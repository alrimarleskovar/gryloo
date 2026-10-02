// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLendingHarness,OWNER} from '../../e2e/lending-harness.mjs';
import {createAuthoredLending} from '../domain/lending-authoring';
import {createLendingCompositionService} from './lending-composition-service';
import {createSupplyService} from './supply-service';
import {createBorrowNode,createWithdrawNode,hashJournalBytes,type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
import {appendJournalState} from '@defi-workflow-engine/reference-executor';
import {wrappedAaveSetup} from '../../e2e/aave-wallet-fixtures';
import {repayModel} from '../../e2e/repay-fixtures';
import {AAVE_V3_BASE_SEPOLIA as p} from '@defi-workflow-engine/action-registry';
import {supplyHash,supplyArtifactHash,readLendingSnapshot} from '@defi-workflow-engine/reference-compiler';
import {verifyComposedLendingEffects,verifyLendingExport,buildLendingEvidence} from '@defi-workflow-engine/reference-reconciler';
const workflow=createAuthoredLending('lending',0,{supply:'0.1',borrow:'0.01',slippage:'50',owner:OWNER});
async function fixture(action:(f:{model:ReturnType<typeof createLendingHarness>;service:ReturnType<typeof createLendingCompositionService>;dir:string})=>Promise<void>){
  const dir=await mkdtemp(join(tmpdir(),'build013-')),model=createLendingHarness(),service=createLendingCompositionService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});
  try{await action({model,service,dir});}finally{await rm(dir,{recursive:true,force:true});}
}
async function authorized(service:ReturnType<typeof createLendingCompositionService>){const r=await service.simulate(workflow,OWNER);return service.review(r.id,r.reviews[0]!.commitment,workflow);}
async function step(service:ReturnType<typeof createLendingCompositionService>,model:ReturnType<typeof createLendingHarness>,id:string){
  const begin=await service.begin(id,OWNER,workflow);await service.handoff(id,begin.attemptId);const hash=await model.rpc('MOCK_submit',[begin.transaction]) as string;
  await service.report(id,begin.attemptId,{kind:'HASH',hash});return service.observe(id);
}
describe('BUILD-013 durable composition and economic outcome',()=>{
  it('never labels a public preflight or unproven attempt as TESTNET_EXECUTED evidence',()=>fixture(async({service})=>{
    const r=await authorized(service);
    expect(()=>buildLendingEvidence({id:r.id,reviews:r.reviews,journal:r.journal,observations:[],provenance:'PUBLIC_TESTNET',completed:false})).toThrow('PUBLIC_OWNER_EXECUTION_NOT_PROVEN');
  }));
  it('reuses a completed BUILD-012 EIP-7702 nonce only after fresh positive owner proof',()=>fixture(async({model})=>{
    const leaf:SemanticWorkflow={schemaVersion:'1.0.0',workflowId:'withdraw',revision:0,nodes:[createWithdrawNode('withdraw',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'5000',recipient:'CONNECTED_OWNER'})],resourceEdges:[]};
    const wrapped=await wrappedAaveSetup(model as unknown as ReturnType<typeof repayModel>,leaf);
    try{
      let prior=await wrapped.s.simulate(leaf,OWNER);prior=await wrapped.s.review(prior.id,prior.review.commitment,leaf);
      const begin=await wrapped.s.begin(prior.id,OWNER,leaf);await wrapped.s.handoff(prior.id,begin.step,true);
      const hash=await wrapped.rpc('MOCK_submit',[begin.transaction]) as string;await wrapped.s.report(prior.id,begin.step,{kind:'HASH',hash});prior=await wrapped.s.observe(prior.id);
      expect(prior.verdict).toBe('RECONCILED');expect(model.state.nonce).toBe(0);
      const composed=createLendingCompositionService({...wrapped.input,rpc:wrapped.rpc});const r=await authorized(composed);
      expect((await composed.begin(r.id,OWNER,workflow)).record.attempts[0]!.state).toBe('PREPARED');expect(model.transactions).toHaveLength(1);
    }finally{await rm(wrapped.input.journalDir,{recursive:true,force:true});}
  }));
  it('executes five exact owner calls, ordered receipts, conserved balances, scaled collateral/debt and honest MOCKED evidence',()=>fixture(async({model,service,dir})=>{
    let r=await authorized(service);const initial=await readLendingSnapshot(model.rpc,OWNER);
    for(const expected of ['POOL_APPROVAL','SUPPLY','BORROW','ROUTER_APPROVAL','SWAP']){
      r=await step(service,model,r.id);expect(r.attempts.at(-1)?.step).toBe(expected);expect(r.error).toBeNull();expect(r.attempts.at(-1)?.reconciled).toBe(true);
    }
    expect(r.status).toBe('COMPLETED');expect(r.evidence?.bundle.environment).toBe('MOCKED');expect(r.evidence?.bundle.outcome).toBe('RECONCILED');
    expect(BigInt(r.currentPosition!.aave.balance)).toBe(BigInt(initial.aave.balance)-100000n);expect(r.currentPosition!.aave.borrow!.debt).toBe('10000');expect(r.currentPosition!.wethBalance).toBe('10000000000000');
    expect(model.transactions).toHaveLength(5);await expect(service.begin(r.id,OWNER,workflow)).rejects.toThrow();
    const journal=await readFile(join(dir,r.id+'.jsonl'),'utf8');expect(journal).toContain('PREPARED');expect(journal).toContain('SUBMITTING');expect(journal).toContain('PENDING');expect(journal).toContain('CONFIRMED');
    await expect(verifyLendingExport(r.evidence!,model.rpc)).rejects.toThrow('PUBLIC_COMPOSED_OWNER_EVIDENCE_REQUIRED');
    // Exercise public archive validation with SYNTHETIC test data and the closed mock RPC only.
    // No public-shaped fixture is written to disk or claimed as public execution evidence.
    const archive=structuredClone(r.evidence!);archive.bundle.environment='TESTNET_EXECUTED';archive.composedExecution.provenance='PUBLIC_TESTNET';
    archive.bundle.evidence[0]!.contentHash=supplyHash(archive.composedExecution);archive.bundleHash=supplyArtifactHash('evidence-bundle',archive.bundle);
    expect((await verifyLendingExport(archive,model.rpc)).verdict).toBe('INDEPENDENTLY_RECONCILED');
    const forged=structuredClone(archive);forged.bundle.reconciliation.debt[0]!.amount='0';forged.bundleHash=supplyArtifactHash('evidence-bundle',forged.bundle);
    await expect(verifyLendingExport(forged,model.rpc)).rejects.toThrow('LENDING_EVIDENCE_EXPOSURE_MISMATCH');
    const wrongAsset=structuredClone(archive);wrongAsset.bundle.reconciliation.balances[0]!.asset={chainId:p.chain,address:'0x036cbd53842c5426634e7929541ec2318f3dcf7e',decimals:6};wrongAsset.bundleHash=supplyArtifactHash('evidence-bundle',wrongAsset.bundle);
    await expect(verifyLendingExport(wrongAsset,model.rpc)).rejects.toThrow('LENDING_EVIDENCE_ASSET_MISMATCH');
    const duplicate=structuredClone(archive),extra={level:'attempt' as const,entityId:r.id+'.BORROW.extra',segmentId:'lending-segment',stepId:'BORROW',executionAttemptId:r.id+'.BORROW.extra',recordedAt:new Date().toISOString()};
    duplicate.artifacts.journal=appendJournalState(duplicate.artifacts.journal,{...extra,toState:'PREPARED'}).journal;
    duplicate.artifacts.journal=appendJournalState(duplicate.artifacts.journal,{...extra,toState:'SUBMITTING'}).journal;
    duplicate.bundle.journalHeadHash=hashJournalBytes(new TextEncoder().encode(JSON.stringify(duplicate.artifacts.journal))).at(-1)!;duplicate.bundleHash=supplyArtifactHash('evidence-bundle',duplicate.bundle);
    await expect(verifyLendingExport(duplicate,model.rpc)).rejects.toThrow('LENDING_JOURNAL_SUBMISSION_MISMATCH');

    const damaged=structuredClone(r.evidence!.composedExecution.observations);damaged[2]!.post!.aave.balance='1';expect(()=>verifyComposedLendingEffects(r.reviews[0]!,damaged)).toThrow();
  }));
  it.each(['poolAvailable','swapAvailable','simulationAvailable'] as const)('blocks before first owner request when %s becomes unavailable',key=>fixture(async({model,service})=>{
    const r=await authorized(service);model.state[key]=false;await expect(service.begin(r.id,OWNER,workflow)).rejects.toThrow();expect(model.transactions).toHaveLength(0);expect((await service.load(r.id)).attempts).toHaveLength(0);
  }));
  it('rechecks complete path at handoff and cancels only positive PREPARED absence',()=>fixture(async({model,service})=>{
    let r=await authorized(service);const b=await service.begin(r.id,OWNER,workflow);model.state.swapAvailable=false;
    await expect(service.handoff(r.id,b.attemptId)).rejects.toThrow();expect((await service.load(r.id)).attempts[0]!.state).toBe('PREPARED');
    r=await service.cancelPrepared(r.id,b.attemptId);expect(r.attempts[0]!.notSubmitted).toBe(true);expect(model.transactions).toHaveLength(0);
    model.state.swapAvailable=true;r=await service.refreshReview(r.id);r=await service.review(r.id,r.reviews.at(-1)!.commitment,workflow);await step(service,model,r.id);
  }));
  it('retains two historical cancellations through reload and fresh Review, then permits exactly one new POOL_APPROVAL preparation',()=>fixture(async({model,service,dir})=>{
    let r=await authorized(service);
    for(let i=0;i<2;i++){
      const b=await service.begin(r.id,OWNER,workflow);r=await service.cancelPrepared(r.id,b.attemptId);
      expect(r.attempts.at(-1)).toMatchObject({step:'POOL_APPROVAL',state:'CANCELLED',notSubmitted:true,hash:null});
      r=await service.refreshReview(r.id);r=await service.review(r.id,r.reviews.at(-1)!.commitment,workflow);
    }
    const before=await readFile(join(dir,r.id+'.jsonl'),'utf8'),oldAttempts=structuredClone(r.attempts);
    const restarted=createLendingCompositionService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});
    r=await restarted.refreshReview(r.id);expect(r.authorization).toBeNull();
    r=await restarted.review(r.id,r.reviews.at(-1)!.commitment,workflow);
    const b=await restarted.begin(r.id,OWNER,workflow);
    expect(b.record.attempts.slice(0,2)).toEqual(oldAttempts);
    expect(b.record.attempts.at(-1)).toMatchObject({step:'POOL_APPROVAL',state:'PREPARED'});expect(b.record.attempts.at(-1)!.notSubmitted).not.toBe(true);
    expect((await readFile(join(dir,r.id+'.jsonl'),'utf8')).startsWith(before)).toBe(true);
    await expect(restarted.begin(r.id,OWNER,workflow)).rejects.toThrow();
    expect(model.transactions).toHaveLength(0);
  }));
  it.each(['POOL_APPROVAL','SUPPLY','BORROW','ROUTER_APPROVAL','SWAP'])('restart observes an unknown %s without a second submission',target=>fixture(async({model,service,dir})=>{
    let r=await authorized(service);
    while(r.reviews[0]!.calls.find(c=>!r.attempts.some(a=>a.step===c.id&&a.reconciled))?.id!==target)r=await step(service,model,r.id);
    const b=await service.begin(r.id,OWNER,workflow);await service.handoff(r.id,b.attemptId);const hash=await model.rpc('MOCK_submit',[b.transaction]);await service.report(r.id,b.attemptId,{kind:'UNKNOWN'});
    const count=model.transactions.length,restarted=createLendingCompositionService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});
    await expect(restarted.begin(r.id,OWNER,workflow)).rejects.toThrow();r=await restarted.observe(r.id);
    expect(r.attempts.at(-1)?.hash).toBe(hash);expect(r.attempts.at(-1)?.reconciled).toBe(true);expect(model.transactions).toHaveLength(count);
  }));
  it('unknown unobserved submission is permanently observation-only, including fresh IDs/revisions and corrupt advanced nonce',()=>fixture(async({model,service})=>{
    const r=await authorized(service),b=await service.begin(r.id,OWNER,workflow);await service.handoff(r.id,b.attemptId);await service.report(r.id,b.attemptId,{kind:'UNKNOWN'});
    await expect(service.refreshReview(r.id)).rejects.toThrow('LENDING_RECOVERY_OBSERVE_ONLY');await service.observe(r.id);await expect(service.begin(r.id,OWNER,workflow)).rejects.toThrow();
    model.state.nonce=42;const other=await authorized(service);await expect(service.begin(other.id,OWNER,workflow)).rejects.toThrow('ECONOMIC_EXISTING_INTENT_OBSERVE_ONLY');expect(model.transactions).toHaveLength(0);
  }));
  it('a fresh Review accepts price drift while prior authority fails closed and principal is unchanged',()=>fixture(async({model,service})=>{
    let r=await authorized(service);model.state.price=110000000n;
    await expect(service.begin(r.id,OWNER,workflow)).rejects.toThrow('LENDING_REVIEW_STALE');const commitment=r.reviews[0]!.commitment;
    r=await service.refreshReview(r.id);expect(r.authorization).toBeNull();expect(r.reviews.at(-1)!.commitment).not.toBe(commitment);
    r=await service.review(r.id,r.reviews.at(-1)!.commitment,workflow);await step(service,model,r.id);
  }));
  it('initial zero collateral is supplied and collateral enabled before Borrow; simulated reserve liquidity propagates',()=>fixture(async({model,service})=>{
    model.state.scaled=0n;model.state.userConfig=0n;model.state.liquidity=0n;model.history.set(model.state.block,{...model.state});
    let r=await authorized(service);for(let i=0;i<5;i++)r=await step(service,model,r.id);expect(r.status).toBe('COMPLETED');expect(r.currentPosition!.aave.borrow!.debt).toBe('10000');
  }));
  it('duplicate Execute races release only one durable PREPARED call',()=>fixture(async({model,service})=>{
    const r=await authorized(service),results=await Promise.allSettled([service.begin(r.id,OWNER,workflow),service.begin(r.id,'0x'+OWNER.slice(2).toUpperCase(),workflow)]);
    expect(results.filter(v=>v.status==='fulfilled')).toHaveLength(1);expect((await service.load(r.id)).attempts).toHaveLength(1);expect(model.transactions).toHaveLength(0);
  }));
  it('Borrow success / route disappearance exposes debt, residual USDC, HF and allowance without repeating prior steps; explicit fresh continuation only',()=>fixture(async({model,service})=>{
    let r=await authorized(service);for(let i=0;i<3;i++)r=await step(service,model,r.id);
    model.state.swapAvailable=false;await expect(service.begin(r.id,OWNER,workflow)).rejects.toThrow();r=await service.observe(r.id);
    expect(r.currentPosition!.aave.borrow!.debt).toBe('10000');expect(r.status).toBe('PARTIALLY_COMPLETED');expect(r.evidence?.composedExecution.completed).toBe(false);expect(model.transactions).toHaveLength(3);
    model.state.swapAvailable=true;r=await service.refreshReview(r.id);expect(r.authorization).toBeNull();expect(r.reviews.at(-1)!.calls.map(c=>c.id)).toEqual(['ROUTER_APPROVAL','SWAP']);
    await expect(service.begin(r.id,OWNER,workflow)).rejects.toThrow();r=await service.review(r.id,r.reviews.at(-1)!.commitment,workflow);r=await step(service,model,r.id);r=await step(service,model,r.id);expect(r.status).toBe('COMPLETED');
  }));
  it('failed Swap retains debt and router allowance; no retry, no compensation, no false composed success',()=>fixture(async({model,service})=>{
    let r=await authorized(service);for(let i=0;i<4;i++)r=await step(service,model,r.id);
    const b=await service.begin(r.id,OWNER,workflow);await service.handoff(r.id,b.attemptId);model.state.revert=true;const hash=await model.rpc('MOCK_submit',[b.transaction]) as string;
    await service.report(r.id,b.attemptId,{kind:'HASH',hash});r=await service.observe(r.id);expect(r.status).toBe('PARTIALLY_COMPLETED');expect(r.evidence?.bundle.outcome).toBe('DIVERGENT');
    expect(r.evidence?.bundle.reconciliation.debt[0]?.amount).toBe('10000');expect(r.currentPosition!.routerAllowance).toBe('10000');expect(r.currentPosition!.wethBalance).toBe('0');
    await expect(service.refreshReview(r.id)).rejects.toThrow();await expect(service.begin(r.id,OWNER,workflow)).rejects.toThrow();await service.observe(r.id);expect(model.transactions).toHaveLength(5);
  }));
  it('cross-entry isolated Borrow cannot duplicate reserved composed Borrow even with a changed nonce',()=>fixture(async({model,service,dir})=>{
    const r=await authorized(service);await service.begin(r.id,OWNER,workflow);model.state.nonce=99;
    const leaf:SemanticWorkflow={schemaVersion:'1.0.0',workflowId:'other',revision:0,nodes:[createBorrowNode('borrow',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'10000',beneficiary:OWNER,interestRateMode:2})],resourceEdges:[]};
    const isolated=createSupplyService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});let other=await isolated.simulate(leaf,OWNER);other=await isolated.review(other.id,other.review.commitment,leaf);
    await expect(isolated.begin(other.id,OWNER,leaf)).rejects.toThrow('ECONOMIC_EXISTING_INTENT_OBSERVE_ONLY');expect(model.transactions).toHaveLength(0);
  }));
  it('durable corruption and workflow edits cannot resurrect financial authority',()=>fixture(async({service,dir})=>{
    const r=await authorized(service);await service.invalidate(r.id);await expect(service.begin(r.id,OWNER,workflow)).rejects.toThrow();
    const file=join(dir,r.id+'.jsonl'),lines=(await readFile(file,'utf8')).trimEnd().split('\n'),last=JSON.parse(lines.at(-1)!);last.reviews[0].fields.borrowAmount='999';last.reviews[0].commitment=supplyHash(last.reviews[0]);
    await writeFile(file,lines.slice(0,-1).join('\n')+'\n'+JSON.stringify(last)+'\n');await expect(service.load(r.id)).rejects.toThrow('LENDING_STORE_CORRUPT');
  }));
  it('validates changed historical bytes after a warm load and after restart, and keeps its cached predecessor private',()=>fixture(async({model,service,dir})=>{
    let r=await authorized(service);r=await step(service,model,r.id);
    const file=join(dir,r.id+'.jsonl'),original=await readFile(file,'utf8'),lines=original.trimEnd().split('\n');
    const loaded=await service.load(r.id);loaded.reviews[0]!.fields.borrowAmount='999';loaded.attempts[0]!.nonce='99';
    expect((await service.load(r.id)).reviews[0]!.fields.borrowAmount).toBe('10000');
    const first=JSON.parse(lines[0]!);first.reviews[0].fields.borrowAmount='999';
    await writeFile(file,JSON.stringify(first)+'\n'+lines.slice(1).join('\n')+'\n');
    await expect(service.load(r.id)).rejects.toThrow('LENDING_STORE_CORRUPT');
    const restarted=createLendingCompositionService({rpc:model.rpc,journalDir:dir,provenance:'MOCKED'});
    await expect(restarted.load(r.id)).rejects.toThrow('LENDING_STORE_CORRUPT');
    await writeFile(file,original);
    // Rejected bytes never become a trusted prefix, and a valid append still works.
    r=await step(service,model,r.id);expect(r.attempts.at(-1)?.step).toBe('SUPPLY');expect(r.attempts.at(-1)?.reconciled).toBe(true);
    expect((await restarted.load(r.id)).attempts).toHaveLength(2);
    // A newly appended, individually valid snapshot cannot alter a prior attempt.
    const changed=structuredClone(r);changed.attempts[0]!.nonce='99';
    await writeFile(file,(await readFile(file,'utf8'))+JSON.stringify(changed)+'\n');
    await expect(service.load(r.id)).rejects.toThrow('LENDING_STORE_CORRUPT');
    await expect(restarted.load(r.id)).rejects.toThrow('LENDING_STORE_CORRUPT');
  }));
});
