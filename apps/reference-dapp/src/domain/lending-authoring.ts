// SPDX-License-Identifier: AGPL-3.0-only
import { createLendingCompositionWorkflow, readLendingComposition, isLendingComposition, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA as p, LENDING_BASE_SEPOLIA as u } from '@defi-workflow-engine/action-registry';
import type {Workflow} from './initial-workflow';
import { parseSupplyAmount } from './supply-authoring';
export type LendingInput = { supply: string; borrow: string; slippage: string; owner: string };
export const lendingHuman = (amount:string,decimals=6) => {
  const value=BigInt(amount),scale=10n**BigInt(decimals);
  return `${value/scale}${value%scale?'.'+(value%scale).toString().padStart(decimals,'0').replace(/0+$/,''):''}`;
};
export function createAuthoredLending(id:string,revision:number,input:LendingInput):SemanticWorkflow {
  if(!input||Object.keys(input).sort().join()!==['borrow','owner','slippage','supply'].join() || !Object.values(input).every(v=>typeof v==='string'&&v.length<=80) || !/^(?:[1-9][0-9]{0,2})$/.test(input.slippage))throw Error('LENDING_INPUT_INVALID');
  const asset={chainId:p.chain,address:p.asset,decimals:6};
  return createLendingCompositionWorkflow(id,revision,{chain:p.chain,collateral:asset,borrowed:asset,output:{chainId:p.chain,address:u.weth,decimals:18},
    supplyAmount:parseSupplyAmount(input.supply),borrowAmount:parseSupplyAmount(input.borrow),slippageBps:Number(input.slippage),owner:input.owner});
}
export function lendingDetails(workflow:SemanticWorkflow|Workflow):LendingInput|null {
  if(!isLendingComposition(workflow))return null;
  const f=readLendingComposition(workflow as SemanticWorkflow);return {supply:lendingHuman(f.supplyAmount),borrow:lendingHuman(f.borrowAmount),slippage:String(f.slippageBps),owner:f.owner};
}
