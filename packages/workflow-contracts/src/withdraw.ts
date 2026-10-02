// SPDX-License-Identifier: Apache-2.0
import { canonicalJson } from './canonical.js';
import { createSupplyNode, type SupplyFields, type SupplyNode } from './supply.js';
export type WithdrawFields = Omit<SupplyFields,'beneficiary'> & { recipient:'CONNECTED_OWNER' };
/** Owner binding is session state. Authored intent contains no wallet address. */
export function createWithdrawNode(nodeId:string,fields:WithdrawFields):SupplyNode {
  if(fields.recipient!=='CONNECTED_OWNER'||BigInt(fields.amount)===(1n<<256n)-1n)throw new Error('WITHDRAW_EXACT_OWNER_AMOUNT_REQUIRED');
  const base=createSupplyNode(nodeId,{...fields,beneficiary:'0x0000000000000000000000000000000000000001'});
  return {...base,actionType:'withdraw',requiredCapabilities:['aave-v3.withdraw'],inputs:[base.inputs[0]!,{name:'recipient',kind:'IDENTIFIER',value:'CONNECTED_OWNER'}]};
}
export function readWithdrawNode(node:SupplyNode):WithdrawFields {
  const amount=node.inputs.find(p=>p.name==='amount'),recipient=node.inputs.find(p=>p.name==='recipient');
  if(amount?.kind!=='QUANTITY'||!('address' in amount.value.asset)||recipient?.kind!=='IDENTIFIER'||recipient.value!=='CONNECTED_OWNER')throw new Error('WITHDRAW_PORTS_INVALID');
  const fields:WithdrawFields={chain:node.chainId,asset:amount.value.asset,amount:amount.value.amount,recipient:'CONNECTED_OWNER'};
  const ordered=(n:SupplyNode)=>({...n,inputs:[...n.inputs].sort((a,b)=>a.name.localeCompare(b.name))});
  if(canonicalJson(ordered(node))!==canonicalJson(ordered(createWithdrawNode(node.nodeId,fields))))throw new Error('WITHDRAW_DECLARATION_INVALID');
  return fields;
}
