// SPDX-License-Identifier: AGPL-3.0-only
import { createRequire } from 'node:module';
import { createRepayNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA as p } from '@defi-workflow-engine/reference-compiler';
import { supplyModel,REPAY_OWNER } from './supply-fixtures';
export { REPAY_OWNER } from './supply-fixtures';
export function repayModel(){const fixture=createRequire(import.meta.url)('./supply-harness.mjs') as {mockAllowanceSlot:(owner:string)=>string};const m=supplyModel();Object.assign(m.state,{owner:REPAY_OWNER,allowanceSlot:fixture.mockAllowanceSlot(REPAY_OWNER),balance:10000n,scaledDebt:8001n,userConfig:3n});m.history.set(10,{...m.state});return m;}
export const repayWorkflow=(amount='5000'):SemanticWorkflow=>({schemaVersion:'1.0.0',workflowId:'repay',revision:0,nodes:[createRepayNode('repay',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount,beneficiary:REPAY_OWNER,interestRateMode:2})],resourceEdges:[]});
