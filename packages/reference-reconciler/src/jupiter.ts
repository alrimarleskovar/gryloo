// SPDX-License-Identifier: AGPL-3.0-only
import { JUPITER_SOLANA_MAINNET as profile, decompileMessageV0, fromBase64, jupiterArtifactHash, jupiterHash, parseMessageV0, parseTransaction,
  verifySolanaCluster, base58Encode, type JupiterReview, type SolanaRpc } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type EvidenceBundle, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';

export type JupiterChainAttempt = { signature: string | null; transaction: string | null };
export type JupiterObservation = { verdict: 'RECONCILED' | 'DIVERGENT' | 'INCONCLUSIVE'; reason: string; found: boolean; signature: string | null;
  confirmation: string | null; slot: number | null; blockTime: number | null; feeLamports: string | null;
  owner: { lamportsBefore: string; lamportsAfter: string; inputBefore: string; inputAfter: string; outputBefore: string; outputAfter: string } | null;
  inputSpent: string | null; outputReceived: string | null; accountCreationLamports: string | null; minimumOutput: string;
  programs: string[]; innerPrograms: string[]; explorer: string | null };
const fail = (code: string): never => { throw new Error(code); };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail('SOLANA_RPC_INVALID');
const lamportList = (v: unknown, n: number): bigint[] => Array.isArray(v) && v.length === n && v.every(x => Number.isSafeInteger(x) && (x as number) >= 0)
  ? (v as number[]).map(BigInt) : fail('SOLANA_RPC_INVALID');
type TokenBalance = { index: number; mint: string; owner: string; amount: bigint; decimals: number };
function tokenBalances(v: unknown): TokenBalance[] {
  if (!Array.isArray(v)) fail('SOLANA_RPC_INVALID');
  return (v as unknown[]).map(item => {
    const b = record(item), ui = record(b.uiTokenAmount);
    if (!Number.isSafeInteger(b.accountIndex) || typeof b.mint !== 'string' || typeof b.owner !== 'string' || typeof ui.amount !== 'string' ||
        !/^(0|[1-9][0-9]{0,19})$/.test(ui.amount) || !Number.isSafeInteger(ui.decimals) || b.programId !== undefined && b.programId !== profile.programs.token) fail('SOLANA_TOKEN_BALANCE_INVALID');
    return { index: b.accountIndex as number, mint: b.mint as string, owner: b.owner as string, amount: BigInt(ui.amount as string), decimals: ui.decimals as number };
  });
}

/**
 * Independent public-chain reconciliation. Success status alone never reconciles: the finalized transaction must be
 * byte-identical to the owner-signed reviewed transaction, and the owner's balance deltas must match the semantic intent.
 */
