// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RH-DEMO-001: read-only simulation and Review of one native test-ETH self-transfer on Robinhood Testnet.
 * Every value is read at one block; nothing is signed or sent. The Review commitment binds the exact
 * transaction, nonce, fee bounds, balances and freshness.
 */
import { ROBINHOOD_TESTNET_TRANSFER as profile } from '@defi-workflow-engine/action-registry';
export { ROBINHOOD_TESTNET_TRANSFER } from '@defi-workflow-engine/action-registry';
import { readNativeTransferNode, supplyAddress, hashSupplyValue, TRANSFER_ACTION, type SemanticWorkflow, type ArtifactSet,
  type SimulationBundle, type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { rpcRecord, rpcHex, rpcUint, rpcHash, supplyHex, supplyHash, supplyArtifactHash } from './supply.js';

export type TransferRpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
/** The exact request a wallet receives. The wallet assigns the nonce; it must equal the reviewed nonce. */
export type NativeTransferTransaction = { from: string; to: string; value: string; data: '0x'; chainId: string;
  gas: string; maxFeePerGas: string; maxPriorityFeePerGas: '0x0' };
export type TransferState = { block: number; blockHash: string; blockTimestamp: number; account: string; balance: string;
  nonce: string; pendingNonce: string; gasPrice: string; baseFee: string; observedAt: string };
export type NativeTransferReview = { format: 'gryloo.native-transfer-review.v1'; workflow: SemanticWorkflow; chain: string; chainId: number;
  account: string; recipient: string; value: string; nonce: string; transaction: NativeTransferTransaction;
  gasEstimate: string; gasLimit: string; gasPrice: string; maxFeePerGas: string; expectedFee: string; feeBudget: string;
  balanceBefore: string; expectedBalanceAfter: string; minimumBalanceAfter: string; simulationResult: '0x';
  state: TransferState; expiresAt: string; artifactSet: ArtifactSet; simulation: SimulationBundle; policy: AuthorizationPolicy;
  manifest: StrategyManifest; plan: ExecutionPlan; commitment: string };
const native = { chainId: profile.chain, nativeId: 'ETH', decimals: 18 };
const adapter = { id: profile.adapterId, version: '1.0.0' };

export async function readTransferState(rpc: TransferRpc, accountInput: string, now = Date.now()): Promise<TransferState> {
  const account = supplyAddress(accountInput);
  if (rpcUint(await rpc('eth_chainId', [])) !== BigInt(profile.chainId)) throw new Error('TRANSFER_WRONG_CHAIN');
  const block = rpcRecord(await rpc('eth_getBlockByNumber', ['latest', false]));
  const tag = rpcHex(block.number), blockHash = rpcHash(block.hash), number = Number(rpcUint(tag)), timestamp = Number(rpcUint(block.timestamp));
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(timestamp)) throw new Error('TRANSFER_RPC_INVALID');
  const age = now - timestamp * 1000;
  if (age > 120_000 || age < -30_000) throw new Error('TRANSFER_STALE_CHAIN_HEAD');
  const [balance, nonce, pendingNonce, gasPrice, code] = await Promise.all([
    rpc('eth_getBalance', [account, tag]), rpc('eth_getTransactionCount', [account, tag]),
    rpc('eth_getTransactionCount', [account, 'pending']), rpc('eth_gasPrice', []), rpc('eth_getCode', [account, tag])]);
  // A code-bearing owner (contract or EIP-7702 delegation) would execute code on a self-transfer.
  if (rpcHexOrEmpty(code) !== '0x') throw new Error('TRANSFER_OWNER_NOT_EOA');
  if (rpcHash(rpcRecord(await rpc('eth_getBlockByNumber', [tag, false])).hash) !== blockHash) throw new Error('TRANSFER_REORG');
  const baseFee = block.baseFeePerGas === undefined ? 0n : rpcUint(block.baseFeePerGas);
  return { block: number, blockHash, blockTimestamp: timestamp, account, balance: rpcUint(balance).toString(), nonce: rpcUint(nonce).toString(),
    pendingNonce: rpcUint(pendingNonce).toString(), gasPrice: rpcUint(gasPrice).toString(), baseFee: baseFee.toString(), observedAt: new Date(now).toISOString() };
}
function rpcHexOrEmpty(value: unknown): string { return value === '0x' ? '0x' : rpcHex(value); }

