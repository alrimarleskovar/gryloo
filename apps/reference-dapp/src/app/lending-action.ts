// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createLendingCompositionService, type LendingCompositionService } from '../server/lending-composition-service';
import { createLendingRpc } from '../server/lending-rpc';
import { cloudFlow } from '../server/flow-runtime';
let service:LendingCompositionService|null=null;
function current(){
  if(service)return service;
  const harness=process.env.GRYLOO_LENDING_HARNESS==='MOCKED_LOOPBACK_ONLY', journalDir=process.env.GRYLOO_SUPPLY_JOURNAL;
  if(!journalDir)throw Error('LENDING_STORAGE_NOT_CONFIGURED');
  if(!harness&&!process.env.GRYLOO_ALCHEMY_API_KEY?.trim())throw Error('LENDING_PUBLIC_CREDENTIAL_NOT_CONFIGURED');
  service=createLendingCompositionService({journalDir,provenance:harness?'MOCKED':'PUBLIC_TESTNET',rpc:createLendingRpc(harness,process.env)});return service;
}
async function run<T>(method:string,args:readonly unknown[],action:(s:LendingCompositionService)=>Promise<T>):Promise<{ok:true;value:T}|{ok:false;code:string}>{
  // Cloud deployment (BUILD-CLOUD-PARITY-001): the remote Flofi API or the embedded PostgreSQL runtime, on the Aave family's shared storage.
  const cloud=await cloudFlow<T>('lending-composition',method,args);if(cloud)return cloud;
  try{return {ok:true,value:await action(current())};}catch(cause){const code=cause instanceof Error?cause.message:'';return{ok:false,code:/^[A-Z][A-Z0-9_]{2,80}$/.test(code)?code:'LENDING_SERVICE_UNAVAILABLE'};}
}
export async function lendingSimulate(workflow:SemanticWorkflow,account:string){return run('simulate',[workflow,account],s=>s.simulate(workflow,account));}
export async function lendingReview(id:string,commitment:string,workflow:SemanticWorkflow){return run('review',[id,commitment,workflow],s=>s.review(id,commitment,workflow));}
export async function lendingBegin(id:string,account:string,workflow:SemanticWorkflow){return run('begin',[id,account,workflow],s=>s.begin(id,account,workflow));}
export async function lendingHandoff(id:string,attempt:string){return run('handoff',[id,attempt],s=>s.handoff(id,attempt));}
export async function lendingReport(id:string,attempt:string,result:{kind:'HASH';hash:string}|{kind:'UNKNOWN'}){return run('report',[id,attempt,result],s=>s.report(id,attempt,result));}
export async function lendingCancelPrepared(id:string,attempt:string){return run('cancelPrepared',[id,attempt],s=>s.cancelPrepared(id,attempt));}
export async function lendingObserve(id:string){return run('observe',[id],s=>s.observe(id));}
export async function lendingStatus(id:string){return run('status',[id],s=>s.load(id));}
export async function lendingRefresh(id:string){return run('refresh',[id],s=>s.refreshReview(id));}
export async function lendingInvalidate(id:string){return run('invalidate',[id],s=>s.invalidate(id));}
