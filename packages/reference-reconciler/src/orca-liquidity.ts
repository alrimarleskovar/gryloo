// SPDX-License-Identifier: AGPL-3.0-only
import { ORCA_LIQUIDITY_INNER_PROGRAMS, ORCA_LIQUIDITY_TOP_LEVEL_PROGRAMS, ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY as profile, assessOrcaLiquidityEffects, base58Encode, decompileMessageV0, fromBase64,
  parseMessageV0, parseTransaction, solanaSwapArtifactHash, solanaSwapHash, summarizeOrcaLiquidityInstructions, verifyEd25519, verifySolanaCluster,
  type OrcaLiquidityBalances, type OrcaLiquidityEvent, type OrcaLiquidityReview, type OrcaLiquiditySimulation, type SolanaRpc } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type EvidenceBundle, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';

export type OrcaLiquidityEffects = Omit<OrcaLiquiditySimulation, 'slot' | 'unitsConsumed' | 'logs' | 'pre' | 'post'>;
export type OrcaLiquidityObservation = { verdict: 'RECONCILED' | 'DIVERGENT' | 'INCONCLUSIVE'; reason: string; found: boolean; signature: string | null;
  confirmation: string | null; slot: number | null; blockTime: number | null; feeLamports: string | null; transactionFailed: boolean;
  owner: { lamportsBefore: string; lamportsAfter: string; tokenBBefore: string | null; tokenBAfter: string | null } | null;
  vaults: { aBefore: string; aAfter: string; bBefore: string; bAfter: string } | null;
  positionAuthority: { tokenAccount: string; owner: string; amount: string } | null;
  effects: OrcaLiquidityEffects | null; events: OrcaLiquidityEvent[]; instructions: string[]; programs: string[]; innerPrograms: string[]; signers: string[];
  explorer: string | null };
const fail = (code: string): never => { throw new Error(code); };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail('SOLANA_RPC_INVALID');
const lamportList = (v: unknown, n: number): bigint[] => Array.isArray(v) && v.length === n && v.every(x => Number.isSafeInteger(x) && (x as number) >= 0)
  ? (v as number[]).map(BigInt) : fail('SOLANA_RPC_INVALID');
type TokenBalance = { index: number; mint: string; owner: string; amount: bigint; programId: string };
function tokenBalances(v: unknown): TokenBalance[] {
  if (!Array.isArray(v)) fail('SOLANA_RPC_INVALID');
  return (v as unknown[]).map(item => {
    const b = record(item), ui = record(b.uiTokenAmount);
    const programId = b.programId === undefined ? profile.programs.token : b.programId;
    if (!Number.isSafeInteger(b.accountIndex) || typeof b.mint !== 'string' || typeof b.owner !== 'string' || typeof ui.amount !== 'string' ||
        !/^(0|[1-9][0-9]{0,19})$/.test(ui.amount) || programId !== profile.programs.token && programId !== profile.programs.token2022) fail('SOLANA_TOKEN_BALANCE_INVALID');
    return { index: b.accountIndex as number, mint: b.mint as string, owner: b.owner as string, amount: BigInt(ui.amount as string), programId: programId as string };
  });
}
export const orcaLiquidityExplorer = (signature: string) => `${profile.explorer}/tx/${signature}?cluster=devnet`;

/**
 * Independent finalized reconciliation of one liquidity operation. RPC success alone never reconciles: the transaction must
 * be byte-identical to the reviewed message with valid signatures from exactly the reviewed signers, invoke only allowlisted
 * programs, emit exactly the planned Orca events, and every owner, vault and position balance must be explained.
 */
