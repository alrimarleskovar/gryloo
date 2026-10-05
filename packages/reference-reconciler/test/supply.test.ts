// SPDX-License-Identifier: AGPL-3.0-only
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSupplyService} from '../../../apps/reference-dapp/src/server/supply-service';
import {createSupplyRun,prepareSupplyAttempt} from '../../reference-executor/src/supply.js';
import {describe,it,expect} from 'vitest';
import {secp256k1} from '@noble/curves/secp256k1.js';
import {keccak_256} from '@noble/hashes/sha3.js';
import {createSupplyNode,createBorrowNode,type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
import {simulateSupply,AAVE_V3_BASE_SEPOLIA as p,supplyHex,supplyCall,supplyWord,supplyTopic,encodeSupplyWalletEnvelope,decodeSupplyWalletEnvelope,SUPPLY_METAMASK,fromHex,toHex,type SupplyRpc} from '@defi-workflow-engine/reference-compiler';
import {reconcileSupplyAttempt,verifySupplyPosition,buildSupplyEvidence,supplyWalletDelegationDigest} from '../src/supply.js';
import {supplyModel,SUPPLY_OWNER,realWrappedApprovalFixture as wrappedApprovalFixture} from '../../../apps/reference-dapp/e2e/supply-fixtures';
const workflow:SemanticWorkflow={schemaVersion:'1.0.0',workflowId:'supply',revision:0,nodes:[createSupplyNode('supply',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'10000000',beneficiary:SUPPLY_OWNER})],resourceEdges:[]};
async function executed(){const model=supplyModel();model.state.allowance=10000000n;const review=await simulateSupply(workflow,SUPPLY_OWNER,model.rpc);const transaction=review.transactions[0]!;
  const hash=await model.rpc('MOCK_submit',[{...transaction,nonce:'0x0',gas:supplyHex(review.gasLimits[0]!),gasPrice:'0x1e8480'}]) as string;
  return {model,review,attempt:{step:'SUPPLY' as const,nonce:'0',transaction,transactionHash:hash,preparedAtBlock:10}};}
describe('independent Aave Supply reconciliation',()=>{
  it('requires real position readback and exact transaction/events',async()=>{const {model,review,attempt}=await executed();const observed=await reconcileSupplyAttempt(review,attempt,model.rpc);expect(observed.verdict).toBe('RECONCILED');expect(observed.delta).toBe('10000000');expect(observed.scaledDelta).toBe('8000000');expect(observed.cost).toBe('140000000000');});
  it.each(['pool','account','calldata','amount','chain','beneficiary','position','revert','canonical','gas','fee'])('rejects inconsistent %s evidence',async kind=>{
    const {model,review,attempt}=await executed(),tx=model.transactions[0]!,receipt=model.receipts.get(attempt.transactionHash)!;
    if(kind==='pool')tx.to='0x'+'2'.repeat(40);if(kind==='account')tx.from='0x'+'2'.repeat(40);if(kind==='calldata')tx.input='0xdeadbeef';if(kind==='amount')review.amount='20000000';
    if(kind==='chain')model.state.chain='0x1';if(kind==='beneficiary')review.beneficiary='0x'+'2'.repeat(40);
    if(kind==='gas')tx.gas='0xffffff';if(kind==='fee')tx.gasPrice='0xffffff';
    if(kind==='position'){const state=model.history.get(11) as {scaled:bigint};state.scaled+=100n;}
    if(kind==='revert')receipt.status='0x0';if(kind==='canonical')receipt.blockHash='0x'+'a'.repeat(64);
    expect((await reconcileSupplyAttempt(review,attempt,model.rpc)).verdict).toBe('DIVERGENT');
  });
  it('RPC failure remains inconclusive even with a successful receipt',async()=>{const {model,review,attempt}=await executed();const rpc=async(method:string,params:readonly unknown[])=>{if(method==='eth_call')throw new Error('RPC_FAILED');return model.rpc(method,params);};expect((await reconcileSupplyAttempt(review,attempt,rpc)).verdict).toBe('INCONCLUSIVE');});
  it('accounts for index growth and bounded rounding rather than raw balance delta',()=>{
    expect(verifySupplyPosition('10',{scaledPosition:'80',position:'100',index:(125n*10n**25n).toString()},{scaledPosition:'88',position:'119',index:(135n*10n**25n).toString()})).toEqual({delta:'11',scaledDelta:'8'});
    expect(()=>verifySupplyPosition('10',{scaledPosition:'80',position:'100',index:(125n*10n**25n).toString()},{scaledPosition:'80',position:'110',index:(1375n*10n**24n).toString()})).toThrow('POSITION');
  });
  it('cannot promote unverified/receipt-only evidence',()=>{expect(()=>buildSupplyEvidence({id:'supply',review:{} as never,journal:{} as never,provenance:'PUBLIC_TESTNET',ownerInitiated:true,observations:[]})).toThrow('NOT_RECONCILED');});
});


