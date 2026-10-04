// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createSupplyService, type SupplyWalletDiagnostic, type SupplyService } from '../server/supply-service';
import { createSupplyReadRpc } from '../server/supply-rpc';
import { callCloudFlow } from '../server/cloud-api-client';
let service:SupplyService|null=null;
function current():SupplyService {
  const harness=process.env.GRYLOO_SUPPLY_HARNESS==='MOCKED_LOOPBACK_ONLY';
  const journalDir=process.env.GRYLOO_SUPPLY_JOURNAL;
  if(!journalDir)throw new Error('SUPPLY_STORAGE_NOT_CONFIGURED');
  // Pace public reads and retry only bounded provider throttling. No mutation method is permitted.
  service??=createSupplyService({journalDir,provenance:harness?'MOCKED':'PUBLIC_TESTNET',rpc:createSupplyReadRpc(harness)});
  return service;
}
async function run<T>(method:string,args:readonly unknown[],action:(service:SupplyService)=>Promise<T>):Promise<{ok:true;value:T}|{ok:false;code:string}>{
  // Cloud deployment: forward the identical contract to the stateless Flofi API.
  if(process.env.API_BASE_URL)return callCloudFlow<T>('aave-supply',method,args);
  try{return{ok:true,value:await action(current())};}catch(cause){const code=cause instanceof Error?cause.message:'';return{ok:false,code:/^[A-Z][A-Z0-9_]{2,80}$/.test(code)?code:'SUPPLY_SERVICE_UNAVAILABLE'};}
}
export async function supplySimulate(workflow:SemanticWorkflow,account:string){return run('simulate',[workflow,account],service=>service.simulate(workflow,account));}
export async function supplyReview(id:string,commitment:string,workflow:SemanticWorkflow){return run('review',[id,commitment,workflow],service=>service.review(id,commitment,workflow));}
export async function supplyBegin(id:string,account:string,workflow:SemanticWorkflow){return run('begin',[id,account,workflow],service=>service.begin(id,account,workflow));}
export async function supplyReport(id:string,step:'APPROVAL'|'SUPPLY'|'BORROW'|'REPAY'|'WITHDRAW',result:{kind:'HASH';hash:string}|{kind:'UNKNOWN'|'REJECTED';code?:string}){return run('report',[id,step,result],service=>service.report(id,step,result));}
export async function supplyObserve(id:string){return run('observe',[id],service=>service.observe(id));}
export async function supplyStatus(id:string){return run('status',[id],service=>service.load(id));}

export async function supplyInvalidate(id:string){return run('invalidate',[id],service=>service.invalidate(id));}
export async function supplyRecoverReview(id:string){return run('recoverReview',[id],service=>service.recoverReview(id));}

export async function supplyWalletFailure(id:string,diagnostic:SupplyWalletDiagnostic){return run('walletFailure',[id,diagnostic],service=>service.walletFailure(id,diagnostic));}
export async function supplyWalletTrace(id:string,diagnostic:SupplyWalletDiagnostic){return run('walletTrace',[id,diagnostic],service=>service.walletTrace(id,diagnostic));}

export async function supplyHandoff(id:string,step:'APPROVAL'|'SUPPLY'|'BORROW'|'REPAY'|'WITHDRAW',walletManagedNonce=false){return run('handoff',[id,step,walletManagedNonce],service=>service.handoff(id,step,walletManagedNonce));}
