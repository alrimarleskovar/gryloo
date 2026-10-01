// SPDX-License-Identifier: AGPL-3.0-only
import { AAVE_V3_BASE_SEPOLIA as p } from '@defi-workflow-engine/action-registry';
import { readRepayNode, supplyAddress, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { borrowHealthFactor, type BorrowState } from './borrow.js';
import { supplyCall, type SupplyTransaction } from './supply.js';
export function estimateRepay(amount:string,state:BorrowState):{debtAfter:string;debtAfterBase:string;healthFactorAfter:string} {
  if (!/^[1-9][0-9]{0,77}$/.test(amount)) throw new Error('REPAY_AMOUNT_INVALID');
  const a=BigInt(amount),debt=BigInt(state.debt),cfg=BigInt(state.reserveConfiguration);
  if(a>=(1n<<256n)-1n||debt<=a)throw new Error('REPAY_PARTIAL_DEBT_REQUIRED');
  if(BigInt(state.eMode)!==0n||(BigInt(state.userConfiguration)&~3n)!==0n||state.variableDebtToken!==p.variableDebtToken||BigInt(state.price)<=0n||BigInt(state.baseCurrencyUnit)!==100000000n)throw new Error('REPAY_STATE_UNSUPPORTED');
  if(!((cfg>>56n)&1n)||((cfg>>60n)&1n))throw new Error('REPAY_RESERVE_UNAVAILABLE');
  const ray=10n**27n,index=BigInt(state.debtIndex),scaled=BigInt(state.scaledDebt);
  if(index<ray||scaled<=0n)throw new Error('REPAY_STATE_INVALID');
  // Conservative preview: floor the scaled burn, then round remaining debt upward.
  const burn=a*ray/index;
  if(!burn||burn>=scaled)throw new Error('REPAY_PARTIAL_DEBT_REQUIRED');
  const debtAfter=((scaled-burn)*index+ray-1n)/ray;
  const debtAfterBase=(debtAfter*BigInt(state.price)+999999n)/1000000n;
  return {debtAfter:debtAfter.toString(),debtAfterBase:debtAfterBase.toString(),healthFactorAfter:borrowHealthFactor(state.collateralBase,state.liquidationThresholdBps,debtAfterBase.toString())};
}
export function assertRepayFresh(amount:string,before:BorrowState,after:BorrowState):void {
  // Repay does not require borrow availability/capacity or a minimum HF. Reuse only drift checks.
  for(const k of ['reserveConfiguration','userConfiguration','variableDebtToken','baseCurrencyUnit','eMode','codeHash','scaledDebt'] as const)if(before[k]!==after[k])throw new Error('REPAY_AUTHORIZATION_STALE');
  for(const k of ['collateralBase','debtBase','price','healthFactor','debt','debtIndex'] as const){const a=BigInt(before[k]),b=BigInt(after[k]);if((a>b?a-b:b-a)>a/1000n+2n)throw new Error('REPAY_AUTHORIZATION_STALE');}
  estimateRepay(amount,after);
}
export function compileRepayCalls(workflow:SemanticWorkflow,account:string,allowance:string):SupplyTransaction[] {
  const nodes=workflow.nodes.filter(n=>n.actionType==='repay');
  if(nodes.length!==1||workflow.nodes.some(n=>n.actionType!=='repay'&&!n.actionType.startsWith('mock-'))||workflow.resourceEdges.some(e=>e.fromNodeId===nodes[0]?.nodeId||e.toNodeId===nodes[0]?.nodeId)||workflow.nodes.some(n=>n.dependencies.includes(nodes[0]?.nodeId??'')))throw new Error('REPAY_ISOLATED_ONLY');
  const f=readRepayNode(nodes[0]!),owner=supplyAddress(account);
  if(f.chain!==p.chain||f.asset.address!==p.asset||f.asset.decimals!==6||!/^(0|[1-9][0-9]*)$/.test(allowance))throw new Error('REPAY_DEPLOYMENT_UNSUPPORTED');
  if(f.beneficiary!==owner)throw new Error('REPAY_BENEFICIARY_MUST_BE_OWNER');
  const base={from:owner,value:'0x0' as const,chainId:'0x14a34' as const};
  return [...BigInt(allowance)<BigInt(f.amount)?[{...base,to:p.asset,data:supplyCall('approve(address,uint256)',p.pool,BigInt(f.amount))}]:[],{...base,to:p.pool,data:supplyCall('repay(address,uint256,uint256,address)',p.asset,BigInt(f.amount),2n,owner)}];
}