function capturedApproval(mutate?:(tx:Record<string,unknown>)=>void){
  const responses=structuredClone(wrappedApprovalFixture.responses);
  const key=JSON.stringify(['eth_getTransactionByHash',[wrappedApprovalFixture.attempt.transactionHash]]);
  if(mutate)mutate(responses[key] as Record<string,unknown>);
  const rpc:SupplyRpc=async(method,params)=>{
    const answer=responses[JSON.stringify([method,params])];
    if(answer===undefined)throw new Error(`UNRECORDED_PUBLIC_RPC: ${method}`);
    return structuredClone(answer);
  };
  return {rpc,review:structuredClone(wrappedApprovalFixture.review),attempt:structuredClone(wrappedApprovalFixture.attempt)};
}
const packedCall=(call:{to:string;value:string;data:string})=>'0x'+call.to.slice(2)+supplyWord(BigInt(call.value))+call.data.slice(2);
function changeCapturedInnerCall(tx:Record<string,unknown>,changes:Partial<{owner:string;to:string;data:string;signature:string}>){
  const e=decodeSupplyWalletEnvelope(tx.input);
  const call={...e.call,...changes.to?{to:changes.to}:{},...changes.data?{data:changes.data}:{}};
  tx.input=encodeSupplyWalletEnvelope({...e,owner:changes.owner??e.owner,signature:changes.signature??e.signature,call,
    caveats:[e.caveats[0]!,{...e.caveats[1]!,terms:packedCall(call)}]});
}

describe('real MetaMask EIP-7702 approval envelope',()=>{
  it('proves the observed owner signature, exact inner approval, enforcers, event, and allowance',async()=>{
    const {rpc,review,attempt}=capturedApproval();
    const result=await reconcileSupplyAttempt(review,attempt,rpc);
    expect(result.verdict).toBe('RECONCILED');
    expect(result.reason).toBe('EXACT_APPROVAL_VERIFIED');
    expect(result.walletEnvelope).toMatchObject({kind:'METAMASK_EIP7702',owner:review.account,outerDestination:SUPPLY_METAMASK.manager,
      relayNonce:'119621',ownerAuthorizationNonce:'3',ownerNonceBefore:'3',ownerNonceAfter:'4',callCountBefore:'0',callCountAfter:'1'});
    expect(result.walletEnvelope?.delegation.call).toEqual({to:p.asset,value:'0',data:supplyCall('approve(address,uint256)',p.pool,1_000_000n)});
    expect(result.postPosition?.allowance).toBe('1000000');
    expect(result.walletEnvelope?.outerSender).not.toBe(review.account);
  });
  it.each(['owner','token','spender','amount','signature','code'])('rejects %s despite a matching Approval event',async kind=>{
    const {rpc,review,attempt}=capturedApproval(tx=>{
      if(kind==='owner')changeCapturedInnerCall(tx,{owner:'0x'+'1'.repeat(40)});
      if(kind==='token')changeCapturedInnerCall(tx,{to:'0x'+'2'.repeat(40)});
      if(kind==='spender')changeCapturedInnerCall(tx,{data:supplyCall('approve(address,uint256)','0x'+'3'.repeat(40),1_000_000n)});
      if(kind==='amount')changeCapturedInnerCall(tx,{data:supplyCall('approve(address,uint256)',p.pool,2_000_000n)});
      if(kind==='signature'){const e=decodeSupplyWalletEnvelope(tx.input);changeCapturedInnerCall(tx,{signature:e.signature.slice(0,-2)+(e.signature.endsWith('01')?'02':'01')});}
    });
    const guardedRpc:SupplyRpc=async(method,params)=>kind==='code'&&method==='eth_getCode'&&params[0]===SUPPLY_METAMASK.exact?'0x6000':rpc(method,params);
    const result=await reconcileSupplyAttempt(review,attempt,guardedRpc);
    expect(result.verdict).toBe('DIVERGENT');
  });
});

