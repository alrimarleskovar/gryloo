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
     const durable=await readFile(join(dir,run.id+'.jsonl'),'utf8');expect(durable).toContain('PREPARED');expect(JSON.parse(durable.trim().split('\n').at(-1)!).attempts.at(-1).state).toBe('PREPARED');expect(durable).toContain(begin.transaction.data);
     await service.handoff(run.id,begin.step);const hash=await model.rpc('MOCK_submit',[begin.transaction]) as string;await service.report(run.id,begin.step,{kind:'HASH',hash});run=await service.observe(run.id);
   }
   expect(run.verdict).toBe('RECONCILED');expect(run.evidence?.bundle.environment).toBe('MOCKED');expect(run.attempts).toHaveLength(2);expect(model.transactions).toHaveLength(2);
   await expect(service.begin(run.id,SUPPLY_OWNER,workflow)).rejects.toThrow();expect(model.transactions).toHaveLength(2);
 }));
 it.each(['APPROVAL','SUPPLY'] as const)('restart recovers uncertain %s without duplicate intent',async step=>fixture(async({model,dir,service})=>{
   if(step==='SUPPLY')model.state.allowance=10000000n;
   let run=await service.simulate(workflow,SUPPLY_OWNER);run=await service.review(run.id,run.review.commitment,workflow);const begin=await service.begin(run.id,SUPPLY_OWNER,workflow);
   await service.handoff(run.id,begin.step);const hash=await model.rpc('MOCK_submit',[begin.transaction]);await service.report(run.id,step,{kind:'UNKNOWN'});
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
   model.state.revert=true;await service.handoff(run.id,begin.step);const hash=await model.rpc('MOCK_submit',[begin.transaction]) as string;await service.report(run.id,step,{kind:'HASH',hash});run=await service.observe(run.id);expect(run.verdict).toBe('DIVERGENT');expect(run.evidence).toBeNull();expect(run.attempts[0]?.state).toBe('REVERTED');expect((await service.report(run.id,step,{kind:'HASH',hash})).attempts[0]?.state).toBe('REVERTED');
 }));
 it('semantic invalidation and stale/replaced reviews fail closed',async()=>fixture(async({service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await expect(service.review(run.id,'0x'+'a'.repeat(64),workflow)).rejects.toThrow('REPLACED');
   await service.review(run.id,run.review.commitment,workflow);await expect(service.begin(run.id,SUPPLY_OWNER,{...workflow,revision:1})).rejects.toThrow('STALE');await service.invalidate(run.id);await expect(service.begin(run.id,SUPPLY_OWNER,workflow)).rejects.toThrow('REVIEW_REQUIRED');
 }));
 it.each(['APPROVAL','SUPPLY'] as const)('owner rejection of %s remains observation-only',async step=>fixture(async({model,service})=>{
   if(step==='SUPPLY')model.state.allowance=10000000n;let run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);await service.begin(run.id,SUPPLY_OWNER,workflow);await service.handoff(run.id,step);run=await service.report(run.id,step,{kind:'REJECTED'});expect(run.error).toContain('REJECTED');
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

 it('records bounded NOT_FOUND without claiming non-broadcast, then prepares a read-only fresh review for the same nonce',async()=>fixture(async({model,dir,service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);
   const original=await service.begin(run.id,SUPPLY_OWNER,workflow);await service.handoff(run.id,'APPROVAL');await service.report(run.id,'APPROVAL',{kind:'UNKNOWN',code:'SUPPLY_WALLET_SUBMISSION_RESULT_UNKNOWN'});
   model.state.block=200;const absent=await service.observe(run.id);
   expect(absent.absence).toMatchObject({outcome:'NOT_FOUND',latestNonce:'0',pendingNonce:'0',allowance:'0'});
   expect(absent.attempts[0]?.state).toBe('SUBMISSION_RESULT_UNKNOWN');expect(absent.authorization).toBeNull();expect(absent.evidence).toBeNull();
   const restarted=createSupplyService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});expect((await restarted.load(run.id)).submissionError).toBe('SUPPLY_WALLET_SUBMISSION_RESULT_UNKNOWN');
   const fresh=await restarted.recoverReview(run.id);expect(fresh.recoveryOf).toBe(run.id);expect(fresh.attempts).toEqual([]);expect(fresh.ownerInitiated).toBe(false);expect(fresh.authorization).toBeNull();
   await expect(restarted.begin(fresh.id,SUPPLY_OWNER,workflow)).rejects.toThrow('REVIEW_REQUIRED');
   await restarted.review(fresh.id,fresh.review.commitment,workflow);const retry=await restarted.begin(fresh.id,SUPPLY_OWNER,workflow);
   expect(retry.transaction).toEqual(original.transaction);await expect(restarted.handoff(fresh.id,'APPROVAL',true)).rejects.toThrow('RECOVERY_NOT_AVAILABLE');expect(model.transactions).toHaveLength(0);
   const lease=(await readFile(join(dir,SUPPLY_OWNER+'-0.intent'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));expect(lease.map(l=>l.id)).toEqual([run.id,fresh.id]);
   const hash=await model.rpc('MOCK_submit',[retry.transaction]) as string;await restarted.report(fresh.id,'APPROVAL',{kind:'HASH',hash});expect((await restarted.observe(fresh.id)).attempts[0]?.reconciled).toBe(true);expect(model.transactions).toHaveLength(1);
 }));
 it('never makes recovery available before the observation bound, when nonce advances, or when allowance changes',async()=>fixture(async({model,service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);await service.begin(run.id,SUPPLY_OWNER,workflow);await service.handoff(run.id,'APPROVAL');
   expect((await service.observe(run.id)).absence).toBeUndefined();await expect(service.recoverReview(run.id)).rejects.toThrow('NOT_AVAILABLE');
   model.state.block=200;model.state.nonce=1;expect((await service.observe(run.id)).absence).toBeUndefined();
   model.state.nonce=0;model.state.allowance=10000000n;expect((await service.observe(run.id)).absence).toBeUndefined();
   model.state.allowance=0n;await service.observe(run.id);model.state.nonce=1;
   await expect(service.recoverReview(run.id)).rejects.toThrow('STATE_CHANGED');expect(model.transactions).toHaveLength(0);
 }));
 it('serializes competing explicit retries and retains the original lease bytes, including the legacy single-line format',async()=>fixture(async({model,dir,service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);await service.begin(run.id,SUPPLY_OWNER,workflow);await service.handoff(run.id,'APPROVAL');
   const leasePath=join(dir,SUPPLY_OWNER+'-0.intent'),legacy=(await readFile(leasePath,'utf8')).trim();await writeFile(leasePath,legacy);
   model.state.block=200;await service.observe(run.id);const a=await service.recoverReview(run.id),b=await service.recoverReview(run.id);
   await service.review(a.id,a.review.commitment,workflow);await service.review(b.id,b.review.commitment,workflow);
   const results=await Promise.allSettled([service.begin(a.id,SUPPLY_OWNER,workflow),service.begin(b.id,SUPPLY_OWNER,workflow)]);
   expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
   expect((await readFile(leasePath,'utf8')).startsWith(legacy+'\n')).toBe(true);expect(model.transactions).toHaveLength(0);
 }));
 it('still reconciles the ORIGINAL attempt if its exact transaction appears after a NOT_FOUND observation',async()=>fixture(async({model,service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);const begin=await service.begin(run.id,SUPPLY_OWNER,workflow);
   await service.handoff(run.id,begin.step);model.state.block=200;await service.observe(run.id);const hash=await model.rpc('MOCK_submit',[begin.transaction]) as string;
   await service.report(run.id,'APPROVAL',{kind:'HASH',hash});const observed=await service.observe(run.id);
   expect(observed.attempts[0]?.reconciled).toBe(true);expect(observed.absence?.outcome).toBe('NOT_FOUND');expect(observed.error).toBeNull();
   await expect(service.recoverReview(run.id)).rejects.toThrow('NOT_AVAILABLE');expect(model.transactions).toHaveLength(1);
 }));
 it.each(['latest','pending'])('does not classify absence when only the %s nonce has advanced',async advanced=>fixture(async({model,dir,service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);await service.begin(run.id,SUPPLY_OWNER,workflow);await service.handoff(run.id,'APPROVAL');model.state.block=200;
   const observer=createSupplyService({journalDir:dir,provenance:'MOCKED',rpc:(method,params)=>method==='eth_getTransactionCount'&&params[1]===advanced?Promise.resolve('0x1'):model.rpc(method,params)});
   expect((await observer.observe(run.id)).absence).toBeUndefined();await expect(observer.recoverReview(run.id)).rejects.toThrow('NOT_AVAILABLE');expect(model.transactions).toHaveLength(0);
 }));
 it('never transfers the original nonce lease to different financial semantics',async()=>fixture(async({model,dir,service})=>{
   const original=await service.simulate(workflow,SUPPLY_OWNER);await service.review(original.id,original.review.commitment,workflow);await service.begin(original.id,SUPPLY_OWNER,workflow);await service.handoff(original.id,'APPROVAL');model.state.block=200;await service.observe(original.id);
   const changed={...workflow,revision:1,nodes:[createSupplyNode('supply',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'20000000',beneficiary:SUPPLY_OWNER})]};
   const unrelated=await service.simulate(changed,SUPPLY_OWNER),path=join(dir,unrelated.id+'.jsonl');
   // Even a forged linkage in an initial record cannot grant a different economic intent.
   await writeFile(path,JSON.stringify({...unrelated,recoveryOf:original.id})+'\n');await service.review(unrelated.id,unrelated.review.commitment,changed);
   await expect(service.begin(unrelated.id,SUPPLY_OWNER,changed)).rejects.toThrow('NONCE_ALREADY_RESERVED');expect(model.transactions).toHaveLength(0);
 }));

 it('positive pre-send failure retains the lease and diagnostics, while a fresh review keeps exactly the same intent',async()=>fixture(async({model,dir,service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);const begin=await service.begin(run.id,SUPPLY_OWNER,workflow);
   const diagnostic={invoked:false,transaction:begin.transaction,calls:[{method:'eth_accounts',params:[],result:[SUPPLY_OWNER]}],error:{code:4900,message:'Disconnected',data:{phase:'preflight'},cause:{message:'Transport'}},code:'SUPPLY_RPC_ERROR_BEFORE_WALLET_SUBMISSION'};
   const failed=await service.walletFailure(run.id,diagnostic);expect(failed.notSubmitted).toBe(true);expect(failed.attempts[0]?.state).toBe('CANCELLED');expect(failed.journal.entries.some(e=>e.toState==='SUBMISSION_RESULT_UNKNOWN')).toBe(false);expect(failed.authorization).toBeNull();expect(failed.evidence).toBeNull();
   const restarted=createSupplyService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});expect((await restarted.load(run.id)).walletDiagnostic).toEqual(diagnostic);
   const fresh=await restarted.recoverReview(run.id);await restarted.review(fresh.id,fresh.review.commitment,workflow);const retry=await restarted.begin(fresh.id,SUPPLY_OWNER,workflow);expect(retry.transaction).toEqual(begin.transaction);expect(model.transactions).toHaveLength(0);
   expect((await readFile(join(dir,SUPPLY_OWNER+'-0.intent'),'utf8')).trim().split('\n')).toHaveLength(2);
 }));
 it('an invoked send can never be classified as a positive pre-submission failure',async()=>fixture(async({service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);const begin=await service.begin(run.id,SUPPLY_OWNER,workflow);
   for(const diagnostic of [{invoked:true,calls:[]},{invoked:false,calls:[{method:'WALLET_SUBMISSION',submission:true,params:[begin.transaction]}]}])await expect(service.walletFailure(run.id,{...diagnostic,transaction:begin.transaction,error:null,code:'SUPPLY_WALLET_NOT_SUBMITTED'})).rejects.toThrow('NOT_PRE_SUBMISSION');
   expect((await service.load(run.id)).attempts[0]?.state).toBe('PREPARED');
 }));
 it('legacy guard diagnostics prove no wallet submission invocation and are reclassified only after current nonce/allowance verification',async()=>fixture(async({model,service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);await service.begin(run.id,SUPPLY_OWNER,workflow);
   await service.handoff(run.id,'APPROVAL');await service.report(run.id,'APPROVAL',{kind:'UNKNOWN',code:'SUPPLY_WALLET_OR_AUTHORIZATION_CHANGED'});
   model.state.nonce=1;expect((await service.observe(run.id)).notSubmitted).toBeUndefined();model.state.nonce=0;
   const observed=await service.observe(run.id);expect(observed.notSubmitted).toBe(true);expect(observed.attempts[0]?.state).toBe('NOT_FOUND');expect(observed.walletDiagnostic?.invoked).toBe(false);expect(observed.evidence).toBeNull();
 }));

 it('restart before wallet handoff cancels preparation without ever recording submission uncertainty',async()=>fixture(async({model,dir,service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);await service.begin(run.id,SUPPLY_OWNER,workflow);
   const restarted=createSupplyService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'}),observed=await restarted.observe(run.id);
   expect(observed.notSubmitted).toBe(true);expect(observed.attempts[0]?.state).toBe('CANCELLED');expect(observed.journal.entries.some(e=>e.toState==='SUBMISSION_RESULT_UNKNOWN')).toBe(false);
   expect((await restarted.recoverReview(run.id)).attempts).toEqual([]);expect(model.transactions).toHaveLength(0);
 }));
 it('wallet refusal is proven by the direct provider response; disconnection after invocation stays uncertain',async()=>fixture(async({service})=>{
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);const begin=await service.begin(run.id,SUPPLY_OWNER,workflow);await service.handoff(run.id,'APPROVAL');
   const diagnostic={invoked:true,transaction:begin.transaction,calls:[{method:'WALLET_SUBMISSION',submission:true,params:[begin.transaction],error:{code:4900,message:'Disconnected'}}],error:{code:4900},code:'SUPPLY_WALLET_REQUEST_REFUSED',rejectionCode:4900};
   await expect(service.walletFailure(run.id,diagnostic)).rejects.toThrow('NOT_PRE_SUBMISSION');
   const refused={...diagnostic,rejectionCode:-32602,calls:[{...diagnostic.calls[0]!,error:{code:-32602,message:'Invalid transaction params'}}]};
   const failed=await service.walletFailure(run.id,refused);expect(failed.notSubmitted).toBe(true);expect(failed.attempts[0]?.state).toBe('NOT_FOUND');expect(failed.evidence).toBeNull();
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

 it.each(['APPROVAL','SUPPLY'] as const)('wallet-managed nonce keeps uncertain %s observation-only after restart and bounded absence',async step=>fixture(async({model,dir,service})=>{
   if(step==='SUPPLY')model.state.allowance=10000000n;
   const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);await service.begin(run.id,SUPPLY_OWNER,workflow);
   await service.handoff(run.id,step,true);await service.report(run.id,step,{kind:'UNKNOWN'});model.state.block=200;
   const restarted=createSupplyService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});const observed=await restarted.observe(run.id);
   expect(observed.walletManagedNonce).toBe(true);expect(observed.absence).toBeUndefined();expect(observed.attempts[0]?.state).toBe('SUBMISSION_RESULT_UNKNOWN');
   await expect(restarted.recoverReview(run.id)).rejects.toThrow('NOT_AVAILABLE');await expect(restarted.begin(run.id,SUPPLY_OWNER,workflow)).rejects.toThrow('OBSERVE_ONLY');expect(model.transactions).toHaveLength(0);
 }));
 it('wallet-managed handoff preserves a confirmed hash and observes the actual nonce without duplicate approval',async()=>fixture(async({model,dir,service})=>{
   model.state.nonce=3;const run=await service.simulate(workflow,SUPPLY_OWNER);await service.review(run.id,run.review.commitment,workflow);const begin=await service.begin(run.id,SUPPLY_OWNER,workflow);await service.handoff(run.id,'APPROVAL',true);
   const hash=await model.rpc('MOCK_submit',[begin.transaction]) as string;await service.report(run.id,'APPROVAL',{kind:'HASH',hash});
   const restarted=createSupplyService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});const observed=await restarted.observe(run.id);
   expect(observed.attempts[0]?.reconciled).toBe(true);expect(observed.attempts[0]?.nonce).toBe('3');expect(model.transactions[0]?.nonce).toBe('0x3');expect(model.state.allowance).toBe(10000000n);expect(model.transactions).toHaveLength(1);
 }));

});