function transferFields(workflow: SemanticWorkflow) {
  const nodes = workflow.nodes.filter(n => n.actionType === TRANSFER_ACTION);
  if (nodes.length !== 1 || workflow.nodes.some(n => n.actionType !== TRANSFER_ACTION && !n.actionType.startsWith('mock-')) ||
      workflow.resourceEdges.length || workflow.nodes.some(n => n.dependencies.length)) throw new Error('TRANSFER_ISOLATED_ONLY');
  const fields = readNativeTransferNode(nodes[0]!);
  if (fields.chain !== profile.chain || BigInt(fields.amount) > BigInt(profile.maximumValueWei)) throw new Error('TRANSFER_PROFILE_UNSUPPORTED');
  return { node: nodes[0]!, fields };
}
/** The exact self-transfer for the connected owner. */
export function compileNativeTransfer(workflow: SemanticWorkflow, accountInput: string, gasLimit: string, maxFeePerGas: string): NativeTransferTransaction {
  const { fields } = transferFields(workflow), owner = supplyAddress(accountInput);
  return { from: owner, to: owner, value: supplyHex(fields.amount), data: '0x', chainId: profile.chainHex,
    gas: supplyHex(gasLimit), maxFeePerGas: supplyHex(maxFeePerGas), maxPriorityFeePerGas: '0x0' };
}