async function syntheticWrappedSupply(borrow=false){
  // The signed real approval fixture supplies verified deployed contract bytes; all economic state is local.
  const key=new Uint8Array(32).fill(0x42),publicKey=secp256k1.getPublicKey(key,false);
  const owner=toHex(keccak_256(publicKey.slice(1)).slice(12)),relay='0x'+'b'.repeat(40);
  const model=supplyModel();model.state.owner=owner;model.state.allowance=1_000_000n;model.history.set(10,{...model.state});
  const supplyWorkflow:SemanticWorkflow={...workflow,nodes:[borrow?createBorrowNode('borrow',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'1000000',beneficiary:owner,interestRateMode:2}):createSupplyNode('supply',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'1000000',beneficiary:owner})]};
  const review=await simulateSupply(supplyWorkflow,owner,model.rpc);
  expect(review.approvalRequired).toBe(false);
  const direct=review.transactions[0]!;
  const hash=await model.rpc('MOCK_submit',[{...direct,nonce:'0x0',gas:supplyHex(review.gasLimits[0]!),gasPrice:supplyHex(review.gasPrice)}]) as string;
  const tx=model.transactions[0]!,receipt=model.receipts.get(hash)!;
  const call={to:p.pool,value:'0',data:direct.data};
  const draft={owner,delegate:'0x0000000000000000000000000000000000000a11',salt:'7',signature:'0x'+'00'.repeat(65),call,
    caveats:[{enforcer:SUPPLY_METAMASK.limited,terms:'0x'+supplyWord(1n),args:'0x'},
      {enforcer:SUPPLY_METAMASK.exact,terms:packedCall(call),args:'0x'}]};
  const digest=supplyWalletDelegationDigest({...draft,delegationTuple:''},84532).digest;
  const signatureBytes=secp256k1.sign(fromHex(digest),key,{prehash:false});
  const recovery=[0,1].find(i=>{
    const recovered=secp256k1.Signature.fromBytes(signatureBytes).addRecoveryBit(i).recoverPublicKey(fromHex(digest)).toBytes(false);
    return Buffer.from(recovered).equals(Buffer.from(publicKey));
  });
  if(recovery===undefined)throw new Error('SYNTHETIC_SIGNATURE_FAILED');
  const envelope=encodeSupplyWalletEnvelope({...draft,signature:toHex(signatureBytes)+(27+recovery).toString(16)});
  tx.from=relay;tx.to=SUPPLY_METAMASK.manager;tx.input=envelope;tx.nonce='0x1234';tx.type='0x2';
  receipt.from=relay;receipt.to=SUPPLY_METAMASK.manager;
  const decoded=decodeSupplyWalletEnvelope(envelope),delegationHash=supplyWalletDelegationDigest(decoded,84532).delegationHash;
  (receipt.logs as Record<string,unknown>[]).push(
    {address:SUPPLY_METAMASK.limited,topics:[supplyTopic('IncreasedCount(address,address,bytes32,uint256,uint256)'),
      '0x'+supplyWord(SUPPLY_METAMASK.manager),'0x'+supplyWord(relay),delegationHash],data:'0x'+supplyWord(1n)+supplyWord(1n)},
    {address:SUPPLY_METAMASK.manager,topics:[supplyTopic('RedeemedDelegation(address,address,(address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))'),
      '0x'+supplyWord(owner),'0x'+supplyWord(relay)],data:'0x'+supplyWord(32n)+decoded.delegationTuple.slice(2)});
  model.state.nonce=0;model.history.set(11,{...model.state});
  const codeResponses=wrappedApprovalFixture.responses;
  const codeByAddress=new Map([SUPPLY_METAMASK.manager,SUPPLY_METAMASK.implementation,SUPPLY_METAMASK.limited,SUPPLY_METAMASK.exact].map(address=>{
    const match=Object.entries(codeResponses).find(([key])=>key.startsWith(JSON.stringify(['eth_getCode',[address]]).slice(0,-2)));
    if(!match)throw new Error('CAPTURED_CODE_MISSING');return [address,match[1]] as const;
  }));
  const getDomain=codeResponses[JSON.stringify(['eth_call',[{to:SUPPLY_METAMASK.manager,data:supplyCall('getDomainHash()')},'0x2d57f4a']])];
  const delegationManager=codeResponses[JSON.stringify(['eth_call',[{to:SUPPLY_METAMASK.implementation,data:supplyCall('delegationManager()')},'0x2d57f4a']])];
  if(!getDomain||!delegationManager)throw new Error('CAPTURED_DOMAIN_MISSING');
  const rpc:SupplyRpc=async(method,params)=>{
    if(method==='eth_getCode'){
      if(params[0]===owner)return '0xef0100'+SUPPLY_METAMASK.implementation.slice(2);
      const code=codeByAddress.get(params[0] as string);if(code)return code;
    }
    if(method==='eth_call'){
      const call=params[0] as {to:string;data:string};
      if(call.to===SUPPLY_METAMASK.manager&&call.data===supplyCall('getDomainHash()'))return getDomain;
      if(call.to===SUPPLY_METAMASK.implementation&&call.data===supplyCall('delegationManager()'))return delegationManager;
      if(call.to===SUPPLY_METAMASK.limited&&call.data.startsWith(supplyCall('callCounts(address,bytes32)').slice(0,10)))return '0x'+supplyWord(params[1]==='0xa'?0n:1n);
    }
    return model.rpc(method,params);
  };
  const attempt={step:borrow?'BORROW' as const:'SUPPLY' as const,nonce:'0',transaction:direct,transactionHash:hash,preparedAtBlock:10};
  return {review,attempt,model,rpc,owner,tx,receipt};
}

