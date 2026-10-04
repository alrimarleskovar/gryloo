// SPDX-License-Identifier: AGPL-3.0-only
import { solanaSwapRuntime, type SolanaSwapRuntime, type SolanaSwapToken } from '@defi-workflow-engine/action-registry';
import { hashArtifactBytes, hashSupplyValue, assertPublicWorkflow, type SemanticWorkflow, type ArtifactSet, type SimulationBundle, type AuthorizationPolicy,
  type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { base58Encode, decodeTokenAccount, decompileMessageV0, fromBase64, parseMessageV0, parseTransaction, serializeTransaction, sha256Hex, solanaAddress, toBase64, u32Bytes, verifyEd25519,
  type LookupTables, type SolanaInstruction } from './solana.js';

/**
 * Provider-neutral Solana swap core shared by every runtime of the canonical swap (Jupiter mainnet-beta,
 * Orca Whirlpools Devnet): chain reads, cluster identity, exact-message simulation, owner deltas and the frozen
 * v1 artifact chain. Providers only build and inspect their own instructions. Nothing here signs or sends.
 */
export type SolanaRpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
export type SolanaSwapIntent = { owner: string; input: SolanaSwapToken; output: SolanaSwapToken; amount: string; slippageBps: number };
export type SolanaRouteStep = { label: string; ammKey: string; inputMint: string; outputMint: string; inAmount: string; outAmount: string; bps: number };
export type SolanaSwapQuote = { inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct: string; slippageBps: number;
  routePlan: SolanaRouteStep[]; fetchedAt: string };
export type SolanaBalances = { slot: number; ownerLamports: string; input: string | null; output: string | null };
export type SolanaSwapSimulation = { slot: number; unitsConsumed: number; logs: string[]; pre: SolanaBalances; post: SolanaBalances;
  inputSpent: string; outputReceived: string; accountCreationLamports: string; feeLamports: string };
export type SolanaSwapArtifacts = { artifactSet: ArtifactSet; simulation: SimulationBundle; policy: AuthorizationPolicy; manifest: StrategyManifest; plan: ExecutionPlan };
/** Fields every Solana swap review carries; the reconciler, executor and service depend only on these. */
export type SolanaSwapReviewCore = SolanaSwapArtifacts & { workflow: SemanticWorkflow; chain: string; cluster: 'mainnet-beta' | 'devnet'; owner: string;
  input: { symbol: string; mint: string; decimals: number }; output: { symbol: string; mint: string; decimals: number };
  amount: string; slippageBps: number; quote: SolanaSwapQuote; routeCommitment: string;
  inspection: { programs: string[]; ownerInputAccount: string; ownerOutputAccount: string; wrappedSolAccount: string | null; ensuredAccounts: string[]; swap: unknown };
  lookupTables: Record<string, string[]>; blockhash: string; lastValidBlockHeight: number; computeUnitLimit: number; computeUnitPrice: string;
  estimatedFeeLamports: string; message: string; messageHash: string; unsignedTransaction: string; simulationResult: SolanaSwapSimulation; expiresAt: string; commitment: string };

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
const fail = (code: string): never => { throw new Error(code); };
export const solanaRecord = (value: unknown, code: string): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(code);
export const solanaSwapHash = (value: unknown): string => hashSupplyValue(value);
export const solanaSwapArtifactHash = (kind: Parameters<typeof hashArtifactBytes>[0], value: unknown): string => hashArtifactBytes(kind, new TextEncoder().encode(JSON.stringify(value)));
export function requireSolanaSwapRuntime(chain: string): SolanaSwapRuntime {
  return solanaSwapRuntime(chain) ?? fail('SOLANA_CLUSTER_UNSUPPORTED');
}

export type RawSolanaAccount = { lamports: bigint; owner: string; data: Uint8Array } | null;
export function decodeRpcAccount(value: unknown): RawSolanaAccount {
  if (value === null) return null;
  const a = solanaRecord(value, 'SOLANA_RPC_INVALID');
  if (!Array.isArray(a.data) || a.data[1] !== 'base64' || typeof a.lamports !== 'number' || !Number.isSafeInteger(a.lamports)) fail('SOLANA_RPC_INVALID');
  return { lamports: BigInt(a.lamports as number), owner: solanaAddress(a.owner), data: fromBase64((a.data as unknown[])[0], 1_000_000) };
}
export const rpcContextValue = (value: unknown): Record<string, unknown> => solanaRecord(solanaRecord(value, 'SOLANA_RPC_INVALID').value, 'SOLANA_RPC_INVALID');
export async function readSolanaAccounts(rpc: SolanaRpc, keys: string[]): Promise<{ slot: number; accounts: RawSolanaAccount[] }> {
  const result = solanaRecord(await rpc('getMultipleAccounts', [keys, { encoding: 'base64', commitment: 'confirmed' }]), 'SOLANA_RPC_INVALID');
  const context = solanaRecord(result.context, 'SOLANA_RPC_INVALID');
  if (!Array.isArray(result.value) || result.value.length !== keys.length || !Number.isSafeInteger(context.slot)) fail('SOLANA_RPC_INVALID');
  return { slot: context.slot as number, accounts: (result.value as unknown[]).map(decodeRpcAccount) };
}
/** Owner token balance for an exact (owner, mint) classic SPL token account; absent accounts read as null. */
export function solanaTokenAmount(a: RawSolanaAccount, owner: string, mint: string): string | null {
  // Simulation reports an account closed by the transaction (the temporary wrapped-SOL account) as empty and lamport-free.
  if (!a || a.lamports === 0n && a.data.length === 0) return null;
  const t = decodeTokenAccount(a.data);
  if (a.owner !== TOKEN_PROGRAM || t.owner !== owner || t.mint !== mint) fail('SOLANA_TOKEN_ACCOUNT_MISMATCH');
  return t.amount.toString();
}
/** The RPC must be the expected cluster. Mainnet-beta is the default for the Jupiter runtime. */
export async function verifySolanaCluster(rpc: SolanaRpc, genesisHash = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'): Promise<void> {
  if (await rpc('getGenesisHash', []) !== genesisHash) fail('SOLANA_WRONG_CLUSTER');
}
export async function readSolanaSwapBalances(rpc: SolanaRpc, intent: SolanaSwapIntent, accounts: { ownerInputAccount: string; ownerOutputAccount: string }): Promise<SolanaBalances> {
  const { slot, accounts: read } = await readSolanaAccounts(rpc, [intent.owner, accounts.ownerInputAccount, accounts.ownerOutputAccount]);
  return { slot, ownerLamports: (read[0]?.lamports ?? 0n).toString(),
    input: solanaTokenAmount(read[1]!, intent.owner, intent.input.mint), output: solanaTokenAmount(read[2]!, intent.owner, intent.output.mint) };
}
export function estimateFee(units: number, computeUnitPrice: string, baseFeeLamports = '5000'): string {
  return (BigInt(baseFeeLamports) + (BigInt(units) * BigInt(computeUnitPrice) + 999_999n) / 1_000_000n).toString();
}
/** Economic deltas for the owner. Native SOL is measured on owner lamports with fees and new-account deposits separated. */
export function solanaSwapDeltas(intent: SolanaSwapIntent, pre: SolanaBalances, post: SolanaBalances, fee: bigint, created: bigint, prefix = 'JUPITER'): { inputSpent: bigint; outputReceived: bigint } {
  const lamports = BigInt(post.ownerLamports) - BigInt(pre.ownerLamports) + fee + created;
  const spent = intent.input.native ? -lamports : BigInt(pre.input ?? fail(`${prefix}_INPUT_ACCOUNT_MISSING`)) - BigInt(post.input ?? '0');
  const received = intent.output.native ? lamports : BigInt(post.output ?? '0') - BigInt(pre.output ?? '0');
  return { inputSpent: spent, outputReceived: received };
}
/** The compiled bytes must resolve to exactly the inspected instructions under runtime account rules. */
export function assertMessageRoundTrip(messageBytes: Uint8Array, instructions: SolanaInstruction[], owner: string, tables: LookupTables, prefix = 'JUPITER'): void {
  const writable = new Set([owner, ...instructions.flatMap(i => i.accounts.filter(a => a.isWritable).map(a => a.pubkey))]);
  const normalize = (list: SolanaInstruction[]) => JSON.stringify(list.map(i => ({ programId: i.programId, data: toBase64(i.data),
    accounts: i.accounts.map(a => [a.pubkey, a.pubkey === owner, writable.has(a.pubkey)]) })));
  const decoded = decompileMessageV0(parseMessageV0(messageBytes), tables);
  if (decoded.some(i => i.accounts.some(a => a.isSigner !== (a.pubkey === owner) || a.isWritable !== writable.has(a.pubkey))) ||
      normalize(decoded) !== normalize(instructions)) fail(`${prefix}_MESSAGE_ROUND_TRIP_MISMATCH`);
}
export function setComputeUnitLimit(units: number): SolanaInstruction {
  return { programId: COMPUTE_BUDGET_PROGRAM, accounts: [], data: Uint8Array.from([2, ...u32Bytes(units)]) };
}
/** Read-only `simulateTransaction` of the exact unsigned message; nothing is signed. Returns post-states of `addresses`. */
export async function simulateSolanaMessage(rpc: SolanaRpc, message: Uint8Array, addresses: string[], prefix = 'JUPITER') {
  const tx = toBase64(serializeTransaction(null, message));
  const value = rpcContextValue(await rpc('simulateTransaction', [tx, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses } }]));
  const allLogs = Array.isArray(value.logs) ? (value.logs as unknown[]).filter((l): l is string => typeof l === 'string') : [];
  const logs = allLogs.slice(-40).map(l => l.slice(0, 300));
  if (value.err !== null) throw new Error(`${prefix}_SIMULATION_FAILED`, { cause: { err: value.err, logs } });
  if (!Number.isSafeInteger(value.unitsConsumed) || (value.unitsConsumed as number) <= 0 || !Array.isArray(value.accounts) || value.accounts.length !== addresses.length) fail(`${prefix}_SIMULATION_INVALID`);
  return { unitsConsumed: value.unitsConsumed as number, logs, allLogs: allLogs.slice(-200), accounts: (value.accounts as unknown[]).map(decodeRpcAccount) };
}

