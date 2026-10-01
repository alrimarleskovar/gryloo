// SPDX-License-Identifier: AGPL-3.0-only
import { it,expect } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { createSupplyService } from '../../../apps/reference-dapp/src/server/supply-service';
import { repayModel,repayWorkflow,REPAY_OWNER } from '../../../apps/reference-dapp/e2e/repay-fixtures';
import { realWrappedApprovalFixture } from '../../../apps/reference-dapp/e2e/supply-fixtures';
import { supplyWalletDelegationDigest } from '../src/supply.js';
import { supplyCall,supplyWord,supplyTopic,fromHex,toHex,encodeSupplyWalletEnvelope,decodeSupplyWalletEnvelope,SUPPLY_METAMASK,type SupplyRpc } from '@defi-workflow-engine/reference-compiler';
it('owner-authorized wrapped approval → wrapped Repay safely reuses the unchanged owner nonce',async()=>{
  const m=repayModel(),key=new Uint8Array(32).fill(0x43),pub=secp256k1.getPublicKey(key,false),relay='0x'+'b'.repeat(40);
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
    if(method==='MOCK_submit'){
      const tx=m.transactions.at(-1)!,receipt=m.receipts.get(result as string)!,direct=params[0] as {to:string;data:string};
      const call={to:direct.to,value:'0',data:direct.data},packed='0x'+call.to.slice(2)+supplyWord(0n)+call.data.slice(2);
      const draft={owner:REPAY_OWNER,delegate:'0x0000000000000000000000000000000000000a11',salt:String(m.transactions.length),signature:'0x'+'00'.repeat(65),call,caveats:[{enforcer:SUPPLY_METAMASK.limited,terms:'0x'+supplyWord(1n),args:'0x'},{enforcer:SUPPLY_METAMASK.exact,terms:packed,args:'0x'}]};
      const digest=supplyWalletDelegationDigest({...draft,delegationTuple:''}).digest,sig=secp256k1.sign(fromHex(digest),key,{prehash:false});
      const recovery=[0,1].find(i=>toHex(secp256k1.Signature.fromBytes(sig).addRecoveryBit(i).recoverPublicKey(fromHex(digest)).toBytes(false))===toHex(pub));if(recovery===undefined)throw Error('SYNTHETIC_SIGNATURE_FAILED');
      const envelope=encodeSupplyWalletEnvelope({...draft,signature:toHex(sig)+(27+recovery).toString(16)}),decoded=decodeSupplyWalletEnvelope(envelope),hash=supplyWalletDelegationDigest(decoded).delegationHash;
      Object.assign(tx,{from:relay,to:SUPPLY_METAMASK.manager,input:envelope,nonce:'0x1234'});Object.assign(receipt,{from:relay,to:SUPPLY_METAMASK.manager});
      (receipt.logs as unknown[]).push({address:SUPPLY_METAMASK.limited,topics:[supplyTopic('IncreasedCount(address,address,bytes32,uint256,uint256)'), '0x'+supplyWord(SUPPLY_METAMASK.manager),'0x'+supplyWord(relay),hash],data:'0x'+supplyWord(1n)+supplyWord(1n)}, {address:SUPPLY_METAMASK.manager,topics:[supplyTopic('RedeemedDelegation(address,address,(address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))'),'0x'+supplyWord(REPAY_OWNER),'0x'+supplyWord(relay)],data:'0x'+supplyWord(32n)+decoded.delegationTuple.slice(2)});
      counts.set(hash,Number(BigInt(receipt.blockNumber as string)));m.state.nonce--;m.state.nativeBalance+=BigInt(receipt.gasUsed as string)*BigInt(receipt.effectiveGasPrice as string);m.history.set(Number(BigInt(receipt.blockNumber as string)),{...m.state});
    }
    return result;
  };
  const input={rpc,journalDir:await mkdtemp(join(tmpdir(),'gryloo-repay-wrapped-')),provenance:'MOCKED' as const},s=createSupplyService(input),w=repayWorkflow(),r=await s.simulate(w,REPAY_OWNER);await s.review(r.id,r.review.commitment,w);
  const a=await s.begin(r.id,REPAY_OWNER,w);await s.handoff(r.id,'APPROVAL',true);const h=await rpc('MOCK_submit',[a.transaction]) as string;await s.report(r.id,'APPROVAL',{kind:'HASH',hash:h});const approval=await s.observe(r.id);
  expect(approval.attempts[0]).toMatchObject({reconciled:true,ownerNonceAfter:'0'});
  const restarted=createSupplyService(input),b=await restarted.begin(r.id,REPAY_OWNER,w);expect(b.step).toBe('REPAY');expect(b.transaction.nonce).toBe('0x0');await restarted.handoff(r.id,'REPAY',true);const hash=await rpc('MOCK_submit',[b.transaction]) as string;await restarted.report(r.id,'REPAY',{kind:'HASH',hash});const o=await restarted.observe(r.id);
  expect(o.verdict).toBe('RECONCILED');expect(o.evidence?.publicExecution).toMatchObject({walletDelta:'-5000',ownerAuthorization:{kind:'METAMASK_EIP7702',owner:REPAY_OWNER,ownerNonceBefore:'0',ownerNonceAfter:'0'}});expect(m.transactions).toHaveLength(2);
});
