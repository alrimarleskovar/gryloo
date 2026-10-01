// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {createSupplyNode,type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
import {simulateSupply,compileSupplyCalls,assertSupplyReview,supplyCall,AAVE_V3_BASE_SEPOLIA as p} from '../src/index.js';
import {supplyModel,SUPPLY_OWNER} from '../../../apps/reference-dapp/e2e/supply-fixtures';
const workflow=():SemanticWorkflow=>({schemaVersion:'1.0.0',workflowId:'supply',revision:0,nodes:[createSupplyNode('supply',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'10000000',beneficiary:SUPPLY_OWNER})],resourceEdges:[]});
describe('exact read-only Supply compiler and review',()=>{
  it('prepares exact minimum approval and exact Supply calldata',()=>{const calls=compileSupplyCalls(workflow(),SUPPLY_OWNER,'9999999');expect(calls).toHaveLength(2);expect(calls[0]?.data).toBe(supplyCall('approve(address,uint256)',p.pool,10000000n));expect(calls[1]?.data).toBe('0x617ba037'+'0'.repeat(24)+p.asset.slice(2)+10000000n.toString(16).padStart(64,'0')+'0'.repeat(24)+SUPPLY_OWNER.slice(2)+'0'.repeat(64));});
  it.each(['10000000','99999999'])('does not approve sufficient allowance %s',allowance=>{const calls=compileSupplyCalls(workflow(),SUPPLY_OWNER,allowance);expect(calls).toHaveLength(1);expect(calls[0]?.to).toBe(p.pool);});
  it('simulates approval and Supply without submitting, then binds the review',async()=>{
    const model=supplyModel(),w=workflow();const review=await simulateSupply(w,SUPPLY_OWNER,model.rpc);expect(model.transactions).toHaveLength(0);expect(model.state.allowance).toBe(0n);expect(review.approvalRequired).toBe(true);expect(review.plan.segments[0]?.steps).toHaveLength(2);
    expect(()=>assertSupplyReview(review,w,SUPPLY_OWNER,review.state)).not.toThrow();
    expect(()=>assertSupplyReview(review,{...w,revision:1},SUPPLY_OWNER,review.state)).toThrow('STALE');
    expect(()=>assertSupplyReview(review,w,'0x'+'2'.repeat(40),review.state)).toThrow('STALE');
    expect(()=>assertSupplyReview(review,w,SUPPLY_OWNER,{...review.state,allowance:'10000000'})).toThrow('STALE');
    expect(()=>assertSupplyReview({...review,pool:'0x'+'2'.repeat(40)},w,SUPPLY_OWNER,review.state)).toThrow('STALE');
    expect(()=>assertSupplyReview(review,w,SUPPLY_OWNER,review.state,Date.parse(review.expiresAt))).toThrow('STALE');
  });
  it('retains exact beneficiary',()=>{const w=workflow(),input=w.nodes[0]!.inputs[1]!;if(input.kind==='ACCOUNT')input.value.address='0x'+'2'.repeat(40);expect(compileSupplyCalls(w,SUPPLY_OWNER,'10000000')[0]?.data.slice(138,202)).toBe('0'.repeat(24)+'2'.repeat(40));});
  it('requires proof of the allowance override',async()=>{const m=supplyModel();m.state.ignoreOverride=true;await expect(simulateSupply(workflow(),SUPPLY_OWNER,m.rpc)).rejects.toThrow('OVERRIDE_UNVERIFIED');});
  it.each(['chain','USDC','ETH','RPC'])('blocks %s before submission',async kind=>{const m=supplyModel();if(kind==='chain')m.state.chain='0x1';if(kind==='USDC')m.state.balance=0n;if(kind==='ETH')m.state.nativeBalance=0n;const rpc=kind==='RPC'?async()=>{throw new Error('RPC_FAILED');}:m.rpc;await expect(simulateSupply(workflow(),SUPPLY_OWNER,rpc)).rejects.toThrow();expect(m.transactions).toHaveLength(0);});
});
