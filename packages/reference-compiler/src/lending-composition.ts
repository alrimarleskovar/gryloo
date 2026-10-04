// SPDX-License-Identifier: AGPL-3.0-only
/** Finite Mode A lending composition. This module has no signing or submission transport. */
import { AAVE_V3_BASE_SEPOLIA as p, LENDING_BASE_SEPOLIA as u } from '@defi-workflow-engine/action-registry';
import { readLendingComposition, createSupplyNode, createBorrowNode, supplyAddress, hashSupplyValue,
  type SemanticWorkflow, type LendingCompositionFields, type ArtifactSet, type SimulationBundle,
  type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { readBorrowState, estimateBorrow, borrowHealthFactor, BORROW_MINIMUM_HEALTH_FACTOR } from './borrow.js';
import { compileSupplyCalls, rpcUint, rpcRecord, rpcHash, rpcHex, supplyCall, supplyHex, supplyHash, supplyArtifactHash,
  type SupplyState, type SupplyRpc, type SupplyTransaction } from './supply.js';
export type LendingStepId = 'POOL_APPROVAL' | 'SUPPLY' | 'BORROW' | 'ROUTER_APPROVAL' | 'SWAP';
export type LendingRoute = { pool: string; liquidity: string; expectedOut: string; minimumOut: string;
  codeHash: string; block: number; blockHash: string; timestamp: number; sqrtPriceX96: string; poolWethBalance: string };
export type LendingSnapshot = { aave: SupplyState; wethBalance: string; routerAllowance: string; variableRateRay: string };
export type LendingCall = { id: LendingStepId; nodeId: string; tx: SupplyTransaction; gasLimit: string };
export type LendingReview = { format: 'gryloo.lending-review.v1'; workflow: SemanticWorkflow; fields: LendingCompositionFields;
  state: LendingSnapshot; rootState: LendingSnapshot; route: LendingRoute; completed: LendingStepId[];
  calls: LendingCall[]; projected: { afterSupply: LendingSnapshot; afterBorrow: LendingSnapshot; afterSwap: LendingSnapshot };
  simulationResponse: unknown; gasPrice: string; l1FeeUpperBound: string; gasBudget: string; expiresAt: string;
  artifactSet: ArtifactSet; simulation: SimulationBundle; policy: AuthorizationPolicy; manifest: StrategyManifest;
  plan: ExecutionPlan; rerootOf?: string; commitment: string };
const order: LendingStepId[] = ['POOL_APPROVAL', 'SUPPLY', 'BORROW', 'ROUTER_APPROVAL', 'SWAP'];
export const lendingSteps = order;
// Match the existing 2x fee-price headroom in Supply and this composition.
// This is a finite owner-reviewed ceiling for the 120-second window, not a promise
// that fees cannot double. An estimate above it still requires a new Review.
export const LENDING_L1_FEE_CEILING_MULTIPLIER = 2n;
const uint = (value: string) => { if (!/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 1n << 256n) throw Error('LENDING_VALUE_INVALID'); return BigInt(value); };
const words = (value: unknown, count: number): bigint[] => {
  const data = rpcHex(value).slice(2); if (data.length !== count * 64) throw Error('LENDING_RPC_INVALID');
  return data.match(/.{64}/g)!.map(w => BigInt('0x' + w));
};
export async function readLendingL1FeeUpperBound(rpc: SupplyRpc, callCount: number, tag: string): Promise<string> {
  if (!Number.isSafeInteger(callCount) || callCount < 1 || callCount > order.length) throw Error('LENDING_FEE_BUDGET_INVALID');
  const fee = rpcUint(await rpc('eth_call', [{to:u.gasOracle,data:supplyCall('getL1FeeUpperBound(uint256)',8192n)},tag]));
  return (fee * BigInt(callCount)).toString();
}
/** Existing Manifest budgets are authority; l1FeeUpperBound is the pinned estimate. */
export function lendingFeeCeilings(review: LendingReview) {
  const fee = review.manifest.feeBudgets, gas = review.manifest.gasBudgets;
  const native = (asset: (typeof fee)[number]['asset']) => asset.chainId === p.chain && 'nativeId' in asset && asset.nativeId === 'ETH' && asset.decimals === 18;
  if (fee.length !== 1 || gas.length !== 1 || !native(fee[0]!.asset) || !native(gas[0]!.asset) ||
      supplyHash(fee) !== supplyHash(review.policy.feeBudgets) || supplyHash(gas) !== supplyHash(review.policy.gasBudgets)) throw Error('LENDING_COMMITMENT_INVALID');
  const maximumL1Fee = uint(fee[0]!.maximumAmount), maximumNetworkFee = uint(gas[0]!.maximumAmount);
  const executionMaximum = review.calls.reduce((sum,c) => sum + uint(c.gasLimit) * uint(review.gasPrice),0n);
  if (maximumL1Fee < uint(review.l1FeeUpperBound) || maximumNetworkFee !== uint(review.gasBudget) ||
      maximumNetworkFee !== executionMaximum + maximumL1Fee) throw Error('LENDING_COMMITMENT_INVALID');
  return {maximumL1Fee,maximumNetworkFee};
}
/** Neither a live estimate nor a continuation can enlarge accepted/root authority. */
export function assertLendingFeeBudgets(review: LendingReview, currentL1Fee: string, remainingNetworkMaximum: string,
  rootReview = review, consumedNetworkCost = '0', consumedL1Fee = '0'): void {
  const current = lendingFeeCeilings(review), root = lendingFeeCeilings(rootReview);
  if (uint(currentL1Fee) > current.maximumL1Fee || uint(currentL1Fee) + uint(consumedL1Fee) > root.maximumL1Fee) throw Error('LENDING_FINAL_L1_FEE_BUDGET_CHANGED');
  if (uint(remainingNetworkMaximum) > current.maximumNetworkFee || uint(remainingNetworkMaximum) + uint(consumedNetworkCost) > root.maximumNetworkFee) throw Error('LENDING_REVIEW_STALE');
}
export function assertLendingFields(workflow: SemanticWorkflow, account: string) {
  const f = readLendingComposition(workflow);
  if (f.chain !== p.chain || f.collateral.address !== p.asset || f.borrowed.address !== p.asset || f.output.address !== u.weth ||
      f.collateral.decimals !== 6 || f.borrowed.decimals !== 6 || f.output.decimals !== 18) throw Error('LENDING_ASSET_IDENTITY_UNSUPPORTED');
  if (f.owner !== supplyAddress(account)) throw Error('LENDING_OWNER_CHANGED');
  return f;
}
/** Factory discovery is repeated at the pinned block. Token symbols are never used to route. */
export async function readLendingRoute(rpc: SupplyRpc, amount: string, slippageBps: number, now = Date.now(), tag = 'latest', fixedMinimum?: string): Promise<LendingRoute> {
  if (rpcUint(await rpc('eth_chainId', [])) !== BigInt(p.chainId)) throw Error('LENDING_WRONG_CHAIN');
  const block = rpcRecord(await rpc('eth_getBlockByNumber', [tag, false]));
  const at = supplyHex(rpcUint(block.number)), blockHash = rpcHash(block.hash), timestamp = Number(rpcUint(block.timestamp)) * 1000;
  if (!Number.isSafeInteger(timestamp) || now < timestamp - 15_000 || now - timestamp > 120_000) throw Error('LENDING_RPC_STALE');
  const read = (to: string, data: string) => rpc('eth_call', [{ to, data }, at]);
  const poolWord = rpcUint(await read(u.factory, supplyCall('getPool(address,address,uint24)', p.asset, u.weth, BigInt(u.fee))));
  if (poolWord === 0n) throw Error('LENDING_COMPATIBLE_POOL_NOT_FOUND');
  if (poolWord >= 1n << 160n) throw Error('LENDING_POOL_IDENTITY_INVALID');
  const pool = '0x' + poolWord.toString(16).padStart(40, '0');
  const [factory, qFactory, rWeth, token0, token1, fee, poolFactory, liquidity, slot, quote, outputBalance, ...codes] = await Promise.all([
    read(u.router, supplyCall('factory()')), read(u.quoter, supplyCall('factory()')), read(u.router, supplyCall('WETH9()')),
    read(pool, supplyCall('token0()')), read(pool, supplyCall('token1()')), read(pool, supplyCall('fee()')),
    read(pool, supplyCall('factory()')), read(pool, supplyCall('liquidity()')), read(pool, supplyCall('slot0()')),
    read(u.quoter, supplyCall('quoteExactInputSingle((address,address,uint256,uint24,uint160))', p.asset, u.weth, uint(amount), BigInt(u.fee), 0n)),
    read(u.weth, supplyCall('balanceOf(address)', pool)),
    ...[u.factory, u.router, u.quoter, pool, u.weth].map(to => rpc('eth_getCode', [to, at])),
  ]);
  const tokens = [rpcUint(token0), rpcUint(token1)].sort((a,b) => a < b ? -1 : 1);
  const expectedTokens = [BigInt(p.asset), BigInt(u.weth)].sort((a,b) => a < b ? -1 : 1);
  if (tokens.some((v,i) => v !== expectedTokens[i]) || rpcUint(factory) !== BigInt(u.factory) || rpcUint(qFactory) !== BigInt(u.factory) ||
      rpcUint(poolFactory) !== BigInt(u.factory) || rpcUint(rWeth) !== BigInt(u.weth) || rpcUint(fee) !== 500n ||
      codes.some(code => rpcHex(code).length < 4)) throw Error('LENDING_INFRASTRUCTURE_MISMATCH');
  const state = words(slot, 7), q = words(quote, 4);
  if (!rpcUint(liquidity) || !state[0] || state[6] !== 1n || !q[0] || rpcUint(outputBalance) < q[0]!) throw Error('LENDING_SWAP_LIQUIDITY_UNAVAILABLE');
  const minimumOut = fixedMinimum ?? (q[0]! * BigInt(10000 - slippageBps) / 10000n).toString();
  if (!uint(minimumOut) || q[0]! < uint(minimumOut)) throw Error('LENDING_SWAP_MINIMUM_UNAVAILABLE');
  if (rpcHash(rpcRecord(await rpc('eth_getBlockByNumber', [at, false])).hash) !== blockHash) throw Error('LENDING_RPC_INCONSISTENT');
  return { pool, liquidity: rpcUint(liquidity).toString(), expectedOut: q[0]!.toString(), minimumOut, codeHash: supplyHash(codes),
    block: Number(rpcUint(block.number)), blockHash, timestamp, sqrtPriceX96: state[0]!.toString(), poolWethBalance: rpcUint(outputBalance).toString() };
}
export async function readLendingSnapshot(rpc: SupplyRpc, account: string, tag = 'latest', enforceHealth = true): Promise<LendingSnapshot> {
  const aave = await readBorrowState(rpc, account, account, tag), at = supplyHex(aave.block);
  const call = (to: string, data: string) => rpc('eth_call', [{ to, data }, at]);
  const [weth, allowance, reserve] = await Promise.all([call(u.weth, supplyCall('balanceOf(address)', account)),
    call(p.asset, supplyCall('allowance(address,address)', account, u.router)), call(p.pool, supplyCall('getReserveData(address)', p.asset))]);
  if (aave.borrow!.eMode !== '0' || uint(aave.borrow!.userConfiguration) & ~3n) throw Error('LENDING_ACCOUNT_UNSUPPORTED');
  if (enforceHealth && uint(aave.borrow!.healthFactor) < BORROW_MINIMUM_HEALTH_FACTOR) throw Error('LENDING_UNSAFE_HEALTH_FACTOR');
  return { aave, wethBalance: rpcUint(weth).toString(), routerAllowance: rpcUint(allowance).toString(), variableRateRay: words(reserve, 15)[4]!.toString() };
}
export function compileLendingCalls(workflow: SemanticWorkflow, account: string, state: LendingSnapshot, minimumOut: string, completed: LendingStepId[] = []): LendingCall[] {
  const f = assertLendingFields(workflow, account), ids = workflow.nodes.map(n => n.nodeId);
  const base = { from: f.owner, value: '0x0' as const, chainId: p.chainHex };
  const list: LendingCall[] = [];
  const add = (id: LendingStepId, nodeId: string, to: string, data: string) => { if (!completed.includes(id)) list.push({ id, nodeId, tx: { ...base, to, data }, gasLimit: '0' }); };
  if (!completed.includes('SUPPLY')) {
    const leaf: SemanticWorkflow = { ...workflow, nodes: [createSupplyNode(ids[0]!, { chain: f.chain, asset: f.collateral, amount: f.supplyAmount, beneficiary: f.owner })], resourceEdges: [] };
    const calls = compileSupplyCalls(leaf, account, state.aave.allowance);
    if (calls.length === 2) add('POOL_APPROVAL', ids[0]!, calls[0]!.to, calls[0]!.data);
    add('SUPPLY', ids[0]!, calls.at(-1)!.to, calls.at(-1)!.data);
  }
  const borrowLeaf: SemanticWorkflow = { ...workflow, nodes: [createBorrowNode(ids[1]!, { chain: f.chain, asset: f.borrowed, amount: f.borrowAmount, beneficiary: f.owner, interestRateMode: 2 })], resourceEdges: [] };
  const borrow = compileSupplyCalls(borrowLeaf, account, '0')[0]!;
  add('BORROW', ids[1]!, borrow.to, borrow.data);
  if (uint(state.routerAllowance) < uint(f.borrowAmount)) add('ROUTER_APPROVAL', ids[2]!, p.asset, supplyCall('approve(address,uint256)', u.router, uint(f.borrowAmount)));
  add('SWAP', ids[2]!, u.router, supplyCall('exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', p.asset, u.weth, 500n, f.owner, uint(f.borrowAmount), uint(minimumOut), 0n));
  return list;
}
const snapshotQueries = (account: string) => [
  [p.pool, supplyCall('getUserAccountData(address)', account)], [p.pool, supplyCall('getUserConfiguration(address)', account)],
  [p.asset, supplyCall('balanceOf(address)', account)], [u.weth, supplyCall('balanceOf(address)', account)],
  [p.aToken, supplyCall('balanceOf(address)', account)], [p.aToken, supplyCall('scaledBalanceOf(address)', account)],
  [p.variableDebtToken, supplyCall('balanceOf(address)', account)], [p.variableDebtToken, supplyCall('scaledBalanceOf(address)', account)],
  [p.asset, supplyCall('allowance(address,address)', account, p.pool)], [p.asset, supplyCall('allowance(address,address)', account, u.router)],
  [p.pool, supplyCall('getReserveNormalizedIncome(address)', p.asset)], [p.pool, supplyCall('getReserveNormalizedVariableDebt(address)', p.asset)],
  [p.asset,supplyCall('balanceOf(address)',p.aToken)], [p.variableDebtToken,supplyCall('totalSupply()')],
];
function simulatedSnapshot(before: LendingSnapshot, responses: Record<string, unknown>[]): LendingSnapshot {
  const values = responses.map(r => r.returnData), a = words(values[0], 6), n = values.slice(1).map(v => rpcUint(v).toString());
  return { ...before, wethBalance: n[2]!, routerAllowance: n[8]!, aave: { ...before.aave,
    balance: n[1]!, position: n[3]!, scaledPosition: n[4]!, allowance: n[7]!, index: n[9]!,
    borrow: { ...before.aave.borrow!, collateralBase: a[0]!.toString(), debtBase: a[1]!.toString(), availableBorrowBase: a[2]!.toString(),
      liquidationThresholdBps: a[3]!.toString(), ltvBps: a[4]!.toString(), healthFactor: a[5]!.toString(),
      userConfiguration: n[0]!, debt: n[5]!, scaledDebt: n[6]!, debtIndex: n[10]!,liquidity:n[11]!,debtTotalSupply:n[12]! } } };
}
/**
 * Owner-interaction lifetime of a Review, measured from its simulation. A continuation (at least one completed step)
 * needs Accept, the full public gate at preparation and a fast release gate before the wallet; 120 s was not enough
 * for that sequence. Every wallet handoff is still gated on fresh state, so a longer lifetime grants no stale authority.
 */
export const LENDING_REVIEW_TTL_MS = 120_000, LENDING_CONTINUATION_REVIEW_TTL_MS = 600_000;
/** Rejects unsupported simulation; no state override, replacement token, pool creation or send exists here. */
export async function simulateLendingComposition(workflow: SemanticWorkflow, account: string, rpc: SupplyRpc,
  options: { now?: number; completed?: LendingStepId[]; rootState?: LendingSnapshot; minimumOut?: string; maximumL1Fee?: string; rerootOf?: string } = {}): Promise<LendingReview> {
  const now = options.now ?? Date.now(), f = assertLendingFields(workflow, account), completed = options.completed ?? [];
  const route = await readLendingRoute(rpc, f.borrowAmount, f.slippageBps, now, 'latest', options.minimumOut);
  if (options.rerootOf !== undefined && (options.rootState || completed.length || !/^0x[0-9a-f]{64}$/.test(options.rerootOf))) throw Error('LENDING_REROOT_INVALID');
  const state = await readLendingSnapshot(rpc, account, supplyHex(route.block)), rootState = options.rootState ?? state;
  if (state.aave.blockHash !== route.blockHash) throw Error('LENDING_RPC_INCONSISTENT');
  if (!completed.includes('SUPPLY') && uint(state.aave.balance) < uint(f.supplyAmount) || completed.includes('BORROW') && uint(state.aave.balance) < uint(f.borrowAmount)) throw Error('LENDING_OWNER_FUNDING_INSUFFICIENT');
  const calls = compileLendingCalls(workflow, account, state, route.minimumOut, completed), gasPrice = (uint(state.aave.gasPrice) * 2n).toString();
  const sequence: Record<string, unknown>[] = [], indexes = new Map<LendingStepId, { tx: number; queries: number }>();
  for (const c of calls) {
    const tx = sequence.length; sequence.push({ ...c.tx, gas: supplyHex(1_000_000n), gasPrice: supplyHex(gasPrice) });
    const queries = sequence.length;
    if (['SUPPLY', 'BORROW', 'SWAP'].includes(c.id)) for (const [to, data] of snapshotQueries(account)) sequence.push({ from: account, to, data, value: '0x0', gas: supplyHex(300_000n), gasPrice: supplyHex(gasPrice) });
    indexes.set(c.id, { tx, queries });
  }
  let simulationResponse: unknown;
  try { simulationResponse = await rpc('eth_simulateV1', [{ blockStateCalls: [{ calls: sequence }], validation: true, traceTransfers: false, returnFullTransactions: false }, supplyHex(route.block)]); }
  catch (cause) { throw Error('LENDING_SEQUENTIAL_SIMULATION_UNAVAILABLE', { cause }); }
  if (!Array.isArray(simulationResponse) || simulationResponse.length !== 1) throw Error('LENDING_SEQUENTIAL_SIMULATION_INVALID');
  const responses = rpcRecord(simulationResponse[0]).calls;
  if (!Array.isArray(responses) || responses.length !== sequence.length || responses.some(r => rpcRecord(r).status !== '0x1')) throw Error('LENDING_SEQUENTIAL_SIMULATION_FAILED');
  const projected = { afterSupply: state, afterBorrow: state, afterSwap: state };
  for (const c of calls) {
    const ix = indexes.get(c.id)!, result = rpcRecord(responses[ix.tx]), gas = rpcUint(result.gasUsed);
    if (!gas || gas > 1_000_000n) throw Error('LENDING_GAS_INVALID');
    c.gasLimit = ((gas * 150n + 99n) / 100n).toString();
    if (c.id.endsWith('APPROVAL') && rpcUint(result.returnData) !== 1n || ['SUPPLY','BORROW'].includes(c.id) && result.returnData !== '0x' || c.id === 'SWAP' && rpcUint(result.returnData) < uint(route.minimumOut)) throw Error('LENDING_SIMULATION_RETURN_INVALID');
    if (c.id === 'SUPPLY') projected.afterSupply = simulatedSnapshot(state, responses.slice(ix.queries, ix.queries + snapshotQueries(account).length).map(rpcRecord));
    if (c.id === 'BORROW') projected.afterBorrow = simulatedSnapshot(state, responses.slice(ix.queries, ix.queries + snapshotQueries(account).length).map(rpcRecord));
    if (c.id === 'SWAP') projected.afterSwap = simulatedSnapshot(state, responses.slice(ix.queries, ix.queries + snapshotQueries(account).length).map(rpcRecord));
  }
  const beforeBorrow = completed.includes('SUPPLY') ? state : projected.afterSupply;
  if (!completed.includes('BORROW')) estimateBorrow(f.borrowAmount, beforeBorrow.aave.borrow!);
  for (const s of [beforeBorrow, completed.includes('BORROW') ? state : projected.afterBorrow, projected.afterSwap]) {
    const b = s.aave.borrow!;
    const expected = BigInt(borrowHealthFactor(b.collateralBase, b.liquidationThresholdBps, b.debtBase));
    const difference = uint(b.healthFactor) > expected ? uint(b.healthFactor)-expected : expected-uint(b.healthFactor);
    if (uint(b.healthFactor) < BORROW_MINIMUM_HEALTH_FACTOR || difference > expected / 1_000_000n + 1n) throw Error('LENDING_UNSAFE_HEALTH_FACTOR');
  }
  const afterBorrow=completed.includes('BORROW')?state:projected.afterBorrow;
  const ray=10n**27n,abs=(n:bigint)=>n<0n?-n:n;
  const principal=(amount:string,preShares:string,postShares:string,index:string)=>{
    const delta=uint(postShares)-uint(preShares),i=uint(index);
    if(delta<=0n||abs((delta*i+ray/2n)/ray-uint(amount))>(i+ray-1n)/ray+1n)throw Error('LENDING_SIMULATION_PRINCIPAL_MISMATCH');
  };
  if(!completed.includes('SUPPLY')){
    principal(f.supplyAmount,state.aave.scaledPosition,beforeBorrow.aave.scaledPosition,beforeBorrow.aave.index);
    if(uint(state.aave.balance)-uint(beforeBorrow.aave.balance)!==uint(f.supplyAmount)||state.wethBalance!==beforeBorrow.wethBalance||state.aave.borrow!.scaledDebt!==beforeBorrow.aave.borrow!.scaledDebt)throw Error('LENDING_SIMULATION_EXPOSURE_MISMATCH');
  }
  if(!completed.includes('BORROW')){
    principal(f.borrowAmount,beforeBorrow.aave.borrow!.scaledDebt,afterBorrow.aave.borrow!.scaledDebt,afterBorrow.aave.borrow!.debtIndex);
    if(uint(afterBorrow.aave.balance)-uint(beforeBorrow.aave.balance)!==uint(f.borrowAmount)||beforeBorrow.aave.scaledPosition!==afterBorrow.aave.scaledPosition||beforeBorrow.wethBalance!==afterBorrow.wethBalance)throw Error('LENDING_SIMULATION_EXPOSURE_MISMATCH');
  }
  if(afterBorrow.aave.scaledPosition!==projected.afterSwap.aave.scaledPosition||afterBorrow.aave.borrow!.scaledDebt!==projected.afterSwap.aave.borrow!.scaledDebt)throw Error('LENDING_SIMULATION_PRINCIPAL_MISMATCH');
  const expectedUsdc = uint(state.aave.balance) - (completed.includes('SUPPLY') ? 0n : uint(f.supplyAmount)) + (completed.includes('BORROW') ? 0n : uint(f.borrowAmount)) - uint(f.borrowAmount);
  if (uint(projected.afterSwap.aave.balance) !== expectedUsdc || uint(projected.afterSwap.wethBalance) - uint(state.wethBalance) < uint(route.minimumOut)) throw Error('LENDING_SIMULATION_EXPOSURE_MISMATCH');
  const l1FeeUpperBound = await readLendingL1FeeUpperBound(rpc,calls.length,supplyHex(route.block));
  // Rechecks reuse the accepted ceiling; only a new Simulate creates headroom.
  const maximumL1Fee = options.maximumL1Fee === undefined ? uint(l1FeeUpperBound) * LENDING_L1_FEE_CEILING_MULTIPLIER : uint(options.maximumL1Fee);
  if (uint(l1FeeUpperBound) > maximumL1Fee) throw Error('LENDING_FINAL_L1_FEE_BUDGET_CHANGED');
  const gasBudget = (calls.reduce((sum,c) => sum + uint(c.gasLimit) * uint(gasPrice), 0n) + maximumL1Fee).toString();
  if (!uint(gasPrice) || uint(state.aave.nativeBalance) < uint(gasBudget)) throw Error('LENDING_GAS_FUNDING_INSUFFICIENT');
  if (rpcHash(rpcRecord(await rpc('eth_getBlockByNumber', [supplyHex(route.block), false])).hash) !== route.blockHash) throw Error('LENDING_RPC_INCONSISTENT');
  const expiresAt = new Date(now + (completed.length ? LENDING_CONTINUATION_REVIEW_TTL_MS : LENDING_REVIEW_TTL_MS)).toISOString(), semanticHash = supplyArtifactHash('semantic-workflow', workflow);
  const artifactSet: ArtifactSet = { schemaVersion:'1.0.0', artifactSetId:'lending-artifacts', semanticWorkflowHash:semanticHash,
    artifacts: workflow.nodes.map(n => ({ artifactId:n.nodeId + '-state', nodeId:n.nodeId,
      artifactHash:supplyHash({ nodeId:n.nodeId, state, rootState, route, calls, completed, projected, gasPrice, l1FeeUpperBound, simulationResponse }) })) };
  const artifactHash = supplyArtifactHash('artifact-set', artifactSet), asset = f.borrowed;
  const simulation: SimulationBundle = { schemaVersion:'1.0.0', simulationId:'lending-simulation', semanticWorkflowRevision:workflow.revision,
    semanticWorkflowHash:semanticHash, artifactSetHash:artifactHash, adapters:[{id:'aave-v3',version:'1.0.0'},{id:'uniswap.v3',version:'1.0.0'}],
    contracts:[p.pool,p.asset,p.aToken,p.variableDebtToken,p.oracle,u.factory,u.router,u.quoter,route.pool,u.weth].map(address => ({chainId:p.chain,address,version:'verified-runtime'})),
    outputs:[{nodeId:'lending-borrow',outputId:'borrowed-amount',expected:{asset,amount:f.borrowAmount},minimum:{asset,amount:f.borrowAmount},adverse:{asset,amount:f.borrowAmount}},
      {nodeId:'lending-swap',outputId:'amount-out',expected:{asset:f.output,amount:route.expectedOut},minimum:{asset:f.output,amount:route.minimumOut},adverse:{asset:f.output,amount:route.minimumOut}}],
    propagatedOutputs:[{fromNodeId:'lending-borrow',outputId:'borrowed-amount',toNodeId:'lending-swap',inputName:'amount-in',quantity:{asset,amount:f.borrowAmount}}],
    failurePaths:[{failedNodeId:'lending-borrow',blockedNodeIds:['lending-swap'],residualAssets:[]},
      {failedNodeId:'lending-swap',blockedNodeIds:[],residualAssets:[{asset,amount:f.borrowAmount}]}],
    uncertainty:[{code:'NON_ATOMIC_LENDING',description:'Debt remains if Swap fails. Checkpoint health factor does not protect against future liquidation.'},
      {code:'MODE_A_APPLICATION_CHECKS',description:'The wallet signs exact calls. HF 2.0, route readiness, expiry and aggregate budgets are application checks.'},
      {code:'VARIABLE_INTEREST_AND_L1_FEES',description:'Future variable interest is not capped. Base L1 fees and wallet envelopes may differ from estimates.'}],
    unsupportedAssumptions:[], freshness:{observedAt:new Date(now).toISOString(),expiresAt,maximumAgeSeconds:120} };
  const simulationHash = supplyArtifactHash('simulation-bundle', simulation), owner = {chainId:p.chain,address:account};
  const spend = (uint(f.supplyAmount)+uint(f.borrowAmount)).toString(), native = {chainId:p.chain,nativeId:'ETH',decimals:18};
  const gasBudgets = [{asset:native,maximumAmount:gasBudget}], feeBudgets = [{asset:native,maximumAmount:maximumL1Fee.toString()}];
  const spendLimits = [{asset,maximumAmount:spend,maximumPerStepAmount:(uint(f.supplyAmount)>uint(f.borrowAmount)?f.supplyAmount:f.borrowAmount),maximumCumulativeAmount:spend}];
  const recovery = {failurePolicy:'ABORT' as const,residualAssetRecipient:owner,maximumAttemptsPerStep:1,requiresHumanReview:true as const};
  const providers = {kind:'AUTHORIZED_SET' as const,providerIds:['aave-v3','uniswap.v3']};
  const checkpoints = [{checkpointId:'lending-before-borrow',beforeNodeId:'lending-borrow',maximumSlippageBps:0,minimumOutputs:[]},
    {checkpointId:'lending-before-swap',beforeNodeId:'lending-swap',maximumSlippageBps:f.slippageBps,minimumOutputs:[{asset:f.output,amount:route.minimumOut}]}];
  const policy: AuthorizationPolicy = {schemaVersion:'1.0.0',policyId:'lending-policy',semanticWorkflowHash:semanticHash,artifactSetHash:artifactHash,simulationHash,
    requiredAuthorizationClass:'MODE_A', allowlists:{owners:[owner],accounts:[owner],recipients:[owner],chains:[p.chain],
      adapters:simulation.adapters,protocols:['aave-v3','uniswap-v3'],contracts:simulation.contracts,
      functions:[{chainId:p.chain,contract:p.pool,functionId:'supply'},{chainId:p.chain,contract:p.pool,functionId:'borrow'},
        {chainId:p.chain,contract:p.asset,functionId:'approve'},{chainId:p.chain,contract:u.router,functionId:'exactInputSingle'}]},
    budgetReservation:{rule:'RESERVE_BEFORE_SUBMISSION',concurrentConsumption:'CUMULATIVE_ACROSS_BRANCHES',implementation:'NOT_IMPLEMENTED'},
    spendLimits,maximumSlippageBps:f.slippageBps,gasBudgets,feeBudgets,oracleRules:[],accountRiskRules:checkpoints.map(c => ({account:owner,
      minimumHealthFactorNumerator:'2',minimumHealthFactorDenominator:'1',maximumLtvBps:Number(state.aave.borrow!.ltvBps),maximumExposure:[],oracleId:'aave-oracle',checkpointId:c.checkpointId})),
    checkpointRules:checkpoints,providers,nonce:state.aave.nonce,deadline:expiresAt,revocationEpoch:workflow.revision,recovery,enforcement:'NOT_ENFORCED'};
  const policyHash = supplyArtifactHash('authorization-policy',policy);
  const manifest: StrategyManifest = {schemaVersion:'1.0.0',manifestId:'lending-manifest',semanticWorkflowRevision:workflow.revision,semanticWorkflowHash:semanticHash,
    artifactSetHash:artifactHash,simulationHash,policyHash,authorizationMode:'MODE_A',owner,executor:null,expiresAt,nonce:state.aave.nonce,revocationEpoch:workflow.revision,
    spendLimits,maximumSlippageBps:f.slippageBps,gasBudgets,feeBudgets,providers,recovery,enforcement:'NOT_ENFORCED'};
  const manifestHash = supplyArtifactHash('strategy-manifest',manifest);
  const plan: ExecutionPlan = {schemaVersion:'1.0.0',executionPlanId:'lending-plan',semanticWorkflowHash:semanticHash,manifestHash,
    segments:[{segmentId:'lending-segment',chainId:p.chain,dependencies:[],steps:calls.map((c,i) => ({stepId:c.id,nodeId:c.nodeId,chainId:p.chain,
      adapter:{id:c.id==='SWAP'||c.id==='ROUTER_APPROVAL'?'uniswap.v3':'aave-v3',version:'1.0.0'},dependencies:i?[calls[i-1]!.id]:[],
      requiredAuthorizationClass:'MODE_A',executionKind:'DIRECT_TRANSACTION',payloadHash:hashSupplyValue(c.tx,'payload')}))}],
    checkpointIds:checkpoints.map(c=>c.checkpointId),enforcement:'NOT_ENFORCED'};
  supplyArtifactHash('execution-plan',plan);
  const content = {format:'gryloo.lending-review.v1' as const,workflow,fields:f,state,rootState,route,completed,calls,projected,simulationResponse,gasPrice,l1FeeUpperBound,gasBudget,expiresAt,artifactSet,simulation,policy,manifest,plan,
    ...(options.rerootOf === undefined ? {} : {rerootOf:options.rerootOf})};
  return {...content,commitment:supplyHash(content)};
}
/**
 * The composed baseline of a run: its first Review, or the latest Review that re-rooted it. A re-root names the
 * previous root's commitment, starts from its own fresh state and has no completed step; every other Review keeps
 * the current root's starting state. Whether a re-root was permitted is validated against the run's attempts.
 */
export function lendingRootChain(reviews: readonly LendingReview[]): { root: LendingReview; index: number } {
  if (!reviews.length || reviews[0]!.rerootOf !== undefined) throw Error('LENDING_ROOT_CHAIN_INVALID');
  let index = 0;
  reviews.forEach((r, i) => {
    if (!i) return;
    const root = reviews[index]!;
    if (r.rerootOf === undefined) { if (supplyHash(r.rootState) !== supplyHash(root.rootState)) throw Error('LENDING_ROOT_CHAIN_INVALID'); return; }
    if (r.rerootOf !== root.commitment || r.completed.length || supplyHash(r.rootState) !== supplyHash(r.state)) throw Error('LENDING_ROOT_CHAIN_INVALID');
    index = i;
  });
  return { root: reviews[index]!, index };
}
/** Whole commitment and economic predicates, including unchanged approved calldata/minimum. */
export function assertLendingReview(review: LendingReview, workflow: SemanticWorkflow, account: string, now = Date.now()): void {
  const {commitment,...content} = review;
  assertLendingFields(workflow, account);
  if (commitment !== supplyHash(content) || supplyArtifactHash('semantic-workflow',workflow) !== review.manifest.semanticWorkflowHash ||
      now >= Date.parse(review.expiresAt) || now < Date.parse(review.simulation.freshness.observedAt)) throw Error('LENDING_REVIEW_STALE');
  if (review.manifest.policyHash !== supplyArtifactHash('authorization-policy',review.policy) || review.manifest.simulationHash !== supplyArtifactHash('simulation-bundle',review.simulation) ||
      review.manifest.artifactSetHash !== supplyArtifactHash('artifact-set',review.artifactSet) || review.plan.manifestHash !== supplyArtifactHash('strategy-manifest',review.manifest)) throw Error('LENDING_COMMITMENT_INVALID');
  lendingFeeCeilings(review);
}
export function assertLendingPrincipalContinuity(before: LendingSnapshot, after: LendingSnapshot): void {
  if(after.aave.block<before.aave.block||after.aave.block===before.aave.block&&after.aave.blockHash!==before.aave.blockHash)throw Error('LENDING_RPC_INCONSISTENT');
  const a = before.aave.borrow!, b = after.aave.borrow!;
  for (const key of ['reserveConfiguration','userConfiguration','eMode','variableDebtToken','codeHash','baseCurrencyUnit'] as const)
    if (a[key] !== b[key]) throw Error('LENDING_REVIEW_STALE');
  if (before.aave.deploymentHash !== after.aave.deploymentHash || before.aave.scaledPosition !== after.aave.scaledPosition ||
      a.scaledDebt !== b.scaledDebt || before.aave.balance !== after.aave.balance || before.wethBalance !== after.wethBalance ||
      before.aave.allowance !== after.aave.allowance || before.routerAllowance !== after.routerAllowance) throw Error('LENDING_PRINCIPAL_CHANGED');
}
export function assertLendingFresh(before: LendingSnapshot, after: LendingSnapshot): void {
  assertLendingPrincipalContinuity(before,after);
  const a=before.aave.borrow!,b=after.aave.borrow!;
  for (const key of ['price','collateralBase','debtBase','debt','healthFactor'] as const) {
    const x = uint(a[key]), y = uint(b[key]), difference = x>y?x-y:y-x;
    if (difference > x/1000n+2n) throw Error('LENDING_REVIEW_STALE');
  }
}
