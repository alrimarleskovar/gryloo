// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {createWithdrawNode,readWithdrawNode} from '@defi-workflow-engine/workflow-contracts';
import {resolveNodeCapability} from '@defi-workflow-engine/action-registry';
import {validateAuthoringWorkflow,createBaseSepoliaReviewContext} from '../../reference-linter/src/index.js';
import {simulateSupply,assertSupplyReview,compileWithdrawCalls,supplyCall,supplyHash,AAVE_V3_BASE_SEPOLIA as p} from '../src/index.js';
import {withdrawModel,withdrawWorkflow,WITHDRAW_OWNER as owner} from '../../../apps/reference-dapp/e2e/withdraw-fixtures';
describe('canonical Withdraw contract, capability, compiler and Review',()=>{
  it('authors owner semantics without an address and reads a closed declaration',()=>{
    const w=withdrawWorkflow(),node=w.nodes[0]!,f=readWithdrawNode(node);
    expect(f).toMatchObject({amount:'100000',recipient:'CONNECTED_OWNER'});expect(JSON.stringify(node)).not.toContain(owner);
    expect(validateAuthoringWorkflow(w,createBaseSepoliaReviewContext())).toEqual(w);
    expect(resolveNodeCapability(node,{environment:'PUBLIC_TESTNET'}).capabilities.EXECUTE).toBe(true);
    for(const environment of ['MOCK','LOCAL_FORK','MAINNET'])expect(resolveNodeCapability(node,{environment}).capabilities.EXECUTE).toBe(false);
    for(const amount of ['0','max','0.1',((1n<<256n)-1n).toString(),(1n<<256n).toString()])expect(()=>createWithdrawNode('withdraw',{...f,amount})).toThrow();
    expect(()=>createWithdrawNode('withdraw',{...f,recipient:owner as 'CONNECTED_OWNER'})).toThrow();
    expect(()=>readWithdrawNode({...node,requiredCapabilities:['aave-v3.repay']})).toThrow('DECLARATION');
    expect(()=>readWithdrawNode({...node,inputs:[...node.inputs,{name:'owner',kind:'ACCOUNT',value:{chainId:p.chain,address:owner}}]})).toThrow('DECLARATION');
  });
  it('encodes one exact withdraw(asset,100000,owner) and never approval',()=>{
    const calls=compileWithdrawCalls(withdrawWorkflow(),owner);expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({from:owner,to:p.pool,value:'0x0',chainId:p.chainHex,data:supplyCall('withdraw(address,uint256,address)',p.asset,100000n,owner)});
    expect(calls[0]!.data.slice(0,10)).toBe('0x69328dec');
  });
  it('simulates without signing, mutation, submission or allowance override',async()=>{
    const m=withdrawModel(),r=await simulateSupply(withdrawWorkflow(),owner,m.rpc);
    expect(r.withdraw).toMatchObject({walletAfter:'105000'});expect(r.approvalRequired).toBe(false);
    expect(BigInt(r.withdraw!.expectedPostHealthFactor)).toBeGreaterThan(154n*10n**18n);
    expect(r.plan.segments[0]!.steps.map(s=>s.stepId)).toEqual(['aave-withdraw']);expect(r.policy.allowlists.functions.map(f=>f.functionId)).toEqual(['withdraw']);
    expect(m.transactions).toHaveLength(0);expect(m.state.balance).toBe(5000n);expect(()=>assertSupplyReview(r,withdrawWorkflow(),owner,r.state)).not.toThrow();
  });
  it.each(['insufficient','unsafe','chain','profile','inconsistent','reserve','multi-reserve'])('fails closed on %s before Review',async kind=>{
    const m=withdrawModel();if(kind==='insufficient')m.state.scaled=100n;if(kind==='unsafe')m.state.scaledDebt=500000n;if(kind==='chain')m.state.chain='0x1';if(kind==='reserve')m.state.reserveConfig|=1n<<60n;if(kind==='multi-reserve')m.state.userConfig|=4n;
    const w=withdrawWorkflow();if(kind==='profile')w.nodes[0]=createWithdrawNode('withdraw',{...readWithdrawNode(w.nodes[0]!),asset:{chainId:p.chain,address:'0x'+'2'.repeat(40),decimals:6}});
    const rpc:typeof m.rpc=async(method,params)=>{const result=await m.rpc(method,params);if(kind==='inconsistent'&&method==='eth_call'&&(params[0] as {data:string}).data===supplyCall('balanceOf(address)',owner)&&(params[0] as {to:string}).to===p.aToken)return '0x1';return result;};
    await expect(simulateSupply(w,owner,rpc)).rejects.toThrow();expect(m.transactions).toHaveLength(0);
  });
  it.each(['workflow','owner','recipient','pool','asset','amount','calldata','expiry','collateral','debt','price','block','health'])('invalidates changed %s',async kind=>{
    const m=withdrawModel(),w=withdrawWorkflow(),r=await simulateSupply(w,owner,m.rpc),s=structuredClone(r.state);
    if(kind==='workflow')w.revision++;if(kind==='recipient')r.beneficiary='0x'+'2'.repeat(40);if(kind==='pool')r.pool='0x'+'2'.repeat(40);if(kind==='asset')r.asset='0x'+'2'.repeat(40);if(kind==='amount')r.amount='99999';if(kind==='calldata')r.transactions[0]!.data+='00';
    if(kind==='collateral')s.scaledPosition='800000';if(kind==='debt')s.borrow!.scaledDebt='3859';if(kind==='price')s.borrow!.price='1';if(kind==='block')s.block--;if(kind==='health')r.withdraw!.expectedPostHealthFactor='1';
    // Recommit mutated presentation to prove semantic checks also reject valid hashes.
    const content={...r} as Partial<typeof r>;delete content.commitment;r.commitment=supplyHash(content);
    expect(()=>assertSupplyReview(r,w,kind==='owner'?'0x'+'2'.repeat(40):owner,s,kind==='expiry'?Date.parse(r.expiresAt):Date.now())).toThrow();
  });
});
