// SPDX-License-Identifier: AGPL-3.0-only
import { compileWithdrawCalls,estimateWithdraw,assertWithdrawFresh,readWithdrawState } from './withdraw.js';
import { compileRepayCalls, estimateRepay, assertRepayFresh } from './repay.js';
import { compileBorrowCalls, readBorrowState, estimateBorrow, assertBorrowFresh, type BorrowState } from './borrow.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { aaveLendingProfile, assertAaveLendingProfile, type AaveLendingProfile } from '@defi-workflow-engine/action-registry';
import { readSupplyNode, readBorrowNode, readRepayNode, readWithdrawNode, supplyAddress, hashArtifactBytes, type SemanticWorkflow,
  hashSupplyValue, type ArtifactSet, type SimulationBundle, type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
export { AAVE_V3_BASE_SEPOLIA, AAVE_V3_ETHEREUM_SEPOLIA, aaveLendingProfile, type AaveLendingProfile } from '@defi-workflow-engine/action-registry';
export type SupplyRpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
export type SupplyTransaction = { from: string; to: string; data: string; value: '0x0'; chainId: AaveLendingProfile['chainHex'] };
/** The registered Aave profile for an authored chain; any other chain fails with the caller's code. */
export function lendingProfile(chain: string, code: string): AaveLendingProfile {
  try { return aaveLendingProfile(chain); } catch { throw new Error(code); }
}
/** User-configuration bits of the profile's reserve (2·id borrowing, 2·id+1 collateral) and its token unit. */
export function reserveBits(profileInput: AaveLendingProfile): { mask: bigint; borrowing: bigint; collateral: bigint; scale: bigint } {
  const profile = assertAaveLendingProfile(profileInput), shift = 2n * BigInt(profile.reserveId);
  return { mask: 3n << shift, borrowing: 1n << shift, collateral: 2n << shift, scale: 10n ** BigInt(profile.decimals) };
}
export const supplyHash = (value: unknown): string => hashSupplyValue(value);
export const supplyArtifactHash = (kind: Parameters<typeof hashArtifactBytes>[0], value: unknown): string => hashArtifactBytes(kind, new TextEncoder().encode(JSON.stringify(value)));
export function supplySelector(signature: string): string { return '0x' + Array.from(keccak_256(new TextEncoder().encode(signature)).slice(0,4), b => b.toString(16).padStart(2,'0')).join(''); }
export function supplyTopic(signature: string): string { return '0x' + Array.from(keccak_256(new TextEncoder().encode(signature)), b => b.toString(16).padStart(2,'0')).join(''); }
export function supplyWord(value: string | bigint): string {
  const n = typeof value === 'string' ? BigInt(supplyAddress(value)) : value;
  if (n < 0n || n >= 1n << 256n) throw new Error('SUPPLY_UINT_INVALID');
  return n.toString(16).padStart(64,'0');
}
export function supplyCall(signature: string, ...args: (string | bigint)[]): string { return supplySelector(signature) + args.map(supplyWord).join(''); }
export function rpcRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SUPPLY_RPC_INVALID');
  return value as Record<string, unknown>;
}
export function rpcHex(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value) || value.length > 1_048_576) throw new Error('SUPPLY_RPC_INVALID');
  return value.toLowerCase();
}
export function rpcUint(value: unknown): bigint { return BigInt(rpcHex(value)); }
export function rpcHash(value: unknown): string { const v = rpcHex(value); if (v.length !== 66) throw new Error('SUPPLY_HASH_INVALID'); return v; }
export function supplyHex(value: string | number | bigint): string { return '0x' + BigInt(value).toString(16); }
export async function readSupplyLatestNonce(rpc:SupplyRpc,profileInput:AaveLendingProfile,account:string):Promise<string> {
  const profile=assertAaveLendingProfile(profileInput),normalized=supplyAddress(account);
  if(rpcUint(await rpc('eth_chainId',[]))!==BigInt(profile.chainId))throw new Error('SUPPLY_WRONG_CHAIN');
  return rpcUint(await rpc('eth_getTransactionCount',[normalized,'latest'])).toString();
}
export type SupplyState = { withdrawState?: {previousIndex:string}; borrow?: BorrowState; block: number; blockHash: string; account: string; allowance: string; balance: string; nativeBalance: string;
  nonce: string; gasPrice: string; scaledPosition: string; position: string; index: string; deploymentHash: string; observedAt: string };
