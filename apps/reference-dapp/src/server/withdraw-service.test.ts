// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSupplyService} from './supply-service';
import {withdrawModel,withdrawWorkflow,WITHDRAW_OWNER as owner} from '../../e2e/withdraw-fixtures';
import {supplyCall,supplyTopic,supplyWord,AAVE_V3_BASE_SEPOLIA as p} from '@defi-workflow-engine/reference-compiler';
async function setup(){const m=withdrawModel(),input={rpc:m.rpc,journalDir:await mkdtemp(join(tmpdir(),'gryloo-withdraw-test-')),provenance:'MOCKED' as const};return {m,input,s:createSupplyService(input)};}
async function prepare(f:Awaited<ReturnType<typeof setup>>){const r=await f.s.simulate(withdrawWorkflow(),owner);await f.s.review(r.id,r.review.commitment,withdrawWorkflow());return f.s.begin(r.id,owner,withdrawWorkflow());}
describe('Withdraw durable wallet execution and independent reconciliation',()=>{
  it('persists PREPARED before handoff, executes once and exports honest MOCKED evidence',async()=>{
    const f=await setup(),b=await prepare(f);expect(b.step).toBe('WITHDRAW');expect(b.record.attempts[0]!.state).toBe('PREPARED');expect((await createSupplyService(f.input).load(b.record.id)).attempts).toHaveLength(1);
    await f.s.handoff(b.record.id,b.step,true);const hash=await f.m.rpc('MOCK_submit',[b.transaction]) as string;await f.s.report(b.record.id,b.step,{kind:'HASH',hash});const r=await f.s.observe(b.record.id);
    expect(r.error).toBeNull();expect(r.verdict).toBe('RECONCILED');expect(r.evidence?.bundle).toMatchObject({environment:'MOCKED',outcome:'RECONCILED'});expect(r.evidence?.bundle.receipts).toHaveLength(1);
    expect(r.evidence?.publicExecution).toMatchObject({amount:'100000',walletDelta:'100000',recipient:owner,ownerAuthorization:{kind:'DIRECT_EIP1559',owner}});expect(f.m.transactions).toHaveLength(1);
    await expect(createSupplyService(f.input).begin(r.id,owner,withdrawWorkflow())).rejects.toThrow();
  });
  it('unknown wallet response after submission recovers across restart without another send',async()=>{
    const f=await setup(),b=await prepare(f);await f.s.handoff(b.record.id,b.step,true);const before=await readFile(join(f.input.journalDir,b.record.id+'.jsonl'),'utf8');await f.m.rpc('MOCK_submit',[b.transaction]);await f.s.report(b.record.id,b.step,{kind:'UNKNOWN'});
    const restarted=createSupplyService(f.input),r=await restarted.observe(b.record.id);expect(r.verdict).toBe('RECONCILED');expect(f.m.transactions).toHaveLength(1);expect((await readFile(join(f.input.journalDir,b.record.id+'.jsonl'),'utf8')).startsWith(before)).toBe(true);await expect(restarted.recoverReview(r.id)).rejects.toThrow('OBSERVE_ONLY');
  });
  it('unknown submission remains observation-only with no hash, even after nonce or metadata changes',async()=>{
    const f=await setup(),b=await prepare(f);await f.s.handoff(b.record.id,b.step,true);await f.s.report(b.record.id,b.step,{kind:'UNKNOWN'});
    const restarted=createSupplyService(f.input);await restarted.observe(b.record.id);await expect(restarted.recoverReview(b.record.id)).rejects.toThrow('OBSERVE_ONLY');await expect(restarted.begin(b.record.id,owner,withdrawWorkflow())).rejects.toThrow();
    f.m.state.nonce=1;const w={...withdrawWorkflow(),revision:7,workflowId:'reauthored'},r=await f.s.simulate(w,owner);await f.s.review(r.id,r.review.commitment,w);await expect(f.s.begin(r.id,owner,w)).rejects.toThrow('EXISTING_INTENT_OBSERVE_ONLY');expect(f.m.transactions).toHaveLength(0);
  });
  it('restart before handoff proves no wallet request and requires a fresh explicit Review',async()=>{
    const f=await setup(),b=await prepare(f),s=createSupplyService(f.input);const original=b.record.journal.entries.slice();const observed=await s.observe(b.record.id);expect(observed.notSubmitted).toBe(true);expect(observed.journal.entries.slice(0,original.length)).toEqual(original);
    const r=await s.recoverReview(b.record.id);expect(r.authorization).toBeNull();await expect(s.begin(r.id,owner,withdrawWorkflow())).rejects.toThrow('REVIEW_REQUIRED');await s.review(r.id,r.review.commitment,withdrawWorkflow());expect((await s.begin(r.id,owner,withdrawWorkflow())).transaction).toEqual(b.transaction);expect(f.m.transactions).toHaveLength(0);
  });
  it('known refusal permits fresh owner Review without weakening unknown-result safety',async()=>{
    const f=await setup(),b=await prepare(f);await f.s.handoff(b.record.id,b.step,true);await f.s.walletFailure(b.record.id,{invoked:true,rejectionCode:4001,transaction:b.transaction,calls:[{method:'eth_sendTransaction',submission:true,params:[b.transaction],error:{code:4001}}],error:{code:4001},code:'SUPPLY_REJECTED'});
    const r=await f.s.recoverReview(b.record.id);expect(r.authorization).toBeNull();await f.s.review(r.id,r.review.commitment,withdrawWorkflow());expect((await f.s.begin(r.id,owner,withdrawWorkflow())).transaction).toEqual(b.transaction);
  });
  it('fresh collateral change invalidates handoff after preparation',async()=>{
    const f=await setup(),b=await prepare(f);f.m.state.scaled--;await expect(f.s.handoff(b.record.id,b.step,true)).rejects.toThrow('AUTHORIZATION_STALE');expect(f.m.transactions).toHaveLength(0);
  });
  it.each(['signature','wallet','debt','collateral','configuration','event','amount','recipient','asset','pool','calldata','unexpected movement','collateral transfer','native movement','nonce','chain','revert','block inclusion'])('rejects %s and produces no evidence',async kind=>{
    const f=await setup(),b=await prepare(f);await f.s.handoff(b.record.id,b.step,true);if(kind==='revert')f.m.state.revert=true;
    const hash=await f.m.rpc('MOCK_submit',[b.transaction]) as string,tx=f.m.transactions[0]!,receipt=f.m.receipts.get(hash)!,post=f.m.history.get(11) as typeof f.m.state;
    if(kind==='signature')tx.s='0x1';if(kind==='wallet')post.balance++;if(kind==='debt')post.scaledDebt++;if(kind==='collateral')post.scaled++;if(kind==='configuration')post.reserveConfig|=1n<<58n<<1n;if(kind==='native movement')post.nativeBalance++;if(kind==='nonce')post.nonce++;if(kind==='chain')f.m.state.chain='0x1';if(kind==='block inclusion')receipt.transactionIndex='0x1';
    if(kind==='event')(receipt.logs as unknown[]).shift();if(kind==='collateral transfer')(receipt.logs as {topics:string[]}[])[2]!.topics[2]='0x'+supplyWord(p.pool);
    if(['amount','recipient','asset'].includes(kind))tx.input=supplyCall('withdraw(address,uint256,address)',kind==='asset'?'0x'+'2'.repeat(40):p.asset,kind==='amount'?99999n:100000n,kind==='recipient'?'0x'+'2'.repeat(40):owner);
    if(kind==='calldata')tx.input=String(tx.input)+'00';if(kind==='pool'){tx.to='0x'+'2'.repeat(40);receipt.to=tx.to;}
    if(kind==='unexpected movement')(receipt.logs as unknown[]).push({address:'0x'+'2'.repeat(40),topics:[supplyTopic('Transfer(address,address,uint256)'), '0x'+supplyWord(owner),'0x'+supplyWord(p.aToken)],data:'0x'+supplyWord(1n)});
    await f.s.report(b.record.id,b.step,{kind:'HASH',hash});if(kind==='chain'){await expect(f.s.observe(b.record.id)).rejects.toThrow('WRONG_CHAIN');return;}const r=await f.s.observe(b.record.id);expect(r.verdict).toBe('DIVERGENT');expect(r.evidence).toBeNull();
  });
  it('accepts canonical receipt inclusion when transaction blockHash is explicitly null',async()=>{
    const f=await setup(),b=await prepare(f);await f.s.handoff(b.record.id,b.step,true);const hash=await f.m.rpc('MOCK_submit',[b.transaction]) as string;f.m.transactions[0]!.blockHash=null;await f.s.report(b.record.id,b.step,{kind:'HASH',hash});expect((await f.s.observe(b.record.id)).verdict).toBe('RECONCILED');
  });
  it.each(['nearest','ceil'])('accounts for index accrual and %s scaled burn without naive nominal subtraction',async rounding=>{
    const f=await setup(),b=await prepare(f);await f.s.handoff(b.record.id,b.step,true);f.m.state.index+=10n**22n;f.m.state.debtIndex+=10n**22n;
    const oldScaled=f.m.state.scaled,hash=await f.m.rpc('MOCK_submit',[b.transaction]) as string;
    if(rounding==='ceil'){const post=f.m.history.get(11) as typeof f.m.state;post.scaled=oldScaled-(100000n*10n**27n+post.index-1n)/post.index;}
    await f.s.report(b.record.id,b.step,{kind:'HASH',hash});const r=await f.s.observe(b.record.id);expect(r.error).toBeNull();expect(r.verdict).toBe('RECONCILED');expect(r.evidence?.publicExecution).toMatchObject({walletDelta:'100000'});
  });
});
