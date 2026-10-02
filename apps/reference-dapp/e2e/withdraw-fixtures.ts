// SPDX-License-Identifier: AGPL-3.0-only
import { createWithdrawNode,type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA as p } from '@defi-workflow-engine/reference-compiler';
import { repayModel,REPAY_OWNER } from './repay-fixtures';
export { REPAY_OWNER as WITHDRAW_OWNER } from './repay-fixtures';
export const withdrawOptions={owner:REPAY_OWNER,balance:'5000',scaled:'803435',index:'1244658226988670665599345266',previousIndex:'1244658226988670665599345266',scaledDebt:'3858',debtIndex:'1296361915267372345054439157',userConfig:'3'};
export function withdrawModel(){const m=repayModel();Object.assign(m.state,Object.fromEntries(Object.entries(withdrawOptions).map(([k,v])=>[k,k==='owner'?v:BigInt(v)])));m.history.set(10,{...m.state});return m;}
export const withdrawWorkflow=(amount='100000'):SemanticWorkflow=>({schemaVersion:'1.0.0',workflowId:'withdraw',revision:0,nodes:[createWithdrawNode('withdraw',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount,recipient:'CONNECTED_OWNER'})],resourceEdges:[]});
