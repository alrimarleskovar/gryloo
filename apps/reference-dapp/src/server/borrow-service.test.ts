// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSupplyService} from './supply-service';
import {supplyModel,SUPPLY_OWNER} from '../../e2e/supply-fixtures';
import {supplyHex,supplyCall,AAVE_V3_BASE_SEPOLIA as p,type SupplyRpc} from '@defi-workflow-engine/reference-compiler';
import {createBorrowNode,type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
const workflow=():SemanticWorkflow=>({schemaVersion:'1.0.0',workflowId:'borrow-service',revision:0,nodes:[createBorrowNode('borrow',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'10000',beneficiary:SUPPLY_OWNER,interestRateMode:2})],resourceEdges:[]});
async function setup(){const m=supplyModel();m.state.balance=0n;m.history.set(10,{...m.state});const journalDir=await mkdtemp(join(tmpdir(),'gryloo-borrow-test-'));const input={rpc:m.rpc,journalDir,provenance:'MOCKED' as const};return {m,input,service:createSupplyService(input)};}
async function prepare(s:ReturnType<typeof createSupplyService>){const r=await s.simulate(workflow(),SUPPLY_OWNER);await s.review(r.id,r.review.commitment,workflow());return s.begin(r.id,SUPPLY_OWNER,workflow());}
describe('Borrow uses durable shared execution and recovery',()=>{
  it('persists Borrow before handoff, reconciles all economic effects and produces only MOCKED evidence',async()=>{
    const {m,input,service:s}=await setup(),begin=await prepare(s);expect(begin.step).toBe('BORROW');expect(begin.record.attempts[0]!.state).toBe('PREPARED');
    expect((await createSupplyService(input).load(begin.record.id)).attempts).toHaveLength(1);
    await s.handoff(begin.record.id,'BORROW',true);
    const hash=await m.rpc('MOCK_submit',[begin.transaction]) as string;await s.report(begin.record.id,'BORROW',{kind:'HASH',hash});
    const observed=await createSupplyService(input).observe(begin.record.id);
    expect(observed.verdict).toBe('RECONCILED');expect(observed.attempts).toHaveLength(1);expect(m.transactions).toHaveLength(1);
    expect(observed.evidence?.bundle).toMatchObject({environment:'MOCKED',outcome:'RECONCILED'});
    expect(observed.evidence?.bundle.reconciliation.debt[0]!.amount).toBe('10000');
    expect(observed.evidence?.publicExecution).toMatchObject({rateMode:2,walletDelta:'10000',debtDelta:'10000',postHealthFactor:'860000000000000000000'});
    await expect(s.begin(begin.record.id,SUPPLY_OWNER,workflow())).rejects.toThrow();
  });
  it('recovers uncertain submission by observing the existing transaction, never a second Borrow',async()=>{
    const {m,input,service:s}=await setup(),b=await prepare(s);await s.handoff(b.record.id,'BORROW',true);
    await m.rpc('MOCK_submit',[b.transaction]);await s.report(b.record.id,'BORROW',{kind:'UNKNOWN'});
    const restarted=createSupplyService(input),o=await restarted.observe(b.record.id);expect(o.verdict).toBe('RECONCILED');expect(m.transactions).toHaveLength(1);
    await expect(restarted.begin(b.record.id,SUPPLY_OWNER,workflow())).rejects.toThrow();await expect(restarted.recoverReview(b.record.id)).rejects.toThrow('OBSERVE_ONLY');
  });
  it('uncertainty without a visible hash remains observation-only even across fresh runs',async()=>{
    const {service:s}=await setup(),b=await prepare(s);await s.handoff(b.record.id,'BORROW',true);await s.report(b.record.id,'BORROW',{kind:'UNKNOWN'});
    await expect(s.recoverReview(b.record.id)).rejects.toThrow('OBSERVE_ONLY');
    await expect(s.begin(b.record.id,SUPPLY_OWNER,workflow())).rejects.toThrow('OBSERVE_ONLY');
    const fresh=await s.simulate(workflow(),SUPPLY_OWNER);await s.review(fresh.id,fresh.review.commitment,workflow());await expect(s.begin(fresh.id,SUPPLY_OWNER,workflow())).rejects.toThrow();
  });
  it.each(['collateral','price','capacity'])('fresh %s changes invalidate Review again at Execute',async kind=>{
    const {m,service:s}=await setup(),r=await s.simulate(workflow(),SUPPLY_OWNER);await s.review(r.id,r.review.commitment,workflow());
    if(kind==='price')m.state.price=110000000n;else m.state.scaled=7000000n;
    await expect(s.begin(r.id,SUPPLY_OWNER,workflow())).rejects.toThrow('STALE');expect(m.transactions).toHaveLength(0);
  });
  it('handoff rechecks fresh public risk after preparation',async()=>{
    const {m,service:s}=await setup(),b=await prepare(s);m.state.price=110000000n;await expect(s.handoff(b.record.id,'BORROW',true)).rejects.toThrow('STALE');expect(m.transactions).toHaveLength(0);
  });
  it.each([4001,-32602])('known wallet refusal %s allows a new owner review for the same economic intent',async code=>{
    const {service:s}=await setup(),b=await prepare(s);await s.handoff(b.record.id,'BORROW',true);
    const r=await s.walletFailure(b.record.id,{invoked:true,rejectionCode:code,transaction:b.transaction,calls:[{method:'eth_sendTransaction',submission:true,params:[b.transaction],error:{code}}],error:{code},code:'SUPPLY_REJECTED'});
    expect(r.notSubmitted).toBe(true);expect(r.evidence).toBeNull();
    const recovered=await s.recoverReview(r.id);await s.review(recovered.id,recovered.review.commitment,workflow());const second=await s.begin(recovered.id,SUPPLY_OWNER,workflow());expect(second.transaction).toEqual(b.transaction);
  });
  it('pre-submission local failure persists cancellation and a recoverable explicit Review',async()=>{
    const {service:s}=await setup(),b=await prepare(s);const r=await s.walletFailure(b.record.id,{invoked:false,transaction:null,calls:[],error:{message:'Read failed'},code:'SUPPLY_RPC_ERROR_BEFORE_WALLET_SUBMISSION'});
    expect(r.attempts[0]!.state).toBe('CANCELLED');expect(r.authorization).toBeNull();expect((await s.recoverReview(r.id)).authorization).toBeNull();
  });
  it.each(['revert','debt','wallet','event','health','asset','amount','pool','beneficiary','rate'])('fails closed for %s after a successful send',async kind=>{
    const {m,service:s,input}=await setup(),b=await prepare(s);await s.handoff(b.record.id,'BORROW',true);
    if(kind==='revert')m.state.revert=true;
    const hash=await m.rpc('MOCK_submit',[b.transaction]) as string,tx=m.transactions[0]!,receipt=m.receipts.get(hash)!;
    if(kind==='debt')(m.history.get(11) as {scaledDebt:bigint}).scaledDebt+=100n;
    if(kind==='wallet')(m.history.get(11) as {balance:bigint}).balance+=1n;
    if(kind==='event')(receipt.logs as unknown[]).shift();
    if(['asset','amount','beneficiary','rate'].includes(kind))tx.input=supplyCall('borrow(address,uint256,uint256,uint16,address)',kind==='asset'?'0x'+'2'.repeat(40):p.asset,kind==='amount'?20000n:10000n,kind==='rate'?1n:2n,0n,kind==='beneficiary'?'0x'+'3'.repeat(40):SUPPLY_OWNER);
    if(kind==='pool'){tx.to='0x'+'2'.repeat(40);receipt.to=tx.to;}
    const rpc:SupplyRpc=async(method,params)=>{if(kind==='health'&&method==='eth_call'&&(params[0] as {data:string}).data===supplyCall('getUserAccountData(address)',SUPPLY_OWNER)&&params[1]==='0xb'){const raw=await m.rpc(method,params) as string;return raw.slice(0,-64)+'0'.repeat(63)+'1';}return m.rpc(method,params);};
    await s.report(b.record.id,'BORROW',{kind:'HASH',hash});const observed=await createSupplyService({...input,rpc}).observe(b.record.id);
    expect(observed.verdict).toBe('DIVERGENT');expect(observed.evidence).toBeNull();expect((await s.load(b.record.id)).verdict).toBe('DIVERGENT');
    expect(supplyHex(b.record.attempts[0]!.nonce)).toBe('0x0');
  });
});

