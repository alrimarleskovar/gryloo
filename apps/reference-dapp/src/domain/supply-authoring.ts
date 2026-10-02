// SPDX-License-Identifier: AGPL-3.0-only
import { createSupplyNode, readSupplyNode, createBorrowNode, readBorrowNode, createRepayNode, readRepayNode, createWithdrawNode, readWithdrawNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA as profile } from '@defi-workflow-engine/action-registry';
export type SupplyInput={network:'Base Sepolia';asset:'USDC';amount:string;beneficiary:string};
export function parseSupplyAmount(value:string):string {
  if(!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value)||value.length>80)throw new Error('SUPPLY_AMOUNT_INVALID');
  const [whole,fraction='']=value.split('.');const units=BigInt(whole!)*1_000_000n+BigInt(fraction.padEnd(6,'0'));
  if(units<=0n||units>=1n<<256n)throw new Error('SUPPLY_AMOUNT_INVALID');return units.toString();
}
export function createAuthoredSupply(nodeId:string,input:SupplyInput):SemanticWorkflow['nodes'][number]{
  if(input.network!==profile.network||input.asset!=='USDC')throw new Error('SUPPLY_DEPLOYMENT_UNSUPPORTED');
  return createSupplyNode(nodeId,{chain:profile.chain,asset:{chainId:profile.chain,address:profile.asset,decimals:profile.decimals},amount:parseSupplyAmount(input.amount),beneficiary:input.beneficiary});
}
export function supplyDetails(node:SemanticWorkflow['nodes'][number]):SupplyInput|null{
  if(node.actionType!=='supply')return null;
  const fields=readSupplyNode(node),amount=BigInt(fields.amount);
  return{network:'Base Sepolia',asset:'USDC',amount:`${amount/1_000_000n}${amount%1_000_000n?'.'+(amount%1_000_000n).toString().padStart(6,'0').replace(/0+$/,''):''}`,beneficiary:fields.beneficiary};
}

// Some injected providers return a safe JS integer for this read instead of an RPC quantity.
// Preserve the raw response in diagnostics; normalize only lossless, nonnegative values.
export function supplyWalletNonce(value:unknown):bigint {
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return BigInt(value);
  if(typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value))return BigInt(value);
  throw new Error('SUPPLY_WALLET_NONCE_RESPONSE_INVALID');
}
export function supplyWalletTransaction(prepared:Record<string,string>):Record<string,string> {
  const transaction={...prepared};delete transaction.nonce;
  for(const field of ['chainId','gas','gasPrice','maxFeePerGas','maxPriorityFeePerGas','value']){
    if(transaction[field]!==undefined&&!/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(transaction[field]))throw new Error('SUPPLY_WALLET_QUANTITY_INVALID');
  }
  return transaction;
}

export function createAuthoredBorrow(nodeId:string,input:SupplyInput):SemanticWorkflow['nodes'][number]{
  if(input.network!==profile.network||input.asset!=='USDC')throw new Error('BORROW_DEPLOYMENT_UNSUPPORTED');
  return createBorrowNode(nodeId,{chain:profile.chain,asset:{chainId:profile.chain,address:profile.asset,decimals:profile.decimals},amount:parseSupplyAmount(input.amount),beneficiary:input.beneficiary,interestRateMode:2});
}
export function borrowDetails(node:SemanticWorkflow['nodes'][number]):SupplyInput|null{
  if(node.actionType!=='borrow')return null;
  const fields=readBorrowNode(node),amount=BigInt(fields.amount);
  return {network:'Base Sepolia',asset:'USDC',amount:`${amount/1000000n}${amount%1000000n?'.'+(amount%1000000n).toString().padStart(6,'0').replace(/0+$/,''):''}`,beneficiary:fields.beneficiary};
}

export function createAuthoredRepay(nodeId:string,input:SupplyInput):SemanticWorkflow['nodes'][number]{
  if(input.network!==profile.network||input.asset!=='USDC')throw new Error('REPAY_DEPLOYMENT_UNSUPPORTED');
  return createRepayNode(nodeId,{chain:profile.chain,asset:{chainId:profile.chain,address:profile.asset,decimals:profile.decimals},amount:parseSupplyAmount(input.amount),beneficiary:input.beneficiary,interestRateMode:2});
}
export function repayDetails(node:SemanticWorkflow['nodes'][number]):SupplyInput|null{
  if(node.actionType!=='repay')return null;
  const fields=readRepayNode(node),amount=BigInt(fields.amount);
  return {network:'Base Sepolia',asset:'USDC',amount:`${amount/1000000n}${amount%1000000n?'.'+(amount%1000000n).toString().padStart(6,'0').replace(/0+$/,''):''}`,beneficiary:fields.beneficiary};
}

export type WithdrawInput={network:'Base Sepolia';asset:'USDC';amount:string;recipient:'CONNECTED_OWNER'};
export function createAuthoredWithdraw(nodeId:string,input:WithdrawInput):SemanticWorkflow['nodes'][number]{
  if(input.network!==profile.network||input.asset!=='USDC'||input.recipient!=='CONNECTED_OWNER')throw new Error('WITHDRAW_DEPLOYMENT_UNSUPPORTED');
  return createWithdrawNode(nodeId,{chain:profile.chain,asset:{chainId:profile.chain,address:profile.asset,decimals:6},amount:parseSupplyAmount(input.amount),recipient:input.recipient});
}
export function withdrawDetails(node:SemanticWorkflow['nodes'][number]):WithdrawInput|null{
  if(node.actionType!=='withdraw')return null;
  const fields=readWithdrawNode(node),amount=BigInt(fields.amount);
  return {network:'Base Sepolia',asset:'USDC',amount:`${amount/1000000n}${amount%1000000n?'.'+(amount%1000000n).toString().padStart(6,'0').replace(/0+$/,''):''}`,recipient:fields.recipient};
}