export async function readSupplyState(rpc: SupplyRpc, profileInput: AaveLendingProfile, accountInput: string, beneficiaryInput: string, blockTag = 'latest'): Promise<SupplyState> {
  const profile = assertAaveLendingProfile(profileInput), account = supplyAddress(accountInput), beneficiary = supplyAddress(beneficiaryInput);
  if (rpcUint(await rpc('eth_chainId', [])) !== BigInt(profile.chainId)) throw new Error('SUPPLY_WRONG_CHAIN');
  const block = rpcRecord(await rpc('eth_getBlockByNumber', [blockTag, false]));
  const tag = rpcHex(block.number), blockHash = rpcHash(block.hash);
  const call = (to: string, data: string) => rpc('eth_call', [{ to, data }, tag]);
  const [pool, reserve, decimals, underlying, allowance, balance, nativeBalance, nonce, gasPrice, scaled, position, index, tokenPool, ...codes] = await Promise.all([
    call(profile.provider, supplyCall('getPool()')), call(profile.pool, supplyCall('getReserveData(address)', profile.asset)),
    call(profile.asset, supplyCall('decimals()')), call(profile.aToken, supplyCall('UNDERLYING_ASSET_ADDRESS()')),
    call(profile.asset, supplyCall('allowance(address,address)', account, profile.pool)), call(profile.asset, supplyCall('balanceOf(address)', account)),
    rpc('eth_getBalance',[account,tag]), rpc('eth_getTransactionCount',[account,'pending']), rpc('eth_gasPrice',[]),
    call(profile.aToken,supplyCall('scaledBalanceOf(address)',beneficiary)), call(profile.aToken,supplyCall('balanceOf(address)',beneficiary)),
    call(profile.pool,supplyCall('getReserveNormalizedIncome(address)',profile.asset)), call(profile.aToken,supplyCall('POOL()')),
    ...[profile.pool,profile.provider,profile.asset,profile.aToken].map(to => rpc('eth_getCode',[to,tag])),
  ]);
  const reserveHex = rpcHex(reserve).slice(2);
  if (reserveHex.length !== 15 * 64 || rpcUint(pool) !== BigInt(profile.pool) || rpcUint(decimals) !== BigInt(profile.decimals) || rpcUint(underlying) !== BigInt(profile.asset) || rpcUint(tokenPool) !== BigInt(profile.pool) ||
      BigInt('0x'+reserveHex.slice(8*64,9*64)) !== BigInt(profile.aToken)) throw new Error('SUPPLY_DEPLOYMENT_MISMATCH');
  const config = BigInt('0x'+reserveHex.slice(0,64));
  if (((config >> 56n) & 1n) !== 1n || ((config >> 57n) & 1n) || ((config >> 60n) & 1n)) throw new Error('SUPPLY_RESERVE_UNAVAILABLE');
  if (codes.some(code => rpcHex(code).length < 4) || rpcUint(index) < 10n ** 27n) throw new Error('SUPPLY_DEPLOYMENT_MISMATCH');
  const verifiedBlock = rpcRecord(await rpc('eth_getBlockByNumber',[tag,false]));
  if (rpcHash(verifiedBlock.hash) !== blockHash) throw new Error('SUPPLY_REORG');
  const blockNumber = Number(rpcUint(tag));
  if (!Number.isSafeInteger(blockNumber)) throw new Error('SUPPLY_BLOCK_INVALID');
  return { block: blockNumber, blockHash, account, allowance: rpcUint(allowance).toString(), balance: rpcUint(balance).toString(),
    nativeBalance: rpcUint(nativeBalance).toString(), nonce: rpcUint(nonce).toString(), gasPrice: rpcUint(gasPrice).toString(),
    scaledPosition: rpcUint(scaled).toString(), position: rpcUint(position).toString(), index: rpcUint(index).toString(),
    deploymentHash: supplyHash(codes), observedAt: new Date().toISOString() };
}
/** OpenZeppelin-style nested allowance mapping. A candidate is used only after on-chain read-only proof. */
function allowanceSlot(profile: AaveLendingProfile, account: string, slot: bigint): string {
  const hashWords = (value: string) => '0x' + Array.from(keccak_256(Uint8Array.from(value.match(/../g)!.map(b => Number.parseInt(b,16)))), b => b.toString(16).padStart(2,'0')).join('');
  const first = hashWords(supplyWord(account)+supplyWord(slot));
  return hashWords(supplyWord(profile.pool)+first.slice(2));
}
async function simulateSupplyWithAllowanceOverride(rpc: SupplyRpc, profile: AaveLendingProfile, transactions: SupplyTransaction[], state: SupplyState, amount: string): Promise<{gasLimits:string[];observation:unknown}> {
  const tag=supplyHex(state.block), approval=transactions.length===2?transactions[0]:null, supply=transactions.at(-1)!;
  let override:Record<string,unknown>|null=null;
  if(approval){
    // First simulate the exact approval against real token code. The ERC-20 must return true.
    if(rpcUint(await rpc('eth_call',[{from:approval.from,to:approval.to,data:approval.data,value:approval.value},tag]))!==1n)throw new Error('SUPPLY_APPROVAL_SIMULATION_FAILED');
    // Bounded mapping discovery, with unique markers, followed by proof of ONE exact storage key.
    const candidates=Array.from({length:16},(_,i)=>allowanceSlot(profile,state.account,BigInt(i)));
    const stateDiff=Object.fromEntries(candidates.map((slot,i)=>[slot,'0x'+supplyWord(BigInt(i+1))]));
    const data=supplyCall('allowance(address,address)',state.account,profile.pool);
    const marker=rpcUint(await rpc('eth_call',[{to:profile.asset,data},tag,{[profile.asset]:{stateDiff}}]));
    if(marker<1n||marker>16n)throw new Error('SUPPLY_ALLOWANCE_OVERRIDE_UNVERIFIED');
    const slot=candidates[Number(marker)-1]!;
    override={[profile.asset]:{stateDiff:{[slot]:'0x'+supplyWord(BigInt(amount))}}};
    const control='0x1111111111111111111111111111111111111111';
    const controlData=supplyCall('allowance(address,address)',state.account,control);
    const [exact,balance,controlBefore,controlAfter]=await Promise.all([
      rpc('eth_call',[{to:profile.asset,data},tag,override]),
      rpc('eth_call',[{to:profile.asset,data:supplyCall('balanceOf(address)',state.account)},tag,override]),
      rpc('eth_call',[{to:profile.asset,data:controlData},tag]),rpc('eth_call',[{to:profile.asset,data:controlData},tag,override]),
    ]);
    if(rpcUint(exact)!==BigInt(amount)||rpcUint(balance)!==BigInt(state.balance)||rpcUint(controlBefore)!==rpcUint(controlAfter))throw new Error('SUPPLY_ALLOWANCE_OVERRIDE_UNVERIFIED');
  }
  const calls=transactions.map(tx=>({from:tx.from,to:tx.to,data:tx.data,value:tx.value}));
  const result=await rpc('eth_call',[calls.at(-1),tag,...override?[override]:[]]);
  if(supply.data.startsWith(supplySelector('repay(address,uint256,uint256,address)')) ? rpcUint(result)!==BigInt(amount) : result!=='0x')throw new Error('SUPPLY_SIMULATION_UNEXPECTED_RETURN');
  const gasLimits:string[]=[];
  if(approval){const gas=rpcUint(await rpc('eth_estimateGas',[calls[0],tag]));gasLimits.push(((gas*150n+99n)/100n).toString());}
  const gas=rpcUint(await rpc('eth_estimateGas',[{from:supply.from,to:supply.to,data:supply.data,value:supply.value},tag,...override?[override]:[]]));
  if(gas<=0n||gas>1_000_000n)throw new Error('SUPPLY_GAS_INVALID');gasLimits.push(((gas*150n+99n)/100n).toString());
  return {gasLimits,observation:{method:'eth_call',approvalResult:approval?'true':null,allowanceOverride:override,supplyResult:result}};
}
export type SupplyReview = { withdraw?: { expectedPostHealthFactor:string; collateralAfter:string; collateralAfterBase:string; walletAfter:string }; repay?: { interestRateMode:2; expectedPostHealthFactor:string; debtAfterBase:string; debtAfter:string }; borrow?: { interestRateMode:2; expectedPostHealthFactor:string; debtAfterBase:string }; format: 'gryloo.supply-review.v1'; workflow: SemanticWorkflow; account: string; beneficiary: string; amount: string;
  pool: string; asset: string; aToken: string; chain: string; approvalRequired: boolean; allowance: string; state: SupplyState;
  transactions: SupplyTransaction[]; gasLimits: string[]; gasPrice: string; expiresAt: string; commitment: string;
  artifactSet: ArtifactSet; simulation: SimulationBundle; policy: AuthorizationPolicy; manifest: StrategyManifest; plan: ExecutionPlan };
