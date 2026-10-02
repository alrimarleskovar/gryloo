// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLendingHarness,OWNER} from '../../e2e/lending-harness.mjs';
import {createAuthoredLending} from '../domain/lending-authoring';
import {createLendingCompositionService} from './lending-composition-service';
import {LENDING_BASE_SEPOLIA as u} from '@defi-workflow-engine/action-registry';
import {assertLendingFeeBudgets,lendingFeeCeilings,supplyCall,supplyHex,type SupplyRpc} from '@defi-workflow-engine/reference-compiler';
const workflow=createAuthoredLending('fee-ceilings',0,{supply:'0.1',borrow:'0.01',slippage:'50',owner:OWNER});
async function fixture(action:(f:{service:ReturnType<typeof createLendingCompositionService>;model:ReturnType<typeof createLendingHarness>;fees:{value:bigint;final?:bigint};simulations:unknown[][]})=>Promise<void>){
  const dir=await mkdtemp(join(tmpdir(),'build013-fees-')),model=createLendingHarness(),fees:{value:bigint;final?:bigint}={value:1000000n},simulations:unknown[][]=[];
  let reads=0;
  const rpc:SupplyRpc=async(method,params)=>{
    if(method==='eth_simulateV1')simulations.push([...params]);
    if(method==='eth_call'){
      const call=params[0] as {to:string;data:string};
      if(call.to===u.gasOracle&&call.data===supplyCall('getL1FeeUpperBound(uint256)',8192n)){
        reads++;return supplyHex(reads>=3&&fees.final!==undefined?fees.final:fees.value);
      }
    }
    return model.rpc(method,params);
  };
  const service=createLendingCompositionService({rpc,journalDir:dir,provenance:'MOCKED'});
  try{await action({service,model,fees,simulations});expect(model.transactions).toHaveLength(0);
    for(const params of simulations){const request=params[0] as {validation:boolean;blockStateCalls:{calls:unknown[];stateOverrides?:unknown;blockOverrides?:unknown}[]};
      expect(request.validation).toBe(true);expect(request.blockStateCalls).toHaveLength(1);expect(request.blockStateCalls[0]!.calls).toHaveLength(47);
      expect(request.blockStateCalls[0]!.stateOverrides).toBeUndefined();expect(request.blockStateCalls[0]!.blockOverrides).toBeUndefined();}
  }finally{await rm(dir,{recursive:true,force:true});}
}
describe('BUILD-013 fixed owner-reviewed L1 and root network ceilings',()=>{
  it.each([['unchanged',1000000n],['increased below maximum',1500000n],['exactly at maximum',2000000n]])('accepts %s at the final fee check',(_label,fee)=>fixture(async({service,fees,simulations})=>{
    const run=await service.simulate(workflow,OWNER),review=run.reviews[0]!,before=JSON.stringify(review);
    expect(review.l1FeeUpperBound).toBe('5000000');expect(lendingFeeCeilings(review).maximumL1Fee).toBe(10000000n);
    expect(review.policy.feeBudgets).toEqual(review.manifest.feeBudgets);expect(review.policy.gasBudgets).toEqual(review.manifest.gasBudgets);
    fees.value=fee;fees.final=fee;const accepted=await service.review(run.id,review.commitment,workflow);
    expect(accepted.authorization).toBe(review.commitment);expect(JSON.stringify(accepted.reviews[0])).toBe(before);expect(simulations).toHaveLength(2);
  }));
  it('blocks above the maximum at the final check without accepting or enlarging Review',()=>fixture(async({service,fees,simulations})=>{
    const run=await service.simulate(workflow,OWNER),review=run.reviews[0]!,before=JSON.stringify(review);fees.final=2000001n;
    await expect(service.review(run.id,review.commitment,workflow)).rejects.toThrow('LENDING_FINAL_L1_FEE_BUDGET_CHANGED');
    const loaded=await service.load(run.id);expect(loaded.authorization).toBeNull();expect(loaded.attempts).toHaveLength(0);expect(JSON.stringify(loaded.reviews[0])).toBe(before);expect(simulations).toHaveLength(2);
  }));
  it('accepts a higher estimate in the full re-simulation without applying headroom again',()=>fixture(async({service,fees})=>{
    const run=await service.simulate(workflow,OWNER),review=run.reviews[0]!;fees.value=1500000n;
    const accepted=await service.review(run.id,review.commitment,workflow);expect(accepted.authorization).toBe(review.commitment);
    expect(accepted.reviews[0]!.gasBudget).toBe(review.gasBudget);expect(accepted.reviews[0]!.manifest.feeBudgets[0]!.maximumAmount).toBe('10000000');
  }));
  it('requires funding for the full owner-reviewed maximum, including L1 headroom',()=>fixture(async({service,model})=>{
    const run=await service.simulate(workflow,OWNER);model.state.nativeBalance=BigInt(run.reviews[0]!.gasBudget)-1n;
    await expect(service.simulate(workflow,OWNER)).rejects.toThrow('LENDING_GAS_FUNDING_INSUFFICIENT');
  }));
  it('enforces the total root budget including already consumed network costs and L1 fees',()=>fixture(async({service})=>{
    const run=await service.simulate(workflow,OWNER),review=run.reviews[0]!,cap=lendingFeeCeilings(review);
    expect(()=>assertLendingFeeBudgets(review,'5000000',review.gasBudget)).not.toThrow();
    expect(()=>assertLendingFeeBudgets(review,'5000000',review.gasBudget,review,'1')).toThrow('LENDING_REVIEW_STALE');
    expect(()=>assertLendingFeeBudgets(review,'5000000',(cap.maximumNetworkFee-1n).toString(),review,'1')).not.toThrow();
    expect(()=>assertLendingFeeBudgets(review,'5000000','1',review,'0','5000001')).toThrow('LENDING_FINAL_L1_FEE_BUDGET_CHANGED');
  }));
  it('keeps accepted ceilings and commitment unchanged at preparation and blocked handoff',()=>fixture(async({service,fees})=>{
    let run=await service.simulate(workflow,OWNER);run=await service.review(run.id,run.reviews[0]!.commitment,workflow);
    const before=JSON.stringify(run.reviews),commitment=run.authorization;fees.value=1500000n;
    const prepared=await service.begin(run.id,OWNER,workflow);expect(JSON.stringify(prepared.record.reviews)).toBe(before);expect(prepared.record.authorization).toBe(commitment);
    fees.value=2000001n;await expect(service.handoff(run.id,prepared.attemptId)).rejects.toThrow('LENDING_FINAL_L1_FEE_BUDGET_CHANGED');
    const loaded=await service.load(run.id);expect(JSON.stringify(loaded.reviews)).toBe(before);expect(loaded.authorization).toBe(commitment);expect(loaded.attempts[0]!.state).toBe('PREPARED');
  }));
});
