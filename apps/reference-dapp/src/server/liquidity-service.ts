// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-006 isolated Mode A Uniswap v3 service. No signer or public RPC route is accepted. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, liquidityDetails, validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import { buildLiquidityPayload, encodeLiquidityCall, rangeComposition, verifyLiquidityPayload,
  LIQUIDITY_FACTORY, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER,
  type LiquidityCall, type PoolState } from '@defi-workflow-engine/reference-compiler';
import { advanceLiquidityAttempt, appendJournalState, classifyLiquidityUnknown, createJournal, markLiquidityReconciled, newLiquidityJournal, prepareLiquidityAttempt,
  type LiquidityJournal, type LiquidityStep } from '@defi-workflow-engine/reference-executor';
import { buildEvidenceBundle, reconcileLiquidity, verifySignedPayload, type LiquidityRead, type PositionRead, type LiquidityReconciliation } from '@defi-workflow-engine/reference-reconciler';
import { hashArtifactBytes, hashJournalBytes, hashRawBytes, type EvidenceBundle, type ExecutionJournal, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { writeExtendingFile } from '@defi-workflow-engine/reference-executor';
import { fromHex, toHex } from '@defi-workflow-engine/reference-compiler';
import { type ModeAProfile, parseModeAProfile, opStackFee } from './mode-a-service';

const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
  actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const text = new TextEncoder();
const hash = (value: string) => /^0x[0-9a-f]{64}$/.test(value);
const address = (value: string) => /^0x[0-9a-f]{40}$/.test(value);
const word = (n: bigint) => n.toString(16).padStart(64, '0');
const addressWord = (value: string) => value.slice(2).padStart(64, '0');
const hex = (value: bigint) => `0x${value.toString(16)}`;
const number = (value: unknown) => { if (typeof value !== 'string' || !/^0x[0-9a-f]+$/.test(value)) throw new Error('LIQUIDITY_RPC_INVALID'); return BigInt(value); };
const sha = (value: Uint8Array | string) => `0x${createHash('sha256').update(value).digest('hex')}`;
function gasForCall(call: LiquidityCall): bigint {
  return call.kind === 'APPROVE' ? 150_000n : call.kind === 'MINT' ? 1_500_000n :
    call.kind === 'INCREASE' ? 1_000_000n : call.kind === 'DECREASE' ? 900_000n :
      call.kind === 'COLLECT' ? 750_000n : 450_000n;
}
const selector = (value: string) => {
  // Keccak selectors are compile-time-pinned here; no runtime dependency on a public ABI endpoint.
  const values: Record<string, string> = { getPool: '1698ee82', factory: 'c45a0155', WETH9: '4aa4a4fc', token0: '0dfe1681',
    token1: 'd21220a7', fee: 'ddca3f43', tickSpacing: 'd0c93a7c', slot0: '3850c7bd', ownerOf: '6352211e',
    positions: '99fbab88', balanceOf: '70a08231', allowance: 'dd62ed3e' };
  const result = values[value]; if (!result) throw new Error('LIQUIDITY_SELECTOR_INVALID'); return `0x${result}`;
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LIQUIDITY_RPC_INVALID');
  return value as Record<string, unknown>;
}
function resultWord(value: unknown, index = 0): bigint {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{64})+$/.test(value) || value.length < 2 + 64 * (index + 1)) throw new Error('LIQUIDITY_RPC_INVALID');
  return BigInt(`0x${value.slice(2 + 64 * index, 66 + 64 * index)}`);
}
function resultAddress(value: unknown, index = 0): string {
  const n = resultWord(value, index); if (n >> 160n) throw new Error('LIQUIDITY_RPC_INVALID');
  return `0x${n.toString(16).padStart(40, '0')}`;
}
function signed24(value: bigint): number {
  const n = value & ((1n << 24n) - 1n); return Number(n >= (1n << 23n) ? n - (1n << 24n) : n);
}
export type LiquidityProfile = ModeAProfile & {
  readonly liquidity: { readonly pool: string; readonly fee: 500; readonly poolCodeHash: string;
    readonly managerCodeHash: string; readonly factoryCodeHash: string; readonly usdcCodeHash: string; readonly wethCodeHash: string };
};
export function parseLiquidityProfile(value: unknown): LiquidityProfile {
  const entry = record(value);
  const baseValue = { ...entry }; delete baseValue.liquidity;
  const base = parseModeAProfile(baseValue);
  const pins = record(entry.liquidity);
  if (Object.keys(pins).sort().join() !== ['pool', 'fee', 'poolCodeHash', 'managerCodeHash', 'factoryCodeHash', 'usdcCodeHash', 'wethCodeHash'].sort().join()
    || typeof pins.pool !== 'string' || !address(pins.pool) || pins.fee !== 500
    || ['poolCodeHash', 'managerCodeHash', 'factoryCodeHash', 'usdcCodeHash', 'wethCodeHash'].some(key => typeof pins[key] !== 'string' || !hash(pins[key] as string)))
    throw new Error('LIQUIDITY_PROFILE_INVALID');
  return { ...base, liquidity: pins as LiquidityProfile['liquidity'] };
}
export type ForkCall = (method: string, params?: readonly unknown[]) => Promise<unknown>;
export type LiquidityOperation = 'APPROVE_WETH' | 'APPROVE_USDC' | 'MINT' | 'INCREASE' | 'DECREASE_PARTIAL' | 'COLLECT_PARTIAL'
  | 'DECREASE_FULL' | 'COLLECT_FINAL' | 'BURN' | 'RESET_WETH' | 'RESET_USDC';
const stepFor: Record<LiquidityOperation, LiquidityStep> = { APPROVE_WETH: 'approve-weth', APPROVE_USDC: 'approve-usdc',
  MINT: 'mint', INCREASE: 'increase', DECREASE_PARTIAL: 'decrease-partial', COLLECT_PARTIAL: 'collect-partial',
  DECREASE_FULL: 'decrease-full', COLLECT_FINAL: 'collect-final', BURN: 'burn', RESET_WETH: 'reset-weth', RESET_USDC: 'reset-usdc' };
export type PreparedLiquidity = { readonly format: 'gryloo.liquidity-prepared.v1'; readonly executionId: string;
  readonly operation: LiquidityOperation; readonly step: LiquidityStep; readonly workflowId: string; readonly workflowHash: string; readonly revision: number;
  readonly profileHash: string; readonly pool: string; readonly poolBlockHash: string; readonly poolTick: number;
  readonly sqrtPriceX96: string; readonly composition: { readonly state: string; readonly liquidity: string; readonly amount0: string; readonly amount1: string };
  readonly owner: string; readonly tokenId: string | null; readonly before: SerializedRead; readonly call: SerializedCall;
  readonly bytes: string; readonly payloadHash: string; readonly signingHash: string; readonly nonce: string;
  readonly gasLimit: string; readonly maxFeePerGas: string; readonly deadline: string; readonly preparedAt: string;
  readonly simulation: { readonly gasUsed: string; readonly status: 'SUCCESS'; readonly rawHash: string };
  readonly artifacts: { readonly quote: unknown; readonly artifactSet: unknown; readonly simulation: unknown; readonly policy: unknown;
    readonly manifest: unknown; readonly plan: unknown; readonly matrix: unknown; readonly hashes: {
    readonly quoteHash: string; readonly artifactSetHash: string; readonly simulationHash: string; readonly policyHash: string;
    readonly manifestHash: string; readonly planHash: string; readonly matrixHash: string; readonly simulationRawHash: string } };
};
type SerializedRead = { readonly blockHash: string; readonly owner: string; readonly nonce: string; readonly weth: string; readonly usdc: string;
  readonly eth: string; readonly wethAllowance: string; readonly usdcAllowance: string; readonly position: null | {
    readonly tokenId: string; readonly owner: string; readonly token0: string; readonly token1: string; readonly fee: number;
    readonly tickLower: number; readonly tickUpper: number; readonly liquidity: string; readonly owed0: string; readonly owed1: string;
    readonly feeGrowth0: string; readonly feeGrowth1: string } };