export function compileSupplyCalls(workflow: SemanticWorkflow, accountInput: string, allowance: string): SupplyTransaction[] {
  if(workflow.nodes.some(n=>n.actionType==='withdraw')) return compileWithdrawCalls(workflow,accountInput);
  if(workflow.nodes.some(n=>n.actionType==='repay')) return compileRepayCalls(workflow,accountInput,allowance);
  if(workflow.nodes.some(n=>n.actionType==='borrow')) return compileBorrowCalls(workflow,accountInput);
  const nodes = workflow.nodes.filter(n => n.actionType === 'supply');
  if (nodes.length !== 1 || workflow.nodes.some(n => n.actionType !== 'supply' && !n.actionType.startsWith('mock-')) ||
      workflow.resourceEdges.some(e => e.fromNodeId === nodes[0]?.nodeId || e.toNodeId === nodes[0]?.nodeId) ||
      workflow.nodes.some(n => n.dependencies.includes(nodes[0]?.nodeId ?? ''))) throw new Error('SUPPLY_ISOLATED_ONLY');
  const fields = readSupplyNode(nodes[0]!), profile = lendingProfile(fields.chain, 'SUPPLY_DEPLOYMENT_UNSUPPORTED');
  if (fields.asset.address !== profile.asset || fields.asset.decimals !== profile.decimals || !/^(0|[1-9][0-9]*)$/.test(allowance)) throw new Error('SUPPLY_DEPLOYMENT_UNSUPPORTED');
  const base = { from: supplyAddress(accountInput), value: '0x0' as const, chainId: profile.chainHex };
  const calls: SupplyTransaction[] = [];
  if (BigInt(allowance) < BigInt(fields.amount)) calls.push({ ...base, to: profile.asset, data: supplyCall('approve(address,uint256)',profile.pool,BigInt(fields.amount)) });
  calls.push({ ...base, to: profile.pool, data: supplyCall('supply(address,uint256,address,uint16)',profile.asset,BigInt(fields.amount),fields.beneficiary,0n) });
  return calls;
}
/** Only reads. Exact sequential call simulation uses ephemeral RPC state, never sends. */
export async function simulateSupply(workflow: SemanticWorkflow, accountInput: string, rpc: SupplyRpc, now = Date.now()): Promise<SupplyReview> {
  // Canonical hashing validates the frozen shared IR before protocol interpretation.
  const semanticHash = supplyArtifactHash('semantic-workflow',workflow);
  const node = workflow.nodes.find(n => ['supply','borrow','repay','withdraw'].includes(n.actionType));
  const borrowing = node?.actionType === 'borrow', repaying = node?.actionType === 'repay', withdrawing = node?.actionType === 'withdraw';
  if (!node) throw new Error('SUPPLY_REQUIRED');
  const authored = withdrawing ? readWithdrawNode(node) : null;
  const fields = authored ? {...authored,beneficiary:supplyAddress(accountInput)} : repaying ? readRepayNode(node) : borrowing ? readBorrowNode(node) : readSupplyNode(node), account = supplyAddress(accountInput);
  // The authored chain selects the deployment; the RPC must then report that chain before any state is read.
  const profile = lendingProfile(fields.chain, 'SUPPLY_DEPLOYMENT_UNSUPPORTED');
  const state = await (withdrawing ? readWithdrawState : borrowing || repaying ? readBorrowState : readSupplyState)(rpc,profile,account,fields.beneficiary);
  const estimate = borrowing ? estimateBorrow(fields.amount,state.borrow!,profile) : null;
  const repayment = repaying ? estimateRepay(fields.amount,state.borrow!,profile) : null;
  const withdrawal = withdrawing ? estimateWithdraw(fields.amount,state,profile) : null;
  const transactions = compileSupplyCalls(workflow,account,state.allowance);
  if (!borrowing && !withdrawing && BigInt(state.balance) < BigInt(fields.amount)) throw new Error(profile.symbol === 'USDC' ? 'SUPPLY_INSUFFICIENT_USDC' : 'SUPPLY_INSUFFICIENT_ASSET');
  // The public gateway rejects eth_simulateV1; the approved fallback proves a bounded
  // allowance mapping override, then eth_call/estimateGas execute exact Supply read-only.
  const {gasLimits,observation:response}=withdrawing ? await simulateWithdrawCall(rpc,transactions[0]!,state,fields.amount) : borrowing ? await simulateBorrowCall(rpc,transactions[0]!,state) : await simulateSupplyWithAllowanceOverride(rpc,profile,transactions,state,fields.amount);
  const gasPrice = (BigInt(state.gasPrice)*2n).toString();
  const gasBudget = gasLimits.reduce((a,g) => a+BigInt(g)*BigInt(gasPrice),0n) + 10_000_000_000_000n;
  if (BigInt(state.nativeBalance) < gasBudget || BigInt(gasPrice) <= 0n) throw new Error('SUPPLY_INSUFFICIENT_ETH');
  const expiresAt = new Date(now+120_000).toISOString();
  const artifactSet: ArtifactSet = { schemaVersion:'1.0.0',artifactSetId:'supply-artifacts',semanticWorkflowHash:semanticHash,
    artifacts:[{artifactId:'supply-state',nodeId:node.nodeId,artifactHash:supplyHash({state,transactions,gasLimits,gasPrice,response})}] };
  const artifactHash = supplyArtifactHash('artifact-set',artifactSet);
  const asset = fields.asset, quantity = { asset, amount: fields.amount };
  const simulation: SimulationBundle = { schemaVersion:'1.0.0',simulationId:'supply-simulation',semanticWorkflowRevision:workflow.revision,
    semanticWorkflowHash:semanticHash,artifactSetHash:artifactHash,adapters:[{id:'aave-v3',version:'1.0.0'}],
    contracts:[{chainId:profile.chain,address:profile.pool,version:'aave-v3'},{chainId:profile.chain,address:profile.asset,version:'erc20'}],
    outputs:[],propagatedOutputs:[],failurePaths:[],uncertainty:[],unsupportedAssumptions:[],
    freshness:{ observedAt:new Date(now).toISOString(), expiresAt, maximumAgeSeconds:120 } };
  const simulationHash = supplyArtifactHash('simulation-bundle',simulation), owner = { chainId:profile.chain,address:account };
  const spendLimits = [{asset,maximumAmount:fields.amount,maximumPerStepAmount:fields.amount,maximumCumulativeAmount:fields.amount}];
  const gasBudgets = [{asset:{chainId:profile.chain,nativeId:'ETH',decimals:18},maximumAmount:gasBudget.toString()}];
  const recovery = { failurePolicy:'ABORT' as const,residualAssetRecipient:owner,maximumAttemptsPerStep:1,requiresHumanReview:true as const };
  const providers = {kind:'FIXED' as const,providerId:'aave-v3'};
  const policy: AuthorizationPolicy = { schemaVersion:'1.0.0',policyId:'supply-policy',semanticWorkflowHash:semanticHash,artifactSetHash:artifactHash,simulationHash,
    requiredAuthorizationClass:'MODE_A',allowlists:{owners:[owner],accounts:[owner],recipients:[{chainId:profile.chain,address:fields.beneficiary}],
      chains:[profile.chain],adapters:[{id:'aave-v3',version:'1.0.0'}],protocols:['aave-v3'],
      contracts:[{chainId:profile.chain,address:profile.pool,version:'aave-v3'},{chainId:profile.chain,address:profile.asset,version:'erc20'}],
      functions:withdrawing?[{chainId:profile.chain,contract:profile.pool,functionId:'withdraw'}]:borrowing?[{chainId:profile.chain,contract:profile.pool,functionId:'borrow'}]:repaying?[{chainId:profile.chain,contract:profile.pool,functionId:'repay'},...transactions.length===2?[{chainId:profile.chain,contract:profile.asset,functionId:'approve'}]:[]]:[{chainId:profile.chain,contract:profile.pool,functionId:'supply'},{chainId:profile.chain,contract:profile.asset,functionId:'approve'}]},
    budgetReservation:{rule:'RESERVE_BEFORE_SUBMISSION',concurrentConsumption:'CUMULATIVE_ACROSS_BRANCHES',implementation:'NOT_IMPLEMENTED'},
    spendLimits,maximumSlippageBps:0,gasBudgets,feeBudgets:[],oracleRules:[],accountRiskRules:borrowing||withdrawing?[{account:owner,minimumHealthFactorNumerator:'2',minimumHealthFactorDenominator:'1',maximumLtvBps:Number(state.borrow!.ltvBps),maximumExposure:[],oracleId:'aave-oracle',checkpointId:'borrow-risk'}]:[],checkpointRules:[],providers,
    nonce:state.nonce,deadline:expiresAt,revocationEpoch:workflow.revision,recovery,enforcement:'NOT_ENFORCED'};
  const policyHash = supplyArtifactHash('authorization-policy',policy);
  const manifest: StrategyManifest = {schemaVersion:'1.0.0',manifestId:'supply-manifest',semanticWorkflowRevision:workflow.revision,semanticWorkflowHash:semanticHash,
    artifactSetHash:artifactHash,simulationHash,policyHash,authorizationMode:'MODE_A',owner,executor:null,expiresAt,nonce:state.nonce,revocationEpoch:workflow.revision,
    spendLimits,maximumSlippageBps:0,gasBudgets,feeBudgets:[],providers,recovery,enforcement:'NOT_ENFORCED'};
  const manifestHash = supplyArtifactHash('strategy-manifest',manifest);
  const plan: ExecutionPlan = {schemaVersion:'1.0.0',executionPlanId:'supply-plan',semanticWorkflowHash:semanticHash,manifestHash,
    segments:[{segmentId:'supply-segment',chainId:profile.chain,dependencies:[],steps:transactions.map((tx,i) => ({stepId:i===0&&transactions.length===2?'supply-approval':withdrawing?'aave-withdraw':repaying?'aave-repay':borrowing?'aave-borrow':'supply-deposit',
      nodeId:node.nodeId,chainId:profile.chain,adapter:{id:'aave-v3',version:'1.0.0'},dependencies:i===1?['supply-approval']:[],requiredAuthorizationClass:'MODE_A',
      executionKind:'DIRECT_TRANSACTION',payloadHash:hashSupplyValue(tx,'payload')}))}],checkpointIds:[],enforcement:'NOT_ENFORCED'};
  supplyArtifactHash('execution-plan',plan);
  const review = {...withdrawal?{withdraw:{expectedPostHealthFactor:withdrawal.healthFactorAfter,collateralAfter:withdrawal.collateralAfter,collateralAfterBase:withdrawal.collateralAfterBase,walletAfter:withdrawal.walletAfter}}:{},...repayment?{repay:{interestRateMode:2 as const,expectedPostHealthFactor:repayment.healthFactorAfter,debtAfterBase:repayment.debtAfterBase,debtAfter:repayment.debtAfter}}:{},...estimate?{borrow:{interestRateMode:2 as const,expectedPostHealthFactor:estimate.healthFactorAfter,debtAfterBase:estimate.debtAfterBase}}:{},format:'gryloo.supply-review.v1' as const,workflow,account,beneficiary:fields.beneficiary,amount:quantity.amount,pool:profile.pool,asset:profile.asset,
    aToken:profile.aToken,chain:profile.chain,approvalRequired:transactions.length===2,allowance:state.allowance,state,transactions,gasLimits,gasPrice,expiresAt,
    artifactSet,simulation,policy,manifest,plan};
  return {...review,commitment:supplyHash(review)};
}
export function assertSupplyReview(review: SupplyReview, workflow: SemanticWorkflow, account: string, state: SupplyState, now = Date.now(), approvalConfirmed = false): void {
  const {commitment,...content} = review;
  // The reviewed chain selects the deployment and must be the chain the workflow authored.
  const profile = lendingProfile(review.chain, 'SUPPLY_AUTHORIZATION_INVALID');
  if (!workflow.nodes.some(n=>['supply','borrow','repay','withdraw'].includes(n.actionType)&&n.chainId===profile.chain)) throw new Error('SUPPLY_AUTHORIZATION_INVALID');
  const borrowing=workflow.nodes.some(n=>n.actionType==='borrow'),repaying=workflow.nodes.some(n=>n.actionType==='repay'),withdrawing=workflow.nodes.some(n=>n.actionType==='withdraw');
  if(withdrawing!==Boolean(review.withdraw)||review.withdraw&&(review.borrow||review.repay||review.approvalRequired||review.beneficiary!==review.account))throw new Error('WITHDRAW_AUTHORIZATION_INVALID');
  if(repaying!==Boolean(review.repay)||review.repay&&review.borrow)throw new Error('REPAY_AUTHORIZATION_INVALID');
  if(borrowing!==Boolean(review.borrow))throw new Error('BORROW_AUTHORIZATION_INVALID');
  if(borrowing){const fields=readBorrowNode(workflow.nodes.find(n=>n.actionType==='borrow')!);
    if(fields.amount!==review.amount||fields.beneficiary!==review.beneficiary||review.pool!==profile.pool||review.asset!==profile.asset||review.chain!==profile.chain||review.aToken!==profile.aToken)throw new Error('BORROW_AUTHORIZATION_INVALID');}

  if (supplyHash(content) !== commitment || supplyArtifactHash('semantic-workflow',workflow) !== review.manifest.semanticWorkflowHash ||
      supplyAddress(account) !== review.account || state.account !== review.account || state.deploymentHash !== review.state.deploymentHash ||
      now >= Date.parse(review.expiresAt) || now < Date.parse(review.simulation.freshness.observedAt) ||
      (!approvalConfirmed && ((!review.borrow && state.allowance !== review.allowance) || state.nonce !== review.state.nonce)) ||
      (approvalConfirmed && BigInt(state.allowance) < BigInt(review.amount)) || !review.borrow && !review.withdraw && BigInt(state.balance) < BigInt(review.amount)) throw new Error('SUPPLY_AUTHORIZATION_STALE');
  if(review.borrow){
    if(!state.borrow||!review.state.borrow||review.approvalRequired||review.borrow.interestRateMode!==2)throw new Error('BORROW_AUTHORIZATION_INVALID');
    assertBorrowFresh(review.amount,review.state.borrow,state.borrow,profile);
    const estimated=estimateBorrow(review.amount,review.state.borrow,profile);
    if(estimated.healthFactorAfter!==review.borrow.expectedPostHealthFactor||estimated.debtAfterBase!==review.borrow.debtAfterBase)throw new Error('BORROW_AUTHORIZATION_INVALID');
  }
  if(review.repay){
    const fields=readRepayNode(workflow.nodes.find(n=>n.actionType==='repay')!);
    if(!state.borrow||!review.state.borrow||review.repay.interestRateMode!==2||review.beneficiary!==review.account||fields.amount!==review.amount||fields.beneficiary!==review.account||review.pool!==profile.pool||review.asset!==profile.asset||review.chain!==profile.chain||review.aToken!==profile.aToken)throw new Error('REPAY_AUTHORIZATION_INVALID');
    assertRepayFresh(review.amount,review.state.borrow,state.borrow,profile);
    const estimate=estimateRepay(review.amount,review.state.borrow,profile);
    if(estimate.debtAfter!==review.repay.debtAfter||estimate.debtAfterBase!==review.repay.debtAfterBase||estimate.healthFactorAfter!==review.repay.expectedPostHealthFactor)throw new Error('REPAY_AUTHORIZATION_INVALID');
  }
  if(review.withdraw){
    const fields=readWithdrawNode(workflow.nodes.find(n=>n.actionType==='withdraw')!);
    if(fields.amount!==review.amount||review.pool!==profile.pool||review.asset!==profile.asset||review.chain!==profile.chain||review.aToken!==profile.aToken)throw new Error('WITHDRAW_AUTHORIZATION_INVALID');
    assertWithdrawFresh(review.amount,review.state,state,profile);
    const e=estimateWithdraw(review.amount,review.state,profile);
    if(e.healthFactorAfter!==review.withdraw.expectedPostHealthFactor||e.collateralAfter!==review.withdraw.collateralAfter||e.collateralAfterBase!==review.withdraw.collateralAfterBase||e.walletAfter!==review.withdraw.walletAfter)throw new Error('WITHDRAW_AUTHORIZATION_INVALID');
  }
  if (JSON.stringify(compileSupplyCalls(workflow,account,review.allowance)) !== JSON.stringify(review.transactions)) throw new Error('SUPPLY_AUTHORIZATION_INVALID');
}

