// SPDX-License-Identifier: AGPL-3.0-only
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {decodeSupplyWalletEnvelope,SUPPLY_METAMASK,supplyWord,supplyTopic,type SupplyRpc,type SupplyTransaction} from '@defi-workflow-engine/reference-compiler';
import {verifySupplyWalletEnvelope} from '../src/supply.js';
import {reconcileLendingAttempt,type LendingChainAttempt} from '../src/lending-composition.js';
import type {LendingReview} from '@defi-workflow-engine/reference-compiler';

// Real public Base Sepolia MetaMask relayed redemption (type 2, depth 1, no authorizationList,
// owner already EIP-7702-delegated) with the historical reads its verification needs.
type Read={method:string;params:unknown[];result:unknown};
type Log={address:string;topics:string[];data:string;removed?:boolean};
const f=JSON.parse(readFileSync(new URL('./testdata/metamask-relayed-type2-depth1.base-sepolia.json',import.meta.url),'utf8')) as {
  owner:string;reviewedCall:{target:string;data:string;value:string};transaction:Record<string,unknown>&{input:string;hash:string};
  receipt:Record<string,unknown>&{logs:Log[];blockNumber:string;blockHash:string};canonicalBlock:{number:string;hash:string;transactions:string[]};reads:Read[]};
const ZERO='0x'+'0'.repeat(64),PRE='0x2d6fccb',POST='0x2d6fccc';
const redeemed=supplyTopic('RedeemedDelegation(address,address,(address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))');
const counted=supplyTopic('IncreasedCount(address,address,bytes32,uint256,uint256)');
const replay=(patch?:(method:string,params:unknown[],result:unknown)=>unknown):SupplyRpc=>async(method,params)=>{
  const read=f.reads.find(r=>r.method===method&&JSON.stringify(r.params)===JSON.stringify(params));
  if(!read)throw Error('UNRECORDED_READ');
  return patch?patch(method,params,read.result):read.result;
};
const reviewed=(over:Partial<SupplyTransaction>={})=>({from:f.owner,to:f.reviewedCall.target,data:f.reviewedCall.data,value:'0x0',chainId:'0x14a34',...over}) as SupplyTransaction;
const verify=(o:{rpc?:SupplyRpc;tx?:Record<string,unknown>;logs?:Log[];call?:Partial<SupplyTransaction>;nonce?:string;owner?:string}={})=>
  verifySupplyWalletEnvelope({account:o.owner??f.owner},{transaction:reviewed(o.call),nonce:o.nonce??'5'},{...f.transaction,...o.tx},{...f.receipt,...(o.logs?{logs:o.logs}:{})},o.rpc??replay());
function depthTwo(input:string):string {
  // Point the decoder at a permission context claiming two chained delegations.
  const hex=input.slice(10),word=(at:number)=>Number(BigInt('0x'+hex.slice(at*2,at*2+64)));
  const outer=word(0),element=outer+32+word(outer+32),count=element+32+32;
  return input.slice(0,10)+hex.slice(0,count*2)+supplyWord(2n)+hex.slice(count*2+64);
}
function innerValue(input:string):string {
  // The redeemed execution (target ‖ value ‖ calldata) is the last copy in the envelope; give it 1 wei.
  const packed=f.reviewedCall.target.slice(2)+supplyWord(0n)+f.reviewedCall.data.slice(2),at=input.lastIndexOf(packed);
  return input.slice(0,at)+f.reviewedCall.target.slice(2)+supplyWord(1n)+input.slice(at+40+64);
}

