// SPDX-License-Identifier: AGPL-3.0-only
import { describe,it,expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupplyService } from './supply-service';
import { repayModel,repayWorkflow,REPAY_OWNER } from '../../e2e/repay-fixtures';
import { supplyCall,supplyTopic,supplyWord,AAVE_V3_BASE_SEPOLIA as p } from '@defi-workflow-engine/reference-compiler';
async function setup(allowance=0n){const m=repayModel();m.state.allowance=allowance;m.history.set(10,{...m.state});const input={rpc:m.rpc,journalDir:await mkdtemp(join(tmpdir(),'gryloo-repay-test-')),provenance:'MOCKED' as const};return {m,input,s:createSupplyService(input)};}
async function prepare(s:ReturnType<typeof createSupplyService>){const r=await s.simulate(repayWorkflow(),REPAY_OWNER);await s.review(r.id,r.review.commitment,repayWorkflow());return s.begin(r.id,REPAY_OWNER,repayWorkflow());}
async function submit(f:Awaited<ReturnType<typeof setup>>,b:Awaited<ReturnType<typeof prepare>>){await f.s.handoff(b.record.id,b.step,true);const hash=await f.m.rpc('MOCK_submit',[b.transaction]) as string;await f.s.report(b.record.id,b.step,{kind:'HASH',hash});return f.s.observe(b.record.id);}
describe('durable Repay owner execution and independent reconciliation',()=>{
  it('reconciles exact approval then partial Repay, only producing MOCKED evidence',async()=>{
    const f=await setup(),a=await prepare(f.s);expect(a.step).toBe('APPROVAL');expect(a.record.attempts[0]!.state).toBe('PREPARED');expect((await createSupplyService(f.input).load(a.record.id)).attempts).toHaveLength(1);
    const approved=await submit(f,a);expect(approved.verdict).toBe('PENDING');expect(approved.attempts[0]!.reconciled).toBe(true);expect(f.m.state.allowance).toBe(5000n);
    const b=await createSupplyService(f.input).begin(a.record.id,REPAY_OWNER,repayWorkflow());expect(b.step).toBe('REPAY');const o=await submit(f,b);
    expect(o.verdict).toBe('RECONCILED');expect(o.evidence?.bundle).toMatchObject({environment:'MOCKED',outcome:'RECONCILED'});expect(o.evidence?.bundle.receipts).toHaveLength(2);
    expect(o.evidence?.publicExecution).toMatchObject({amount:'5000',rateMode:2,walletDelta:'-5000',preAllowance:'5000',postAllowance:'0',ownerAuthorization:{kind:'DIRECT_EIP1559',owner:REPAY_OWNER}});
    expect(f.m.state.balance).toBe(5000n);expect(f.m.transactions).toHaveLength(2);await expect(f.s.begin(b.record.id,REPAY_OWNER,repayWorkflow())).rejects.toThrow();
  });
  it.each(['APPROVAL','REPAY'] as const)('lost %s response recovers across restart without another submission',async step=>{
    const f=await setup(step==='REPAY'?5000n:0n),b=await prepare(f.s);await f.s.handoff(b.record.id,b.step,true);await f.m.rpc('MOCK_submit',[b.transaction]);await f.s.report(b.record.id,b.step,{kind:'UNKNOWN'});
    const restarted=createSupplyService(f.input),o=await restarted.observe(b.record.id);expect(o.attempts[0]!.reconciled).toBe(true);expect(f.m.transactions).toHaveLength(1);if(step==='REPAY')await expect(restarted.recoverReview(b.record.id)).rejects.toThrow('OBSERVE_ONLY');else expect((await restarted.recoverReview(b.record.id)).review.approvalRequired).toBe(false);
  });
  it.each(['APPROVAL','REPAY'] as const)('unknown %s cannot be duplicated under new metadata or nonce',async step=>{
    const f=await setup(step==='REPAY'?5000n:0n),b=await prepare(f.s);await f.s.handoff(b.record.id,b.step,true);await f.s.report(b.record.id,b.step,{kind:'UNKNOWN'});await expect(f.s.recoverReview(b.record.id)).rejects.toThrow('OBSERVE_ONLY');
    f.m.state.nonce=1;const w={...repayWorkflow(),workflowId:'reauthored',revision:7},r=await f.s.simulate(w,REPAY_OWNER);await f.s.review(r.id,r.review.commitment,w);await expect(f.s.begin(r.id,REPAY_OWNER,w)).rejects.toThrow('REPAY_EXISTING_INTENT_OBSERVE_ONLY');expect(f.m.transactions).toHaveLength(0);
  });
  it('approval consumption cannot bypass a lease held by an uncertain Repay',async()=>{
    const f=await setup(),a=await prepare(f.s);await submit(f,a);const b=await f.s.begin(a.record.id,REPAY_OWNER,repayWorkflow());await f.s.handoff(b.record.id,'REPAY',true);await f.s.report(b.record.id,'REPAY',{kind:'UNKNOWN'});
    f.m.state.nonce=2;const r=await f.s.simulate(repayWorkflow(),REPAY_OWNER);expect(r.review.approvalRequired).toBe(false);await f.s.review(r.id,r.review.commitment,repayWorkflow());await expect(f.s.begin(r.id,REPAY_OWNER,repayWorkflow())).rejects.toThrow('REPAY_EXISTING_INTENT_OBSERVE_ONLY');
  });
  it.each(['APPROVAL','REPAY'] as const)('known %s refusal permits a fresh explicit Review of the same intent',async step=>{
    const f=await setup(step==='REPAY'?5000n:0n),b=await prepare(f.s);await f.s.handoff(b.record.id,b.step,true);await f.s.walletFailure(b.record.id,{invoked:true,rejectionCode:4001,transaction:b.transaction,calls:[{method:'eth_sendTransaction',submission:true,params:[b.transaction],error:{code:4001}}],error:{code:4001},code:'SUPPLY_REJECTED'});
    const r=await createSupplyService(f.input).recoverReview(b.record.id);expect(r.authorization).toBeNull();await f.s.review(r.id,r.review.commitment,repayWorkflow());const fresh=await f.s.begin(r.id,REPAY_OWNER,repayWorkflow());expect(fresh.transaction).toEqual(b.transaction);expect(f.m.transactions).toHaveLength(0);
  });
  it('refreshes an expired Review after independently confirmed approval without repeating it',async()=>{
    const f=await setup(),a=await prepare(f.s);await submit(f,a);const r=await createSupplyService(f.input).recoverReview(a.record.id);expect(r.review.approvalRequired).toBe(false);expect(r.priorApproval?.runId).toBe(a.record.id);await f.s.review(r.id,r.review.commitment,repayWorkflow());const b=await f.s.begin(r.id,REPAY_OWNER,repayWorkflow());expect(b.step).toBe('REPAY');const o=await submit(f,b);expect(o.verdict).toBe('RECONCILED');expect(o.evidence?.bundle.receipts).toHaveLength(2);expect(f.m.transactions).toHaveLength(2);
  });
  it('known Repay refusal after approval preserves the proof and recovers without duplicate approval',async()=>{
    const f=await setup(),a=await prepare(f.s);await submit(f,a);const b=await f.s.begin(a.record.id,REPAY_OWNER,repayWorkflow());await f.s.walletFailure(b.record.id,{invoked:false,transaction:null,calls:[],error:{message:'Preflight failed'},code:'SUPPLY_RPC_ERROR_BEFORE_WALLET_SUBMISSION'});
    const r=await f.s.recoverReview(b.record.id);expect(r.review.approvalRequired).toBe(false);await f.s.review(r.id,r.review.commitment,repayWorkflow());expect((await f.s.begin(r.id,REPAY_OWNER,repayWorkflow())).step).toBe('REPAY');expect(f.m.transactions).toHaveLength(1);
  });
  it('fresh debt mutation invalidates handoff after durable preparation',async()=>{
    const f=await setup(),b=await prepare(f.s);f.m.state.scaledDebt+=1n;await expect(f.s.handoff(b.record.id,b.step,true)).rejects.toThrow('REPAY_AUTHORIZATION_STALE');expect(f.m.transactions).toHaveLength(0);
  });
  it.each(['signature','wallet','debt','allowance','collateral','event','amount','mode','owner','pool','unexpected movement','native movement','nonce','revert'])('fails closed for %s after submission',async kind=>{
    const f=await setup(5000n),b=await prepare(f.s);await f.s.handoff(b.record.id,'REPAY',true);if(kind==='revert')f.m.state.revert=true;
    const hash=await f.m.rpc('MOCK_submit',[b.transaction]) as string,tx=f.m.transactions[0]!,receipt=f.m.receipts.get(hash)!,post=f.m.history.get(11) as typeof f.m.state;
    if(kind==='native movement')post.nativeBalance+=1n;if(kind==='nonce')post.nonce+=1;if(kind==='signature')tx.s='0x1';if(kind==='wallet')post.balance+=1n;if(kind==='debt')post.scaledDebt+=10n;if(kind==='allowance')post.allowance+=1n;if(kind==='collateral')post.scaled+=1n;if(kind==='event')(receipt.logs as unknown[]).shift();
    if(['amount','mode','owner'].includes(kind))tx.input=supplyCall('repay(address,uint256,uint256,address)',p.asset,kind==='amount'?4999n:5000n,kind==='mode'?1n:2n,kind==='owner'?'0x'+'2'.repeat(40):REPAY_OWNER);
    if(kind==='pool'){tx.to='0x'+'2'.repeat(40);receipt.to=tx.to;}
    if(kind==='unexpected movement')(receipt.logs as unknown[]).push({address:'0x'+'2'.repeat(40),topics:[supplyTopic('Transfer(address,address,uint256)'), '0x'+supplyWord(REPAY_OWNER),'0x'+supplyWord(p.aToken)],data:'0x'+supplyWord(1n)});
    await f.s.report(b.record.id,'REPAY',{kind:'HASH',hash});const o=await f.s.observe(b.record.id);expect(o.verdict).toBe('DIVERGENT');expect(o.evidence).toBeNull();
  });
  it('legitimate index accrual reconciles scaled burn rather than nominal subtraction',async()=>{
    const f=await setup(5000n),b=await prepare(f.s);await f.s.handoff(b.record.id,'REPAY',true);f.m.state.debtIndex+=10n**22n;
    const hash=await f.m.rpc('MOCK_submit',[b.transaction]) as string;await f.s.report(b.record.id,'REPAY',{kind:'HASH',hash});const o=await f.s.observe(b.record.id);expect(o.verdict).toBe('RECONCILED');expect(o.evidence?.publicExecution).toMatchObject({amount:'5000',walletDelta:'-5000'});
  });
});
