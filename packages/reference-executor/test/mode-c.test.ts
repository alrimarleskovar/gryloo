// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach,describe,it,expect } from 'vitest';
import { hashModeCPolicy,validateModeCPolicy,modeCDipEligible,hashModeCManifest,hashArtifactBytes,modeCCommitment,serializeModeC } from '@defi-workflow-engine/workflow-contracts';
import { createModeCExecutor,evaluateModeC,type ModeCDriver,type ModeCLedger,type ModeCAction } from '../src/mode-c.js';
import { createFileExecutionStorage } from '../src/durable-storage.js';
import { fixture,poolObservation,S,H } from './mode-c-fixture.js';

const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
const empty:ModeCLedger={totalReserved:0n,periodReserved:0n,executions:0,lastReservedAt:null,observationHashes:[],revoked:false,paused:false};
async function setup() {
  const dir=await mkdtemp(join(tmpdir(),'build016-unit-'));dirs.push(dir);
  const c=fixture();let clock=120,sends=0,revoked=false,receipt=false,unknown=false;
  let observed=poolObservation(c.policy.semanticWorkflowHash,S*97n/100n,120,11);
  const tx={hash:H,nonce:'0',raw:'0x01',beforeInput:'1000000',beforeOutput:'0'};
  const driver:ModeCDriver={now:async()=>clock,observe:async()=>observed,verifyInstalled:async()=>!revoked,eligible:async()=>!revoked,
    prepareExact:async call=>{expect(call).toEqual({from:c.policy.executor,to:c.policy.roles,data:c.policy.executorCalldata,value:'0x0'});return tx;},
    submitExact:async()=>{sends++;if(unknown)throw new Error('LOST_RESPONSE');return H;},
    reconcile:async()=>({outcome:receipt?'RECONCILED':'INCONCLUSIVE',transactionHash:H,details:{synthetic:true}}),verifyRevoked:async()=>revoked};
  const storage=createFileExecutionStorage(dir,'MODE_C_BUSY');
  return {c,storage,driver,worker:()=>createModeCExecutor({compiled:c,storage,driver}),sends:()=>sends,
    clock:(n:number)=>{clock=n;},observe:(o:typeof observed)=>{observed=o;},revoke:()=>{revoked=true;},receipt:()=>{receipt=true;},unknown:()=>{unknown=true;}};
}
describe('BUILD-016 deterministic conditional policy',()=>{
  it.each([[96n,false],[95n,true],[94n,true]])('exact rational threshold: price %s versus reference 100', (price,eligible)=>{
    expect(modeCDipEligible(price,1n,100n,1n)).toBe(eligible);
  });
  it('evaluates source-backed pool price without floats',()=>{
    const p=fixture().policy;
    expect(evaluateModeC(p,poolObservation(p.semanticWorkflowHash,S*98n/100n,120,11).artifact,120,empty).code).toBe('MODE_C_TRIGGER_NOT_MET');
    expect(evaluateModeC(p,poolObservation(p.semanticWorkflowHash,S*97n/100n,120,11).artifact,120,empty).eligible).toBe(true);
  });
  it.each(['stale','future','source','chain','pool','pair','fee','sqrt','malformed','reference-repeat'] as const)('fails closed for %s observations',kind=>{
    const p=fixture().policy, a=poolObservation(p.semanticWorkflowHash,S*97n/100n,120,11).artifact;
    let now=120;
    if(kind==='stale')now=150;
    if(kind==='future')now=119;
    if(kind==='source')a.sourceId='base.json-rpc';
    if(kind==='chain')a.chainId='eip155:8453';
    if(['pool','pair','fee','sqrt'].includes(kind)) {
      const name={pool:'pool',pair:'token1',fee:'fee',sqrt:'sqrt-price-x96'}[kind as 'pool'|'pair'|'fee'|'sqrt'];
      const v=a.normalizedValues.find(v=>v.name===name)!;
      if(v.kind==='IDENTIFIER')v.value='invalid';else if(v.kind==='INTEGER')v.value=3000;
    }
    const input=kind==='malformed'?{invalid:true}:kind==='reference-repeat'?p.reference:a;
    expect(evaluateModeC(p,input,now,empty).eligible).toBe(false);
  });
  it.each([
    ['MODE_C_COOLDOWN',{lastReservedAt:115}],['MODE_C_FREQUENCY',{lastReservedAt:105}],
    ['MODE_C_TOTAL_BUDGET',{totalReserved:1000000n}],['MODE_C_PERIOD_BUDGET',{periodReserved:1000000n}],
    ['MODE_C_ACTION_CONSUMED',{executions:1}],['MODE_C_REVOCATION_CONFIRMED',{revoked:true}],
    ['MODE_C_REVOCATION_REQUESTED',{paused:true}],
  ] as const)('enforces %s', (code,change)=>{
    const p=fixture().policy,a=poolObservation(p.semanticWorkflowHash,S*97n/100n,120,11).artifact;
    expect(evaluateModeC(p,a,120,{...empty,...change}).code).toBe(code);
  });
  it('enforces start inclusive and expiry exclusive',()=>{
    const p=fixture().policy,a=poolObservation(p.semanticWorkflowHash,S*97n/100n,120,11).artifact;
    expect(evaluateModeC(p,a,99,empty).code).toBe('MODE_C_NOT_STARTED');
    expect(evaluateModeC(p,a,p.expiresAt,empty).code).toBe('MODE_C_EXPIRED');
  });
  it.each(['chainId','tokenIn','tokenOut','recipient','router','functionId','amount','minimumOut','slippageBps','triggerDropBps'] as const)('rejects %s expansion',field=>{
    const p=fixture().policy,a=poolObservation(p.semanticWorkflowHash,S*97n/100n,120,11).artifact;
    const action:ModeCAction={chainId:31337,tokenIn:p.tokenIn,tokenOut:p.tokenOut,recipient:p.recipient,router:p.router,functionId:p.functionId,
      amount:p.maximumSwapAmount,minimumOut:p.minimumOut,slippageBps:p.maximumSlippageBps,triggerDropBps:500};
    Object.assign(action,{[field]:typeof action[field]==='number'?0:'invalid'});
    expect(evaluateModeC(p,a,120,empty,action).code).toBe('MODE_C_AUTHORITY_EXPANSION');
  });
  it('recomputes the additive authority vector independently and rejects v1 Manifest hashing',async()=>{
    const path=new URL('../../../tests/compatibility/build016/authority-vector.json',import.meta.url).pathname;
    const v=JSON.parse(await readFile(path,'utf8'));
    expect(hashModeCPolicy(v.policy)).toBe(v.policyHash);expect(hashModeCManifest(v.policy,v.manifest)).toBe(v.manifestHash);
    expect(modeCCommitment('execution-plan',v.executionPlan)).toBe(v.executionPlanHash);
    expect(()=>hashArtifactBytes('strategy-manifest',new TextEncoder().encode(serializeModeC(v.manifest)))).toThrow();
    execFileSync('python3',['-c',[
      'import json,hashlib,struct,sys',
      'v=json.load(open(sys.argv[1]));d=b"defi-workflow-engine/intent"',
      'p=json.dumps({"format":"gryloo.build016.policy.v1","value":v["policy"]},sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()',
      'f=b"DWE-HASH"+bytes([0,1])+struct.pack(">H",len(d))+d+struct.pack(">Q",len(p))+p',
      'assert "0x"+hashlib.sha256(f).hexdigest()==v["policyHash"]',
    ].join('\n'),path]);
  });
  it('binds policy, Manifest, reference and every conditional limit',()=>{
    const c=fixture();expect(hashModeCManifest(c.policy,c.manifest)).toBe(c.manifestHash);
    for(const field of ['expiresAt','cooldownSeconds','frequencySeconds','periodSeconds','totalBudget','perPeriodBudget'] as const) {
      const changed={...c.policy,[field]:typeof c.policy[field]==='number'?Number(c.policy[field])+1:(BigInt(c.policy[field])+1n).toString()};
      expect(hashModeCPolicy(changed)).not.toBe(c.policyHash);
    }
    expect(()=>validateModeCPolicy({...c.policy,triggerDropBps:499})).toThrow();
    expect(()=>validateModeCPolicy({...c.policy,referenceHash:'0x'+'b'.repeat(64)})).toThrow('MODE_C_REFERENCE_MISMATCH');
    expect(()=>validateModeCPolicy({...c.policy,perPeriodBudget:'999999'})).toThrow();
  });
});
describe('BUILD-016 durable one-action execution',()=>{
  it('reserves before submission, executes existing call once, preserves state on restart and rejects replay',async()=>{
    const t=await setup();t.receipt();
    const original=t.driver.submitExact;
    t.driver.submitExact=async tx=>{
      const events=await t.worker().events();expect(events.some(e=>e.kind==='RESERVED')).toBe(true);
      expect(events.at(-1)?.kind).toBe('SUBMITTING');return original(tx);
    };
    const first=await t.worker().attempt();expect(first.reconciliation?.outcome).toBe('RECONCILED');
    expect(first.remaining).toMatchObject({total:'0',period:'0',actions:0});
    expect((await t.worker().attempt()).decision.code).toBe('MODE_C_REPLAY');expect(t.sends()).toBe(1);
    expect((await t.worker().events()).filter(e=>e.kind==='RESERVED')).toHaveLength(1);
  });
  it('two independent workers get exactly one reservation and one financial action',async()=>{
    const t=await setup(),outcomes=await Promise.allSettled([t.worker().attempt(),t.worker().attempt()]);
    expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(t.sends()).toBe(1);
    expect((await t.worker().events()).filter(e=>e.kind==='RESERVED')).toHaveLength(1);
    expect(await t.storage.log.list('dip-attempt-',10)).toHaveLength(2);
  });
  it('monitoring and unverifiable authority failures leave evidence and never reserve',async()=>{
    for(const failure of ['monitor','authority','raw'] as const) {
      const t=await setup();
      if(failure==='monitor')t.driver.observe=async()=>{throw new Error('RPC_DOWN');};
      if(failure==='authority')t.driver.verifyInstalled=async()=>false;
      if(failure==='raw')t.observe({...poolObservation(t.c.policy.semanticWorkflowHash,S*97n/100n,120,11),raw:'tampered'});
      expect((await t.worker().attempt()).decision.eligible).toBe(false);expect(t.sends()).toBe(0);
      expect((await t.worker().events()).some(e=>e.kind==='DECISION')).toBe(true);
      expect((await t.worker().events()).some(e=>e.kind==='RESERVED')).toBe(false);
    }
  });
  it('crash before reservation leaves unused authority and permits a later valid attempt',async()=>{
    const t=await setup();const original=t.storage.log.extend;let crash=true;
    t.storage.log.extend=async(name,data,validate)=>{if(crash&&name===t.worker().logName&&new TextDecoder().decode(data).includes('"kind":"RESERVED"')){crash=false;throw new Error('CRASH_BEFORE_RESERVATION');}return original(name,data,validate);};
    await expect(t.worker().attempt()).rejects.toThrow('CRASH_BEFORE_RESERVATION');expect(t.sends()).toBe(0);
    expect((await t.worker().attempt()).decision.eligible).toBe(true);expect(t.sends()).toBe(1);
  });
  it('crash after reservation never restores or blindly resubmits authority',async()=>{
    const t=await setup();t.driver.prepareExact=async()=>{throw new Error('CRASH_AFTER_RESERVATION');};
    expect((await t.worker().attempt()).decision.code).toBe('MODE_C_RESERVED_REQUIRES_REVIEW');
    expect((await t.worker().attempt()).decision.eligible).toBe(false);expect(t.sends()).toBe(0);
    expect((await t.worker().status()).actions).toBe(0);
  });
  it('lost submission result reconciles by persisted signed hash and nonce, never blind resubmits',async()=>{
    const t=await setup();t.unknown();expect((await t.worker().attempt()).reconciliation?.outcome).toBe('INCONCLUSIVE');
    expect(t.sends()).toBe(1);t.receipt();expect((await t.worker().recover())?.outcome).toBe('RECONCILED');
    expect((await t.worker().attempt()).decision.eligible).toBe(false);expect(t.sends()).toBe(1);
  });
  it('unused authority, then confirmed owner revocation, then trigger: reject',async()=>{
    const t=await setup();const w=t.worker();await w.requestRevocation();
    await expect(w.confirmRevocation([H])).rejects.toThrow('MODE_C_REVOCATION_UNCONFIRMED');
    t.revoke();await w.confirmRevocation([H]);expect((await w.attempt()).decision.code).toBe('MODE_C_REVOCATION_CONFIRMED');
    expect(t.sends()).toBe(0);expect((await w.status()).actions).toBe(1);
  });
  it('already submitted action reconciles after confirmed revocation without a new execution',async()=>{
    const t=await setup();await t.worker().attempt();t.revoke();await t.worker().confirmRevocation([H]);t.receipt();
    expect((await t.worker().recover())?.outcome).toBe('RECONCILED');expect(t.sends()).toBe(1);
  });
  it('expiry, source staleness and revocation racing dispatch retain reservation and block send',async()=>{
    const t=await setup();let calls=0;t.driver.now=async()=>++calls===1?120:2000;
    expect((await t.worker().attempt()).decision.eligible).toBe(false);expect(t.sends()).toBe(0);
    expect((await t.worker().status()).actions).toBe(0);
  });
  it.each(['stale','revoked'] as const)('a %s recheck after reservation never dispatches',async kind=>{
    const t=await setup();let checks=0;
    if(kind==='stale')t.driver.now=async()=>++checks===1?120:150;
    else t.driver.verifyInstalled=async()=>++checks===1;
    expect((await t.worker().attempt()).decision.code).toBe('MODE_C_RESERVED_REQUIRES_REVIEW');
    expect(t.sends()).toBe(0);expect((await t.worker().status()).actions).toBe(0);
  });
  it('crash after persisted SUBMITTING but before broadcast only reconciles on restart',async()=>{
    const t=await setup(),extend=t.storage.log.extend;let crash=true;
    t.storage.log.extend=async(name,data,validate)=>{
      const value=await extend(name,data,validate);
      if(crash&&name===t.worker().logName&&new TextDecoder().decode(data).includes('"kind":"SUBMITTING"')) {
        crash=false;throw new Error('CRASH_AFTER_SUBMITTING');
      }
      return value;
    };
    await t.worker().attempt();expect(t.sends()).toBe(0);
    expect((await t.worker().recover())?.outcome).toBe('INCONCLUSIVE');
    expect((await t.worker().attempt()).decision.eligible).toBe(false);expect(t.sends()).toBe(0);
  });
  it('period rollover does not replenish the one-use cumulative authority',async()=>{
    const t=await setup();await t.worker().attempt();t.clock(720);t.observe(poolObservation(t.c.policy.semanticWorkflowHash,S*97n/100n,720,20));
    expect((await t.worker().attempt()).decision.code).toBe('MODE_C_TOTAL_BUDGET');expect(t.sends()).toBe(1);
  });
});