describe('real MetaMask relayed type-2 depth-1 redemption',()=>{
  it('is the exact already-delegated envelope shape',()=>{
    expect(f.transaction.type).toBe('0x2');expect('authorizationList' in f.transaction).toBe(false);
    expect(f.transaction.to).toBe(SUPPLY_METAMASK.manager);expect(f.transaction.from).not.toBe(f.owner);
    const e=decodeSupplyWalletEnvelope(f.transaction.input);
    expect(e).toMatchObject({owner:f.owner,delegate:'0x0000000000000000000000000000000000000a11',call:{to:f.reviewedCall.target,data:f.reviewedCall.data,value:'0'}});
    expect(e.caveats.map(c=>c.enforcer)).toEqual([SUPPLY_METAMASK.limited,SUPPLY_METAMASK.exact]);
  });
  it('verifies exact inner call, manager and delegator code, unchanged owner nonce and the Redeemed/IncreasedCount events',async()=>{
    const proof=await verify();
    expect(proof).toMatchObject({kind:'METAMASK_EIP7702',owner:f.owner,outerSender:f.transaction.from,outerDestination:SUPPLY_METAMASK.manager,ownerAuthorizationNonce:null,
      ownerNonceBefore:'5',ownerNonceAfter:'5',callCountBefore:'0',callCountAfter:'1',authorization:null,ownerNativeCost:'0'});
    expect(proof.codeHashes).toEqual([...SUPPLY_METAMASK.codeHashes]);
  });
  const code=(address:string,tag:string,value:string)=>replay((m,p,r)=>m==='eth_getCode'&&p[0]===address&&p[1]===tag?value:r);
  const logs=(change:(l:Log[])=>Log[])=>change(structuredClone(f.receipt.logs));
  it.each<[string,Parameters<typeof verify>[0]]>([
    ['inner target',{call:{to:'0x'+'1'.repeat(40)}}],
    ['inner calldata',{call:{data:f.reviewedCall.data.slice(0,-1)+'1'}}],
    ['inner execution value',{tx:{input:innerValue(f.transaction.input)}}],
    ['owner',{owner:'0x'+'2'.repeat(40)}],
    ['outer destination',{tx:{to:'0x'+'3'.repeat(40)}}],
    ['owner-sent outer transaction',{tx:{from:f.owner}}],
    ['tampered delegation signature',{tx:{input:f.transaction.input.slice(0,-200)+(f.transaction.input.slice(-200,-199)==='0'?'1':'0')+f.transaction.input.slice(-199)}}],
    ['depth-2 permission context',{tx:{input:depthTwo(f.transaction.input)}}],
    ['authorizationList on a type-2 envelope',{tx:{authorizationList:[{chainId:'0x14a34',address:SUPPLY_METAMASK.implementation,nonce:'0x5',yParity:'0x0',r:'0x1',s:'0x1'}]}}],
    ['reviewed owner nonce',{nonce:'4'}],
    ['owner not delegated before',{rpc:code(f.owner,PRE,'0x')}],
    ['owner delegated elsewhere after',{rpc:code(f.owner,POST,'0xef0100'+'4'.repeat(40))}],
    ['owner nonce advanced',{rpc:replay((m,p,r)=>m==='eth_getTransactionCount'&&p[1]===POST?'0x6':r)}],
    ['manager code',{rpc:code(SUPPLY_METAMASK.manager,POST,'0x00')}],
    ['delegation already redeemed',{rpc:replay((m,p,r)=>m==='eth_call'&&(p[0] as {to:string}).to===SUPPLY_METAMASK.limited&&p[1]===PRE?'0x'+supplyWord(1n):r)}],
    ['missing Redeemed event',{logs:logs(l=>l.filter(x=>x.topics[0]!==redeemed))}],
    ['duplicated Redeemed event',{logs:logs(l=>[...l,...l.filter(x=>x.topics[0]===redeemed)])}],
    ['removed Redeemed event',{logs:logs(l=>l.map(x=>x.topics[0]===redeemed?{...x,removed:true}:x))}],
    ['Redeemed by another redeemer',{logs:logs(l=>l.map(x=>x.topics[0]===redeemed?{...x,topics:[x.topics[0]!,x.topics[1]!,'0x'+supplyWord('0x'+'5'.repeat(40))]}:x))}],
    ['missing IncreasedCount event',{logs:logs(l=>l.filter(x=>x.topics[0]!==counted))}],
  ])('fails closed on a changed %s',async(_,variant)=>{
    await expect(verify(variant)).rejects.toThrow(/^SUPPLY_(ENVELOPE|OWNER_AUTHORIZATION|WALLET_CODE)_MISMATCH$/);
  });
});

describe('canonical inclusion before a lending receipt becomes evidence',()=>{
  const attempt:LendingChainAttempt={id:'lending-x.POOL_APPROVAL.0',call:{id:'POOL_APPROVAL',nodeId:'n',tx:reviewed(),gasLimit:'100000'} as LendingChainAttempt['call'],
    nonce:'5',hash:f.transaction.hash,preparedAtBlock:Number(BigInt(PRE)),reviewCommitment:'0x'};
  const review={commitment:'0x',fields:{owner:f.owner}} as unknown as LendingReview;
  const chain=(o:{tx?:Record<string,unknown>;receipt?:Record<string,unknown>;block?:unknown;latest?:string}):SupplyRpc=>async method=>({
    eth_chainId:'0x14a34',eth_getTransactionByHash:{...f.transaction,...o.tx},eth_getTransactionReceipt:{...f.receipt,...o.receipt},
    eth_getBlockByNumber:'block' in o?o.block:f.canonicalBlock,eth_blockNumber:o.latest??POST} as Record<string,unknown>)[method];
  it.each<[string,Parameters<typeof chain>[0]]>([
    ['a Flashblocks-preconfirmed receipt in an unsealed block',{tx:{blockHash:ZERO},receipt:{blockHash:ZERO},block:null}],
    ['a preconfirmed receipt whose block is sealed meanwhile',{tx:{blockHash:ZERO},receipt:{blockHash:ZERO}}],
    ['a transaction readback without a block yet',{tx:{blockHash:null,blockNumber:null,transactionIndex:null}}],
    ['a receipt from a non-canonical block',{block:{...f.canonicalBlock,hash:'0x'+'cd'.repeat(32)}}],
    ['a canonical block that does not list the transaction',{block:{...f.canonicalBlock,transactions:f.canonicalBlock.transactions.filter(h=>h!==f.transaction.hash)}}],
  ])('keeps observing %s: never a mismatch, never evidence',async(_,variant)=>{
    const o=await reconcileLendingAttempt(review,attempt,chain(variant));
    expect(o).toMatchObject({verdict:'INCONCLUSIVE',reason:'LENDING_RECEIPT_NOT_CANONICAL',transaction:null,receipt:null,ownerProof:null});
  });
  it('accepts only the sealed canonical block that lists the transaction',async()=>{
    const o=await reconcileLendingAttempt(review,attempt,chain({}));
    expect(o).toMatchObject({verdict:'INCONCLUSIVE',reason:'AWAITING_CONFIRMATIONS'});expect((o.receipt as {blockHash:string}).blockHash).toBe(f.canonicalBlock.hash);
    expect(f.canonicalBlock.hash).not.toBe(ZERO);expect(f.canonicalBlock.transactions).toContain(f.transaction.hash);
  });
  it('still rejects a receipt before the prepared block as a mismatch',async()=>{
    const o=await reconcileLendingAttempt(review,{...attempt,preparedAtBlock:Number(BigInt(POST))+1},chain({}));
    expect(o).toMatchObject({verdict:'DIVERGENT',reason:'LENDING_CANONICAL_INCLUSION_MISMATCH'});
  });
});
