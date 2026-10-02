// SPDX-License-Identifier: AGPL-3.0-only
import {it,expect} from 'vitest';
import {withdrawModel,withdrawWorkflow,WITHDRAW_OWNER as owner} from '../../../apps/reference-dapp/e2e/withdraw-fixtures';
import {wrappedAaveSetup} from '../../../apps/reference-dapp/e2e/aave-wallet-fixtures';
import {createSupplyService} from '../../../apps/reference-dapp/src/server/supply-service';
import {reconcileWithdrawAttempt} from '../src/withdraw.js';
import {supplyWord,supplyCall,encodeSupplyWalletEnvelope,decodeSupplyWalletEnvelope,AAVE_V3_BASE_SEPOLIA as p} from '@defi-workflow-engine/reference-compiler';
async function wrapped(){
  const f=await wrappedAaveSetup(withdrawModel(),withdrawWorkflow()),r=await f.s.simulate(f.w,owner);await f.s.review(r.id,r.review.commitment,f.w);const b=await f.s.begin(r.id,owner,f.w);await f.s.handoff(r.id,b.step,true);const hash=await f.rpc('MOCK_submit',[b.transaction]) as string;
  return {...f,r,b,hash,attempt:{...b.record.attempts[0]!,transactionHash:hash},receipt:f.m.receipts.get(hash)!,tx:f.m.transactions[0]!};
}
it('reconciles the existing pinned wrapped-wallet model with unchanged owner nonce and sponsored gas',async()=>{
  const f=await wrapped();await f.s.report(f.r.id,'WITHDRAW',{kind:'HASH',hash:f.hash});const result=await createSupplyService(f.input).observe(f.r.id);expect(result.error).toBeNull();expect(result.verdict).toBe('RECONCILED');expect(result.evidence?.publicExecution).toMatchObject({walletDelta:'100000',ownerAuthorization:{kind:'METAMASK_EIP7702',owner,ownerNonceBefore:'0',ownerNonceAfter:'0'}});expect(f.m.transactions).toHaveLength(1);
  // Completed wrapped withdrawal may reuse a nonce, but cannot replay this economic intent.
  const again=await f.s.simulate(f.w,owner);await f.s.review(again.id,again.review.commitment,f.w);await expect(f.s.begin(again.id,owner,f.w)).rejects.toThrow('EXISTING_INTENT_OBSERVE_ONLY');
});
it.each(['asset','amount','recipient','pool','calldata','signature','event amount','event recipient','event asset','collateral transfer amount','collateral event index','interest checkpoint','extra movement','review recipient','review amount','review chain','state collateral','missing network fee'])('fails closed on wrapped %s',async kind=>{
  const f=await wrapped();
  if(['asset','amount','recipient','pool','calldata','signature'].includes(kind)){
    const envelope=decodeSupplyWalletEnvelope(f.tx.input);if(kind==='signature')envelope.signature='0x'+'01'.repeat(65);
    else {envelope.call={...envelope.call,to:kind==='pool'?'0x'+'2'.repeat(40):p.pool,data:kind==='calldata'?envelope.call.data+'00':supplyCall('withdraw(address,uint256,address)',kind==='asset'?'0x'+'2'.repeat(40):p.asset,kind==='amount'?99999n:100000n,kind==='recipient'?'0x'+'2'.repeat(40):owner)};envelope.caveats[1]!.terms='0x'+envelope.call.to.slice(2)+supplyWord(0n)+envelope.call.data.slice(2);}
    f.tx.input=encodeSupplyWalletEnvelope(envelope);
  }
  const logs=f.receipt.logs as {topics:string[];data:string}[];
  if(kind==='event amount')logs[0]!.data='0x'+supplyWord(99999n);if(kind==='event recipient')logs[0]!.topics[3]='0x'+supplyWord(p.pool);if(kind==='event asset')logs[0]!.topics[1]='0x'+supplyWord(p.aToken);if(kind==='collateral transfer amount')logs[2]!.data='0x'+supplyWord(1n);if(kind==='collateral event index')logs[3]!.data=logs[3]!.data.slice(0,-64)+supplyWord(10n**27n);if(kind==='interest checkpoint')(f.m.history.get(11) as typeof f.m.state).previousIndex=10n**27n;if(kind==='extra movement')logs.push({...logs[2]!});
  if(kind==='review recipient')f.r.review.beneficiary=p.pool;if(kind==='review amount')f.r.review.amount='99999';if(kind==='review chain')f.r.review.chain='eip155:1';if(kind==='state collateral')(f.m.history.get(11) as typeof f.m.state).scaled-=10n;
  if(kind==='missing network fee')delete f.receipt.l1Fee;
  const result=await reconcileWithdrawAttempt(f.r.review,f.attempt,f.rpc);expect(result.verdict).toBe('DIVERGENT');
});