/** Narrow compatibility with the observed MetaMask DelegationManager 1.3.0 envelope.
 * Exactly one root delegation, one default single call, and two known caveats.
 * This decoder establishes candidate semantics only; the reconciler verifies signatures/code/state.
 */
export const SUPPLY_METAMASK = Object.freeze({
  manager:'0xdb9b1e94b5b69df7e401ddbede43491141047db3',implementation:'0x63c0c19a282a1b52b07dd5a65b58948a07dae32b',
  limited:'0x04658b29f6b82ed55274221a06fc97d318e25416',exact:'0x146713078d39ecc1f5338309c28405ccf85abfbb',
  codeHashes:Object.freeze(['0xa6f025f7bb23ddc0e2546eec56400672c3dfac88c12963bfeb2b5e1121aeee4a','0x83805f9ac7395294043b10c3b7c1839b7e4582a3e693028c36df84978b09d4e2','0x3a07a1b31d8f8f29cde4260f88fc5011e003e4bdbd519c8274fc7092d2356468','0xd695eefffb5a4da6d7db7dbae12d3a85dff43d9b274b1217ad1498d73539dc5e'])
});
export type SupplyWalletEnvelope={owner:string;delegate:string;salt:string;signature:string;call:{to:string;value:string;data:string};
  caveats:{enforcer:string;terms:string;args:string}[];delegationTuple:string};
