// SPDX-License-Identifier: AGPL-3.0-only
import { it,expect } from 'vitest';
import { readFile,appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSupplyService } from '../../../apps/reference-dapp/src/server/supply-service';
import { repayModel,repayWorkflow,REPAY_OWNER } from '../../../apps/reference-dapp/e2e/repay-fixtures';
import { wrappedAaveSetup } from '../../../apps/reference-dapp/e2e/aave-wallet-fixtures';
import { supplyTransition } from '../../reference-executor/src/supply.js';
import { reconcileRepayAttempt } from '../src/repay.js';
import { AAVE_V3_BASE_SEPOLIA as p,supplyCall,supplyWord,decodeSupplyWalletEnvelope } from '@defi-workflow-engine/reference-compiler';
async function wrappedSetup(realShape=false){return wrappedAaveSetup(repayModel(),repayWorkflow(),realShape);}
it('owner-authorized wrapped approval → wrapped Repay safely reuses the unchanged owner nonce',async()=>{
  const {m,rpc,input,s,w}=await wrappedSetup();const r=await s.simulate(w,REPAY_OWNER);await s.review(r.id,r.review.commitment,w);
  const a=await s.begin(r.id,REPAY_OWNER,w);await s.handoff(r.id,'APPROVAL',true);const h=await rpc('MOCK_submit',[a.transaction]) as string;await s.report(r.id,'APPROVAL',{kind:'HASH',hash:h});const approval=await s.observe(r.id);
  expect(approval.attempts[0]).toMatchObject({reconciled:true,ownerNonceAfter:'0'});
  const restarted=createSupplyService(input),b=await restarted.begin(r.id,REPAY_OWNER,w);expect(b.step).toBe('REPAY');expect(b.transaction.nonce).toBe('0x0');await restarted.handoff(r.id,'REPAY',true);const hash=await rpc('MOCK_submit',[b.transaction]) as string;await restarted.report(r.id,'REPAY',{kind:'HASH',hash});const o=await restarted.observe(r.id);
  expect(o.verdict).toBe('RECONCILED');expect(o.evidence?.publicExecution).toMatchObject({walletDelta:'-5000',ownerAuthorization:{kind:'METAMASK_EIP7702',owner:REPAY_OWNER,ownerNonceBefore:'0',ownerNonceAfter:'0'}});expect(m.transactions).toHaveLength(2);
});

