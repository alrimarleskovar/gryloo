// SPDX-License-Identifier: AGPL-3.0-only
import { keccak_256 } from '@noble/hashes/sha3.js';
import { AAVE_V3_BASE_SEPOLIA as profile } from '@defi-workflow-engine/action-registry';
import { readSupplyNode, supplyAddress, hashArtifactBytes, type SemanticWorkflow,
  hashSupplyValue, type ArtifactSet, type SimulationBundle, type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
export { AAVE_V3_BASE_SEPOLIA } from '@defi-workflow-engine/action-registry';
export type SupplyRpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
export type SupplyTransaction = { from: string; to: string; data: string; value: '0x0'; chainId: '0x14a34' };
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
export type SupplyState = { block: number; blockHash: string; account: string; allowance: string; balance: string; nativeBalance: string;
  nonce: string; gasPrice: string; scaledPosition: string; position: string; index: string; deploymentHash: string; observedAt: string };
export async function readSupplyState(rpc: SupplyRpc, accountInput: string, beneficiaryInput: string, blockTag = 'latest'): Promise<SupplyState> {
  const account = supplyAddress(accountInput), beneficiary = supplyAddress(beneficiaryInput);
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
  if (reserveHex.length !== 15 * 64 || rpcUint(pool) !== BigInt(profile.pool) || rpcUint(decimals) !== 6n || rpcUint(underlying) !== BigInt(profile.asset) || rpcUint(tokenPool) !== BigInt(profile.pool) ||
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
function allowanceSlot(account: string, slot: bigint): string {
  const hashWords = (value: string) => '0x' + Array.from(keccak_256(Uint8Array.from(value.match(/../g)!.map(b => Number.parseInt(b,16)))), b => b.toString(16).padStart(2,'0')).join('');
  const first = hashWords(supplyWord(account)+supplyWord(slot));
  return hashWords(supplyWord(profile.pool)+first.slice(2));
}
async function simulateSupplyWithAllowanceOverride(rpc: SupplyRpc, transactions: SupplyTransaction[], state: SupplyState, amount: string): Promise<{gasLimits:string[];observation:unknown}> {
  const tag=supplyHex(state.block), approval=transactions.length===2?transactions[0]:null, supply=transactions.at(-1)!;
  let override:Record<string,unknown>|null=null;
  if(approval){
    // First simulate the exact approval against real token code. The ERC-20 must return true.
    if(rpcUint(await rpc('eth_call',[{from:approval.from,to:approval.to,data:approval.data,value:approval.value},tag]))!==1n)throw new Error('SUPPLY_APPROVAL_SIMULATION_FAILED');
    // Bounded mapping discovery, with unique markers, followed by proof of ONE exact storage key.
    const candidates=Array.from({length:16},(_,i)=>allowanceSlot(state.account,BigInt(i)));
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
  if(result!=='0x')throw new Error('SUPPLY_SIMULATION_UNEXPECTED_RETURN');
  const gasLimits:string[]=[];
  if(approval){const gas=rpcUint(await rpc('eth_estimateGas',[calls[0],tag]));gasLimits.push(((gas*150n+99n)/100n).toString());}
  const gas=rpcUint(await rpc('eth_estimateGas',[{from:supply.from,to:supply.to,data:supply.data,value:supply.value},tag,...override?[override]:[]]));
  if(gas<=0n||gas>1_000_000n)throw new Error('SUPPLY_GAS_INVALID');gasLimits.push(((gas*150n+99n)/100n).toString());
  return {gasLimits,observation:{method:'eth_call',approvalResult:approval?'true':null,allowanceOverride:override,supplyResult:result}};
}
export type SupplyReview = { format: 'gryloo.supply-review.v1'; workflow: SemanticWorkflow; account: string; beneficiary: string; amount: string;
  pool: string; asset: string; aToken: string; chain: string; approvalRequired: boolean; allowance: string; state: SupplyState;
  transactions: SupplyTransaction[]; gasLimits: string[]; gasPrice: string; expiresAt: string; commitment: string;
  artifactSet: ArtifactSet; simulation: SimulationBundle; policy: AuthorizationPolicy; manifest: StrategyManifest; plan: ExecutionPlan };
export function compileSupplyCalls(workflow: SemanticWorkflow, accountInput: string, allowance: string): SupplyTransaction[] {
  const nodes = workflow.nodes.filter(n => n.actionType === 'supply');
  if (nodes.length !== 1 || workflow.nodes.some(n => n.actionType !== 'supply' && !n.actionType.startsWith('mock-')) ||
      workflow.resourceEdges.some(e => e.fromNodeId === nodes[0]?.nodeId || e.toNodeId === nodes[0]?.nodeId) ||
      workflow.nodes.some(n => n.dependencies.includes(nodes[0]?.nodeId ?? ''))) throw new Error('SUPPLY_ISOLATED_ONLY');
  const fields = readSupplyNode(nodes[0]!);
  if (fields.chain !== profile.chain || fields.asset.address !== profile.asset || fields.asset.decimals !== 6 || !/^(0|[1-9][0-9]*)$/.test(allowance)) throw new Error('SUPPLY_DEPLOYMENT_UNSUPPORTED');
  const base = { from: supplyAddress(accountInput), value: '0x0' as const, chainId: '0x14a34' as const };
  const calls: SupplyTransaction[] = [];
  if (BigInt(allowance) < BigInt(fields.amount)) calls.push({ ...base, to: profile.asset, data: supplyCall('approve(address,uint256)',profile.pool,BigInt(fields.amount)) });
  calls.push({ ...base, to: profile.pool, data: supplyCall('supply(address,uint256,address,uint16)',profile.asset,BigInt(fields.amount),fields.beneficiary,0n) });
  return calls;
}
/** Only reads. Exact sequential call simulation uses ephemeral RPC state, never sends. */
export async function simulateSupply(workflow: SemanticWorkflow, accountInput: string, rpc: SupplyRpc, now = Date.now()): Promise<SupplyReview> {
  // Canonical hashing validates the frozen shared IR before protocol interpretation.
  const semanticHash = supplyArtifactHash('semantic-workflow',workflow);
  const node = workflow.nodes.find(n => n.actionType === 'supply');
  if (!node) throw new Error('SUPPLY_REQUIRED');
  const fields = readSupplyNode(node), account = supplyAddress(accountInput);
  const state = await readSupplyState(rpc,account,fields.beneficiary);
  const transactions = compileSupplyCalls(workflow,account,state.allowance);
  if (BigInt(state.balance) < BigInt(fields.amount)) throw new Error('SUPPLY_INSUFFICIENT_USDC');
  // The public gateway rejects eth_simulateV1; the approved fallback proves a bounded
  // allowance mapping override, then eth_call/estimateGas execute exact Supply read-only.
  const {gasLimits,observation:response}=await simulateSupplyWithAllowanceOverride(rpc,transactions,state,fields.amount);
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
      functions:[{chainId:profile.chain,contract:profile.pool,functionId:'supply'},{chainId:profile.chain,contract:profile.asset,functionId:'approve'}]},
    budgetReservation:{rule:'RESERVE_BEFORE_SUBMISSION',concurrentConsumption:'CUMULATIVE_ACROSS_BRANCHES',implementation:'NOT_IMPLEMENTED'},
    spendLimits,maximumSlippageBps:0,gasBudgets,feeBudgets:[],oracleRules:[],accountRiskRules:[],checkpointRules:[],providers,
    nonce:state.nonce,deadline:expiresAt,revocationEpoch:workflow.revision,recovery,enforcement:'NOT_ENFORCED'};
  const policyHash = supplyArtifactHash('authorization-policy',policy);
  const manifest: StrategyManifest = {schemaVersion:'1.0.0',manifestId:'supply-manifest',semanticWorkflowRevision:workflow.revision,semanticWorkflowHash:semanticHash,
    artifactSetHash:artifactHash,simulationHash,policyHash,authorizationMode:'MODE_A',owner,executor:null,expiresAt,nonce:state.nonce,revocationEpoch:workflow.revision,
    spendLimits,maximumSlippageBps:0,gasBudgets,feeBudgets:[],providers,recovery,enforcement:'NOT_ENFORCED'};
  const manifestHash = supplyArtifactHash('strategy-manifest',manifest);
  const plan: ExecutionPlan = {schemaVersion:'1.0.0',executionPlanId:'supply-plan',semanticWorkflowHash:semanticHash,manifestHash,
    segments:[{segmentId:'supply-segment',chainId:profile.chain,dependencies:[],steps:transactions.map((tx,i) => ({stepId:i===0&&transactions.length===2?'supply-approval':'supply-deposit',
      nodeId:node.nodeId,chainId:profile.chain,adapter:{id:'aave-v3',version:'1.0.0'},dependencies:i===1?['supply-approval']:[],requiredAuthorizationClass:'MODE_A',
      executionKind:'DIRECT_TRANSACTION',payloadHash:hashSupplyValue(tx,'payload')}))}],checkpointIds:[],enforcement:'NOT_ENFORCED'};
  supplyArtifactHash('execution-plan',plan);
  const review = {format:'gryloo.supply-review.v1' as const,workflow,account,beneficiary:fields.beneficiary,amount:quantity.amount,pool:profile.pool,asset:profile.asset,
    aToken:profile.aToken,chain:profile.chain,approvalRequired:transactions.length===2,allowance:state.allowance,state,transactions,gasLimits,gasPrice,expiresAt,
    artifactSet,simulation,policy,manifest,plan};
  return {...review,commitment:supplyHash(review)};
}
export function assertSupplyReview(review: SupplyReview, workflow: SemanticWorkflow, account: string, state: SupplyState, now = Date.now(), approvalConfirmed = false): void {
  const {commitment,...content} = review;
  if (supplyHash(content) !== commitment || supplyArtifactHash('semantic-workflow',workflow) !== review.manifest.semanticWorkflowHash ||
      supplyAddress(account) !== review.account || state.account !== review.account || state.deploymentHash !== review.state.deploymentHash ||
      now >= Date.parse(review.expiresAt) || now < Date.parse(review.simulation.freshness.observedAt) ||
      (!approvalConfirmed && (state.allowance !== review.allowance || state.nonce !== review.state.nonce)) ||
      (approvalConfirmed && BigInt(state.allowance) < BigInt(review.amount)) || BigInt(state.balance) < BigInt(review.amount)) throw new Error('SUPPLY_AUTHORIZATION_STALE');
  if (JSON.stringify(compileSupplyCalls(workflow,account,review.allowance)) !== JSON.stringify(review.transactions)) throw new Error('SUPPLY_AUTHORIZATION_INVALID');
}
