// SPDX-License-Identifier: AGPL-3.0-only
import { describe,it,expect } from 'vitest';
import { readRepayNode,createRepayNode } from '@defi-workflow-engine/workflow-contracts';
import { resolveNodeCapability } from '@defi-workflow-engine/action-registry';
import { compileRepayCalls,simulateSupply,assertSupplyReview,supplyCall,AAVE_V3_BASE_SEPOLIA as p } from '../src/index.js';
import { repayModel,repayWorkflow,REPAY_OWNER } from '../../../apps/reference-dapp/e2e/repay-fixtures';
describe('canonical Repay and exact read-only Review',()=>{
  it('declares an environment-independent lending action and restricts runtime capability',()=>{
    const node=repayWorkflow().nodes[0]!,fields=readRepayNode(node);
    expect(node).toMatchObject({actionType:'repay',requiredCapabilities:['aave-v3.repay']});expect(fields).toMatchObject({amount:'5000',interestRateMode:2,beneficiary:REPAY_OWNER});
    expect(resolveNodeCapability(node,{environment:'PUBLIC_TESTNET'}).capabilities.EXECUTE).toBe(true);
    for(const environment of ['MOCK','LOCAL_FORK','MAINNET'])expect(resolveNodeCapability(node,{environment}).capabilities.EXECUTE).toBe(false);
    for(const amount of ['0','0.005',(1n<<256n).toString(),((1n<<256n)-1n).toString()])expect(()=>createRepayNode('repay',{...fields,amount})).toThrow();
    expect(()=>createRepayNode('repay',{...fields,interestRateMode:1 as 2})).toThrow();
    expect(()=>readRepayNode({...node,requiredCapabilities:['aave-v3.borrow']})).toThrow('DECLARATION');
  });
  it('encodes exactly approve(Pool,5000) then repay(asset,5000,2,owner)',()=>{
    const calls=compileRepayCalls(repayWorkflow(),REPAY_OWNER,'0');expect(calls).toHaveLength(2);
    expect(calls[0]!.data).toBe(supplyCall('approve(address,uint256)',p.pool,5000n));
    expect(calls[1]!.data).toBe(supplyCall('repay(address,uint256,uint256,address)',p.asset,5000n,2n,REPAY_OWNER));
    expect(calls[1]!.data.slice(0,10)).toBe('0x573ade81');expect(calls[1]).not.toHaveProperty('nonce');
    expect(compileRepayCalls(repayWorkflow(),REPAY_OWNER,'5000')).toHaveLength(1);
    expect(()=>compileRepayCalls(repayWorkflow(),'0x'+'2'.repeat(40),'0')).toThrow('OWNER');
  });
  it('reads wallet, allowance, debt/index, collateral and costs without any submission',async()=>{
    const m=repayModel(),r=await simulateSupply(repayWorkflow(),REPAY_OWNER,m.rpc);
    expect(r.repay).toMatchObject({interestRateMode:2,debtAfter:'5002'});expect(r.approvalRequired).toBe(true);
    expect(r.state).toMatchObject({balance:'10000',allowance:'0',borrow:{debt:'10001',scaledDebt:'8001'}});
    expect(BigInt(r.repay!.expectedPostHealthFactor)).toBeGreaterThan(BigInt(r.state.borrow!.healthFactor));
    expect(r.plan.segments[0]!.steps.map(s=>s.stepId)).toEqual(['supply-approval','aave-repay']);
    expect(r.policy.allowlists.functions.map(f=>f.functionId)).toEqual(['repay','approve']);
    expect(m.transactions).toHaveLength(0);expect(m.state.allowance).toBe(0n);expect(()=>assertSupplyReview(r,repayWorkflow(),REPAY_OWNER,r.state)).not.toThrow();
  });
  it.each(['balance','debt','no debt','paused','owner','allowance override'])('fails closed before Review for %s',async kind=>{
    const m=repayModel();if(kind==='balance')m.state.balance=4999n;if(kind==='debt')m.state.scaledDebt=4000n;if(kind==='no debt')m.state.scaledDebt=0n;if(kind==='paused')m.state.reserveConfig|=1n<<60n;if(kind==='allowance override')m.state.ignoreOverride=true;
    await expect(simulateSupply(repayWorkflow(),kind==='owner'?'0x'+'2'.repeat(40):REPAY_OWNER,m.rpc)).rejects.toThrow();expect(m.transactions).toHaveLength(0);
  });
  it.each(['amount','mode','owner','pool','payload','debt','scaled debt','price','allowance','expiry','metadata'])('invalidates reviewed %s changes',async kind=>{
    const m=repayModel(),w=repayWorkflow(),r=await simulateSupply(w,REPAY_OWNER,m.rpc),s=structuredClone(r.state);
    if(kind==='mode')r.repay!.interestRateMode=1 as 2;if(kind==='pool')r.pool='0x'+'2'.repeat(40);if(kind==='payload')r.transactions[1]!.data+='00';
    if(kind==='debt')s.borrow!.debt='20000';if(kind==='scaled debt')s.borrow!.scaledDebt='8000';if(kind==='price')s.borrow!.price='110000000';if(kind==='allowance')s.allowance='5000';
    const changed=kind==='amount'?repayWorkflow('4999'):kind==='metadata'?{...w,revision:1}:w;
    expect(()=>assertSupplyReview(r,changed,kind==='owner'?'0x'+'2'.repeat(40):REPAY_OWNER,s,kind==='expiry'?Date.parse(r.expiresAt):Date.now())).toThrow();
  });
  it('cannot downgrade a Repay review by removing its risk metadata',async()=>{
    const m=repayModel(),w=repayWorkflow(),r=await simulateSupply(w,REPAY_OWNER,m.rpc);delete r.repay;expect(()=>assertSupplyReview(r,w,REPAY_OWNER,r.state)).toThrow('REPAY_AUTHORIZATION_INVALID');
  });
});