type SerializedCall = { readonly kind: LiquidityCall['kind']; readonly fields: Record<string, string | number> };
function serializeCall(call: LiquidityCall): SerializedCall {
  return { kind: call.kind, fields: Object.fromEntries(Object.entries(call).filter(([key]) => key !== 'kind').map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value])) };
}
function deserializeCall(value: SerializedCall): LiquidityCall {
  const kind = value.kind;
  const data = Object.fromEntries(Object.entries(value.fields).map(([key, field]) => [key,
    ['amount', 'tokenId', 'amount0Desired', 'amount1Desired', 'amount0Min', 'amount1Min', 'liquidity', 'deadline', 'amount0Max', 'amount1Max'].includes(key)
      ? BigInt(field) : field]));
  return { ...data, kind } as LiquidityCall;
}
function serializeRead(value: LiquidityRead): SerializedRead {
  const position = value.position;
  return { blockHash: value.blockHash, owner: value.owner, nonce: value.nonce.toString(), weth: value.weth.toString(), usdc: value.usdc.toString(),
    eth: value.eth.toString(), wethAllowance: value.wethAllowance.toString(), usdcAllowance: value.usdcAllowance.toString(),
    position: position && { tokenId: position.tokenId.toString(), owner: position.owner, token0: position.token0, token1: position.token1,
      fee: position.fee, tickLower: position.tickLower, tickUpper: position.tickUpper, liquidity: position.liquidity.toString(),
      owed0: position.owed0.toString(), owed1: position.owed1.toString(), feeGrowth0: position.feeGrowth0.toString(), feeGrowth1: position.feeGrowth1.toString() } };
}
function deserializeRead(value: SerializedRead): LiquidityRead {
  const p = value.position;
  return { blockHash: value.blockHash, owner: value.owner, nonce: BigInt(value.nonce), weth: BigInt(value.weth), usdc: BigInt(value.usdc),
    eth: BigInt(value.eth), wethAllowance: BigInt(value.wethAllowance), usdcAllowance: BigInt(value.usdcAllowance),
    position: p && { tokenId: BigInt(p.tokenId), owner: p.owner, token0: p.token0, token1: p.token1, fee: p.fee,
      tickLower: p.tickLower, tickUpper: p.tickUpper, liquidity: BigInt(p.liquidity), owed0: BigInt(p.owed0), owed1: BigInt(p.owed1),
      feeGrowth0: BigInt(p.feeGrowth0), feeGrowth1: BigInt(p.feeGrowth1) } };
}
type SerializedReconciliation = { readonly outcome: LiquidityReconciliation['outcome']; readonly code: string;
  readonly totalEthFee: string | null; readonly amountWeth: string | null; readonly amountUsdc: string | null;
  readonly positionTokenId: string | null; readonly remainingWethAllowance: string | null; readonly remainingUsdcAllowance: string | null };
function serializeReconciliation(value: LiquidityReconciliation): SerializedReconciliation {
  return { outcome: value.outcome, code: value.code, totalEthFee: value.totalEthFee?.toString() ?? null,
    amountWeth: value.amountWeth?.toString() ?? null, amountUsdc: value.amountUsdc?.toString() ?? null,
    positionTokenId: value.positionTokenId?.toString() ?? null,
    remainingWethAllowance: value.remainingWethAllowance?.toString() ?? null,
    remainingUsdcAllowance: value.remainingUsdcAllowance?.toString() ?? null };
}
export type LiquidityStatus = { readonly prepared: PreparedLiquidity | null; readonly journal: LiquidityJournal | null;
  readonly reconciliation: SerializedReconciliation | null; readonly transactionHash: string | null;
  readonly evidence: { readonly bundle: EvidenceBundle; readonly evidenceBundleHash: string } | null;
  readonly canonicalJournal: ExecutionJournal | null };