/** Only reads. eth_call and eth_estimateGas execute the exact transfer against ephemeral state. */
export async function simulateNativeTransfer(workflow: SemanticWorkflow, accountInput: string, rpc: TransferRpc, now = Date.now()): Promise<NativeTransferReview> {
  const semanticHash = supplyArtifactHash('semantic-workflow', workflow);
  const { node, fields } = transferFields(workflow);
  const state = await readTransferState(rpc, accountInput, now), account = state.account, tag = supplyHex(state.block);
  // A queued transaction would make the wallet's nonce assignment ambiguous.
  if (state.pendingNonce !== state.nonce) throw new Error('TRANSFER_PENDING_TRANSACTION');
  if (BigInt(state.balance) <= BigInt(fields.amount)) throw new Error('TRANSFER_INSUFFICIENT_TEST_ETH');
  const call = { from: account, to: account, value: supplyHex(fields.amount), data: '0x' };
  const result = await rpc('eth_call', [call, tag]);
  if (result !== '0x') throw new Error('TRANSFER_SIMULATION_UNEXPECTED_RETURN');
  const gas = rpcUint(await rpc('eth_estimateGas', [call, tag]));
  if (gas < 21_000n || gas > 500_000n) throw new Error('TRANSFER_GAS_INVALID');
  const gasPrice = BigInt(state.gasPrice), baseFee = BigInt(state.baseFee);
  if (gasPrice <= 0n) throw new Error('TRANSFER_GAS_PRICE_INVALID');
  const gasLimit = (gas * BigInt(profile.gasLimitMarginPercent) + 99n) / 100n;
  const maxFeePerGas = (gasPrice > baseFee ? gasPrice : baseFee) * BigInt(profile.maxFeeMultiplier);
  const expectedFee = gas * gasPrice, feeBudget = gasLimit * maxFeePerGas, value = BigInt(fields.amount), balance = BigInt(state.balance);
  if (balance < value + feeBudget) throw new Error('TRANSFER_INSUFFICIENT_TEST_ETH');
  const transaction = compileNativeTransfer(workflow, account, gasLimit.toString(), maxFeePerGas.toString());
  if (rpcHash(rpcRecord(await rpc('eth_getBlockByNumber', [tag, false])).hash) !== state.blockHash) throw new Error('TRANSFER_REORG');
  const expiresAt = new Date(now + profile.reviewTtlSeconds * 1000).toISOString();
  const artifactSet: ArtifactSet = { schemaVersion: '1.0.0', artifactSetId: 'native-transfer-artifacts', semanticWorkflowHash: semanticHash,
    artifacts: [{ artifactId: 'native-transfer-state', nodeId: node.nodeId, artifactHash: supplyHash({ state, transaction, gas: gas.toString(), result }) }] };
  const artifactHash = supplyArtifactHash('artifact-set', artifactSet);
  const simulation: SimulationBundle = { schemaVersion: '1.0.0', simulationId: 'native-transfer-simulation', semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash, adapters: [adapter], contracts: [], outputs: [], propagatedOutputs: [],
    failurePaths: [], uncertainty: [{ code: 'L2_SOFT_CONFIRMATION', description: 'Inclusion is first a Robinhood Chain sequencer confirmation; L1 finality follows later.' }],
    unsupportedAssumptions: [], freshness: { observedAt: state.observedAt, expiresAt, maximumAgeSeconds: profile.reviewTtlSeconds } };
  const simulationHash = supplyArtifactHash('simulation-bundle', simulation), owner = { chainId: profile.chain, address: account };
  const spendLimits = [{ asset: native, maximumAmount: fields.amount, maximumPerStepAmount: fields.amount, maximumCumulativeAmount: fields.amount }];
  const gasBudgets = [{ asset: native, maximumAmount: feeBudget.toString() }];
  const recovery = { failurePolicy: 'ABORT' as const, residualAssetRecipient: owner, maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const providers = { kind: 'FIXED' as const, providerId: profile.adapterId };
  const policy: AuthorizationPolicy = { schemaVersion: '1.0.0', policyId: 'native-transfer-policy', semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash,
    simulationHash, requiredAuthorizationClass: 'MODE_A', allowlists: { owners: [owner], accounts: [owner], recipients: [owner], chains: [profile.chain],
      adapters: [adapter], protocols: ['native'], contracts: [], functions: [] },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits, maximumSlippageBps: 0, gasBudgets, feeBudgets: [], oracleRules: [], accountRiskRules: [], checkpointRules: [], providers,
    nonce: state.nonce, deadline: expiresAt, revocationEpoch: workflow.revision, recovery, enforcement: 'NOT_ENFORCED' };
  const policyHash = supplyArtifactHash('authorization-policy', policy);
  const manifest: StrategyManifest = { schemaVersion: '1.0.0', manifestId: 'native-transfer-manifest', semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash, simulationHash, policyHash, authorizationMode: 'MODE_A', owner, executor: null,
    expiresAt, nonce: state.nonce, revocationEpoch: workflow.revision, spendLimits, maximumSlippageBps: 0, gasBudgets, feeBudgets: [], providers, recovery,
    enforcement: 'NOT_ENFORCED' };
  const manifestHash = supplyArtifactHash('strategy-manifest', manifest);
  const plan: ExecutionPlan = { schemaVersion: '1.0.0', executionPlanId: 'native-transfer-plan', semanticWorkflowHash: semanticHash, manifestHash,
    segments: [{ segmentId: 'native-transfer-segment', chainId: profile.chain, dependencies: [], steps: [{ stepId: 'native-transfer', nodeId: node.nodeId,
      chainId: profile.chain, adapter, dependencies: [], requiredAuthorizationClass: 'MODE_A', executionKind: 'DIRECT_TRANSACTION',
      payloadHash: hashSupplyValue({ ...transaction, nonce: state.nonce }, 'payload') }] }], checkpointIds: [], enforcement: 'NOT_ENFORCED' };
  supplyArtifactHash('execution-plan', plan);
  const review = { format: 'gryloo.native-transfer-review.v1' as const, workflow, chain: profile.chain, chainId: profile.chainId, account, recipient: account,
    value: fields.amount, nonce: state.nonce, transaction, gasEstimate: gas.toString(), gasLimit: gasLimit.toString(), gasPrice: gasPrice.toString(),
    maxFeePerGas: maxFeePerGas.toString(), expectedFee: expectedFee.toString(), feeBudget: feeBudget.toString(), balanceBefore: state.balance,
    expectedBalanceAfter: (balance - expectedFee).toString(), minimumBalanceAfter: (balance - feeBudget).toString(), simulationResult: '0x' as const,
    state, expiresAt, artifactSet, simulation, policy, manifest, plan };
  return { ...review, commitment: supplyHash(review) };
}
/** Fails closed unless the reviewed commitment, intent, owner, nonce, fee bounds and freshness all still hold. */
export function assertNativeTransferReview(review: NativeTransferReview, workflow: SemanticWorkflow, account: string, state: TransferState, now = Date.now()): void {
  const { commitment, ...content } = review;
  if (supplyHash(content) !== commitment || review.format !== 'gryloo.native-transfer-review.v1') throw new Error('TRANSFER_AUTHORIZATION_INVALID');
  if (supplyArtifactHash('semantic-workflow', workflow) !== review.manifest.semanticWorkflowHash ||
      JSON.stringify(workflow) !== JSON.stringify(review.workflow)) throw new Error('TRANSFER_SEMANTIC_REVISION_CHANGED');
  const { fields } = transferFields(workflow), owner = supplyAddress(account);
  if (fields.amount !== review.value || owner !== review.account || review.recipient !== review.account || review.chain !== profile.chain) throw new Error('TRANSFER_AUTHORIZATION_INVALID');
  if (now >= Date.parse(review.expiresAt) || now < Date.parse(review.state.observedAt)) throw new Error('TRANSFER_REVIEW_EXPIRED');
  if (state.account !== review.account || state.nonce !== review.nonce || state.pendingNonce !== review.nonce || state.block < review.state.block ||
      BigInt(state.gasPrice) > BigInt(review.maxFeePerGas) || BigInt(state.balance) < BigInt(review.value) + BigInt(review.feeBudget)) throw new Error('TRANSFER_AUTHORIZATION_STALE');
  if (JSON.stringify(compileNativeTransfer(workflow, owner, review.gasLimit, review.maxFeePerGas)) !== JSON.stringify(review.transaction)) throw new Error('TRANSFER_AUTHORIZATION_INVALID');
}