const abiBytes=(hex:string)=>supplyWord(BigInt((hex.length-2)/2))+hex.slice(2).padEnd(Math.ceil((hex.length-2)/64)*64,'0');
const bytesArray=(hex:string)=>supplyWord(1n)+supplyWord(32n)+abiBytes(hex);
export function encodeSupplyWalletEnvelope(input:Omit<SupplyWalletEnvelope,'delegationTuple'>):string {
  const caveats=input.caveats.map(c=>{const terms=abiBytes(c.terms);return supplyWord(c.enforcer)+supplyWord(96n)+supplyWord(BigInt(96+terms.length/2))+terms+abiBytes(c.args);});
  const caveatArray=supplyWord(2n)+supplyWord(64n)+supplyWord(BigInt(64+caveats[0]!.length/2))+caveats.join('');
  const tuple=supplyWord(input.delegate)+supplyWord(input.owner)+'f'.repeat(64)+supplyWord(192n)+supplyWord(BigInt(input.salt))+supplyWord(BigInt(192+caveatArray.length/2))+caveatArray+abiBytes(input.signature);
  const permissions=bytesArray('0x'+supplyWord(32n)+supplyWord(1n)+supplyWord(32n)+tuple),modes=supplyWord(1n)+supplyWord(0n);
  const execution='0x'+input.call.to.slice(2)+supplyWord(BigInt(input.call.value))+input.call.data.slice(2);
  return supplySelector('redeemDelegations(bytes[],bytes32[],bytes[])')+supplyWord(96n)+supplyWord(BigInt(96+permissions.length/2))+supplyWord(BigInt(96+permissions.length/2+modes.length/2))+permissions+modes+bytesArray(execution);
}
export function decodeSupplyWalletEnvelope(input:unknown):SupplyWalletEnvelope {
  const fail=():never=>{throw new Error('SUPPLY_ENVELOPE_MISMATCH');};
  if(typeof input!=='string'||!/^0x[0-9a-f]+$/i.test(input)||input.length>16386||input.length%2||input.slice(0,10).toLowerCase()!==supplySelector('redeemDelegations(bytes[],bytes32[],bytes[])'))fail();
  const hex=(input as string).slice(10).toLowerCase();
  const word=(body:string,at:number)=>{if(!Number.isSafeInteger(at)||at<0||at*2+64>body.length)fail();return body.slice(at*2,at*2+64);};
  const offset=(body:string,at:number)=>{const n=BigInt('0x'+word(body,at));if(n>8192n||n%32n)fail();return Number(n);};
  const address=(body:string,at:number)=>{const w=word(body,at);if(!/^0{24}[0-9a-f]{40}$/.test(w))fail();return '0x'+w.slice(24);};
  const bytes=(body:string,at:number)=>{const n=Number(BigInt('0x'+word(body,at)));if(!Number.isSafeInteger(n)||n<0||n>8192||(at+32+n)*2>body.length)fail();return '0x'+body.slice((at+32)*2,(at+32+n)*2);};
  const oneArray=(at:number)=>{if(BigInt('0x'+word(hex,at))!==1n)fail();return bytes(hex,at+32+offset(hex,at+32));};
  const permissions=oneArray(offset(hex,0)).slice(2),array=offset(permissions,0);
  if(BigInt('0x'+word(permissions,array))!==1n)fail();
  const tuple=permissions.slice((array+32+offset(permissions,array+32))*2);
  if(word(tuple,64)!=='f'.repeat(64))fail();
  const caveatAt=offset(tuple,96);if(BigInt('0x'+word(tuple,caveatAt))!==2n)fail();
  const caveats=[0,1].map(i=>{const c=tuple.slice((caveatAt+32+offset(tuple,caveatAt+32+i*32))*2);return{enforcer:address(c,0),terms:bytes(c,offset(c,32)),args:bytes(c,offset(c,64))};});
  const mode=offset(hex,32);if(BigInt('0x'+word(hex,mode))!==1n||BigInt('0x'+word(hex,mode+32))!==0n)fail();
  const execution=oneArray(offset(hex,64));if(execution.length<106)fail();
  const result:SupplyWalletEnvelope={owner:address(tuple,32),delegate:address(tuple,0),salt:BigInt('0x'+word(tuple,128)).toString(),signature:bytes(tuple,offset(tuple,160)),caveats,
    call:{to:'0x'+execution.slice(2,42),value:BigInt('0x'+execution.slice(42,106)).toString(),data:'0x'+execution.slice(106)},delegationTuple:'0x'+tuple};
  if(result.delegate!=='0x0000000000000000000000000000000000000a11'||result.signature.length!==132||caveats[0]!.enforcer!==SUPPLY_METAMASK.limited||caveats[0]!.terms!=='0x'+supplyWord(1n)||caveats[1]!.enforcer!==SUPPLY_METAMASK.exact||caveats.some(c=>c.args!=='0x')||caveats[1]!.terms!==execution||encodeSupplyWalletEnvelope(result)!==(input as string).toLowerCase())fail();
  return result;
}