function compileArtifacts(input: { readonly workflow: SemanticWorkflow; readonly workflowHash: string; readonly step: LiquidityStep;
  readonly callValue: LiquidityCall; readonly pool: PoolState; readonly at: { readonly hash: string; readonly number: number;
    readonly timestamp: bigint; readonly baseFee: bigint }; readonly before: LiquidityRead;
  readonly composition: ReturnType<typeof rangeComposition>;
  readonly simulated: { readonly gasUsed: bigint; readonly rawHash: string };
  readonly payload: ReturnType<typeof buildLiquidityPayload>; readonly executionId: string;
  readonly environment: 'MOCKED' | 'FORK_REPRODUCED'; readonly sourceHash: string }) {
  const { workflow, workflowHash, step, callValue, pool, at, before, composition, simulated, payload, executionId } = input;
  const chain = 'eip155:31337';
  const owner = { chainId: chain, address: before.owner };
  const token0 = { chainId: chain, address: LIQUIDITY_WETH, decimals: 18 };
  const token1 = { chainId: chain, address: LIQUIDITY_USDC, decimals: 6 };
  const nft = { chainId: chain, address: POSITION_MANAGER, decimals: 0 };
  const gas = { chainId: chain, nativeId: 'ETH', decimals: 18 };
  const adapter = { id: 'uniswap-v3.position-manager', version: '1.0.0' };
  const iso = (s: bigint) => new Date(Number(s) * 1000).toISOString();
  const freshness = { observedAt: iso(at.timestamp), expiresAt: iso(at.timestamp + 60n), maximumAgeSeconds: 60 };
  const uncertainty = [
    { code: input.environment === 'MOCKED' ? 'MOCKED_SYNTHETIC_CONTRACTS' : 'FORK_REPRODUCED_NOT_MAINNET',
      description: input.environment === 'MOCKED' ? 'Synthetic local contracts are engineering evidence only.' : 'Recorded Base state is replayed on local chain 31337; no public-chain effect.' },
    { code: 'HISTORICAL_SOURCE_STATE', description: 'The fork reproduces one historical source block; current market conditions can differ.' },
    { code: 'POSITION_FEE_ESTIMATE', description: 'Future position fees are not estimated or promised.' },
  ];
  const artifactId = `${executionId}.quote`;
  const quote = validateArtifact('quote-state-artifact', {
    schemaVersion: '1.0.0', artifactId, semanticWorkflowHash: workflowHash, nodeId: workflow.nodes.find(n => n.actionType === 'asset.liquidity.uniswap-v3')!.nodeId,
    sourceId: 'fork.anvil-31337', adapter, chainId: chain, chainPosition: { kind: 'BLOCK', height: at.number },
    retrievedAt: iso(at.timestamp), freshness,
    rawResponseHash: hashRawBytes('raw-response', text.encode(JSON.stringify({ pool: pool.pool, tick: pool.tick,
      sqrtPriceX96: pool.sqrtPriceX96.toString(), before: serializeRead(before) }))),
    normalizedValues: [
      { name: 'pool', kind: 'IDENTIFIER', value: pool.pool },
      { name: 'position-manager', kind: 'IDENTIFIER', value: POSITION_MANAGER },
      { name: 'source-block-hash', kind: 'IDENTIFIER', value: pool.sourceBlockHash },
      { name: 'fork-block-hash', kind: 'IDENTIFIER', value: at.hash },
      { name: 'tick', kind: 'IDENTIFIER', value: `tick:${pool.tick}` },
      { name: 'sqrt-price-x96', kind: 'IDENTIFIER', value: pool.sqrtPriceX96.toString() },
      { name: 'fee-tier', kind: 'INTEGER', value: pool.fee },
      { name: 'tick-spacing', kind: 'INTEGER', value: pool.tickSpacing },
      { name: 'composition', kind: 'IDENTIFIER', value: composition.state },
      { name: 'composition-weth', kind: 'QUANTITY', value: { asset: token0, amount: composition.amount0.toString() } },
      { name: 'composition-usdc', kind: 'QUANTITY', value: { asset: token1, amount: composition.amount1.toString() } },
    ], providerReference: { kind: 'NONE' },
    proposedContracts: [LIQUIDITY_WETH, LIQUIDITY_USDC, LIQUIDITY_FACTORY, pool.pool, POSITION_MANAGER]
      .map(address => ({ chainId: chain, address, version: 'reviewed-code-pin' })),
    proposedSpenders: [{ chainId: chain, address: POSITION_MANAGER }], proposedRecipients: [owner],
    fees: [], gas: [], outputBounds: callValue.kind === 'MINT' ? [{ outputId: 'position-nft',
      expected: { asset: nft, amount: '1' }, minimum: { asset: nft, amount: '1' }, adverse: { asset: nft, amount: '1' } }] : [],
    uncertainty, registryValidation: { registryVersion: referenceRegistry.registryVersion,
      actionType: 'asset.liquidity.uniswap-v3', result: 'CONTRACT_VALIDATED', enforcement: 'NOT_ENFORCED' },
  });
  const artifactSet = validateArtifact('artifact-set', { schemaVersion: '1.0.0', artifactSetId: `${executionId}.set`,
    semanticWorkflowHash: workflowHash, artifacts: [{ artifactId, nodeId: quote.nodeId,
      artifactHash: hashArtifactBytes('quote-state-artifact', text.encode(JSON.stringify(quote))) }] });
  const quoteHash = artifactSet.artifacts[0]!.artifactHash;
  const artifactSetHash = hashArtifactBytes('artifact-set', text.encode(JSON.stringify(artifactSet)));
  const simulation = validateArtifact('simulation-bundle', { schemaVersion: '1.0.0', simulationId: `${executionId}.simulation`,
    semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: workflowHash, artifactSetHash, adapters: [adapter],
    contracts: [{ chainId: chain, address: POSITION_MANAGER, version: 'reviewed-code-pin' }],
    outputs: callValue.kind === 'MINT' ? [{ nodeId: quote.nodeId, outputId: 'position-nft', expected: { asset: nft, amount: '1' },
      minimum: { asset: nft, amount: '1' }, adverse: { asset: nft, amount: '1' } }] : [], propagatedOutputs: [],
    failurePaths: [{ failedNodeId: quote.nodeId, blockedNodeIds: [], residualAssets: [
      { asset: token0, amount: before.weth.toString() }, { asset: token1, amount: before.usdc.toString() }] }],
    uncertainty, unsupportedAssumptions: ['One exact eth_simulateV1 call at the pinned fork block; later state can change.',
      'Approval can remain after a later liquidity operation fails; a reset requires a separate reviewed wallet request.'], freshness });
  const simulationHash = hashArtifactBytes('simulation-bundle', text.encode(JSON.stringify(simulation)));
  const maximum0 = callValue.kind === 'MINT' || callValue.kind === 'INCREASE' ? callValue.amount0Desired : 0n;
  const maximum1 = callValue.kind === 'MINT' || callValue.kind === 'INCREASE' ? callValue.amount1Desired : 0n;
  const spendLimits = [{ asset: token0, maximumAmount: maximum0.toString(), maximumPerStepAmount: maximum0.toString(),
    maximumCumulativeAmount: maximum0.toString() }, { asset: token1, maximumAmount: maximum1.toString(),
    maximumPerStepAmount: maximum1.toString(), maximumCumulativeAmount: maximum1.toString() }];
  const gasBudgets = [{ asset: gas, maximumAmount: (gasForCall(callValue) * (at.baseFee * 2n + 1_000_000n)).toString() }];
  const bps = (desired: bigint, minimum: bigint) => desired === 0n ? 0n : 10000n - minimum * 10000n / desired;
  const maximumSlippageBps = callValue.kind === 'MINT' || callValue.kind === 'INCREASE'
    ? Number([bps(callValue.amount0Desired, callValue.amount0Min), bps(callValue.amount1Desired, callValue.amount1Min)].reduce((a, b) => a > b ? a : b))
    : 0;
  const provider = { kind: 'FIXED' as const, providerId: adapter.id };
  const recovery = { failurePolicy: 'ABORT' as const, residualAssetRecipient: owner, maximumAttemptsPerStep: 2,
    requiresHumanReview: true as const };
  const encoded = encodeLiquidityCall(callValue);
  const deadline = 'deadline' in callValue ? callValue.deadline : at.timestamp + 180n;
  const policy = validateArtifact('authorization-policy', { schemaVersion: '1.0.0', policyId: `${executionId}.policy`,
    semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, requiredAuthorizationClass: 'MODE_A',
    allowlists: { owners: [owner], accounts: [owner], recipients: [owner], chains: [chain], adapters: [adapter], protocols: ['uniswap-v3'],
      contracts: [LIQUIDITY_WETH, LIQUIDITY_USDC, POSITION_MANAGER].map(address => ({ chainId: chain, address, version: 'reviewed-code-pin' })),
      functions: [{ chainId: chain, contract: encoded.to, functionId: toHex(encoded.data).slice(0, 10) }] },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits, maximumSlippageBps, gasBudgets, feeBudgets: [], oracleRules: [], accountRiskRules: [], checkpointRules: [],
    providers: provider, nonce: before.nonce.toString(), deadline: iso(deadline), revocationEpoch: 0, recovery,
    enforcement: 'NOT_ENFORCED' });
  const policyHash = hashArtifactBytes('authorization-policy', text.encode(JSON.stringify(policy)));
  const manifest = validateArtifact('strategy-manifest', { schemaVersion: '1.0.0', manifestId: `${executionId}.manifest`,
    semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: workflowHash, artifactSetHash, simulationHash, policyHash,
    authorizationMode: 'MODE_A', owner, executor: null, expiresAt: iso(deadline), nonce: before.nonce.toString(), revocationEpoch: 0,
    spendLimits, maximumSlippageBps, gasBudgets, feeBudgets: [], providers: provider, recovery, enforcement: 'NOT_ENFORCED' });
  const manifestHash = hashArtifactBytes('strategy-manifest', text.encode(JSON.stringify(manifest)));
  const plan = validateArtifact('execution-plan', { schemaVersion: '1.0.0', executionPlanId: `${executionId}.plan`,
    semanticWorkflowHash: workflowHash, manifestHash, segments: [{ segmentId: `${executionId}.segment`, chainId: chain,
      dependencies: [], steps: [{ stepId: step, nodeId: quote.nodeId, chainId: chain, adapter, dependencies: [],
        requiredAuthorizationClass: 'MODE_A', executionKind: 'DIRECT_TRANSACTION', payloadHash: payload.payloadHash }] }],
    checkpointIds: [], enforcement: 'NOT_ENFORCED' });
  const planHash = hashArtifactBytes('execution-plan', text.encode(JSON.stringify(plan)));
  // Additive profile: the frozen swap-only v1 EnforcementMatrixSchema accepts at most two swap payloads.
  // This liquidity matrix records the same enforcement locations without mislabeling it as v1.
  const matrix = { format: 'gryloo.liquidity-enforcement-matrix.v1', executionId, semanticWorkflowHash: workflowHash,
    artifactSetHash, simulationHash, policyHash, manifestHash, executionPlanHash: planHash,
    environment: input.environment, sourceBlockHash: pool.sourceBlockHash, stateSourceHash: input.sourceHash,
    step, payloadHash: payload.payloadHash, to: encoded.to, functionId: toHex(encoded.data).slice(0, 10),
    limits: [
      { field: 'chain', value: chain, location: 'EXACT_SIGNED_PAYLOAD' },
      { field: 'target', value: encoded.to, location: 'EXACT_SIGNED_PAYLOAD' },
      { field: 'calldata', value: toHex(encoded.data), location: 'EXACT_SIGNED_PAYLOAD' },
      { field: 'pool-freshness', value: at.hash, location: 'APPLICATION_GATEWAY' },
      { field: 'position-owner', value: before.owner, location: 'APPLICATION_GATEWAY' },
      { field: 'range', value: `${pool.tick}`, location: 'PROTOCOL_VERIFIER' },
      ...('amount0Min' in callValue ? [
        { field: 'amount0-minimum', value: callValue.amount0Min.toString(), location: 'PROTOCOL_VERIFIER' },
        { field: 'amount1-minimum', value: callValue.amount1Min.toString(), location: 'PROTOCOL_VERIFIER' },
      ] : []),
      ...('amount0Desired' in callValue ? [
        { field: 'amount0-maximum', value: callValue.amount0Desired.toString(), location: 'EXACT_SIGNED_PAYLOAD' },
        { field: 'amount1-maximum', value: callValue.amount1Desired.toString(), location: 'EXACT_SIGNED_PAYLOAD' },
      ] : []),
      ...('tokenId' in callValue ? [{ field: 'position-token-id', value: callValue.tokenId.toString(), location: 'EXACT_SIGNED_PAYLOAD' }] : []),
      ...('recipient' in callValue ? [{ field: 'recipient', value: callValue.recipient, location: 'EXACT_SIGNED_PAYLOAD' }] : []),
      ...(callValue.kind === 'APPROVE' ? [{ field: 'finite-approval', value: callValue.amount.toString(), location: 'EXACT_SIGNED_PAYLOAD' }] : []),
    ], limitations: ['No smart-account guard; separate user-wallet Mode A request.',
      'Application freshness checks do not revoke onchain approvals.',
      'Future fees are not guaranteed or simulated.'] };
  const matrixHash = hashRawBytes('raw-response', text.encode(JSON.stringify(matrix)));
  return { quote, artifactSet, simulation, policy, manifest, plan, matrix,
    hashes: { quoteHash, artifactSetHash, simulationHash, policyHash, manifestHash, planHash, matrixHash, simulationRawHash: simulated.rawHash } };
}