/** The frozen v1 artifact chain (ArtifactSet → SimulationBundle → AuthorizationPolicy → StrategyManifest → ExecutionPlan) for one swap. */
export function buildSolanaSwapArtifacts(input: { runtime: SolanaSwapRuntime; workflow: SemanticWorkflow; nodeId: string; intent: SolanaSwapIntent;
  quote: SolanaSwapQuote; quoteArtifact: unknown; messageHash: string; contract: { address: string; version: string }; functionId: string;
  maximumNetworkCostLamports: bigint; lastValidBlockHeight: number; expiresAt: string; reviewTtlSeconds: number }): SolanaSwapArtifacts {
  const { runtime, workflow, intent, quote } = input, prefix = runtime.idPrefix, chain = runtime.chain;
  assertPublicWorkflow(workflow);
  const semanticHash = solanaSwapArtifactHash('semantic-workflow', workflow);
  const inputAsset = { chainId: chain, address: intent.input.mint, decimals: intent.input.decimals };
  const outputAsset = { chainId: chain, address: intent.output.mint, decimals: intent.output.decimals };
  const contract = { chainId: chain, address: input.contract.address, version: input.contract.version };
  const artifactSet: ArtifactSet = { schemaVersion: '1.0.0', artifactSetId: `${prefix}-artifacts`, semanticWorkflowHash: semanticHash,
    artifacts: [{ artifactId: `${prefix}-quote`, nodeId: input.nodeId, artifactHash: solanaSwapHash(input.quoteArtifact) }] };
  const artifactHash = solanaSwapArtifactHash('artifact-set', artifactSet);
  const simulation: SimulationBundle = { schemaVersion: '1.0.0', simulationId: `${prefix}-simulation`, semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash, adapters: [{ id: runtime.adapterId, version: '1.0.0' }], contracts: [contract],
    outputs: [{ nodeId: input.nodeId, outputId: 'amount-out', expected: { asset: outputAsset, amount: quote.outAmount },
      minimum: { asset: outputAsset, amount: quote.otherAmountThreshold }, adverse: { asset: outputAsset, amount: quote.otherAmountThreshold } }],
    propagatedOutputs: [], failurePaths: [], uncertainty: [], unsupportedAssumptions: [],
    freshness: { observedAt: quote.fetchedAt, expiresAt: input.expiresAt, maximumAgeSeconds: input.reviewTtlSeconds } };
  const simulationHash = solanaSwapArtifactHash('simulation-bundle', simulation), owner = { chainId: chain, address: intent.owner };
  const spendLimits = [{ asset: inputAsset, maximumAmount: intent.amount, maximumPerStepAmount: intent.amount, maximumCumulativeAmount: intent.amount }];
  const gasBudgets = [{ asset: { chainId: chain, nativeId: 'SOL', decimals: 9 }, maximumAmount: input.maximumNetworkCostLamports.toString() }];
  const recovery = { failurePolicy: 'ABORT' as const, residualAssetRecipient: owner, maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const providers = { kind: 'FIXED' as const, providerId: runtime.adapterId };
  const policy: AuthorizationPolicy = { schemaVersion: '1.0.0', policyId: `${prefix}-policy`, semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash, simulationHash,
    requiredAuthorizationClass: 'MODE_A', allowlists: { owners: [owner], accounts: [owner], recipients: [owner], chains: [chain],
      adapters: [{ id: runtime.adapterId, version: '1.0.0' }], protocols: [runtime.protocol], contracts: [contract],
      functions: [{ chainId: chain, contract: input.contract.address, functionId: input.functionId }] },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits, maximumSlippageBps: intent.slippageBps, gasBudgets, feeBudgets: [], oracleRules: [], accountRiskRules: [], checkpointRules: [], providers,
    nonce: String(input.lastValidBlockHeight), deadline: input.expiresAt, revocationEpoch: workflow.revision, recovery, enforcement: 'NOT_ENFORCED' };
  const policyHash = solanaSwapArtifactHash('authorization-policy', policy);
  const manifest: StrategyManifest = { schemaVersion: '1.0.0', manifestId: `${prefix}-manifest`, semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: semanticHash,
    artifactSetHash: artifactHash, simulationHash, policyHash, authorizationMode: 'MODE_A', owner, executor: null, expiresAt: input.expiresAt, nonce: String(input.lastValidBlockHeight),
    revocationEpoch: workflow.revision, spendLimits, maximumSlippageBps: intent.slippageBps, gasBudgets, feeBudgets: [], providers, recovery, enforcement: 'NOT_ENFORCED' };
  const manifestHash = solanaSwapArtifactHash('strategy-manifest', manifest);
  const plan: ExecutionPlan = { schemaVersion: '1.0.0', executionPlanId: `${prefix}-plan`, semanticWorkflowHash: semanticHash, manifestHash,
    segments: [{ segmentId: `${prefix}-segment`, chainId: chain, dependencies: [], steps: [{ stepId: `${prefix}-swap`, nodeId: input.nodeId,
      chainId: chain, adapter: { id: runtime.adapterId, version: '1.0.0' }, dependencies: [], requiredAuthorizationClass: 'MODE_A',
      executionKind: 'DIRECT_TRANSACTION', payloadHash: input.messageHash }] }], checkpointIds: [], enforcement: 'NOT_ENFORCED' };
  solanaSwapArtifactHash('execution-plan', plan);
  return { artifactSet, simulation, policy, manifest, plan };
}

/**
 * Review/Execute guard shared by every runtime: commitment, semantic revision, owner, freshness and blockhash validity.
 * `readIntent` re-reads the canonical workflow against the runtime's own profile.
 */
export function assertSolanaSwapReview(review: SolanaSwapReviewCore, workflow: SemanticWorkflow, owner: string, blockHeight: number, now: number,
  readIntent: (workflow: SemanticWorkflow, owner: string) => SolanaSwapIntent, prefix: string): void {
  const { commitment, ...content } = review;
  if (solanaSwapHash(content) !== commitment) fail(`${prefix}_AUTHORIZATION_INVALID`);
  if (solanaSwapArtifactHash('semantic-workflow', workflow) !== review.manifest.semanticWorkflowHash) fail(`${prefix}_SEMANTIC_REVISION_CHANGED`);
  if (owner !== review.owner) fail(`${prefix}_WRONG_OWNER`);
  if (now >= Date.parse(review.expiresAt) || now < Date.parse(review.quote.fetchedAt)) fail(`${prefix}_QUOTE_STALE`);
  if (!Number.isSafeInteger(blockHeight) || blockHeight >= review.lastValidBlockHeight - 20) fail(`${prefix}_QUOTE_STALE`);
  const intent = readIntent(workflow, owner);
  if (intent.amount !== review.amount || intent.input.mint !== review.input.mint || intent.output.mint !== review.output.mint ||
      intent.slippageBps !== review.slippageBps) fail(`${prefix}_SEMANTIC_REVISION_CHANGED`);
  const step = review.plan.segments[0]?.steps[0];
  if (sha256Hex(fromBase64(review.message)) !== review.messageHash || step?.executionKind !== 'DIRECT_TRANSACTION' || step.payloadHash !== review.messageHash ||
      toBase64(serializeTransaction(null, fromBase64(review.message))) !== review.unsignedTransaction) fail(`${prefix}_TRANSACTION_CHANGED`);
}

/** The wallet must return exactly the reviewed message with a valid owner signature. Any modification fails closed. */
export function verifySignedSolanaSwap(review: Pick<SolanaSwapReviewCore, 'message' | 'owner'>, signedBase64: unknown, prefix: string): { signature: string; transaction: string } {
  const bytes = fromBase64(signedBase64, 2048);
  const { signatures, message } = parseTransaction(bytes);
  if (signatures.length !== 1 || toBase64(message) !== review.message) fail(`${prefix}_TRANSACTION_CHANGED`);
  if (!verifyEd25519(signatures[0]!, message, review.owner)) fail(`${prefix}_SIGNATURE_INVALID`);
  return { signature: base58Encode(signatures[0]!), transaction: toBase64(bytes) };
}

/** Every runtime's review. Shared machinery reads only `SolanaSwapReviewCore` fields; `format` identifies the provider. */
export type SolanaSwapReview = import('./jupiter.js').JupiterReview | import('./orca-whirlpool.js').OrcaDevnetReview;
