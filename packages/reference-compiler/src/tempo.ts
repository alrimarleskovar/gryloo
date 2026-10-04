// SPDX-License-Identifier: AGPL-3.0-only
/** Tempo adapter. Shared artifact schemas; protocol-specific amounts, fees and envelope. No signing or sending. */
import { TEMPO_PAYMENT as p } from '@defi-workflow-engine/action-registry';
import { readTokenPaymentNode, supplyAddress, hashSupplyValue, type SemanticWorkflow, type TokenPaymentFields,
  type ArtifactSet, type SimulationBundle, type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { rpcRecord, rpcUint, rpcHash, supplyHex, supplyHash, supplyArtifactHash, supplyCall, supplySelector, supplyWord, supplyTopic } from './supply.js';
export type TempoRpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
export type TempoTransaction = { type: '0x76'; chainId: string; from: string; calls: { to: string; value: '0x0'; data: string }[];
  nonceKey: '0x0'; nonce: string; feeToken: string; gas: string; maxFeePerGas: string; maxPriorityFeePerGas: '0x0'; validBefore: string };
export type TempoState = { block: number; blockHash: string; blockTimestamp: number; account: string; balance: string; recipientBalance: string;
  nonce: string; pendingNonce: string; gasPrice: string; baseFee: string; policy: string; observedAt: string };
export type TempoReview = { format: 'flofi.tempo-payment-review.v1'; workflow: SemanticWorkflow; account: string; fields: TokenPaymentFields;
  state: TempoState; nonce: string; transaction: TempoTransaction; gasLimit: string; maxFeePerGas: string; feeBudget: string; expiresAt: string;
  preflight: unknown; artifactSet: ArtifactSet; simulation: SimulationBundle; policy: AuthorizationPolicy; manifest: StrategyManifest; plan: ExecutionPlan; commitment: string };
const adapter = { id: p.adapterId, version: '1.0.0' };
const asset = { chainId: p.chain, address: p.token, decimals: 6 };
export function tempoFields(w: SemanticWorkflow): TokenPaymentFields {
  const nodes = w.nodes.filter(n => n.actionType === 'asset.transfer');
  if (nodes.length !== 1 || w.resourceEdges.length || w.nodes.some(n => n.dependencies.length || n.actionType !== 'asset.transfer' && !n.actionType.startsWith('mock-')))
    throw new Error('TEMPO_ISOLATED_ONLY');
  const f = readTokenPaymentNode(nodes[0]!);
  if (f.chain !== p.chain || f.token !== p.token || f.feeToken !== p.token || f.decimals !== 6 || f.adapterId !== p.adapterId ||
      BigInt(f.amount) > BigInt(p.maximumAmount) || BigInt(f.maximumFee) > BigInt(p.maximumFee) ||
      f.recipient.startsWith('0x20c0') || (f.recipient === p.feeManager || f.recipient === p.policyRegistry)) throw new Error('TEMPO_PROFILE_UNSUPPORTED');
  return f;
}
/** Gas prices are attodollars, TIP-20 balances are microdollars. Round UP, never ETH wei. */
export const tempoFee = (gas: bigint, price: bigint) => (gas * price + 999_999_999_999n) / 1_000_000_000_000n;
export const tempoMemoCall = (f: TokenPaymentFields) => supplySelector('transferWithMemo(address,uint256,bytes32)') + supplyWord(f.recipient) + supplyWord(BigInt(f.amount)) + f.memo.slice(2);
export async function tempoBalance(rpc: TempoRpc, owner: string, tag: string) {
  return rpcUint(await rpc('eth_call', [{ to: p.token, data: supplyCall('balanceOf(address)', owner) }, tag]));
}
export async function readTempoState(rpc: TempoRpc, accountInput: string, recipient: string, now = Date.now()): Promise<TempoState> {
  const account = supplyAddress(accountInput);
  if (account === recipient || BigInt(account) === 0n) throw new Error('TEMPO_DISTINCT_RECIPIENT_REQUIRED');
  if (rpcUint(await rpc('eth_chainId', [])) !== BigInt(p.chainId)) throw new Error('TEMPO_WRONG_CHAIN');
  const block = rpcRecord(await rpc('eth_getBlockByNumber', ['latest', false]));
  const tag = supplyHex(rpcUint(block.number)), number = Number(rpcUint(tag)), timestamp = Number(rpcUint(block.timestamp));
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(timestamp) || now - timestamp * 1000 > 30_000 || now < timestamp * 1000 - 10_000)
    throw new Error('TEMPO_STALE_HEAD');
  const call = (data: string) => rpc('eth_call', [{ to: p.token, data }, tag]);
  const [balance, recipientBalance, nonce, pendingNonce, gasPrice, decimals, currency, paused, policy, ownerCode, recipientCode] = await Promise.all([
    tempoBalance(rpc, account, tag), tempoBalance(rpc, recipient, tag), rpc('eth_getTransactionCount', [account, tag]),
    rpc('eth_getTransactionCount', [account, 'pending']), rpc('eth_gasPrice', []), call(supplyCall('decimals()')),
    call(supplyCall('currency()')), call(supplyCall('paused()')), call(supplyCall('transferPolicyId()')),
    rpc('eth_getCode', [account, tag]), rpc('eth_getCode', [recipient, tag])]);
  // Canonical ABI string USD. Native precompile code is not an ERC-20 deployment fingerprint.
  const usd = '0x' + supplyWord(32n) + supplyWord(3n) + '555344'.padEnd(64, '0');
  if (rpcUint(decimals) !== 6n || currency !== usd || rpcUint(paused) !== 0n || ownerCode !== '0x' || recipientCode !== '0x') throw new Error('TEMPO_TOKEN_OR_ACCOUNT_UNSUPPORTED');
  // Phase 1 pins always-allow; configurable policies require a new reviewed adapter profile.
  if (rpcUint(policy) !== 1n) throw new Error('TEMPO_POLICY_UNSUPPORTED');
  if (rpcHash(rpcRecord(await rpc('eth_getBlockByNumber', [tag, false])).hash) !== rpcHash(block.hash)) throw new Error('TEMPO_REORG');
  return { block: number, blockHash: rpcHash(block.hash), blockTimestamp: timestamp, account, balance: balance.toString(), recipientBalance: recipientBalance.toString(),
    nonce: rpcUint(nonce).toString(), pendingNonce: rpcUint(pendingNonce).toString(), gasPrice: rpcUint(gasPrice).toString(),
    baseFee: rpcUint(block.baseFeePerGas).toString(), policy: rpcUint(policy).toString(), observedAt: new Date(now).toISOString() };
}
export function compileTempoPayment(f: TokenPaymentFields, account: string, nonce: string, gas: string, price: string, expiresAt: string): TempoTransaction {
  return { type: '0x76', chainId: p.chainHex, from: account, calls: [{ to: p.token, value: '0x0', data: tempoMemoCall(f) }], nonceKey: '0x0',
    nonce: supplyHex(nonce), feeToken: p.token, gas: supplyHex(gas), maxFeePerGas: supplyHex(price), maxPriorityFeePerGas: '0x0',
    validBefore: supplyHex(Math.floor(Date.parse(expiresAt) / 1000)) };
}
/** Require both transfer events; held/redirected payments do not satisfy the requested recipient. */
export function assertTempoPaymentLogs(value: unknown, account: string, f: TokenPaymentFields): void {
  if (!Array.isArray(value)) throw new Error('TEMPO_PAYMENT_LOGS_MISMATCH');
  const matching = (signature: string, memo: boolean) => value.filter(v => {
    const log = rpcRecord(v), topics = log.topics;
    return log.removed !== true && typeof log.address === 'string' && log.address.toLowerCase() === p.token && Array.isArray(topics) &&
      topics.length === (memo ? 4 : 3) && topics[0] === supplyTopic(signature) && topics[1] === '0x' + supplyWord(account) &&
      topics[2] === '0x' + supplyWord(f.recipient) && (!memo || topics[3] === f.memo) && log.data === '0x' + supplyWord(BigInt(f.amount));
  }).length;
  if (matching('Transfer(address,address,uint256)', false) !== 1 || matching('TransferWithMemo(address,address,uint256,bytes32)', true) !== 1)
    throw new Error('TEMPO_PAYMENT_LOGS_MISMATCH');
}
/** This one-call profile permits exactly the payment, memo and one bounded net protocol fee event. */
export function tempoPaymentFeeLog(value: unknown, account: string): bigint {
  if (!Array.isArray(value) || value.length !== 3) throw new Error('TEMPO_FEE_LOG_MISMATCH');
  const fees = value.map(rpcRecord).filter(l => l.address === p.token && l.removed !== true && Array.isArray(l.topics) &&
    l.topics.length === 3 && l.topics[0] === supplyTopic('Transfer(address,address,uint256)') && l.topics[1] === '0x' + supplyWord(account) &&
    l.topics[2] === '0x' + supplyWord(p.feeManager) && typeof l.data === 'string' && /^0x[0-9a-f]{64}$/.test(l.data));
  if (fees.length !== 1) throw new Error('TEMPO_FEE_LOG_MISMATCH');
  return rpcUint(fees[0]!.data);
}
export async function preflightTempoTransaction(rpc: TempoRpc, tx: TempoTransaction, f: TokenPaymentFields, state: TempoState): Promise<unknown> {
  // validation=true includes balance and transaction validation. No state overrides or fake funding.
  // Reth simulation normalizes a top-level call. Do not provide both forms: Tempo appends top-level to calls.
  const { calls: payloadCalls, ...envelope } = tx;
  if (payloadCalls.length !== 1) throw new Error('TEMPO_SINGLE_CALL_REQUIRED');
  const simulatedCall = { ...envelope, ...payloadCalls[0]! };
  const result = await rpc('eth_simulateV1', [{ blockStateCalls: [{ calls: [simulatedCall] }], validation: true, traceTransfers: false }, supplyHex(state.block)]);
  if (!Array.isArray(result) || result.length !== 1) throw new Error('TEMPO_SIMULATION_UNVERIFIABLE');
  const calls = rpcRecord(result[0]).calls;
  if (!Array.isArray(calls) || calls.length !== 1) throw new Error('TEMPO_SIMULATION_UNVERIFIABLE');
  const call = rpcRecord(calls[0]);
  if (call.error || rpcUint(call.status) !== 1n || rpcUint(call.gasUsed) > BigInt(tx.gas)) throw new Error('TEMPO_SIMULATION_FAILED');
  assertTempoPaymentLogs(call.logs, tx.from, f);
  const fee = tempoPaymentFeeLog(call.logs, tx.from);
  if (fee <= 0n || fee > BigInt(f.maximumFee) || fee > tempoFee(rpcUint(call.gasUsed), BigInt(tx.maxFeePerGas))) throw new Error('TEMPO_FEE_LOG_MISMATCH');
  if (rpcHash(rpcRecord(await rpc('eth_getBlockByNumber', [supplyHex(state.block), false])).hash) !== state.blockHash) throw new Error('TEMPO_REORG');
  return result;
}
export async function simulateTempoPayment(workflow: SemanticWorkflow, accountInput: string, rpc: TempoRpc, now = Date.now()): Promise<TempoReview> {
  const fields = tempoFields(workflow), state = await readTempoState(rpc, accountInput, fields.recipient, now), account = state.account;
  if (state.nonce !== state.pendingNonce) throw new Error('TEMPO_PENDING_TRANSACTION');
  if (BigInt(state.balance) < BigInt(fields.amount) + BigInt(fields.maximumFee)) throw new Error('TEMPO_INSUFFICIENT_PATHUSD');
  const price = (BigInt(state.gasPrice) > BigInt(state.baseFee) ? BigInt(state.gasPrice) : BigInt(state.baseFee)) * 2n;
  if (price <= 0n) throw new Error('TEMPO_FEE_UNVERIFIABLE');
  const expiresAt = new Date(Math.floor(now / 1000) * 1000 + p.reviewTtlSeconds * 1000).toISOString();
  const draft = compileTempoPayment(fields, account, state.nonce, p.maximumGas, price.toString(), expiresAt);
  const estimate = rpcUint(await rpc('eth_estimateGas', [draft, supplyHex(state.block)]));
  const gas = (estimate * 120n + 99n) / 100n;
  if (estimate < 21000n || gas > BigInt(p.maximumGas) || tempoFee(gas, price) > BigInt(fields.maximumFee)) throw new Error('TEMPO_FEE_CEILING');
  const transaction = compileTempoPayment(fields, account, state.nonce, gas.toString(), price.toString(), expiresAt);
  const simulated = await preflightTempoTransaction(rpc, transaction, fields, state);
  const semanticHash = supplyArtifactHash('semantic-workflow', workflow), node = workflow.nodes.find(n => n.actionType === 'asset.transfer')!;
  const artifactSet: ArtifactSet = { schemaVersion: '1.0.0', artifactSetId: 'tempo-payment-artifacts', semanticWorkflowHash: semanticHash,
    artifacts: [{ artifactId: 'tempo-payment-preflight', nodeId: node.nodeId, artifactHash: supplyHash({ state, transaction, simulated }) }] };
  const artifactHash = supplyArtifactHash('artifact-set', artifactSet);
  const contract = { chainId: p.chain, address: p.token, version: 'tip20' };
  const simulation: SimulationBundle = { schemaVersion: '1.0.0', simulationId: 'tempo-payment-simulation', semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash, adapters: [adapter], contracts: [contract], outputs: [], propagatedOutputs: [], failurePaths: [],
    uncertainty: [{ code: 'READ_ONLY_PREFLIGHT', description: 'Ephemeral RPC preflight; no owner signature or public execution. Network provenance is recorded by the execution run.' }], unsupportedAssumptions: [],
    freshness: { observedAt: state.observedAt, expiresAt, maximumAgeSeconds: p.reviewTtlSeconds } };
  const simulationHash = supplyArtifactHash('simulation-bundle', simulation), owner = { chainId: p.chain, address: account };
  const spendLimits = [{ asset, maximumAmount: fields.amount, maximumPerStepAmount: fields.amount, maximumCumulativeAmount: fields.amount }];
  const gasBudgets = [{ asset, maximumAmount: fields.maximumFee }];
  const recovery = { failurePolicy: 'ABORT' as const, residualAssetRecipient: owner, maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const providers = { kind: 'FIXED' as const, providerId: p.adapterId };
  const policy: AuthorizationPolicy = { schemaVersion: '1.0.0', policyId: 'tempo-payment-policy', semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash,
    simulationHash, requiredAuthorizationClass: 'MODE_A', allowlists: { owners: [owner], accounts: [owner], recipients: [{ chainId: p.chain, address: fields.recipient }],
      chains: [p.chain], adapters: [adapter], protocols: ['tip20'], contracts: [contract],
      functions: [{ chainId: p.chain, contract: p.token, functionId: supplySelector('transferWithMemo(address,uint256,bytes32)') }] },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits, maximumSlippageBps: 0, gasBudgets, feeBudgets: [], oracleRules: [], accountRiskRules: [], checkpointRules: [], providers,
    nonce: state.nonce, deadline: expiresAt, revocationEpoch: workflow.revision, recovery, enforcement: 'NOT_ENFORCED' };
  const policyHash = supplyArtifactHash('authorization-policy', policy);
  const manifest: StrategyManifest = { schemaVersion: '1.0.0', manifestId: 'tempo-payment-manifest', semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash, simulationHash, policyHash, authorizationMode: 'MODE_A', owner, executor: null,
    expiresAt, nonce: state.nonce, revocationEpoch: workflow.revision, spendLimits, maximumSlippageBps: 0, gasBudgets, feeBudgets: [], providers, recovery, enforcement: 'NOT_ENFORCED' };
  const manifestHash = supplyArtifactHash('strategy-manifest', manifest);
  const plan: ExecutionPlan = { schemaVersion: '1.0.0', executionPlanId: 'tempo-payment-plan', semanticWorkflowHash: semanticHash, manifestHash,
    segments: [{ segmentId: 'tempo-payment-segment', chainId: p.chain, dependencies: [], steps: [{ stepId: 'tempo-payment', nodeId: node.nodeId,
      chainId: p.chain, adapter, dependencies: [], requiredAuthorizationClass: 'MODE_A', executionKind: 'DIRECT_TRANSACTION',
      payloadHash: hashSupplyValue(transaction, 'payload') }] }], checkpointIds: [], enforcement: 'NOT_ENFORCED' };
  supplyArtifactHash('execution-plan', plan);
  const review = { format: 'flofi.tempo-payment-review.v1' as const, workflow, account, fields, state, nonce: state.nonce, transaction,
    gasLimit: gas.toString(), maxFeePerGas: price.toString(), feeBudget: fields.maximumFee, expiresAt, preflight: simulated, artifactSet, simulation, policy, manifest, plan };
  return { ...review, commitment: supplyHash(review) };
}
export function assertTempoReview(review: TempoReview, workflow: SemanticWorkflow, account: string, state: TempoState, now = Date.now()): void {
  const { commitment, ...body } = review;
  if (supplyHash(body) !== commitment || supplyArtifactHash('semantic-workflow', workflow) !== review.manifest.semanticWorkflowHash ||
      supplyAddress(account) !== review.account || JSON.stringify(tempoFields(workflow)) !== JSON.stringify(review.fields)) throw new Error('TEMPO_REVIEW_CHANGED');
  if (now >= Date.parse(review.expiresAt) || now < Date.parse(state.observedAt) || now - Date.parse(state.observedAt) > 30_000 ||
      state.block < review.state.block || state.account !== review.account || state.nonce !== review.nonce || state.pendingNonce !== review.nonce ||
      state.policy !== review.state.policy || BigInt(state.balance) < BigInt(review.fields.amount) + BigInt(review.feeBudget) ||
      BigInt(state.gasPrice) > BigInt(review.maxFeePerGas) || BigInt(state.baseFee) > BigInt(review.maxFeePerGas)) throw new Error('TEMPO_REVIEW_STALE');
  if (JSON.stringify(compileTempoPayment(review.fields, review.account, review.nonce, review.gasLimit, review.maxFeePerGas, review.expiresAt)) !== JSON.stringify(review.transaction))
    throw new Error('TEMPO_TRANSACTION_MISMATCH');
}

export { TEMPO_PAYMENT } from '@defi-workflow-engine/action-registry';
