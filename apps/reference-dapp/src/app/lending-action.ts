// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createLendingCompositionService, type LendingCompositionService } from '../server/lending-composition-service';
import { isHostedDeployment } from '../server/deployment';
const methods=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_simulateV1','eth_getBalance','eth_getTransactionCount','eth_gasPrice','eth_getTransactionByHash','eth_getTransactionReceipt']);
let service:LendingCompositionService|null=null;
function current(){
  // BUILD-CLOUD-PARITY-001: the composition's append-only full-snapshot run log (BUILD-013) outgrows the cloud log store's bound,
  // so it runs only on a local journal; a hosted deployment fails closed before any read or wallet request.
  if(isHostedDeployment(process.env))throw Error('LENDING_CLOUD_RUNTIME_UNAVAILABLE');
  if(service)return service;
  const harness=process.env.GRYLOO_LENDING_HARNESS==='MOCKED_LOOPBACK_ONLY', journalDir=process.env.GRYLOO_SUPPLY_JOURNAL;
  if(!journalDir)throw Error('LENDING_STORAGE_NOT_CONFIGURED');
  const credential=process.env.GRYLOO_ALCHEMY_API_KEY;
  if(!harness&&!credential?.trim())throw Error('LENDING_PUBLIC_CREDENTIAL_NOT_CONFIGURED');
  let queue:Promise<unknown>=Promise.resolve();
  service=createLendingCompositionService({journalDir,provenance:harness?'MOCKED':'PUBLIC_TESTNET',rpc:(method,params)=>{
    const read=async()=>{
      if(!methods.has(method))throw Error('LENDING_RPC_METHOD_DENIED');
      if(!harness)await new Promise<void>(resolve=>setTimeout(resolve,150));
      const headers:Record<string,string>={'content-type':'application/json'};
      if(!harness)headers.authorization=`Bearer ${credential}`;
      const response=await fetch(harness?'http://127.0.0.1:8554':'https://base-sepolia.g.alchemy.com/v2',{method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
      const text=await response.text();if(text.length>1048576)throw Error('LENDING_RPC_RESPONSE_TOO_LARGE');
      const value:unknown=JSON.parse(text);
      if(!response.ok||!value||typeof value!=='object'||!('result'in value)||'error'in value)throw Error(method==='eth_simulateV1'?'LENDING_SEQUENTIAL_SIMULATION_UNAVAILABLE':'LENDING_RPC_UNAVAILABLE');
      return value.result;
    };
    const result=queue.then(read);queue=result.catch(()=>undefined);return result;
  }});return service;
}
async function run<T>(action:(s:LendingCompositionService)=>Promise<T>):Promise<{ok:true;value:T}|{ok:false;code:string}>{
  try{return {ok:true,value:await action(current())};}catch(cause){const code=cause instanceof Error?cause.message:'';return{ok:false,code:/^[A-Z][A-Z0-9_]{2,80}$/.test(code)?code:'LENDING_SERVICE_UNAVAILABLE'};}
}
export async function lendingSimulate(workflow:SemanticWorkflow,account:string){return run(s=>s.simulate(workflow,account));}
export async function lendingReview(id:string,commitment:string,workflow:SemanticWorkflow){return run(s=>s.review(id,commitment,workflow));}
export async function lendingBegin(id:string,account:string,workflow:SemanticWorkflow){return run(s=>s.begin(id,account,workflow));}
export async function lendingHandoff(id:string,attempt:string){return run(s=>s.handoff(id,attempt));}
export async function lendingReport(id:string,attempt:string,result:{kind:'HASH';hash:string}|{kind:'UNKNOWN'}){return run(s=>s.report(id,attempt,result));}
export async function lendingCancelPrepared(id:string,attempt:string){return run(s=>s.cancelPrepared(id,attempt));}
export async function lendingObserve(id:string){return run(s=>s.observe(id));}
export async function lendingStatus(id:string){return run(s=>s.load(id));}
export async function lendingRefresh(id:string){return run(s=>s.refreshReview(id));}
export async function lendingInvalidate(id:string){return run(s=>s.invalidate(id));}