export async function reconcileJupiterAttempt(review: JupiterReview, attempt: JupiterChainAttempt, rpc: SolanaRpc): Promise<JupiterObservation> {
  const base: JupiterObservation = { verdict: 'INCONCLUSIVE', reason: 'TRANSACTION_NOT_OBSERVED', found: false, signature: attempt.signature, confirmation: null,
    slot: null, blockTime: null, feeLamports: null, owner: null, inputSpent: null, outputReceived: null, accountCreationLamports: null,
    minimumOutput: review.quote.otherAmountThreshold, programs: [], innerPrograms: [], explorer: attempt.signature ? `${profile.explorer}/tx/${attempt.signature}` : null };
  if (!attempt.signature || !attempt.transaction) return base;
  try {
    await verifySolanaCluster(rpc);
    const signed = fromBase64(attempt.transaction, 2048), parsedSigned = parseTransaction(signed);
    if (base58Encode(parsedSigned.signatures[0]!) !== attempt.signature) fail('JUPITER_SIGNATURE_MISMATCH');
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
    // Exact owner-signed reviewed bytes, not merely a similar transaction.
    if (Buffer.from(fromBase64((tx.transaction as unknown[])[0], 2048)).toString('base64') !== Buffer.from(signed).toString('base64') ||
        Buffer.from(parsedSigned.message).toString('base64') !== review.message) fail('JUPITER_TRANSACTION_MISMATCH');
    if (base.slot < review.simulationResult.slot) fail('JUPITER_SLOT_MISMATCH');
    const message = parseMessageV0(parsedSigned.message);
    const loaded = record(meta.loadedAddresses);
    const instructions = decompileMessageV0(message, review.lookupTables);
    const keys = [...message.staticKeys, ...message.lookups.flatMap(l => l.writable.map(i => review.lookupTables[l.table]![i]!)),
      ...message.lookups.flatMap(l => l.readonly.map(i => review.lookupTables[l.table]![i]!))];
    // On-chain lookup resolution must equal the reviewed resolution.
    if (JSON.stringify(loaded.writable) !== JSON.stringify(keys.slice(message.staticKeys.length, message.staticKeys.length + message.lookups.reduce((n, l) => n + l.writable.length, 0))) ||
        JSON.stringify(loaded.readonly) !== JSON.stringify(keys.slice(message.staticKeys.length + message.lookups.reduce((n, l) => n + l.writable.length, 0)))) fail('JUPITER_LOOKUP_MISMATCH');
    if (keys[0] !== review.owner) fail('JUPITER_OWNER_MISMATCH');
    base.programs = [...new Set(instructions.map(i => i.programId))];
    base.innerPrograms = Array.isArray(meta.innerInstructions) ? [...new Set((meta.innerInstructions as unknown[]).flatMap(group =>
      Array.isArray(record(group).instructions) ? (record(group).instructions as unknown[]).map(i => keys[record(i).programIdIndex as number] ?? fail('SOLANA_RPC_INVALID')) : []))] : [];
    if (!base.programs.includes(profile.programs.jupiter)) fail('JUPITER_PROGRAM_MISMATCH');
    const fee = typeof meta.fee === 'number' && Number.isSafeInteger(meta.fee) ? BigInt(meta.fee) : fail('SOLANA_RPC_INVALID');
    base.feeLamports = fee.toString();
    if (meta.err !== null) return { ...base, verdict: 'DIVERGENT', reason: 'JUPITER_SWAP_FAILED' };
    if (fee > BigInt(review.estimatedFeeLamports)) fail('JUPITER_FEE_MISMATCH');
    const pre = lamportList(meta.preBalances, keys.length), post = lamportList(meta.postBalances, keys.length);
    const preTokens = tokenBalances(meta.preTokenBalances), postTokens = tokenBalances(meta.postTokenBalances);
    const { ownerInputAccount, ownerOutputAccount, wrappedSolAccount } = review.inspection;
    const at = (account: string) => keys.indexOf(account);
    const amountOf = (list: TokenBalance[], account: string, mint: string, decimals: number) => {
      const entry = list.find(b => b.index === at(account));
      if (!entry) return 0n;
      if (entry.mint !== mint || entry.owner !== review.owner || entry.decimals !== decimals) fail('JUPITER_TOKEN_ACCOUNT_MISMATCH');
      return entry.amount;
    };
    // No unrelated owner asset movement: every other owner token account is unchanged.
    for (const entry of [...preTokens, ...postTokens].filter(b => b.owner === review.owner)) {
      const account = keys[entry.index];
      if (account === ownerInputAccount || account === ownerOutputAccount || account === wrappedSolAccount) continue;
      const before = preTokens.find(b => b.index === entry.index)?.amount ?? 0n, after = postTokens.find(b => b.index === entry.index)?.amount ?? 0n;
      if (before !== after) fail('JUPITER_UNRELATED_ASSET_MOVEMENT');
    }
    if (wrappedSolAccount && (at(wrappedSolAccount) < 0 || post[at(wrappedSolAccount)] !== 0n || pre[at(wrappedSolAccount)] !== 0n)) fail('JUPITER_WRAPPED_SOL_NOT_CLOSED');
    const native = (mint: string) => mint === 'So11111111111111111111111111111111111111112';
    const outputIndex = at(ownerOutputAccount);
    // A newly created owner output token account holds a refundable rent deposit paid from owner SOL.
    const created = !native(review.output.mint) && outputIndex >= 0 && pre[outputIndex] === 0n ? post[outputIndex]! : 0n;
    const lamports = post[0]! - pre[0]! + fee + created;
    const inputBefore = native(review.input.mint) ? pre[0]! : amountOf(preTokens, ownerInputAccount, review.input.mint, review.input.decimals);
    const inputAfter = native(review.input.mint) ? post[0]! : amountOf(postTokens, ownerInputAccount, review.input.mint, review.input.decimals);
    const outputBefore = native(review.output.mint) ? pre[0]! : amountOf(preTokens, ownerOutputAccount, review.output.mint, review.output.decimals);
    const outputAfter = native(review.output.mint) ? post[0]! : amountOf(postTokens, ownerOutputAccount, review.output.mint, review.output.decimals);
    const inputSpent = native(review.input.mint) ? -lamports : inputBefore - inputAfter;
    const outputReceived = native(review.output.mint) ? lamports : outputAfter - outputBefore;
    // With no native leg, the owner's SOL may change only by the fee and a new token-account deposit.
    if (!native(review.input.mint) && !native(review.output.mint) && lamports !== 0n) fail('JUPITER_UNRELATED_ASSET_MOVEMENT');
    base.owner = { lamportsBefore: pre[0]!.toString(), lamportsAfter: post[0]!.toString(), inputBefore: inputBefore.toString(), inputAfter: inputAfter.toString(),
      outputBefore: outputBefore.toString(), outputAfter: outputAfter.toString() };
    base.inputSpent = inputSpent.toString(); base.outputReceived = outputReceived.toString(); base.accountCreationLamports = created.toString();
    if (inputSpent !== BigInt(review.amount)) fail('JUPITER_INPUT_DELTA_MISMATCH');
    if (outputReceived <= 0n) fail('JUPITER_DIRECTION_MISMATCH');
    if (outputReceived < BigInt(review.quote.otherAmountThreshold)) fail('JUPITER_MINIMUM_OUTPUT_VIOLATED');
    return { ...base, verdict: 'RECONCILED', reason: 'JUPITER_TRANSACTION_AND_BALANCES_VERIFIED' };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'JUPITER_OBSERVATION_FAILED';
    // Provider failures stay ambiguous; any semantic mismatch fails closed.
    return { ...base, verdict: /MISMATCH|WRONG_CLUSTER|VIOLATED|UNRELATED|NOT_CLOSED/.test(message) ? 'DIVERGENT' : 'INCONCLUSIVE', reason: message };
  }
}