describe('owner-authorized wrapped Aave Supply',()=>{
  it('reconciles the exact signed inner Supply, event and position delta',async()=>{
    const {review,attempt,rpc,owner}=await syntheticWrappedSupply();const result=await reconcileSupplyAttempt(review,attempt,rpc);
    expect(result).toMatchObject({verdict:'RECONCILED',reason:'SUPPLY_TRANSACTION_AND_POSITION_VERIFIED',delta:'1000000'});
    expect(result.walletEnvelope).toMatchObject({owner,outerDestination:SUPPLY_METAMASK.manager,ownerAuthorizationNonce:null,ownerNonceBefore:'0',ownerNonceAfter:'0'});
    expect(result.walletEnvelope?.delegation.call).toEqual({to:p.pool,value:'0',data:supplyCall('supply(address,uint256,address,uint16)',p.asset,1_000_000n,owner,0n)});
  });
  it.each(['pool','amount','beneficiary','signature','event','position'])('rejects wrapped Supply with wrong %s',async kind=>{
    const {review,attempt,rpc,tx,receipt,model,owner}=await syntheticWrappedSupply();
    if(['pool','amount','beneficiary','signature'].includes(kind)){
      const e=decodeSupplyWalletEnvelope(tx.input);
      const call={...e.call};
      if(kind==='pool')call.to='0x'+'3'.repeat(40);
      if(kind==='amount')call.data=supplyCall('supply(address,uint256,address,uint16)',p.asset,2_000_000n,owner,0n);
      if(kind==='beneficiary')call.data=supplyCall('supply(address,uint256,address,uint16)',p.asset,1_000_000n,'0x'+'4'.repeat(40),0n);
      tx.input=encodeSupplyWalletEnvelope({...e,call,caveats:[e.caveats[0]!,{...e.caveats[1]!,terms:packedCall(call)}],
        signature:kind==='signature'?e.signature.slice(0,-2)+'1b':e.signature});
    }
    if(kind==='event')(receipt.logs as Record<string,unknown>[]).splice(0,1);
    if(kind==='position')(model.history.get(11) as {scaled:bigint}).scaled+=100n;
    expect((await reconcileSupplyAttempt(review,attempt,rpc)).verdict).toBe('DIVERGENT');
  });
});