async function simulateBorrowCall(rpc:SupplyRpc,tx:SupplyTransaction,state:SupplyState):Promise<{gasLimits:string[];observation:unknown}> {
  const call={from:tx.from,to:tx.to,data:tx.data,value:tx.value},tag=supplyHex(state.block);
  const result=await rpc('eth_call',[call,tag]);
  if(result!=='0x')throw new Error('BORROW_SIMULATION_UNEXPECTED_RETURN');
  const gas=rpcUint(await rpc('eth_estimateGas',[call,tag]));
  if(gas<=0n||gas>1000000n)throw new Error('BORROW_GAS_INVALID');
  return {gasLimits:[((gas*150n+99n)/100n).toString()],observation:{method:'eth_call',result}};
}

async function simulateWithdrawCall(rpc:SupplyRpc,tx:SupplyTransaction,state:SupplyState,amount:string):Promise<{gasLimits:string[];observation:unknown}> {
  const call={from:tx.from,to:tx.to,data:tx.data,value:tx.value},tag=supplyHex(state.block);
  const result=await rpc('eth_call',[call,tag]);
  if(rpcUint(result)!==BigInt(amount))throw new Error('WITHDRAW_SIMULATION_UNEXPECTED_RETURN');
  const gas=rpcUint(await rpc('eth_estimateGas',[call,tag]));
  if(gas<=0n||gas>1000000n)throw new Error('WITHDRAW_GAS_INVALID');
  if(rpcHash(rpcRecord(await rpc('eth_getBlockByNumber',[tag,false])).hash)!==state.blockHash)throw new Error('WITHDRAW_REORG');
  return {gasLimits:[((gas*150n+99n)/100n).toString()],observation:{method:'eth_call',result}};
}