export async function reconcileOrcaLiquidityAttempt(review: OrcaLiquidityReview, attempt: { signature: string | null; transaction: string | null },
  rpc: SolanaRpc): Promise<OrcaLiquidityObservation> {
  const base: OrcaLiquidityObservation = { verdict: 'INCONCLUSIVE', reason: 'TRANSACTION_NOT_OBSERVED', found: false, signature: attempt.signature, confirmation: null,
    slot: null, blockTime: null, feeLamports: null, transactionFailed: false, owner: null, vaults: null, positionAuthority: null, effects: null, events: [],
    instructions: [], programs: [], innerPrograms: [], signers: review.signers, explorer: attempt.signature ? orcaLiquidityExplorer(attempt.signature) : null };
  if (!attempt.signature || !attempt.transaction) return base;
  try {
    await verifySolanaCluster(rpc, profile.genesisHash);
    const signed = fromBase64(attempt.transaction, 2048), parsedSigned = parseTransaction(signed);
    if (base58Encode(parsedSigned.signatures[0]!) !== attempt.signature) fail('ORCA_LIQUIDITY_SIGNATURE_MISMATCH');
    const statuses = record(await rpc('getSignatureStatuses', [[attempt.signature], { searchTransactionHistory: true }]));
    const status = Array.isArray(statuses.value) ? statuses.value[0] : fail('SOLANA_RPC_INVALID');
    if (!status) return base;
    const s = record(status);
    base.found = true; base.confirmation = typeof s.confirmationStatus === 'string' ? s.confirmationStatus : null;
    if (s.confirmationStatus !== 'finalized') return { ...base, reason: 'AWAITING_FINALITY' };
    const value = await rpc('getTransaction', [attempt.signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    if (!value) return { ...base, reason: 'AWAITING_FINALITY' };
    const tx = record(value), meta = record(tx.meta);
    if (!Array.isArray(tx.transaction) || tx.transaction[1] !== 'base64' || tx.version !== 0 || !Number.isSafeInteger(tx.slot)) fail('SOLANA_RPC_INVALID');
    base.slot = tx.slot as number; base.blockTime = Number.isSafeInteger(tx.blockTime) ? tx.blockTime as number : null;
    // Exact reviewed, fully signed bytes; every reviewed signer's Ed25519 signature re-verified independently.
    const onChain = fromBase64((tx.transaction as unknown[])[0], 2048), parsed = parseTransaction(onChain);
    if (Buffer.from(onChain).toString('base64') !== Buffer.from(signed).toString('base64') || Buffer.from(parsed.message).toString('base64') !== review.message)
      fail('ORCA_LIQUIDITY_TRANSACTION_MISMATCH');
    if (parsed.signatures.length !== review.signers.length || review.signers.some((signer, i) => !verifyEd25519(parsed.signatures[i]!, parsed.message, signer)))
      fail('ORCA_LIQUIDITY_SIGNATURE_MISMATCH');
    if (base.slot < review.simulationResult.slot) fail('ORCA_LIQUIDITY_SLOT_MISMATCH');
    const message = parseMessageV0(parsed.message), keys = message.staticKeys;
    const loaded = record(meta.loadedAddresses);
    if (message.lookups.length || (Array.isArray(loaded.writable) && loaded.writable.length) || (Array.isArray(loaded.readonly) && loaded.readonly.length))
      fail('ORCA_LIQUIDITY_LOOKUP_MISMATCH');
    if (keys[0] !== review.owner) fail('ORCA_LIQUIDITY_OWNER_MISMATCH');
    const instructions = decompileMessageV0(message, {});
    base.instructions = summarizeOrcaLiquidityInstructions(instructions).map(i => i.name);
    if (JSON.stringify(base.instructions) !== JSON.stringify(review.instructionSummary.map(i => i.name))) fail('ORCA_LIQUIDITY_INSTRUCTION_MISMATCH');
    base.programs = [...new Set(instructions.map(i => i.programId))];
    base.innerPrograms = Array.isArray(meta.innerInstructions) ? [...new Set((meta.innerInstructions as unknown[]).flatMap(group =>
      Array.isArray(record(group).instructions) ? (record(group).instructions as unknown[]).map(i => keys[record(i).programIdIndex as number] ?? fail('SOLANA_RPC_INVALID')) : []))] : [];
    if (!base.programs.includes(profile.programs.whirlpool) || base.programs.some(p => !ORCA_LIQUIDITY_TOP_LEVEL_PROGRAMS.includes(p)) ||
        base.innerPrograms.some(p => !ORCA_LIQUIDITY_INNER_PROGRAMS.includes(p))) fail('ORCA_LIQUIDITY_UNEXPECTED_PROGRAM');
    const fee = typeof meta.fee === 'number' && Number.isSafeInteger(meta.fee) ? BigInt(meta.fee) : fail('SOLANA_RPC_INVALID');
    base.feeLamports = fee.toString();
    if (meta.err !== null) return { ...base, transactionFailed: true, verdict: 'DIVERGENT', reason: 'ORCA_LIQUIDITY_TRANSACTION_FAILED' };
    if (fee > BigInt(review.estimatedFeeLamports)) fail('ORCA_LIQUIDITY_FEE_MISMATCH');
    const pre = lamportList(meta.preBalances, keys.length), post = lamportList(meta.postBalances, keys.length);
    const preTokens = tokenBalances(meta.preTokenBalances), postTokens = tokenBalances(meta.postTokenBalances);
    const a = review.accounts, at = (account: string) => keys.indexOf(account);
    const tokenAt = (list: TokenBalance[], account: string, owner: string, mint: string): string | null => {
      const entry = list.find(b => b.index === at(account));
      if (!entry) return null;
      if (entry.mint !== mint || entry.owner !== owner) fail('ORCA_LIQUIDITY_TOKEN_ACCOUNT_MISMATCH');
      return entry.amount.toString();
    };
    const lamportsAt = (list: bigint[], account: string) => at(account) < 0 ? 0n : list[at(account)]!;
    const balances = (lamports: bigint[], tokens: TokenBalance[]): OrcaLiquidityBalances => ({ slot: base.slot!, ownerLamports: lamports[0]!.toString(),
      tokenA: tokenAt(tokens, a.ownerTokenA, review.owner, review.token0.mint), tokenB: tokenAt(tokens, a.ownerTokenB, review.owner, review.token1.mint), position: null,
      positionLamports: lamportsAt(lamports, a.position).toString(), positionMintLamports: lamportsAt(lamports, a.positionMint).toString(),
      positionTokenLamports: lamportsAt(lamports, a.positionTokenAccount).toString(),
      vaultA: tokenAt(tokens, a.vaultA, profile.pool.address, review.token0.mint) ?? fail('ORCA_LIQUIDITY_VAULT_MISSING'),
      vaultB: tokenAt(tokens, a.vaultB, profile.pool.address, review.token1.mint) ?? fail('ORCA_LIQUIDITY_VAULT_MISSING') });
    const before = balances(pre, preTokens), after = balances(post, postTokens);
    // No unexpected recipient or asset movement: every other token account and every other lamport balance is unchanged.
    const explained = new Set([a.ownerTokenA, a.ownerTokenB, a.positionTokenAccount, a.vaultA, a.vaultB]);
    for (const index of new Set([...preTokens, ...postTokens].map(b => b.index))) {
      if (explained.has(keys[index]!)) continue;
      if ((preTokens.find(b => b.index === index)?.amount ?? 0n) !== (postTokens.find(b => b.index === index)?.amount ?? 0n)) fail('ORCA_LIQUIDITY_UNEXPECTED_TOKEN_MOVEMENT');
    }
    const lamportExplained = new Set([review.owner, a.ownerTokenA, a.ownerTokenB, a.position, a.positionMint, a.positionTokenAccount, a.vaultA]);
    keys.forEach((key, i) => { if (!lamportExplained.has(key) && pre[i] !== post[i]) fail('ORCA_LIQUIDITY_UNEXPECTED_LAMPORT_MOVEMENT'); });
    // Position authority at transaction time: the owner holds exactly one position token (OPEN) or held it until the burn (EXIT).
    const positionToken = (list: TokenBalance[]) => list.find(b => b.index === at(a.positionTokenAccount)) ?? null;
    const authority = review.operation === 'EXIT' ? positionToken(preTokens) : positionToken(postTokens);
    if (!authority || authority.programId !== profile.programs.token2022 || authority.owner !== review.owner || authority.mint !== a.positionMint || authority.amount !== 1n)
      return fail('ORCA_POSITION_AUTHORITY_MISMATCH');
    if (review.operation === 'EXIT' && positionToken(postTokens)) fail('ORCA_POSITION_NOT_CLOSED');
    base.positionAuthority = { tokenAccount: a.positionTokenAccount, owner: authority.owner, amount: authority.amount.toString() };
    base.owner = { lamportsBefore: before.ownerLamports, lamportsAfter: after.ownerLamports, tokenBBefore: before.tokenB, tokenBAfter: after.tokenB };
    base.vaults = { aBefore: before.vaultA, aAfter: after.vaultA, bBefore: before.vaultB, bAfter: after.vaultB };
    const logs = Array.isArray(meta.logMessages) ? (meta.logMessages as unknown[]).filter((l): l is string => typeof l === 'string') : fail('SOLANA_RPC_INVALID');
    const effects = assessOrcaLiquidityEffects({ operation: review.operation, plan: review.operationPlan, accounts: a, pre: before, post: after, logs,
      feeLamports: fee, owner: review.owner, positionState: false });
    base.effects = effects; base.events = effects.events;
    return { ...base, verdict: 'RECONCILED', reason: 'ORCA_LIQUIDITY_TRANSACTION_AND_BALANCES_VERIFIED' };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'ORCA_LIQUIDITY_OBSERVATION_FAILED';
    // Provider failures stay ambiguous; any semantic mismatch fails closed.
    return { ...base, verdict: /MISMATCH|WRONG_CLUSTER|VIOLATED|UNEXPECTED|NOT_CLOSED|EXCEEDED|MISSING/.test(message) ? 'DIVERGENT' : 'INCONCLUSIVE', reason: message };
  }
}

export type OrcaLiquidityEvidenceClass = 'MOCKED' | 'PUBLIC_READ_ONLY' | 'DEVNET_EXECUTED';
/** Only an owner-initiated, independently reconciled public Devnet run is DEVNET_EXECUTED. Never mainnet evidence. */
export function classifyOrcaLiquidityEvidence(input: { provenance: 'PUBLIC_DEVNET' | 'MOCKED'; ownerInitiated: boolean; observation: OrcaLiquidityObservation | null }): OrcaLiquidityEvidenceClass {
  if (input.provenance === 'MOCKED') return 'MOCKED';
  return input.ownerInitiated && input.observation?.verdict === 'RECONCILED' ? 'DEVNET_EXECUTED' : 'PUBLIC_READ_ONLY';
}
export function buildOrcaLiquidityEvidence(input: { id: string; review: OrcaLiquidityReview; journal: ExecutionJournal; provenance: 'PUBLIC_DEVNET' | 'MOCKED';
  ownerInitiated: boolean; observation: OrcaLiquidityObservation; lifecycle: unknown }) {
  const o = input.observation, review = input.review, effects = o.effects;
  if (o.verdict !== 'RECONCILED' || !effects || !o.owner || !input.ownerInitiated) return fail('ORCA_LIQUIDITY_EVIDENCE_NOT_RECONCILED');
  const evidenceClass = classifyOrcaLiquidityEvidence(input);
  const asset = (t: OrcaLiquidityReview['token0']) => ({ chainId: review.chain, address: t.mint, decimals: t.decimals });
  const publicExecution = { environment: evidenceClass, network: 'Solana Devnet', cluster: 'devnet', chain: review.chain, genesisHash: profile.genesisHash,
    provider: 'Orca Whirlpools (Solana Devnet)', program: profile.programs.whirlpool, officialSource: profile.officialSource, explorer: o.explorer,
    operation: review.operation, owner: review.owner, pool: review.pool.address, whirlpoolsConfig: review.whirlpoolsConfig, token0: review.token0, token1: review.token1,
    positionMint: review.accounts.positionMint, position: review.accounts.position, positionTokenAccount: review.accounts.positionTokenAccount,
    positionAuthority: o.positionAuthority, tickLower: review.range.tickLower, tickUpper: review.range.tickUpper, lowerPrice: review.range.lowerPrice, upperPrice: review.range.upperPrice,
    reviewedPoolPrice: review.pool.price, reviewedPoolTick: review.pool.tickCurrentIndex, liquidityDelta: review.operationPlan.liquidityDelta,
    tokenBounds: { a: review.operationPlan.tokenA, b: review.operationPlan.tokenB }, slippageBps: review.intent.slippageBps,
    deposited: { a: effects.depositedA, b: effects.depositedB }, withdrawnPrincipal: { a: effects.withdrawnPrincipalA, b: effects.withdrawnPrincipalB },
    collectedFees: { a: effects.collectedFeesA, b: effects.collectedFeesB }, rentPaidLamports: effects.rentPaidLamports, rentRefundedLamports: effects.rentRefundedLamports,
    createdAccounts: effects.createdAccounts, closedAccounts: effects.closedAccounts, events: o.events, signature: o.signature, signers: o.signers, slot: o.slot,
    blockTime: o.blockTime, confirmation: o.confirmation, feeLamports: o.feeLamports, ownerBalances: o.owner, vaults: o.vaults, instructions: o.instructions,
    programs: o.programs, innerPrograms: o.innerPrograms, messageHash: review.messageHash, lifecycle: input.lifecycle, verdict: o.verdict, reason: o.reason,
    provenance: input.provenance, evidenceClass, ownerInitiated: input.ownerInitiated, realFunds: false };
  const head = hashJournalBytes(new TextEncoder().encode(JSON.stringify(input.journal))).at(-1) ?? fail('ORCA_LIQUIDITY_JOURNAL_EMPTY');
  // The frozen v1 environment enum has no Devnet member: Devnet maps to TESTNET_EXECUTED, never MAINNET_EXECUTED.
  const environment = input.provenance === 'MOCKED' ? 'MOCKED' as const : 'TESTNET_EXECUTED' as const;
  const limitations = ['Balances are finalized transaction metadata for the exact fully signed reviewed bytes.',
    'Withdrawn principal is taken from Orca LiquidityDecreased events; collected fees are the remaining vault outflow. Principal is never counted as fees.',
    'Native SOL deltas exclude the network fee and refundable account deposits, which are reported separately.',
    'Solana Devnet with valueless test tokens (Gryloo evidence class DEVNET_EXECUTED). Not mainnet execution and not real funds.'];
  const bundle: EvidenceBundle = { schemaVersion: '1.0.0', evidenceBundleId: input.id, version: 1, supersedes: null,
    semanticWorkflowHash: review.manifest.semanticWorkflowHash, artifactSetHash: review.manifest.artifactSetHash, simulationHash: review.manifest.simulationHash,
    policyHash: review.manifest.policyHash, manifestHash: solanaSwapArtifactHash('strategy-manifest', review.manifest), executionPlanHash: solanaSwapArtifactHash('execution-plan', review.plan),
    journalHeadHash: head, observedAt: new Date().toISOString(), environment, outcome: 'RECONCILED',
    receipts: [{ receiptId: `orca-liquidity-${review.operation.toLowerCase()}-transaction`, contentHash: solanaSwapHash(o) }], differences: [],
    reconciliation: { balances: [{ asset: asset(review.token1), amount: o.owner.tokenBAfter ?? '0' }], allowances: [], debt: [],
      positions: review.operation === 'EXIT' ? [] : [{ asset: { chainId: review.chain, address: profile.programs.whirlpool, decimals: 0 }, amount: '1' }],
      fees: [{ asset: { chainId: review.chain, nativeId: 'SOL', decimals: 9 }, amount: o.feeLamports ?? '0' }], residualAssets: [],
      ownership: [{ chainId: review.chain, address: review.owner }], limitations },
    evidence: [{ evidenceId: 'orca-liquidity-public-observations', kind: 'EXTERNAL_REFERENCE', contentHash: solanaSwapHash(publicExecution) }] };
  return { bundle, bundleHash: solanaSwapArtifactHash('evidence-bundle', bundle), evidenceClass, publicExecution,
    artifacts: { workflow: review.workflow, artifactSet: review.artifactSet, simulation: review.simulation, policy: review.policy, manifest: review.manifest, plan: review.plan,
      journal: input.journal, review } };
}