async function confirmedApproval(){
  const f=await wrappedSetup(true),r=await f.s.simulate(f.w,REPAY_OWNER);await f.s.review(r.id,r.review.commitment,f.w);
  const a=await f.s.begin(r.id,REPAY_OWNER,f.w);await f.s.handoff(r.id,'APPROVAL',true);
  const hash=await f.rpc('MOCK_submit',[a.transaction]) as string;await f.s.report(r.id,'APPROVAL',{kind:'HASH',hash});
  return {...f,id:r.id,review:r.review,attempt:{...a.record.attempts[0]!,transactionHash:hash},hash,tx:f.m.transactions[0]!,receipt:f.m.receipts.get(hash)!};
}
it('historical wrapped approval reconciles with identical transaction fields in a different key order',async()=>{
  const f=await confirmedApproval(),{from,to,value,chainId,data}=f.attempt.transaction;
  const transaction={from,to,value,chainId,data};
  expect(Object.keys(transaction)).not.toEqual(Object.keys(f.attempt.transaction));
  const o=await reconcileRepayAttempt(f.review,{...f.attempt,transaction},f.rpc);
  expect(o).toMatchObject({verdict:'RECONCILED',reason:'EXACT_REPAY_APPROVAL_VERIFIED',postPosition:{allowance:'5000'},walletEnvelope:{owner:REPAY_OWNER}});expect(f.m.transactions).toHaveLength(1);
});
it.each([
  ['to',p.pool],['from','0x'+'2'.repeat(40)],['chainId','0x1'],['value','0x1'],['data',supplyCall('approve(address,uint256)',p.pool,4999n)],
])('reordered historical approval rejects a different %s',async(field,value)=>{
  const f=await confirmedApproval(),t=f.attempt.transaction,transaction={from:t.from,to:t.to,value:t.value,chainId:t.chainId,data:t.data};
  Object.assign(transaction,{[field!]:value});
  const o=await reconcileRepayAttempt(f.review,{...f.attempt,transaction},f.rpc);
  expect(o).toMatchObject({verdict:'DIVERGENT',reason:'REPAY_SEMANTIC_MISMATCH'});expect(f.m.transactions).toHaveLength(1);
});
it('exact public provider shape: null tx blockHash, real block/index and canonical wrapped approval reconcile',async()=>{
  const f=await confirmedApproval();expect(f.tx).toMatchObject({blockHash:null,blockNumber:'0x2d5bdcf',transactionIndex:'0x6'});expect(f.receipt).toMatchObject({status:'0x1',blockNumber:'0x2d5bdcf',transactionIndex:'0x6',blockHash:'0x156b7a81ae71399bb85a94a9402a423b877845f8485c76ffbe3c07f4e61df489'});
  const o=await reconcileRepayAttempt(f.review,f.attempt,f.rpc);expect(o).toMatchObject({verdict:'RECONCILED',reason:'EXACT_REPAY_APPROVAL_VERIFIED',postPosition:{allowance:'5000'},walletEnvelope:{owner:REPAY_OWNER,delegation:{call:{to:p.asset,data:supplyCall('approve(address,uint256)',p.pool,5000n)}}}});expect(f.m.transactions).toHaveLength(1);
});
it.each(['receipt block number','receipt block hash','canonical block hash','transaction hash','receipt hash','transaction index','receipt index','canonical transaction slot','inner calldata','wrapper','owner','signature','approval amount','approval spender','post allowance'])('null tx blockHash cannot bypass %s',async kind=>{
  const f=await confirmedApproval(),other='0x'+'2'.repeat(64),block=Number(BigInt(f.receipt.blockNumber as string));
  if(kind==='receipt block number')f.receipt.blockNumber='0x2d5bdce';if(kind==='receipt block hash')f.receipt.blockHash=other;if(kind==='transaction hash')f.tx.hash=other;if(kind==='receipt hash')f.receipt.transactionHash=other;if(kind==='transaction index')f.tx.transactionIndex='0x5';if(kind==='receipt index')f.receipt.transactionIndex='0x5';
  if(kind==='inner calldata')f.tx.input=(f.tx.input as string).replace(supplyCall('approve(address,uint256)',p.pool,5000n).slice(2),supplyCall('approve(address,uint256)',p.pool,4999n).slice(2));
  if(kind==='wrapper'){f.tx.to=p.pool;f.receipt.to=p.pool;}
  if(kind==='owner')f.tx.input=(f.tx.input as string).replace(supplyWord(REPAY_OWNER),supplyWord('0x'+'2'.repeat(40)));
  if(kind==='signature'){const e=decodeSupplyWalletEnvelope(f.tx.input);f.tx.input=(f.tx.input as string).replace(e.signature.slice(2),'00'.repeat(65));}
  const event=(f.receipt.logs as {address:string;topics:string[];data:string}[]).find(l=>l.address===p.asset)!;
  if(kind==='approval amount')event.data='0x'+supplyWord(4999n);if(kind==='approval spender')event.topics[2]='0x'+supplyWord('0x'+'2'.repeat(40));
  if(kind==='post allowance')f.m.history.get(block)!.allowance=4999n;
  const rpc:SupplyRpc=async(method,params)=>{if(kind==='transaction hash'&&method==='eth_getTransactionByHash')return f.tx;const result=await f.rpc(method,params);if(method==='eth_getBlockByNumber'&&params[0]===f.receipt.blockNumber){const b=result as {hash:string;transactions:string[]};if(kind==='canonical block hash')b.hash=other;if(kind==='canonical transaction slot')b.transactions[6]=other;}return result;};
  const o=await reconcileRepayAttempt(f.review,f.attempt,rpc);expect(o.verdict).toBe('DIVERGENT');expect(f.m.transactions).toHaveLength(1);
});
async function legacyFailure(f:Awaited<ReturnType<typeof confirmedApproval>>,reason='SUPPLY_RPC_INVALID'){
  const current=await f.s.load(f.id),attempt=current.attempts[0]!,observation={verdict:'DIVERGENT' as const,reason,transaction:structuredClone(f.tx),receipt:structuredClone(f.receipt),prePosition:null,postPosition:null,delta:null,scaledDelta:null,cost:null};
  const legacy={...current,...supplyTransition(current,attempt,'RECONCILIATION_REQUIRED'),attempts:[{...attempt,state:'RECONCILIATION_REQUIRED',receipt:structuredClone(f.receipt)}],verdict:'DIVERGENT',error:observation.reason,observations:[observation]};
  const path=join(f.input.journalDir,f.id+'.jsonl');await appendFile(path,JSON.stringify(legacy)+'\n');return {path,bytes:await readFile(path)};
}
it('restart appends verified recovery to the exact legacy journal without another approval',async()=>{
  const f=await confirmedApproval(),legacy=await legacyFailure(f),restarted=createSupplyService(f.input);
  const recovered=await restarted.observe(f.id);expect(recovered).toMatchObject({id:f.id,verdict:'DIVERGENT',authorization:null,error:null,attempts:[{step:'APPROVAL',transactionHash:f.hash,state:'RECONCILIATION_REQUIRED',reconciled:false}],approvalProof:{hash:f.hash,observation:{verdict:'RECONCILED',reason:'EXACT_REPAY_APPROVAL_VERIFIED'}}});
  expect(recovered.observations).toHaveLength(2);expect(recovered.observations[0]!.reason).toBe('SUPPLY_RPC_INVALID');expect((await readFile(legacy.path)).subarray(0,legacy.bytes.length).equals(legacy.bytes)).toBe(true);expect(f.m.transactions).toHaveLength(1);
  await expect(restarted.begin(f.id,REPAY_OWNER,f.w)).rejects.toThrow('SUPPLY_REVIEW_REQUIRED');
  const fresh=await restarted.recoverReview(f.id);expect(fresh.review.approvalRequired).toBe(false);expect(fresh.priorApproval).toEqual({runId:f.id,hash:f.hash});
  await restarted.review(fresh.id,fresh.review.commitment,f.w);const next=await restarted.begin(fresh.id,REPAY_OWNER,f.w);expect(next.step).toBe('REPAY');expect(f.m.transactions).toHaveLength(1);
  expect((await createSupplyService(f.input).load(f.id)).attempts[0]!.transactionHash).toBe(f.hash);
});
it('legacy null-hash approval stays terminal when fresh canonical proof fails',async()=>{
  const f=await confirmedApproval(),legacy=await legacyFailure(f);(f.receipt.logs as {address:string;data:string}[]).find(l=>l.address===p.asset)!.data='0x'+supplyWord(4999n);
  const r=await createSupplyService(f.input).observe(f.id);expect(r.verdict).toBe('DIVERGENT');expect(r.attempts[0]!.reconciled).toBe(false);expect((await readFile(legacy.path)).equals(legacy.bytes)).toBe(true);expect(f.m.transactions).toHaveLength(1);
});

it.each(['different failure','non-null original hash'])('terminal approval does not recover for %s',async kind=>{
  const f=await confirmedApproval();if(kind==='non-null original hash')f.tx.blockHash=f.receipt.blockHash;
  const legacy=await legacyFailure(f,kind==='different failure'?'REPAY_APPROVAL_MISMATCH':'SUPPLY_RPC_INVALID');
  const r=await createSupplyService(f.input).observe(f.id);expect(r.verdict).toBe('DIVERGENT');expect(r.approvalProof).toBeUndefined();expect((await readFile(legacy.path)).equals(legacy.bytes)).toBe(true);expect(f.m.transactions).toHaveLength(1);
});