it('legitimate variable-debt index accrual reconciles existing debt and new principal',async()=>{
  const {m,service:s}=await setup();m.state.scaledDebt=320000n;m.state.userConfig=3n;m.history.set(10,{...m.state});
  const b=await prepare(s);await s.handoff(b.record.id,'BORROW',true);const hash=await m.rpc('MOCK_submit',[b.transaction]) as string;
  (m.history.get(11) as {debtIndex:bigint}).debtIndex+=1000000000000000000000n;
  await s.report(b.record.id,'BORROW',{kind:'HASH',hash});const result=await s.observe(b.record.id);
  expect(result.verdict).toBe('RECONCILED');expect(result.evidence?.bundle.reconciliation.debt[0]!.amount).toBe('410000');
});
it('a successful receipt without independent economic reconciliation cannot produce Borrow evidence',async()=>{
  const {m,service:s}=await setup(),b=await prepare(s);await s.handoff(b.record.id,'BORROW',true);const hash=await m.rpc('MOCK_submit',[b.transaction]) as string;
  const {buildSupplyEvidence}=await import('@defi-workflow-engine/reference-reconciler');
  expect(()=>buildSupplyEvidence({id:b.record.id,review:b.record.review,journal:b.record.journal,provenance:'MOCKED',ownerInitiated:true,observations:[{verdict:'RECONCILED',reason:'RECEIPT_ONLY',transaction:m.transactions[0]!,receipt:m.receipts.get(hash)!,prePosition:null,postPosition:null,delta:null,scaledDelta:null,cost:'0'}]})).toThrow('EVIDENCE_NOT_RECONCILED');
});
