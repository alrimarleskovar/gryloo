// SPDX-License-Identifier: AGPL-3.0-only
import { it,expect } from 'vitest';
import { mkdtemp,readFile,appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createSupplyService } from '../../../apps/reference-dapp/src/server/supply-service';
import { repayModel,repayWorkflow,REPAY_OWNER } from '../../../apps/reference-dapp/e2e/repay-fixtures';
import { realWrappedApprovalFixture } from '../../../apps/reference-dapp/e2e/supply-fixtures';
import { supplyTransition } from '../../reference-executor/src/supply.js';
import { reconcileRepayAttempt } from '../src/repay.js';
import { supplyWalletDelegationDigest } from '../src/supply.js';
import { AAVE_V3_BASE_SEPOLIA as p,supplyCall,supplyWord,supplyTopic,fromHex,toHex,encodeSupplyWalletEnvelope,decodeSupplyWalletEnvelope,SUPPLY_METAMASK,type SupplyRpc } from '@defi-workflow-engine/reference-compiler';
async function wrappedSetup(realShape=false){
  const m=repayModel(),key=new Uint8Array(32).fill(0x43),pub=secp256k1.getPublicKey(key,false),relay='0x'+'b'.repeat(40);
  if(realShape){m.state.block=Number(BigInt('0x2d5bdcf'))-1;m.history.clear();m.history.set(m.state.block,{...m.state});}
  const codeResponses=realWrappedApprovalFixture.responses;
  const codes=new Map([SUPPLY_METAMASK.manager,SUPPLY_METAMASK.implementation,SUPPLY_METAMASK.limited,SUPPLY_METAMASK.exact].map(address=>{
    const entry=Object.entries(codeResponses).find(([k])=>k.startsWith(JSON.stringify(['eth_getCode',[address]]).slice(0,-2)));if(!entry)throw Error('CAPTURED_CODE_MISSING');return [address,entry[1]] as const;
  }));
  const domain=codeResponses[JSON.stringify(['eth_call',[{to:SUPPLY_METAMASK.manager,data:supplyCall('getDomainHash()')},'0x2d57f4a']])];
  const manager=codeResponses[JSON.stringify(['eth_call',[{to:SUPPLY_METAMASK.implementation,data:supplyCall('delegationManager()')},'0x2d57f4a']])];
  const counts=new Map<string,number>();
  const rpc:SupplyRpc=async(method,params)=>{
    if(method==='eth_getCode'){if(params[0]===REPAY_OWNER)return '0xef0100'+SUPPLY_METAMASK.implementation.slice(2);const code=codes.get(params[0] as string);if(code)return code;}
    if(method==='eth_call'){
      const call=params[0] as {to:string;data:string};
      if(call.to===SUPPLY_METAMASK.manager&&call.data===supplyCall('getDomainHash()'))return domain;
      if(call.to===SUPPLY_METAMASK.implementation&&call.data===supplyCall('delegationManager()'))return manager;
      if(call.to===SUPPLY_METAMASK.limited&&call.data.startsWith(supplyCall('callCounts(address,bytes32)').slice(0,10)))return '0x'+supplyWord(BigInt(params[1] as string)>=BigInt(counts.get('0x'+call.data.slice(-64))??Number.MAX_SAFE_INTEGER)?1n:0n);
    }
    const result=await m.rpc(method,params);
    if(realShape&&method==='eth_getBlockByNumber'){
      const block=result as {number:string;hash:string;transactions:unknown[]};
      if(block.number==='0x2d5bdcf'){block.hash='0x156b7a81ae71399bb85a94a9402a423b877845f8485c76ffbe3c07f4e61df489';block.transactions=[...Array(6).fill('0x'+'a'.repeat(64)),...block.transactions];}
    }
    if(method==='MOCK_submit'){
      const tx=m.transactions.at(-1)!,receipt=m.receipts.get(result as string)!,direct=params[0] as {to:string;data:string};
      const call={to:direct.to,value:'0',data:direct.data},packed='0x'+call.to.slice(2)+supplyWord(0n)+call.data.slice(2);
      const draft={owner:REPAY_OWNER,delegate:'0x0000000000000000000000000000000000000a11',salt:String(m.transactions.length),signature:'0x'+'00'.repeat(65),call,caveats:[{enforcer:SUPPLY_METAMASK.limited,terms:'0x'+supplyWord(1n),args:'0x'},{enforcer:SUPPLY_METAMASK.exact,terms:packed,args:'0x'}]};
      const digest=supplyWalletDelegationDigest({...draft,delegationTuple:''}).digest,sig=secp256k1.sign(fromHex(digest),key,{prehash:false});
      const recovery=[0,1].find(i=>toHex(secp256k1.Signature.fromBytes(sig).addRecoveryBit(i).recoverPublicKey(fromHex(digest)).toBytes(false))===toHex(pub));if(recovery===undefined)throw Error('SYNTHETIC_SIGNATURE_FAILED');
      const envelope=encodeSupplyWalletEnvelope({...draft,signature:toHex(sig)+(27+recovery).toString(16)}),decoded=decodeSupplyWalletEnvelope(envelope),hash=supplyWalletDelegationDigest(decoded).delegationHash;
      Object.assign(tx,{from:relay,to:SUPPLY_METAMASK.manager,input:envelope,nonce:'0x1234'});Object.assign(receipt,{from:relay,to:SUPPLY_METAMASK.manager});
      (receipt.logs as unknown[]).push({address:SUPPLY_METAMASK.limited,topics:[supplyTopic('IncreasedCount(address,address,bytes32,uint256,uint256)'), '0x'+supplyWord(SUPPLY_METAMASK.manager),'0x'+supplyWord(relay),hash],data:'0x'+supplyWord(1n)+supplyWord(1n)}, {address:SUPPLY_METAMASK.manager,topics:[supplyTopic('RedeemedDelegation(address,address,(address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))'),'0x'+supplyWord(REPAY_OWNER),'0x'+supplyWord(relay)],data:'0x'+supplyWord(32n)+decoded.delegationTuple.slice(2)});
      if(realShape){tx.blockHash=null;tx.transactionIndex='0x6';receipt.transactionIndex='0x6';receipt.blockHash='0x156b7a81ae71399bb85a94a9402a423b877845f8485c76ffbe3c07f4e61df489';}
      counts.set(hash,Number(BigInt(receipt.blockNumber as string)));m.state.nonce--;m.state.nativeBalance+=BigInt(receipt.gasUsed as string)*BigInt(receipt.effectiveGasPrice as string);m.history.set(Number(BigInt(receipt.blockNumber as string)),{...m.state});
    }
    return result;
  };
  const input={rpc,journalDir:await mkdtemp(join(tmpdir(),'gryloo-repay-wrapped-')),provenance:'MOCKED' as const},s=createSupplyService(input),w=repayWorkflow();return {m,rpc,input,s,w};
}
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
