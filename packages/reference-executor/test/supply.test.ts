// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest';
import {createSupplyNode,type SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
import {simulateSupply,AAVE_V3_BASE_SEPOLIA as p} from '@defi-workflow-engine/reference-compiler';
import {createSupplyRun,prepareSupplyAttempt,persistSupplyPreparation,discoverSupplyTransaction} from '../src/supply.js';
import {supplyModel,SUPPLY_OWNER} from '../../../apps/reference-dapp/e2e/supply-fixtures';
const workflow:SemanticWorkflow={schemaVersion:'1.0.0',workflowId:'supply',revision:0,nodes:[createSupplyNode('supply',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'10000000',beneficiary:SUPPLY_OWNER})],resourceEdges:[]};
const id='supply-'+'a'.repeat(32);
describe('durable exactly-once Supply intent',()=>{
  it('persists the complete attempt before releasing submission authority',async()=>{
    const m=supplyModel(),run=createSupplyRun(id,await simulateSupply(workflow,SUPPLY_OWNER,m.rpc),'MOCKED'),order:string[]=[];
    const prepared=await persistSupplyPreparation({read:async()=>run,write:async r=>{expect(r.attempts[0]?.state).toBe('SUBMITTING');expect(r.journal.entries.filter(e=>e.level==='attempt').map(e=>e.toState)).toEqual(['PREPARED','SUBMITTING']);order.push('durable');}},10,'0');
    order.push('wallet');expect(order).toEqual(['durable','wallet']);expect(()=>prepareSupplyAttempt(prepared,10,'0')).toThrow('OBSERVE_ONLY');
    await expect(persistSupplyPreparation({read:async()=>run,write:async()=>{throw new Error('DISK_FULL');}},10,'0')).rejects.toThrow('DISK_FULL');expect(m.transactions).toHaveLength(0);
  });
  it.each([false,true])('recovers existing %s approval/Supply after the hash response is lost',async sufficient=>{
    const m=supplyModel();if(sufficient)m.state.allowance=10000000n;
    const run=prepareSupplyAttempt(createSupplyRun(id,await simulateSupply(workflow,SUPPLY_OWNER,m.rpc),'MOCKED'),10,'0'),attempt=run.attempts[0]!;
    const hash=await m.rpc('MOCK_submit',[{...attempt.transaction,nonce:'0x0',gas:'0x493e0',gasPrice:'0x1e8480'}]);
    const restored=JSON.parse(JSON.stringify(run)) as typeof run;
    const found=await discoverSupplyTransaction(restored.attempts[0]!,m.rpc);expect(found.hash).toBe(hash);expect(m.transactions).toHaveLength(1);expect(()=>prepareSupplyAttempt(restored,13,'1')).toThrow('OBSERVE_ONLY');
  });
  it('never resubmits a missing transaction after bounded observation',async()=>{
    const m=supplyModel(),run=prepareSupplyAttempt(createSupplyRun(id,await simulateSupply(workflow,SUPPLY_OWNER,m.rpc),'MOCKED'),10,'0');m.state.block=200;
    expect(await discoverSupplyTransaction(run.attempts[0]!,m.rpc)).toEqual({hash:null,mismatch:false,exhausted:true});expect(m.transactions).toHaveLength(0);
  });
  it('identifies a replaced transaction with unexpected semantics',async()=>{
    const m=supplyModel(),run=prepareSupplyAttempt(createSupplyRun(id,await simulateSupply(workflow,SUPPLY_OWNER,m.rpc),'MOCKED'),10,'0'),a=run.attempts[0]!;
    await m.rpc('MOCK_submit',[{...a.transaction,nonce:'0x0',gas:'0x493e0',gasPrice:'0x1e8480'}]);m.transactions[0]!.input='0xdeadbeef';
    expect((await discoverSupplyTransaction(a,m.rpc)).mismatch).toBe(true);
  });
});