describe('owner-authorized wrapped Aave Borrow reuses the verified envelope model',()=>{
  it('proves owner signature, exact Borrow and independent wallet/debt/health effects',async()=>{
    const {review,attempt,rpc,owner}=await syntheticWrappedSupply(true);
    const result=await reconcileSupplyAttempt(review,attempt,rpc);
    expect(result).toMatchObject({verdict:'RECONCILED',reason:'BORROW_TRANSACTION_DEBT_BALANCE_AND_HEALTH_VERIFIED',delta:'1000000',walletDelta:'1000000',debtDelta:'1000000'});
    expect(result.walletEnvelope).toMatchObject({owner,ownerNonceBefore:'0',ownerNonceAfter:'0',callCountBefore:'0',callCountAfter:'1'});
  });
  it.each(['pool','amount','beneficiary','rate','signature','event','debt','wallet','health'])('rejects wrapped Borrow with wrong %s',async kind=>{
    const {review,attempt,rpc,tx,receipt,model,owner}=await syntheticWrappedSupply(true);
    const e=decodeSupplyWalletEnvelope(tx.input),call={...e.call};
    if(kind==='pool')call.to='0x'+'3'.repeat(40);
    if(kind==='amount')call.data=supplyCall('borrow(address,uint256,uint256,uint16,address)',p.asset,2000000n,2n,0n,owner);
    if(kind==='beneficiary')call.data=supplyCall('borrow(address,uint256,uint256,uint16,address)',p.asset,1000000n,2n,0n,'0x'+'4'.repeat(40));
    if(kind==='rate')call.data=supplyCall('borrow(address,uint256,uint256,uint16,address)',p.asset,1000000n,1n,0n,owner);
    if(['pool','amount','beneficiary','rate','signature'].includes(kind))tx.input=encodeSupplyWalletEnvelope({...e,call,caveats:[e.caveats[0]!,{...e.caveats[1]!,terms:packedCall(call)}],signature:kind==='signature'?'0x'+'00'.repeat(65):e.signature});
    if(kind==='event')(receipt.logs as Record<string,unknown>[]).splice(0,1);
    if(kind==='debt')(model.history.get(11) as {scaledDebt:bigint}).scaledDebt+=100n;
    if(kind==='wallet')(model.history.get(11) as {balance:bigint}).balance+=1n;
    const guarded:SupplyRpc=async(method,params)=>{
      if(kind==='health'&&method==='eth_call'&&(params[0] as {data:string}).data===supplyCall('getUserAccountData(address)',owner)&&params[1]==='0xb'){
        const data=await rpc(method,params) as string;return data.slice(0,-64)+supplyWord(1n);
      }
      return rpc(method,params);
    };
    expect((await reconcileSupplyAttempt(review,attempt,guarded)).verdict).toBe('DIVERGENT');
  });
});


it('Borrow reuses an unchanged owner nonce only after independent proof of completed wrapped Supply',async()=>{
  const f=await syntheticWrappedSupply(),id='supply-'+ 'a'.repeat(32),journalDir=await mkdtemp(join(tmpdir(),'gryloo-borrow-after-supply-'));
  const service=createSupplyService({rpc:f.rpc,journalDir,provenance:'MOCKED'});
  const prior={...prepareSupplyAttempt({...createSupplyRun(id,f.review,'MOCKED'),authorization:f.review.commitment},10,'0'),observations:[],evidence:null,error:null};
  await writeFile(join(journalDir,id+'.jsonl'),JSON.stringify(prior)+'\n');
  await writeFile(join(journalDir,`${f.owner}-0.intent`),JSON.stringify({id,step:'SUPPLY',transaction:prior.attempts[0]!.transaction})+'\n');
  await service.report(id,'SUPPLY',{kind:'HASH',hash:f.attempt.transactionHash});
  expect((await service.observe(id)).verdict).toBe('RECONCILED');
  const workflow:SemanticWorkflow={...f.review.workflow,revision:1,nodes:[createBorrowNode('borrow',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'10000',beneficiary:f.owner,interestRateMode:2})]};
  const next=await service.simulate(workflow,f.owner);await service.review(next.id,next.review.commitment,workflow);
  const begin=await service.begin(next.id,f.owner,workflow);expect(begin.step).toBe('BORROW');expect(begin.record.attempts[0]!.nonce).toBe('0');
  const lease=(await readFile(join(journalDir,`${f.owner}-0.intent`),'utf8')).trimEnd().split('\n').map(line=>JSON.parse(line));
  expect(lease.map(e=>e.step)).toEqual(['SUPPLY','BORROW']);
  await service.walletFailure(next.id,{invoked:false,transaction:null,calls:[],error:{message:'Transport failure'},code:'SUPPLY_RPC_ERROR_BEFORE_WALLET_SUBMISSION'});
  const recovered=await service.recoverReview(next.id);await service.review(recovered.id,recovered.review.commitment,workflow);
  expect((await service.begin(recovered.id,f.owner,workflow)).step).toBe('BORROW');
});
