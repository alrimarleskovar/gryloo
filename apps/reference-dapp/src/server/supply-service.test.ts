// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSupplyNode,type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
import {AAVE_V3_BASE_SEPOLIA as p} from '@defi-workflow-engine/action-registry';
import {createSupplyService} from './supply-service';
import {supplyModel,SUPPLY_OWNER} from '../../e2e/supply-fixtures';
const workflow:SemanticWorkflow={schemaVersion:'1.0.0',workflowId:'supply',revision:0,nodes:[createSupplyNode('supply',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'10000000',beneficiary:SUPPLY_OWNER})],resourceEdges:[]};
async function fixture(action:(f:{model:ReturnType<typeof supplyModel>;dir:string;service:ReturnType<typeof createSupplyService>})=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'build012a-service-')),model=supplyModel(),service=createSupplyService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});
 try{await action({model,dir,service});}finally{await rm(dir,{recursive:true,force:true});}
}
describe('Supply service lifecycle',()=>{
 it('persists before submission; approval reconciles first; Supply reconciles and exports honest MOCKED evidence',async()=>fixture(async({model,dir,service})=>{
   let run=await service.simulate(workflow,SUPPLY_OWNER);run=await service.review(run.id,run.review.commitment,workflow);
   for(const step of ['APPROVAL','SUPPLY']){
     const begin=await service.begin(run.id,SUPPLY_OWNER,workflow);expect(begin.step).toBe(step);
     const durable=await readFile(join(dir,run.id+'.jsonl'),'utf8');expect(durable).toContain('SUBMITTING');expect(durable).toContain(begin.transaction.data);
     const hash=await model.rpc('MOCK_submit',[begin.transaction]) as string;await service.report(run.id,begin.step,{kind:'HASH',hash});run=await service.observe(run.id);
   }
   expect(run.verdict).toBe('RECONCILED');expect(run.evidence?.bundle.environment).toBe('MOCKED');expect(run.attempts).toHaveLength(2);expect(model.transactions).toHaveLength(2);
   await expect(service.begin(run.id,SUPPLY_OWNER,workflow)).rejects.toThrow();expect(model.transactions).toHaveLength(2);
 }));
 it.each(['APPROVAL','SUPPLY'] as const)('restart recovers uncertain %s without duplicate intent',async step=>fixture(async({model,dir,service})=>{
   if(step==='SUPPLY')model.state.allowance=10000000n;
   let run=await service.simulate(workflow,SUPPLY_OWNER);run=await service.review(run.id,run.review.commitment,workflow);const begin=await service.begin(run.id,SUPPLY_OWNER,workflow);
   const hash=await model.rpc('MOCK_submit',[begin.transaction]);await service.report(run.id,step,{kind:'UNKNOWN'});
   const restarted=createSupplyService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});run=await restarted.observe(run.id);
   expect(run.attempts[0]?.transactionHash).toBe(hash);expect(run.attempts[0]?.reconciled).toBe(true);expect(model.transactions).toHaveLength(1);
   if(step==='APPROVAL'){const supply=await restarted.begin(run.id,SUPPLY_OWNER,workflow);expect(supply.step).toBe('SUPPLY');}
   else await expect(restarted.begin(run.id,SUPPLY_OWNER,workflow)).rejects.toThrow();
 }));
 it('sufficient allowance omits approval and a second run cannot reserve an existing nonce',async()=>fixture(async({model,service})=>{
   model.state.allowance=10000000n;const a=await service.simulate(workflow,SUPPLY_OWNER),b=await service.simulate(workflow,SUPPLY_OWNER);
   await service.review(a.id,a.review.commitment,workflow);await service.review(b.id,b.review.commitment,workflow);expect((await service.begin(a.id,SUPPLY_OWNER,workflow)).step).toBe('SUPPLY');
   await expect(service.begin(b.id,SUPPLY_OWNER,workflow)).rejects.toThrow('NONCE_ALREADY_RESERVED');
 }));
 it.each(['APPROVAL','SUPPLY'] as const)('preserves reverted %s without false reconciliation or retransmission',async step=>fixture(async({model,service})=>{
   if(step==='SUPPLY')model.state.allowance=10000000n;let run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);const begin=await service.begin(run.id,SUPPLY_OWNER,workflow);
   model.state.revert=true;const hash=await model.rpc('MOCK_submit',[begin.transaction]) as string;await service.report(run.id,step,{kind:'HASH',hash});run=await service.observe(run.id);expect(run.verdict).toBe('DIVERGENT');expect(run.evidence).toBeNull();expect(run.attempts[0]?.state).toBe('REVERTED');expect((await service.report(run.id,step,{kind:'HASH',hash})).attempts[0]?.state).toBe('REVERTED');
 }));
 it('semantic invalidation and stale/replaced reviews fail closed',async()=>fixture(async({service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await expect(service.review(run.id,'0x'+'a'.repeat(64),workflow)).rejects.toThrow('REPLACED');
   await service.review(run.id,run.review.commitment,workflow);await expect(service.begin(run.id,SUPPLY_OWNER,{...workflow,revision:1})).rejects.toThrow('STALE');await service.invalidate(run.id);await expect(service.begin(run.id,SUPPLY_OWNER,workflow)).rejects.toThrow('REVIEW_REQUIRED');
 }));
 it.each(['APPROVAL','SUPPLY'] as const)('owner rejection of %s remains observation-only',async step=>fixture(async({model,service})=>{
   if(step==='SUPPLY')model.state.allowance=10000000n;let run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);await service.begin(run.id,SUPPLY_OWNER,workflow);run=await service.report(run.id,step,{kind:'REJECTED'});expect(run.error).toContain('REJECTED');
   await expect(service.begin(run.id,SUPPLY_OWNER,workflow)).rejects.toThrow('OBSERVE_ONLY');expect(model.transactions).toHaveLength(0);
 }));
 it('preserves a confirmed approval when the later Supply reverts',async()=>fixture(async({model,service})=>{
   let run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);
   const approval=await service.begin(run.id,SUPPLY_OWNER,workflow);const approvalHash=await model.rpc('MOCK_submit',[approval.transaction]) as string;
   await service.report(run.id,'APPROVAL',{kind:'HASH',hash:approvalHash});await service.observe(run.id);
   const supply=await service.begin(run.id,SUPPLY_OWNER,workflow);model.state.revert=true;
   const hash=await model.rpc('MOCK_submit',[supply.transaction]) as string;await service.report(run.id,'SUPPLY',{kind:'HASH',hash});run=await service.observe(run.id);
   expect(run.attempts[0]).toMatchObject({step:'APPROVAL',transactionHash:approvalHash,reconciled:true});expect(run.attempts[1]?.state).toBe('REVERTED');
   expect(run.observations.map(o=>o.verdict)).toEqual(['RECONCILED','DIVERGENT']);expect(run.evidence).toBeNull();
 }));
 it('rejects journal truncation or altered durable economic identity after restart',async()=>fixture(async({model,dir,service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);await service.begin(run.id,SUPPLY_OWNER,workflow);
   const path=join(dir,run.id+'.jsonl'),lines=(await readFile(path,'utf8')).trimEnd().split('\n');
   const latest=JSON.parse(lines.at(-1)!);latest.attempts[0].nonce='999';lines.push(JSON.stringify(latest));await writeFile(path,lines.join('\n')+'\n');
   const restarted=createSupplyService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});await expect(restarted.load(run.id)).rejects.toThrow('CORRUPT');expect(model.transactions).toHaveLength(0);
 }));

 it('bounds public read throttling retries without releasing a wallet request',async()=>{
   const dir=await mkdtemp(join(tmpdir(),'build012a-rpc-')),priorJournal=process.env.GRYLOO_SUPPLY_JOURNAL,priorHarness=process.env.GRYLOO_SUPPLY_HARNESS;
   const methods:string[]=[];process.env.GRYLOO_SUPPLY_JOURNAL=dir;delete process.env.GRYLOO_SUPPLY_HARNESS;
   vi.stubGlobal('fetch',async(url:string,request:{body:string})=>{
     expect(url).toBe(p.rpc);methods.push((JSON.parse(request.body) as {method:string}).method);
     return new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32005,message:'rate limited'}}),{status:429});
   });
   try{const {supplySimulate}=await import('../app/supply-action');expect(await supplySimulate(workflow,SUPPLY_OWNER)).toEqual({ok:false,code:'SUPPLY_RPC_RATE_LIMITED'});expect(methods).toEqual(['eth_chainId','eth_chainId','eth_chainId']);}
   finally{vi.unstubAllGlobals();if(priorJournal===undefined)delete process.env.GRYLOO_SUPPLY_JOURNAL;else process.env.GRYLOO_SUPPLY_JOURNAL=priorJournal;if(priorHarness===undefined)delete process.env.GRYLOO_SUPPLY_HARNESS;else process.env.GRYLOO_SUPPLY_HARNESS=priorHarness;await rm(dir,{recursive:true,force:true});}
 });

});