export type JupiterEvidenceClass = 'MOCKED' | 'PUBLIC_READ_ONLY' | 'PUBLIC_EXECUTED';
/** Honest classification: only an owner-initiated, reconciled public mainnet run is PUBLIC_EXECUTED. */
export function classifyJupiterEvidence(input: { provenance: 'PUBLIC_MAINNET' | 'MOCKED'; ownerInitiated: boolean; observation: JupiterObservation | null }): JupiterEvidenceClass {
  if (input.provenance === 'MOCKED') return 'MOCKED';
  return input.ownerInitiated && input.observation?.verdict === 'RECONCILED' ? 'PUBLIC_EXECUTED' : 'PUBLIC_READ_ONLY';
}
export function buildJupiterEvidence(input: { id: string; review: JupiterReview; journal: ExecutionJournal; provenance: 'PUBLIC_MAINNET' | 'MOCKED';
  ownerInitiated: boolean; observation: JupiterObservation }): { bundle: EvidenceBundle; bundleHash: string; evidenceClass: JupiterEvidenceClass; publicExecution: unknown; artifacts: unknown } {
  const o = input.observation, review = input.review;
  const balances = o.owner;
  if (o.verdict !== 'RECONCILED' || !balances || !input.ownerInitiated) return fail('JUPITER_EVIDENCE_NOT_RECONCILED');
  const evidenceClass = classifyJupiterEvidence(input);
  const asset = (side: JupiterReview['input']) => ({ chainId: review.chain, address: side.mint, decimals: side.decimals });
  const publicExecution = { network: profile.network, cluster: review.cluster, chain: review.chain, provider: 'Jupiter Swap API V2 /build (Metis)',
    officialSource: profile.officialSource, explorer: o.explorer, owner: review.owner, inputMint: review.input.mint, outputMint: review.output.mint,
    requestedInput: review.amount, quotedOutput: review.quote.outAmount, minimumOutput: review.quote.otherAmountThreshold, slippageBps: review.slippageBps,
    actualInputDelta: o.inputSpent, actualOutputDelta: o.outputReceived, signature: o.signature, slot: o.slot, blockTime: o.blockTime, confirmation: o.confirmation,
    feeLamports: o.feeLamports, accountCreationLamports: o.accountCreationLamports, balances: o.owner, route: review.quote.routePlan, routeCommitment: review.routeCommitment,
    swapInstruction: review.inspection.swap, programs: o.programs, innerPrograms: o.innerPrograms, messageHash: review.messageHash,
    verdict: o.verdict, reason: o.reason, provenance: input.provenance, evidenceClass, ownerInitiated: input.ownerInitiated };
  const head = hashJournalBytes(new TextEncoder().encode(JSON.stringify(input.journal))).at(-1) ?? fail('JUPITER_JOURNAL_EMPTY');
  const bundle: EvidenceBundle = { schemaVersion: '1.0.0', evidenceBundleId: input.id, version: 1, supersedes: null,
    semanticWorkflowHash: review.manifest.semanticWorkflowHash, artifactSetHash: review.manifest.artifactSetHash, simulationHash: review.manifest.simulationHash,
    policyHash: review.manifest.policyHash, manifestHash: jupiterArtifactHash('strategy-manifest', review.manifest), executionPlanHash: jupiterArtifactHash('execution-plan', review.plan),
    journalHeadHash: head, observedAt: new Date().toISOString(), environment: input.provenance === 'PUBLIC_MAINNET' ? 'MAINNET_EXECUTED' : 'MOCKED', outcome: 'RECONCILED',
    receipts: [{ receiptId: 'jupiter-transaction', contentHash: jupiterHash(o) }], differences: [],
    reconciliation: { balances: [{ asset: asset(review.input), amount: balances.inputAfter }, { asset: asset(review.output), amount: balances.outputAfter }],
      allowances: [], debt: [], positions: [], fees: [{ asset: { chainId: review.chain, nativeId: 'SOL', decimals: 9 }, amount: o.feeLamports ?? '0' }], residualAssets: [],
      ownership: [{ chainId: review.chain, address: review.owner }],
      limitations: ['Balances are finalized transaction metadata for the exact owner-signed reviewed bytes.', 'Native SOL deltas exclude the network fee and any new token-account deposit.'] },
    evidence: [{ evidenceId: 'jupiter-public-observations', kind: 'EXTERNAL_REFERENCE', contentHash: jupiterHash(publicExecution) }] };
  return { bundle, bundleHash: jupiterArtifactHash('evidence-bundle', bundle), evidenceClass, publicExecution,
    artifacts: { workflow: review.workflow, artifactSet: review.artifactSet, simulation: review.simulation, policy: review.policy, manifest: review.manifest, plan: review.plan, journal: input.journal, review } };
}
