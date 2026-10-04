// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { createModeCExecutor,type ModeCDriver } from '@defi-workflow-engine/reference-executor';
import { createPostgresLeaseStore,createPostgresLogStore } from '../src/index.js';
import { createTestDatabase,type TestDatabase } from './pg-harness.js';
import { fixture,poolObservation,S,H } from '../../reference-executor/test/mode-c-fixture.js';
describe('BUILD-016 PostgreSQL atomic authority',()=>{
  let t:TestDatabase;
  beforeAll(async()=>{t=await createTestDatabase();});
  afterAll(async()=>{await t.drop();});
  function workers(namespace:string) {
    const c=fixture(),observation=poolObservation(c.policy.semanticWorkflowHash,S*97n/100n,120,11);
    let sends=0,confirmed=false;
    const driver:ModeCDriver={now:async()=>120,observe:async()=>observation,verifyInstalled:async()=>true,eligible:async()=>true,
      prepareExact:async()=>({hash:H,raw:'0x01',nonce:'0',beforeInput:'1000000',beforeOutput:'0'}),
      submitExact:async()=>{sends++;return H;},reconcile:async()=>({outcome:confirmed?'RECONCILED':'INCONCLUSIVE',transactionHash:H,details:{environment:'MOCKED'}}),
      verifyRevoked:async()=>true};
    const storage=(id:string)=>{
      const db=t.open(4);return {log:createPostgresLogStore({db,tenantId:'default',namespace}),
        leases:createPostgresLeaseStore({db,tenantId:'default',namespace,busyCode:'MODE_C_BUSY',holderId:id})};
    };
    const first=storage('worker-one'),second=storage('worker-two');
    return {first,second,c,driver,worker:(storage=first)=>createModeCExecutor({compiled:c,storage,driver}),
      sends:()=>sends,confirm:()=>{confirmed=true;}};
  }
  it('two independent pools reserve exactly once and consume one action',async()=>{
    const w=workers('dip-race'),a=w.worker(w.first),b=w.worker(w.second);
    const outcomes=await Promise.allSettled([a.attempt(),b.attempt()]);
    // Depending on scheduling the second worker is BUSY or observes the already consumed trigger.
    expect(outcomes.filter(o=>o.status==='fulfilled'&&o.value.decision.eligible)).toHaveLength(1);
    expect(w.sends()).toBe(1);expect((await a.events()).filter(e=>e.kind==='RESERVED')).toHaveLength(1);
    expect(await b.status()).toMatchObject({total:'0',period:'0',actions:0});
  });
  it('reservation and evidence roll back atomically; failed storage never dispatches',async()=>{
    const w=workers('dip-rollback'),original=w.first.log.extend;
    w.first.log.extend=async(name,bytes,validate)=>original(name,bytes,b=>{
      validate(b);if(new TextDecoder().decode(b).includes('"kind":"RESERVED"'))throw new Error('INJECTED_STORAGE_FAILURE');
    });
    await expect(w.worker().attempt()).rejects.toThrow();expect(w.sends()).toBe(0);
    const clean=w.worker(w.second);expect((await clean.events()).some(e=>e.kind==='RESERVED')).toBe(false);
    expect((await clean.attempt()).decision.eligible).toBe(true);expect(w.sends()).toBe(1);
  });
  it('unknown submission survives a new connection and reconciles without resubmission',async()=>{
    const w=workers('dip-restart');
    w.driver.submitExact=async()=>{throw new Error('RESPONSE_LOST');};
    expect((await w.worker().attempt()).reconciliation?.outcome).toBe('INCONCLUSIVE');
    w.confirm();expect((await w.worker(w.second).recover())?.outcome).toBe('RECONCILED');
    expect((await w.worker(w.second).attempt()).decision.eligible).toBe(false);expect(w.sends()).toBe(0);
  });
  it('confirmed revocation is durable and stops a later trigger from another worker',async()=>{
    const w=workers('dip-revoke');await w.worker().confirmRevocation([H]);
    expect((await w.worker(w.second).attempt()).decision.code).toBe('MODE_C_REVOCATION_CONFIRMED');expect(w.sends()).toBe(0);
    expect((await w.worker(w.second).status()).actions).toBe(1);
  });
});
