// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {createBorrowNode,readBorrowNode,type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
import {compileBorrowCalls,simulateSupply,readBorrowState,estimateBorrow,borrowHealthFactor,assertSupplyReview,supplyCall,AAVE_V3_BASE_SEPOLIA as p} from '../src/index.js';
import {supplyModel,SUPPLY_OWNER} from '../../../apps/reference-dapp/e2e/supply-fixtures';
export const borrowWorkflow=(amount='10000',owner=SUPPLY_OWNER):SemanticWorkflow=>({schemaVersion:'1.0.0',workflowId:'borrow',revision:0,nodes:[createBorrowNode('borrow',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount,beneficiary:owner,interestRateMode:2})],resourceEdges:[]});
describe('Borrow semantics and conservative public-state review',()=>{
  it('canonical action binds chain, protocol, asset, native amount, beneficiary and variable mode',()=>{
    const w=borrowWorkflow();expect(w.nodes[0]).toMatchObject({actionType:'borrow',requiredCapabilities:['aave-v3.borrow'],adapterConstraints:{protocols:['aave-v3']}});
    expect(readBorrowNode(w.nodes[0]!)).toMatchObject({amount:'10000',beneficiary:SUPPLY_OWNER,interestRateMode:2});
    const f=readBorrowNode(w.nodes[0]!);expect(()=>createBorrowNode('borrow',{...f,interestRateMode:1 as 2})).toThrow('RATE_MODE');
    expect(()=>createBorrowNode('borrow',{...f,amount:'0'})).toThrow();
    expect(()=>createBorrowNode('borrow',{...f,amount:'0.01'})).toThrow();
    expect(()=>createBorrowNode('borrow',{...f,amount:(1n<<256n).toString()})).toThrow();
    expect(()=>readBorrowNode({...w.nodes[0]!,expectedOutputs:[{outputId:'extra',asset:f.asset,minimumAmount:'0'}]})).toThrow('DECLARATION');
  });
  it('encodes one exact borrow with no approval or caller nonce',()=>{
    const tx=compileBorrowCalls(borrowWorkflow(),SUPPLY_OWNER);expect(tx).toHaveLength(1);
    expect(tx[0]!.data).toBe('0xa415bcad'+'0'.repeat(24)+p.asset.slice(2)+10000n.toString(16).padStart(64,'0')+2n.toString(16).padStart(64,'0')+'0'.repeat(64)+'0'.repeat(24)+SUPPLY_OWNER.slice(2));
    expect(tx[0]).not.toHaveProperty('nonce');
    expect(()=>compileBorrowCalls(borrowWorkflow(), '0x'+'2'.repeat(40))).toThrow('BENEFICIARY');
    const wrong=borrowWorkflow();wrong.nodes[0]!.chainId='eip155:1';expect(()=>compileBorrowCalls(wrong,SUPPLY_OWNER)).toThrow();
  });
  it('simulates read-only with zero wallet USDC and zero allowance and binds risk artifacts',async()=>{
    const m=supplyModel();m.state.balance=0n;const r=await simulateSupply(borrowWorkflow(),SUPPLY_OWNER,m.rpc);
    expect(m.transactions).toHaveLength(0);expect(m.state.allowance).toBe(0n);expect(r.approvalRequired).toBe(false);
    expect(r.borrow).toMatchObject({interestRateMode:2,expectedPostHealthFactor:'860000000000000000000',debtAfterBase:'1000000'});
    expect(r.policy.allowlists.functions).toEqual([{chainId:p.chain,contract:p.pool,functionId:'borrow'}]);
    expect(r.policy.accountRiskRules[0]).toMatchObject({minimumHealthFactorNumerator:'2',minimumHealthFactorDenominator:'1'});
    expect(r.plan.segments[0]!.steps[0]!.stepId).toBe('aave-borrow');
    expect(()=>assertSupplyReview(r,borrowWorkflow(),SUPPLY_OWNER,r.state)).not.toThrow();
  });
  it.each(['collateral','capacity','unsafe','disabled','paused','frozen','liquidity','collateral disabled','oracle','debt token','chain'])('fails closed for %s',async kind=>{
    const m=supplyModel();
    if(kind==='collateral')m.state.scaled=0n;
    if(kind==='disabled')m.state.reserveConfig&=~(1n<<58n);
    if(kind==='paused')m.state.reserveConfig|=1n<<60n;
    if(kind==='frozen')m.state.reserveConfig|=1n<<57n;
    if(kind==='liquidity')m.state.liquidity=1n;
    if(kind==='collateral disabled')m.state.userConfig=0n;
    if(kind==='oracle')m.state.price=0n;
    if(kind==='chain')m.state.chain='0x1';
    const rpc=kind==='debt token'?async(method:string,params:readonly unknown[])=>method==='eth_call'&&(params[0] as {to:string;data:string}).to===p.variableDebtToken&&(params[0] as {data:string}).data===supplyCall('POOL()')?'0x'+ '2'.repeat(64):m.rpc(method,params):m.rpc;
    await expect(simulateSupply(borrowWorkflow(kind==='capacity'?'9000000':kind==='unsafe'?'5000000':'10000'),SUPPLY_OWNER,rpc)).rejects.toThrow();expect(m.transactions).toHaveLength(0);
  });
  it('validates risk integers and never represents no-debt as zero',async()=>{
    expect(borrowHealthFactor('100000000','8600','1000000')).toBe('86000000000000000000');
    expect(BigInt(borrowHealthFactor('100000000','8600','0'))).toBe((1n<<256n)-1n);
    for(const input of ['NaN','-1','1.5','01','1e18'])expect(()=>borrowHealthFactor(input,'8600','100')).toThrow('INVALID');
    expect(()=>borrowHealthFactor('100','10001','1')).toThrow('INVALID');
    const m=supplyModel(),s=await readBorrowState(m.rpc,p,SUPPLY_OWNER,SUPPLY_OWNER);
    expect(()=>estimateBorrow('10000',{...s.borrow!,baseCurrencyUnit:'0'},p)).toThrow();
  });
  it.each(['price','collateral','debt','capacity','health','configuration','amount','owner','payload','expiry'])('invalidates stale Review for %s',async kind=>{
    const m=supplyModel(),w=borrowWorkflow(),r=await simulateSupply(w,SUPPLY_OWNER,m.rpc),s=structuredClone(r.state);
    if(kind==='price')s.borrow!.price='110000000';if(kind==='collateral')s.borrow!.collateralBase='900000000';
    if(kind==='debt')s.borrow!.debtBase='1000000';if(kind==='capacity')s.borrow!.availableBorrowBase='800000000';
    if(kind==='health')s.borrow!.healthFactor='1999999999999999999';if(kind==='configuration')s.borrow!.reserveConfiguration='0';
    const changed=kind==='amount'?borrowWorkflow('20000'):w;
    if(kind==='payload')r.transactions[0]!.data+='00';
    expect(()=>assertSupplyReview(r,changed,kind==='owner'?'0x'+'2'.repeat(40):SUPPLY_OWNER,s,kind==='expiry'?Date.parse(r.expiresAt):Date.now())).toThrow();
  });
});

it('validates the reserve borrow cap even with sufficient account capacity',async()=>{
  const m=supplyModel();m.state.scaledDebt=1600000n;m.state.userConfig=3n;m.state.reserveConfig|=1n<<80n;
  await expect(simulateSupply(borrowWorkflow(),SUPPLY_OWNER,m.rpc)).rejects.toThrow('CAP_EXCEEDED');expect(m.transactions).toHaveLength(0);
});
it('missing Borrow risk metadata cannot downgrade the authorization to Supply',async()=>{
  const m=supplyModel(),w=borrowWorkflow(),r=await simulateSupply(w,SUPPLY_OWNER,m.rpc);delete r.borrow;
  expect(()=>assertSupplyReview(r,w,SUPPLY_OWNER,r.state)).toThrow('BORROW_AUTHORIZATION_INVALID');
});
