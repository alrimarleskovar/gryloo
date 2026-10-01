// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { AAVE_V3_BASE_SEPOLIA as profile } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createSupplyService, type SupplyService } from '../server/supply-service';
let service:SupplyService|null=null;
const methods=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_simulateV1',
  'eth_getBalance','eth_getTransactionCount','eth_estimateGas','eth_gasPrice','eth_getTransactionByHash','eth_getTransactionReceipt']);
function current():SupplyService {
  const harness=process.env.GRYLOO_SUPPLY_HARNESS==='MOCKED_LOOPBACK_ONLY';
  const endpoint=harness?'http://127.0.0.1:8549':profile.rpc;
  const journalDir=process.env.GRYLOO_SUPPLY_JOURNAL;
  if(!journalDir)throw new Error('SUPPLY_STORAGE_NOT_CONFIGURED');
  // Pace public reads and retry only bounded provider throttling. No mutation method is permitted.
  if(!service){
    let queue:Promise<unknown>=Promise.resolve();
    const read=async(method:string,params:readonly unknown[])=>{
      if(!methods.has(method))throw new Error('SUPPLY_RPC_METHOD_DENIED');
      for(let attempt=0;attempt<3;attempt++){
        if(!harness)await new Promise<void>(resolve=>setTimeout(resolve,attempt===0?150:500*attempt));
        const response=await fetch(endpoint,{method:'POST',cache:'no-store',signal:AbortSignal.timeout(15_000),headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
        const text=await response.text();if(text.length>1_048_576)throw new Error('SUPPLY_RPC_RESPONSE_TOO_LARGE');
        const value:unknown=JSON.parse(text);
        const throttled=response.status===429||!!value&&typeof value==='object'&&'error'in value&&!!value.error&&typeof value.error==='object'&&'code'in value.error&&value.error.code===-32005;
        if(throttled){if(method==='eth_simulateV1')throw new Error('SUPPLY_SIMULATION_UNAVAILABLE');if(attempt<2)continue;throw new Error('SUPPLY_RPC_RATE_LIMITED');}
        if(!response.ok)throw new Error('SUPPLY_RPC_UNAVAILABLE');
        if(!value||typeof value!=='object'||!('result'in value)||'error'in value)throw new Error(method==='eth_simulateV1'?'SUPPLY_SIMULATION_UNAVAILABLE':'SUPPLY_RPC_RESPONSE_INVALID');
        return value.result;
      }
      throw new Error('SUPPLY_RPC_RATE_LIMITED');
    };
    service=createSupplyService({journalDir,provenance:harness?'MOCKED':'PUBLIC_TESTNET',rpc:(method,params)=>{
      const result=queue.then(()=>read(method,params));queue=result.catch(()=>undefined);return result;
    }});
  }
  return service;
}
async function run<T>(action:(service:SupplyService)=>Promise<T>):Promise<{ok:true;value:T}|{ok:false;code:string}>{
  try{return{ok:true,value:await action(current())};}catch(cause){const code=cause instanceof Error?cause.message:'';return{ok:false,code:/^[A-Z][A-Z0-9_]{2,80}$/.test(code)?code:'SUPPLY_SERVICE_UNAVAILABLE'};}
}
export async function supplySimulate(workflow:SemanticWorkflow,account:string){return run(service=>service.simulate(workflow,account));}
export async function supplyReview(id:string,commitment:string,workflow:SemanticWorkflow){return run(service=>service.review(id,commitment,workflow));}
export async function supplyBegin(id:string,account:string,workflow:SemanticWorkflow){return run(service=>service.begin(id,account,workflow));}
export async function supplyReport(id:string,step:'APPROVAL'|'SUPPLY',result:{kind:'HASH';hash:string}|{kind:'UNKNOWN'|'REJECTED'}){return run(service=>service.report(id,step,result));}
export async function supplyObserve(id:string){return run(service=>service.observe(id));}
export async function supplyStatus(id:string){return run(service=>service.load(id));}

export async function supplyInvalidate(id:string){return run(service=>service.invalidate(id));}
