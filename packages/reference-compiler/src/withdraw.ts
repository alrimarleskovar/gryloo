// SPDX-License-Identifier: AGPL-3.0-only
import { assertAaveLendingProfile,type AaveLendingProfile } from '@defi-workflow-engine/action-registry';
import { readWithdrawNode,supplyAddress,type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { borrowHealthFactor,BORROW_MINIMUM_HEALTH_FACTOR,readBorrowState } from './borrow.js';
import { supplyCall,supplyHex,rpcUint,rpcHash,rpcRecord,lendingProfile,reserveBits,type SupplyRpc,type SupplyState,type SupplyTransaction } from './supply.js';
const ray=10n**27n,abs=(n:bigint)=>n<0n?-n:n;
export function estimateWithdraw(amount:string,state:SupplyState,profile:AaveLendingProfile):{collateralAfter:string;collateralAfterBase:string;healthFactorAfter:string;walletAfter:string} {
  const p=assertAaveLendingProfile(profile),{mask,collateral,scale}=reserveBits(p),decimals=BigInt(p.decimals);
  if(!/^[1-9][0-9]{0,77}$/.test(amount)||BigInt(amount)>=(1n<<256n)-1n)throw new Error('WITHDRAW_AMOUNT_INVALID');
  const n=BigInt(amount),b=state.borrow;
  if(!b)throw new Error('WITHDRAW_STATE_INVALID');
  const cfg=BigInt(b.reserveConfiguration),index=BigInt(state.index),scaled=BigInt(state.scaledPosition),price=BigInt(b.price);
  if(b.variableDebtToken!==p.variableDebtToken||BigInt(b.baseCurrencyUnit)!==100000000n||BigInt(b.eMode)!==0n||(BigInt(b.userConfiguration)&~mask)||!(BigInt(b.userConfiguration)&collateral)||price<=0n||index<ray||BigInt(b.debtIndex)<ray||((cfg>>48n)&255n)!==decimals||(cfg>>212n)&((1n<<40n)-1n))throw new Error('WITHDRAW_STATE_UNSUPPORTED');
  if(!((cfg>>56n)&1n)||((cfg>>57n)&1n)||((cfg>>60n)&1n))throw new Error('WITHDRAW_RESERVE_UNAVAILABLE');
  const health=BigInt(borrowHealthFactor(b.collateralBase,b.liquidationThresholdBps,b.debtBase));
  if(abs(BigInt(b.healthFactor)-health)>health/1000000n+1n||abs(BigInt(state.position)-(scaled*index+ray/2n)/ray)>1n||abs(BigInt(b.debt)-(BigInt(b.scaledDebt)*BigInt(b.debtIndex)+ray/2n)/ray)>1n||abs(BigInt(b.collateralBase)-BigInt(state.position)*price/scale)>2n||abs(BigInt(b.debtBase)-BigInt(b.debt)*price/scale)>2n)throw new Error('WITHDRAW_STATE_INCONSISTENT');
  // Current Aave rounds shares up on burn; legacy rounds nearest. Preview uses
  // the larger burn and rounds remaining collateral down, debt base up.
  const burn=(n*ray+index-1n)/index;
  if(n>=BigInt(state.position)||!burn||burn>=scaled)throw new Error('WITHDRAW_INSUFFICIENT_COLLATERAL');
  if(BigInt(b.liquidity)<n)throw new Error('WITHDRAW_INSUFFICIENT_LIQUIDITY');
  const collateralAfter=(scaled-burn)*index/ray,collateralAfterBase=collateralAfter*price/scale;
  const debtBase=(BigInt(b.debt)*price+scale-1n)/scale;
  const healthFactorAfter=borrowHealthFactor(collateralAfterBase.toString(),b.liquidationThresholdBps,debtBase.toString());
  if(BigInt(b.healthFactor)<BORROW_MINIMUM_HEALTH_FACTOR||BigInt(healthFactorAfter)<BORROW_MINIMUM_HEALTH_FACTOR)throw new Error('WITHDRAW_UNSAFE_HEALTH_FACTOR');
  return {collateralAfter:collateralAfter.toString(),collateralAfterBase:collateralAfterBase.toString(),healthFactorAfter,walletAfter:(BigInt(state.balance)+n).toString()};
}
export function assertWithdrawFresh(amount:string,before:SupplyState,after:SupplyState,profile:AaveLendingProfile):void {
  if(before.withdrawState?.previousIndex!==after.withdrawState?.previousIndex)throw new Error('WITHDRAW_AUTHORIZATION_STALE');
  if(!before.borrow||!after.borrow)throw new Error('WITHDRAW_STATE_INVALID');
  for(const k of ['scaledPosition','balance','allowance','deploymentHash'] as const)if(before[k]!==after[k])throw new Error('WITHDRAW_AUTHORIZATION_STALE');
  for(const k of ['reserveConfiguration','userConfiguration','variableDebtToken','baseCurrencyUnit','eMode','codeHash','scaledDebt'] as const)if(before.borrow[k]!==after.borrow[k])throw new Error('WITHDRAW_AUTHORIZATION_STALE');
  for(const k of ['collateralBase','debtBase','price','healthFactor','debt','debtIndex'] as const){const a=BigInt(before.borrow[k]),b=BigInt(after.borrow[k]);if(abs(a-b)>a/1000n+2n)throw new Error('WITHDRAW_AUTHORIZATION_STALE');}
  if(BigInt(after.index)<BigInt(before.index)||abs(BigInt(after.index)-BigInt(before.index))>BigInt(before.index)/1000n+2n||BigInt(after.block)<BigInt(before.block)||after.block===before.block&&after.blockHash!==before.blockHash)throw new Error('WITHDRAW_AUTHORIZATION_STALE');
  estimateWithdraw(amount,after,profile);
}
export function compileWithdrawCalls(workflow:SemanticWorkflow,account:string):SupplyTransaction[] {
  const nodes=workflow.nodes.filter(n=>n.actionType==='withdraw');
  if(nodes.length!==1||workflow.nodes.some(n=>n.actionType!=='withdraw'&&!n.actionType.startsWith('mock-'))||workflow.resourceEdges.some(e=>e.fromNodeId===nodes[0]?.nodeId||e.toNodeId===nodes[0]?.nodeId)||workflow.nodes.some(n=>n.dependencies.includes(nodes[0]?.nodeId??'')))throw new Error('WITHDRAW_ISOLATED_ONLY');
  const f=readWithdrawNode(nodes[0]!),owner=supplyAddress(account),p=lendingProfile(f.chain,'WITHDRAW_DEPLOYMENT_UNSUPPORTED');
  if(f.asset.address!==p.asset||f.asset.decimals!==p.decimals)throw new Error('WITHDRAW_DEPLOYMENT_UNSUPPORTED');
  return [{from:owner,to:p.pool,value:'0x0',chainId:p.chainHex,data:supplyCall('withdraw(address,uint256,address)',p.asset,BigInt(f.amount),owner)}];
}

/** Reuse the verified lending reader; add the owner aToken interest checkpoint. */
export async function readWithdrawState(rpc:SupplyRpc,profileInput:AaveLendingProfile,account:string,recipient:string,tag='latest'):Promise<SupplyState>{
  const p=assertAaveLendingProfile(profileInput),state=await readBorrowState(rpc,p,account,recipient,tag),block=supplyHex(state.block);
  const previousIndex=rpcUint(await rpc('eth_call',[{to:p.aToken,data:supplyCall('getPreviousIndex(address)',state.account)},block]));
  if(previousIndex<ray||previousIndex>BigInt(state.index)||rpcHash(rpcRecord(await rpc('eth_getBlockByNumber',[block,false])).hash)!==state.blockHash)throw new Error('WITHDRAW_INTEREST_CHECKPOINT_INVALID');
  return {...state,withdrawState:{previousIndex:previousIndex.toString()}};
}