/** One process uses a serial lane; durable append-only snapshots survive process restart. */
export function createLiquidityService(options: { readonly call: ForkCall; readonly profile: LiquidityProfile; readonly journalDir: string }) {
  const { call, profile, journalDir } = options;
  const path = join(journalDir, 'liquidity.jsonl');
  let lane: Promise<unknown> = Promise.resolve();
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const next = lane.then(action, action); lane = next.then(() => undefined, () => undefined); return next;
  }
  type Snapshot = { readonly format: 'gryloo.liquidity-session.v1'; readonly prepared: PreparedLiquidity | null;
    readonly journal: LiquidityJournal | null; readonly reconciliation: SerializedReconciliation | null; readonly transactionHash: string | null;
    readonly evidence: { readonly bundle: EvidenceBundle; readonly evidenceBundleHash: string } | null;
    readonly canonicalJournal: ExecutionJournal | null };
  const empty: Snapshot = { format: 'gryloo.liquidity-session.v1', prepared: null, journal: null, reconciliation: null, transactionHash: null, evidence: null, canonicalJournal: null };
  async function read(): Promise<Snapshot> {
    let bytes: Uint8Array;
    try { bytes = await readFile(path); } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return empty; throw new Error('LIQUIDITY_JOURNAL_CORRUPT', { cause });
    }
    const lines = Buffer.from(bytes).toString('utf8').split('\n');
    if (lines.pop() !== '' || lines.length === 0) throw new Error('LIQUIDITY_JOURNAL_CORRUPT');
    let previous = sha('');
    let value = empty;
    for (const [sequence, line] of lines.entries()) {
      const entry = record(JSON.parse(line));
      const payload = record(entry.value);
      if (entry.sequence !== sequence || entry.previous !== previous || entry.digest !== sha(JSON.stringify({ sequence, previous, value: payload }))
        || payload.format !== empty.format) throw new Error('LIQUIDITY_JOURNAL_CORRUPT');
      previous = entry.digest as string; value = payload as Snapshot;
    }
    return value;
  }
  async function history(): Promise<readonly Snapshot[]> {
    await read();
    let bytes: Uint8Array;
    try { bytes = await readFile(path); } catch { return []; }
    return Buffer.from(bytes).toString('utf8').trimEnd().split('\n').map(line => record(JSON.parse(line)).value as Snapshot);
  }
  function canonicalJournal(prepared: PreparedLiquidity, snapshots: readonly Snapshot[], outcome: LiquidityReconciliation['outcome'], observedAt: string) {
    const segmentId = `${prepared.executionId}.segment`;
    let journal = createJournal({ journalId: `${prepared.executionId}.journal`, workflowId: prepared.workflowId,
      executionPlanHash: prepared.artifacts.hashes.planHash, manifestHash: prepared.artifacts.hashes.manifestHash });
    const add = (level: 'workflow' | 'segment' | 'step' | 'attempt', entityId: string, toState: string,
      stepId: string | null = null, attemptId: string | null = null) => {
      journal = appendJournalState(journal, { level, entityId, segmentId: level === 'workflow' ? null : segmentId,
        stepId, executionAttemptId: attemptId, toState: toState as never, recordedAt: observedAt }).journal;
    };
    add('workflow', prepared.workflowId, 'DRAFT'); add('segment', segmentId, 'PLANNED');
    add('step', prepared.step, 'PLANNED', prepared.step);
    for (const state of ['REVIEWED', 'SIMULATED', 'AUTHORIZED', 'EXECUTING']) add('workflow', prepared.workflowId, state);
    for (const state of ['READY', 'EXECUTING']) add('segment', segmentId, state);
    for (const state of ['READY', 'EXECUTING']) add('step', prepared.step, state, prepared.step);
    const last = new Map<string, string>();
    for (const snapshot of snapshots) for (const attempt of snapshot.journal?.attempts ?? []) {
      if (attempt.executionId !== prepared.executionId || last.get(attempt.executionAttemptId) === attempt.state) continue;
      add('attempt', attempt.executionAttemptId, attempt.state, attempt.stepId, attempt.executionAttemptId);
      last.set(attempt.executionAttemptId, attempt.state);
    }
    const final = outcome === 'RECONCILED' ? 'COMPLETED' : outcome === 'INCONCLUSIVE' ? 'RECOVERY_REQUIRED' : 'FAILED';
    add('step', prepared.step, 'RECONCILING', prepared.step); add('step', prepared.step, final, prepared.step);
    add('segment', segmentId, 'RECONCILING'); add('segment', segmentId, final);
    add('workflow', prepared.workflowId, 'RECONCILING'); add('workflow', prepared.workflowId, final);
    const headHash = hashJournalBytes(text.encode(JSON.stringify(journal))).at(-1);
    if (!headHash) throw new Error('LIQUIDITY_CANONICAL_JOURNAL_EMPTY');
    return { journal, headHash };
  }
  async function write(value: Snapshot): Promise<void> {
    let prior: Uint8Array;
    try { prior = await readFile(path); } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; prior = new Uint8Array();
    }
    const lines = prior.length ? Buffer.from(prior).toString('utf8').trimEnd().split('\n') : [];
    const previous = lines.length ? record(JSON.parse(lines.at(-1)!)).digest as string : sha('');
    const item = { sequence: lines.length, previous, value };
    const next = text.encode(`${Buffer.from(prior).toString('utf8')}${JSON.stringify({ ...item, digest: sha(JSON.stringify(item)) })}\n`);
    await writeExtendingFile(path, next, bytes => {
      const body = Buffer.from(bytes).toString('utf8'); if (!body.endsWith('\n')) throw new Error('LIQUIDITY_JOURNAL_CORRUPT');
      let last = sha('');
      body.trimEnd().split('\n').forEach((line, sequence) => {
        const entry = record(JSON.parse(line));
        if (entry.sequence !== sequence || entry.previous !== last || entry.digest !== sha(JSON.stringify({ sequence, previous: last, value: entry.value })))
          throw new Error('LIQUIDITY_JOURNAL_CORRUPT');
        last = entry.digest as string;
      });
    });
  }
  async function boundary(): Promise<void> {
    if (await call('eth_chainId') !== '0x7a69') throw new Error('LIQUIDITY_FORK_CHAIN_REQUIRED');
    const metadata = record(await call('anvil_metadata'));
    const source = record(metadata.forkedNetwork);
    if (Number(source.chainId) !== 8453 || Number(source.forkBlockNumber) !== profile.sourceBlockNumber || source.forkBlockHash !== profile.sourceBlockHash)
      throw new Error('LIQUIDITY_FORK_SOURCE_MISMATCH');
    if (!profile.rpcUrl.startsWith('http://127.0.0.1:')) throw new Error('LIQUIDITY_LOOPBACK_REQUIRED');
  }
  async function head() {
    const block = record(await call('eth_getBlockByNumber', ['latest', false]));
    if (!hash(block.hash as string)) throw new Error('LIQUIDITY_RPC_INVALID');
    return { hash: block.hash as string, number: Number(number(block.number)), timestamp: number(block.timestamp), baseFee: number(block.baseFeePerGas) };
  }
  async function ethCall(to: string, data: string, blockHash: string): Promise<unknown> {
    return call('eth_call', [{ to, data }, { blockHash, requireCanonical: true }]);
  }
  async function codeHash(target: string, blockHash: string): Promise<string> {
    const code = await call('eth_getCode', [target, { blockHash, requireCanonical: true }]);
    if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(code)) throw new Error('LIQUIDITY_CODE_MISSING');
    return sha(fromHex(code));
  }
  async function poolState(at: Awaited<ReturnType<typeof head>>): Promise<PoolState> {
    const blockHash = at.hash;
    const pool = resultAddress(await ethCall(LIQUIDITY_FACTORY,
      `${selector('getPool')}${addressWord(LIQUIDITY_WETH)}${addressWord(LIQUIDITY_USDC)}${word(500n)}`, blockHash));
    if (pool !== profile.liquidity.pool || pool === '0x' + '0'.repeat(40)) throw new Error('LIQUIDITY_POOL_MISMATCH');
    const pins = profile.liquidity;
    for (const [target, pin] of [[pool, pins.poolCodeHash], [POSITION_MANAGER, pins.managerCodeHash], [LIQUIDITY_FACTORY, pins.factoryCodeHash],
      [LIQUIDITY_USDC, pins.usdcCodeHash], [LIQUIDITY_WETH, pins.wethCodeHash]]) {
      if (await codeHash(target!, blockHash) !== pin) throw new Error('LIQUIDITY_CODE_PIN_MISMATCH');
    }
    const [factory, managerFactory, managerWeth, token0, token1, fee, spacing, slot] = await Promise.all([
      ethCall(pool, selector('factory'), blockHash), ethCall(POSITION_MANAGER, selector('factory'), blockHash),
      ethCall(POSITION_MANAGER, selector('WETH9'), blockHash), ethCall(pool, selector('token0'), blockHash),
      ethCall(pool, selector('token1'), blockHash), ethCall(pool, selector('fee'), blockHash),
      ethCall(pool, selector('tickSpacing'), blockHash), ethCall(pool, selector('slot0'), blockHash),
    ]);
    if (resultAddress(factory) !== LIQUIDITY_FACTORY || resultAddress(managerFactory) !== LIQUIDITY_FACTORY ||
      resultAddress(managerWeth) !== LIQUIDITY_WETH || resultAddress(token0) !== LIQUIDITY_WETH ||
      resultAddress(token1) !== LIQUIDITY_USDC || resultWord(fee) !== 500n || signed24(resultWord(spacing)) !== 10)
      throw new Error('LIQUIDITY_POOL_IDENTITY_MISMATCH');
    const tick = signed24(resultWord(slot, 1));
    const state: PoolState = { sourceChainId: 8453, executionChainId: 31337, sourceBlockHash: profile.sourceBlockHash,
      sourceBlockNumber: profile.sourceBlockNumber, pool, factory: LIQUIDITY_FACTORY, positionManager: POSITION_MANAGER,
      token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC, fee: 500, tickSpacing: 10, tick,
      sqrtPriceX96: resultWord(slot), poolCodeHash: pins.poolCodeHash, positionManagerCodeHash: pins.managerCodeHash,
      observedAtMs: Number(at.timestamp) * 1000, expiresAtMs: Number(at.timestamp + 60n) * 1000 };
    return state;
  }
  async function position(tokenId: bigint, blockHash: string, allowMissing = false): Promise<PositionRead | null> {
    if (tokenId <= 0n) throw new Error('LIQUIDITY_TOKEN_ID_INVALID');
    let owner: string;
    try { owner = resultAddress(await ethCall(POSITION_MANAGER, `${selector('ownerOf')}${word(tokenId)}`, blockHash)); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      if (allowMissing && /^FORK_RPC_ERROR:(?:execution reverted|ERC721: invalid token ID|owner query for nonexistent token)/i.test(message)) return null;
      throw new Error('LIQUIDITY_POSITION_READ_FAILED', { cause });
    }
    const raw = await ethCall(POSITION_MANAGER, `${selector('positions')}${word(tokenId)}`, blockHash);
    return { tokenId, owner, token0: resultAddress(raw, 2), token1: resultAddress(raw, 3), fee: Number(resultWord(raw, 4)),
      tickLower: signed24(resultWord(raw, 5)), tickUpper: signed24(resultWord(raw, 6)), liquidity: resultWord(raw, 7),
      feeGrowth0: resultWord(raw, 8), feeGrowth1: resultWord(raw, 9), owed0: resultWord(raw, 10), owed1: resultWord(raw, 11) };
  }
  async function balance(owner: string, token: string, at: string): Promise<bigint> {
    return resultWord(await ethCall(token, `${selector('balanceOf')}${addressWord(owner)}`, at));
  }
  async function allowance(owner: string, token: string, at: string): Promise<bigint> {
    return resultWord(await ethCall(token, `${selector('allowance')}${addressWord(owner)}${addressWord(POSITION_MANAGER)}`, at));
  }
  async function state(owner: string, tokenId: bigint | null, at: string, allowMissingPosition = false): Promise<LiquidityRead> {
    const [weth, usdc, eth, wethAllowance, usdcAllowance, nonce, pos] = await Promise.all([
      balance(owner, LIQUIDITY_WETH, at), balance(owner, LIQUIDITY_USDC, at),
      call('eth_getBalance', [owner, { blockHash: at, requireCanonical: true }]),
      allowance(owner, LIQUIDITY_WETH, at), allowance(owner, LIQUIDITY_USDC, at),
      call('eth_getTransactionCount', [owner, { blockHash: at, requireCanonical: true }]),
      tokenId ? position(tokenId, at, allowMissingPosition) : Promise.resolve(null),
    ]);
    return { blockHash: at, owner, weth, usdc, eth: number(eth), wethAllowance, usdcAllowance, nonce: number(nonce), position: pos };
  }
  function requestCall(operation: LiquidityOperation, details: NonNullable<ReturnType<typeof liquidityDetails>>,
    before: LiquidityRead, pool: PoolState, at: Awaited<ReturnType<typeof head>>, input: { tokenId?: string; partBps?: number }): LiquidityCall {
    const max0 = BigInt(details.amountWeth), max1 = BigInt(details.amountUsdc);
    const min0 = BigInt(details.minimumWeth), min1 = BigInt(details.minimumUsdc);
    const deadline = at.timestamp + 180n;
    const position = before.position;
    if (operation === 'APPROVE_WETH' || operation === 'APPROVE_USDC') {
      const token = operation === 'APPROVE_WETH' ? LIQUIDITY_WETH : LIQUIDITY_USDC;
      const amount = operation === 'APPROVE_WETH' ? max0 : max1;
      const old = operation === 'APPROVE_WETH' ? before.wethAllowance : before.usdcAllowance;
      if (old !== 0n) throw new Error('LIQUIDITY_ALLOWANCE_RESET_REQUIRED');
      return { kind: 'APPROVE', token, amount };
    }
    if (operation === 'RESET_WETH' || operation === 'RESET_USDC') {
      const token = operation === 'RESET_WETH' ? LIQUIDITY_WETH : LIQUIDITY_USDC;
      const old = operation === 'RESET_WETH' ? before.wethAllowance : before.usdcAllowance;
      if (old === 0n) throw new Error('LIQUIDITY_ALLOWANCE_ALREADY_ZERO');
      return { kind: 'APPROVE', token, amount: 0n };
    }
    if (details.recipient !== profile.owner) throw new Error('LIQUIDITY_RECIPIENT_NOT_OWNER');
    if (operation === 'MINT') {
      if (input.tokenId || position) throw new Error('LIQUIDITY_POSITION_ALREADY_EXISTS');
      if (before.wethAllowance < max0 || before.usdcAllowance < max1) throw new Error('LIQUIDITY_APPROVALS_REQUIRED');
      const composition = rangeComposition(pool, details.tickLower, details.tickUpper, max0, max1, Number(at.timestamp) * 1000);
      if (before.weth < composition.amount0 || before.usdc < composition.amount1) throw new Error('LIQUIDITY_BALANCE_INSUFFICIENT');
      return { kind: 'MINT', token0: LIQUIDITY_WETH, token1: LIQUIDITY_USDC, fee: 500,
        tickLower: details.tickLower, tickUpper: details.tickUpper, amount0Desired: max0, amount1Desired: max1,
        amount0Min: min0, amount1Min: min1, recipient: profile.owner, deadline };
    }
    if (!position || position.owner !== profile.owner || position.token0 !== LIQUIDITY_WETH || position.token1 !== LIQUIDITY_USDC
      || position.fee !== 500 || position.tickLower !== details.tickLower || position.tickUpper !== details.tickUpper)
      throw new Error('LIQUIDITY_POSITION_CHANGED');
    if (operation === 'INCREASE') {
      if (before.wethAllowance < max0 || before.usdcAllowance < max1) throw new Error('LIQUIDITY_APPROVALS_REQUIRED');
      const composition = rangeComposition(pool, details.tickLower, details.tickUpper, max0, max1, Number(at.timestamp) * 1000);
      if (before.weth < composition.amount0 || before.usdc < composition.amount1) throw new Error('LIQUIDITY_BALANCE_INSUFFICIENT');
      return { kind: 'INCREASE', tokenId: position.tokenId, amount0Desired: max0, amount1Desired: max1,
        amount0Min: min0, amount1Min: min1, deadline };
    }
    if (operation === 'DECREASE_PARTIAL' || operation === 'DECREASE_FULL') {
      if (position.liquidity <= 0n) throw new Error('LIQUIDITY_POSITION_EMPTY');
      const bps = operation === 'DECREASE_FULL' ? 10000 : input.partBps;
      if (!Number.isSafeInteger(bps) || !bps || bps < 1 || bps > 10000 || (operation === 'DECREASE_PARTIAL' && bps === 10000))
        throw new Error('LIQUIDITY_PART_INVALID');
      const liquidity = operation === 'DECREASE_FULL' ? position.liquidity : position.liquidity * BigInt(bps) / 10000n;
      if (liquidity <= 0n) throw new Error('LIQUIDITY_PART_INVALID');
      return { kind: 'DECREASE', tokenId: position.tokenId, liquidity, amount0Min: min0, amount1Min: min1, deadline };
    }
    if (operation === 'COLLECT_PARTIAL' || operation === 'COLLECT_FINAL') {
      if (position.owed0 === 0n && position.owed1 === 0n) throw new Error('LIQUIDITY_COLLECT_EMPTY');
      return { kind: 'COLLECT', tokenId: position.tokenId, recipient: profile.owner,
        amount0Max: position.owed0, amount1Max: position.owed1 };
    }
    if (operation === 'BURN') {
      if (position.liquidity !== 0n || position.owed0 !== 0n || position.owed1 !== 0n) throw new Error('LIQUIDITY_BURN_NOT_ELIGIBLE');
      return { kind: 'BURN', tokenId: position.tokenId };
    }
    throw new Error('LIQUIDITY_OPERATION_INVALID');
  }
  async function simulate(callValue: LiquidityCall, owner: string, nonce: bigint,
    gasLimit: bigint, maxFeePerGas: bigint, blockHash: string) {
    const payload = buildLiquidityPayload(callValue, { nonce, gasLimit, maxFeePerGas });
    const encoded = encodeLiquidityCall(callValue);
    const transaction = { from: owner, to: encoded.to, nonce: hex(nonce), gas: hex(gasLimit), maxFeePerGas: hex(maxFeePerGas),
      maxPriorityFeePerGas: '0xf4240', value: '0x0', data: toHex(encoded.data) };
    const raw = await call('eth_simulateV1', [{ blockStateCalls: [{ calls: [transaction] }], validation: true,
      traceTransfers: false, returnFullTransactions: false }, { blockHash, requireCanonical: true }]);
    if (!Array.isArray(raw) || raw.length !== 1 || !Array.isArray(record(raw[0]).calls) || (record(raw[0]).calls as unknown[]).length !== 1)
      throw new Error('LIQUIDITY_SIMULATION_INVALID');
    const result = record((record(raw[0]).calls as unknown[])[0]);
    if (result.status !== '0x1') throw new Error('LIQUIDITY_SIMULATION_REVERTED');
    const gasUsed = number(result.gasUsed);
    if (gasUsed <= 0n || gasUsed > gasLimit) throw new Error('LIQUIDITY_SIMULATION_GAS_INVALID');
    return { payload, gasUsed, rawHash: hashRawBytes('raw-response', text.encode(JSON.stringify(raw))) };
  }
  async function prepare(input: { readonly workflow: SemanticWorkflow; readonly operation: LiquidityOperation;
    readonly tokenId?: string; readonly partBps?: number }): Promise<PreparedLiquidity> {
    return serial(async () => {
      const previous = await read();
      if (previous.journal?.frozen || previous.journal?.attempts.some(item => !['CONFIRMED', 'NOT_FOUND', 'REVERTED'].includes(item.state)))
        throw new Error('LIQUIDITY_RECOVERY_REQUIRED');
      if (previous.prepared && previous.reconciliation?.outcome !== 'RECONCILED' &&
        !previous.journal?.attempts.some(item => item.state === 'NOT_FOUND') && previous.journal?.attempts.length)
        throw new Error('LIQUIDITY_RECONCILIATION_REQUIRED');
      await boundary();
      const workflow = validateArtifact('semantic-workflow', validateAuthoringWorkflow(input.workflow, context));
      const nodes = workflow.nodes.filter(node => node.actionType === 'asset.liquidity.uniswap-v3');
      if (nodes.length !== 1 || workflow.nodes.some(node => node.actionType === 'asset.swap.exact-input'))
        throw new Error('LIQUIDITY_ISOLATED_NODE_REQUIRED');
      const details = liquidityDetails(nodes[0]!, context);
      if (!details || !Object.hasOwn(stepFor, input.operation)) throw new Error('LIQUIDITY_INPUT_INVALID');
      if (input.tokenId !== undefined && !/^[1-9][0-9]{0,76}$/.test(input.tokenId)) throw new Error('LIQUIDITY_TOKEN_ID_INVALID');
      const at = await head();
      const pool = await poolState(at);
      const before = await state(profile.owner, input.tokenId ? BigInt(input.tokenId) : null, at.hash);
      const callValue = requestCall(input.operation, details, before, pool, at, input);
      const composition = rangeComposition(pool, details.tickLower, details.tickUpper,
        BigInt(details.amountWeth), BigInt(details.amountUsdc), Number(at.timestamp) * 1000);
      const maxFeePerGas = at.baseFee * 2n + 1_000_000n;
      const gasLimit = gasForCall(callValue);
      const simulated = await simulate(callValue, profile.owner, before.nonce, gasLimit, maxFeePerGas, at.hash);
      if ((await head()).hash !== at.hash) throw new Error('LIQUIDITY_HEAD_MOVED');
      const workflowHash = hashArtifactBytes('semantic-workflow', text.encode(JSON.stringify(workflow)));
      const step = stepFor[input.operation];
      const executionId = `liquidity-${sha(JSON.stringify({ workflowHash, operation: input.operation, tokenId: input.tokenId ?? null,
        partBps: input.partBps ?? null, head: at.hash, nonce: before.nonce.toString() })).slice(2, 26)}`;
      const artifacts = compileArtifacts({ workflow, workflowHash, step, callValue, pool, at, before,
        composition, simulated: { gasUsed: simulated.gasUsed, rawHash: simulated.rawHash },
        payload: simulated.payload, executionId, environment: profile.environment, sourceHash: profile.stateSourceHash });
      const prepared: PreparedLiquidity = {
        format: 'gryloo.liquidity-prepared.v1', executionId, operation: input.operation, step, workflowId: workflow.workflowId, workflowHash, revision: workflow.revision,
        profileHash: sha(JSON.stringify(profile)), pool: pool.pool, poolBlockHash: at.hash, poolTick: pool.tick,
        sqrtPriceX96: pool.sqrtPriceX96.toString(), composition: { state: composition.state, liquidity: composition.liquidity.toString(),
          amount0: composition.amount0.toString(), amount1: composition.amount1.toString() }, owner: profile.owner,
        tokenId: input.tokenId ?? null, before: serializeRead(before), call: serializeCall(callValue),
        bytes: toHex(simulated.payload.bytes), payloadHash: simulated.payload.payloadHash, signingHash: simulated.payload.signingHash,
        nonce: before.nonce.toString(), gasLimit: gasLimit.toString(), maxFeePerGas: maxFeePerGas.toString(),
        deadline: 'deadline' in callValue ? callValue.deadline.toString() : (at.timestamp + 180n).toString(),
        preparedAt: new Date(Number(at.timestamp) * 1000).toISOString(),
        simulation: { gasUsed: simulated.gasUsed.toString(), status: 'SUCCESS', rawHash: simulated.rawHash }, artifacts,
      };
      const journal = newLiquidityJournal(executionId, workflowHash, prepared.profileHash);
      await write({ format: empty.format, prepared, journal, reconciliation: null, transactionHash: null, evidence: null, canonicalJournal: null });
      return prepared;
    });
  }
  async function begin(executionId: string, idempotencyKey: string, currentWorkflow: SemanticWorkflow): Promise<{ readonly attemptId: string; readonly prepared: PreparedLiquidity }> {
    return serial(async () => {
      const current = await read();
      const prepared = current.prepared, journal = current.journal;
      if (!prepared || !journal || prepared.executionId !== executionId || journal.executionId !== executionId || journal.frozen)
        throw new Error('LIQUIDITY_NOT_PREPARED');
      const workflow = validateArtifact('semantic-workflow', validateAuthoringWorkflow(currentWorkflow, context));
      if (workflow.revision !== prepared.revision ||
        hashArtifactBytes('semantic-workflow', text.encode(JSON.stringify(workflow))) !== prepared.workflowHash)
        throw new Error('LIQUIDITY_WORKFLOW_CHANGED');
      const callValue = deserializeCall(prepared.call);
      const bytes = fromHex(prepared.bytes);
      if (prepared.profileHash !== sha(JSON.stringify(profile)) ||
        verifyLiquidityPayload(bytes, callValue, { nonce: BigInt(prepared.nonce), gasLimit: BigInt(prepared.gasLimit),
          maxFeePerGas: BigInt(prepared.maxFeePerGas) }).payloadHash !== prepared.payloadHash)
        throw new Error('LIQUIDITY_PREPARED_CHANGED');
      await boundary();
      const at = await head();
      const pool = await poolState(at);
      if (at.hash !== prepared.poolBlockHash || pool.tick !== prepared.poolTick || pool.sqrtPriceX96.toString() !== prepared.sqrtPriceX96)
        throw new Error('LIQUIDITY_POOL_STATE_STALE');
      if (at.timestamp >= BigInt(prepared.deadline)) throw new Error('LIQUIDITY_DEADLINE_EXPIRED');
      const currentRead = await state(prepared.owner, prepared.tokenId ? BigInt(prepared.tokenId) : null, at.hash);
      if (JSON.stringify(serializeRead(currentRead)) !== JSON.stringify(prepared.before)) throw new Error('LIQUIDITY_ACCOUNT_STATE_CHANGED');
      const made = prepareLiquidityAttempt(journal, { step: prepared.step, idempotencyKey,
        payloadHash: prepared.payloadHash, blockNumber: at.number, prerequisite: [] });
      // Persist PREPARED and SUBMITTING before the browser receives the wallet request.
      await write({ ...current, journal: made.journal });
      const submitting = advanceLiquidityAttempt(made.journal, made.attempt.executionAttemptId, 'SUBMITTING');
      await write({ ...current, journal: submitting });
      return { attemptId: made.attempt.executionAttemptId, prepared };
    });
  }
  async function submission(executionId: string, attemptId: string, report: { readonly kind: 'HASH' | 'REJECTED' | 'UNKNOWN';
    readonly transactionHash?: string }): Promise<LiquidityStatus> {
    return serial(async () => {
      const current = await read();
      if (!current.prepared || !current.journal || current.prepared.executionId !== executionId ||
        !current.journal.attempts.some(item => item.executionAttemptId === attemptId && item.state === 'SUBMITTING'))
        throw new Error('LIQUIDITY_ATTEMPT_INVALID');
      if (report.kind === 'HASH' && typeof report.transactionHash === 'string' && hash(report.transactionHash)) {
        const journal = advanceLiquidityAttempt(current.journal, attemptId, 'PENDING', report.transactionHash);
        await write({ ...current, journal, transactionHash: report.transactionHash });
      } else {
        const journal = advanceLiquidityAttempt(current.journal, attemptId, 'SUBMISSION_RESULT_UNKNOWN');
        await write({ ...current, journal });
      }
      return read();
    });
  }
  async function recoverUnknown(executionId: string): Promise<LiquidityStatus> {
    return serial(async () => {
      let current = await read();
      const prepared = current.prepared;
      if (!prepared || !current.journal || prepared.executionId !== executionId) throw new Error('LIQUIDITY_NOT_PREPARED');
      let attempt = current.journal.attempts.at(-1);
      if (!attempt || !['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state))
        throw new Error('LIQUIDITY_UNKNOWN_STATE_INVALID');
      if (attempt.state === 'SUBMITTING') {
        current = { ...current, journal: advanceLiquidityAttempt(current.journal, attempt.executionAttemptId, 'SUBMISSION_RESULT_UNKNOWN') };
        await write(current);
        attempt = current.journal!.attempts.at(-1)!;
      }
      await boundary();
      const latest = await head();
      const from = attempt.preparedAtBlock;
      if (latest.number < from || latest.number - from > 255) return current;
      const candidates: string[] = [];
      for (let numberAt = from; numberAt <= latest.number; numberAt++) {
        const block = record(await call('eth_getBlockByNumber', [hex(BigInt(numberAt)), true]));
        if (Number(number(block.number)) !== numberAt || !Array.isArray(block.transactions)) throw new Error('LIQUIDITY_SCAN_INVALID');
        for (const entryValue of block.transactions) {
          const entry = record(entryValue);
          if (typeof entry.from !== 'string' || entry.from.toLowerCase() !== prepared.owner ||
            number(entry.nonce) !== BigInt(prepared.nonce)) continue;
          if (typeof entry.hash !== 'string' || !hash(entry.hash)) throw new Error('LIQUIDITY_SCAN_INVALID');
          candidates.push(entry.hash);
        }
      }
      if (candidates.length > 1) throw new Error('LIQUIDITY_NONCE_CONFLICT');
      let matchingTxHash: string | null = null;
      if (candidates.length === 1) {
        const raw = await call('eth_getRawTransactionByHash', [candidates[0]]);
        if (typeof raw !== 'string') throw new Error('LIQUIDITY_RAW_TRANSACTION_INVALID');
        try { verifySignedPayload(fromHex(raw), candidates[0]!, prepared.owner, fromHex(prepared.bytes)); }
        catch { throw new Error('LIQUIDITY_NONCE_CONFLICT'); }
        matchingTxHash = candidates[0]!;
      }
      const senderNonce = number(await call('eth_getTransactionCount', [prepared.owner, 'latest']));
      const poolValue = record(await call('txpool_content'));
      const pending = record(poolValue.pending ?? {});
      const ownerPending = Object.entries(pending).find(([account]) => account.toLowerCase() === prepared.owner);
      const txpoolContainsNonce = ownerPending ? Object.keys(record(ownerPending[1])).some(nonce => BigInt(nonce) === BigInt(prepared.nonce)) : false;
      const complete = !txpoolContainsNonce && latest.number >= from + 2 &&
        latest.timestamp >= BigInt(Math.floor(Date.parse(prepared.preparedAt) / 1000)) + 30n;
      const classified = classifyLiquidityUnknown(current.journal!, { attemptId: attempt.executionAttemptId,
        senderNonce, reviewedNonce: BigInt(prepared.nonce), matchingTxHash, completeBlockScan: complete });
      if (classified.outcome === 'INCONCLUSIVE') return current;
      await write({ ...current, journal: classified.journal, transactionHash: matchingTxHash });
      return read();
    });
  }
  async function inspect(tokenId: string): Promise<{ readonly pool: PoolState; readonly read: SerializedRead }> {
    if (!/^[1-9][0-9]{0,76}$/.test(tokenId)) throw new Error('LIQUIDITY_TOKEN_ID_INVALID');
    await boundary(); const at = await head(); const pool = await poolState(at);
    const found = await state(profile.owner, BigInt(tokenId), at.hash);
    if (!found.position || found.position.owner !== profile.owner) throw new Error('LIQUIDITY_POSITION_NOT_OWNED');
    return { pool, read: serializeRead(found) };
  }
  async function observe(executionId: string): Promise<LiquidityStatus> {
    return serial(async () => {
      const current = await read();
      const prepared = current.prepared, journal = current.journal;
      if (!prepared || !journal || prepared.executionId !== executionId) throw new Error('LIQUIDITY_NOT_PREPARED');
      const attempt = journal.attempts.find(item => item.stepId === prepared.step && item.state === 'PENDING');
      if (!attempt?.transactionHash) throw new Error('LIQUIDITY_RECONCILIATION_REQUIRED');
      await boundary();
      const [rawHex, receiptValue] = await Promise.all([
        call('eth_getRawTransactionByHash', [attempt.transactionHash]),
        call('eth_getTransactionReceipt', [attempt.transactionHash]),
      ]);
      if (rawHex === null || receiptValue === null) return current;
      if (typeof rawHex !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(rawHex)) throw new Error('LIQUIDITY_RAW_TRANSACTION_INVALID');
      const rawReceipt = record(receiptValue);
      if (rawReceipt.transactionHash !== attempt.transactionHash || !hash(rawReceipt.blockHash as string))
        throw new Error('LIQUIDITY_RECEIPT_INVALID');
      const receipt = { transactionHash: rawReceipt.transactionHash as string, blockHash: rawReceipt.blockHash as string,
        status: Number(number(rawReceipt.status)) as 0 | 1, gasUsed: number(rawReceipt.gasUsed),
        effectiveGasPrice: number(rawReceipt.effectiveGasPrice),
        l1Fee: rawReceipt.l1Fee === undefined || rawReceipt.l1Fee === null ? null : number(rawReceipt.l1Fee),
        logs: (rawReceipt.logs as unknown[]).map(item => {
          const log = record(item);
          if (typeof log.address !== 'string' || !address(log.address) || !Array.isArray(log.topics) ||
            !log.topics.every(topic => typeof topic === 'string' && hash(topic)) || typeof log.data !== 'string')
            throw new Error('LIQUIDITY_RECEIPT_INVALID');
          return { address: log.address, topics: log.topics as string[], data: log.data };
        }) };
      if (receipt.status !== 0 && receipt.status !== 1) throw new Error('LIQUIDITY_RECEIPT_INVALID');
      const atReceipt = { blockHash: receipt.blockHash, requireCanonical: true };
      const l1Address = '0x4200000000000000000000000000000000000015';
      const feeSlot = async (index: bigint) => resultWord(await call('eth_getStorageAt', [l1Address, hex(index), atReceipt]));
      const derivedL1Fee = opStackFee(fromHex(rawHex), receipt.gasUsed,
        { slot1: await feeSlot(1n), slot3: await feeSlot(3n), slot7: await feeSlot(7n), slot8: await feeSlot(8n) });
      if (receipt.l1Fee !== null && receipt.l1Fee !== derivedL1Fee) throw new Error('LIQUIDITY_L1_FEE_MISMATCH');
      const callValue = deserializeCall(prepared.call);
      let tokenId = prepared.tokenId ? BigInt(prepared.tokenId) : null;
      if (callValue.kind === 'MINT' && receipt.status === 1) {
        const transfer = receipt.logs.find(log => log.address === POSITION_MANAGER && log.topics[0] ===
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' && log.topics.length === 4
          && log.topics[1] === `0x${'0'.repeat(64)}` && log.topics[2] === `0x${addressWord(prepared.owner)}`);
        if (!transfer || !hash(transfer.topics[3]!)) throw new Error('LIQUIDITY_MINT_TOKEN_ID_MISSING');
        tokenId = BigInt(transfer.topics[3]!);
      }
      const after = await state(prepared.owner, tokenId, receipt.blockHash, callValue.kind === 'BURN');
      // Repeat the same pinned block read; contradictory RPC responses never certify an effect.
      const consistent = await state(prepared.owner, tokenId, receipt.blockHash, callValue.kind === 'BURN');
      const checked = JSON.stringify(serializeRead(after)) === JSON.stringify(serializeRead(consistent)) ? receipt.blockHash : '0x0';
      const outcome = reconcileLiquidity({ call: callValue, owner: prepared.owner, before: deserializeRead(prepared.before), after,
        consistencyBlockHash: checked, reviewedBytes: fromHex(prepared.bytes), signedRaw: fromHex(rawHex),
        transactionHash: attempt.transactionHash, receipt, nonce: BigInt(prepared.nonce), gasLimit: BigInt(prepared.gasLimit),
        maxFeePerGas: BigInt(prepared.maxFeePerGas), knownL1Fee: derivedL1Fee });
      let nextJournal: LiquidityJournal;
      if (receipt.status === 0) nextJournal = advanceLiquidityAttempt(journal, attempt.executionAttemptId, 'REVERTED');
      else if (outcome.outcome === 'RECONCILED') {
        nextJournal = advanceLiquidityAttempt(journal, attempt.executionAttemptId, 'CONFIRMED', attempt.transactionHash);
        nextJournal = markLiquidityReconciled(nextJournal, prepared.step, attempt.executionAttemptId);
      } else nextJournal = { ...journal, frozen: true };
      const blockValue = record(await call('eth_getBlockByHash', [receipt.blockHash, false]));
      if (blockValue.hash !== receipt.blockHash) throw new Error('LIQUIDITY_RECEIPT_BLOCK_INVALID');
      const observedAt = new Date(Number(number(blockValue.timestamp)) * 1000).toISOString();
      const finalSnapshot: Snapshot = { ...current, journal: nextJournal, reconciliation: serializeReconciliation(outcome), transactionHash: attempt.transactionHash };
      const canonical = canonicalJournal(prepared, [...await history(), finalSnapshot], outcome.outcome, observedAt);
      const chain = 'eip155:31337';
      const wethAsset = { chainId: chain, address: LIQUIDITY_WETH, decimals: 18 };
      const usdcAsset = { chainId: chain, address: LIQUIDITY_USDC, decimals: 6 };
      const nftAsset = { chainId: chain, address: POSITION_MANAGER, decimals: 0 };
      const ethAsset = { chainId: chain, nativeId: 'ETH', decimals: 18 };
      const limitations = ['FORK_REPRODUCED_NOT_MAINNET', 'HISTORICAL_SOURCE_STATE',
        'POSITION_TOKENS_OWED_MAY_INCLUDE_PRINCIPAL', 'FUTURE_FEES_NOT_ESTIMATED',
        ...(profile.environment === 'MOCKED' ? ['MOCKED_SYNTHETIC_ENVIRONMENT_NOT_FORK_EVIDENCE'] : [])];
      const built = buildEvidenceBundle({ evidenceBundleId: `${prepared.executionId}.evidence`, version: 1, supersedes: null,
        semanticWorkflowHash: prepared.workflowHash, artifactSetHash: prepared.artifacts.hashes.artifactSetHash,
        simulationHash: prepared.artifacts.hashes.simulationHash, policyHash: prepared.artifacts.hashes.policyHash,
        manifestHash: prepared.artifacts.hashes.manifestHash, executionPlanHash: prepared.artifacts.hashes.planHash,
        journalHeadHash: canonical.headHash, observedAt, outcome: outcome.outcome,
        receipts: [{ transactionHash: attempt.transactionHash, exactRawResponse: text.encode(JSON.stringify(rawReceipt)) }],
        matrixHash: prepared.artifacts.hashes.matrixHash,
        signedRawDigests: [hashRawBytes('raw-response', fromHex(rawHex))],
        reconciliationTranscript: text.encode(JSON.stringify({ code: outcome.code, before: prepared.before,
          after: serializeRead(after), receiptBlockHash: receipt.blockHash, signedRawHash: sha(fromHex(rawHex)),
          tokenId: tokenId?.toString() ?? null, observedEthFee: outcome.totalEthFee?.toString() ?? null })),
        forkTranscriptHash: profile.stateSourceHash, differences: [],
        reconciliation: { balances: [{ asset: wethAsset, amount: after.weth.toString() }, { asset: usdcAsset, amount: after.usdc.toString() }],
          allowances: [{ asset: wethAsset, amount: after.wethAllowance.toString() }, { asset: usdcAsset, amount: after.usdcAllowance.toString() }],
          debt: [], positions: [{ asset: nftAsset, amount: after.position ? '1' : '0' }],
          fees: outcome.totalEthFee === null ? [] : [{ asset: ethAsset, amount: outcome.totalEthFee.toString() }],
          residualAssets: [{ asset: wethAsset, amount: after.weth.toString() }, { asset: usdcAsset, amount: after.usdc.toString() }],
          ownership: [{ chainId: chain, address: prepared.owner }], limitations },
      });
      const bundle = profile.environment === 'MOCKED' ? validateArtifact('evidence-bundle', { ...built.bundle, environment: 'MOCKED' }) : built.bundle;
      const evidence = { bundle, evidenceBundleHash: hashArtifactBytes('evidence-bundle', text.encode(JSON.stringify(bundle))) };
      await write({ ...finalSnapshot, canonicalJournal: canonical.journal, evidence });
      return read();
    });
  }
  return { prepare, begin, submission, recoverUnknown, inspect, observe, status: read };
}
export type LiquidityService = ReturnType<typeof createLiquidityService>;
