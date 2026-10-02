// SPDX-License-Identifier: AGPL-3.0-only
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLendingHarness,OWNER} from '../../e2e/lending-harness.mjs';
import {createAuthoredLending} from '../domain/lending-authoring';

const workflow=createAuthoredLending('transport',0,{supply:'0.1',borrow:'0.01',slippage:'50',owner:OWNER});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});
async function fixture(harness:boolean,credential:string|undefined,action:(calls:{url:string;init:RequestInit;method:string;params:unknown[]}[])=>Promise<void>){
  const dir=await mkdtemp(join(tmpdir(),'build013-transport-')),model=createLendingHarness(),calls:{url:string;init:RequestInit;method:string;params:unknown[]}[]=[];
  vi.resetModules();vi.stubEnv('GRYLOO_SUPPLY_JOURNAL',dir);vi.stubEnv('GRYLOO_LENDING_HARNESS',harness?'MOCKED_LOOPBACK_ONLY':undefined);vi.stubEnv('GRYLOO_ALCHEMY_API_KEY',credential);
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    const request=JSON.parse(String(init.body)) as {method:string;params:unknown[]};calls.push({url,init,...request});
    return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:await model.rpc(request.method,request.params)}),{status:200});
  }));
  try{await action(calls);expect(model.transactions).toHaveLength(0);}finally{await rm(dir,{recursive:true,force:true});}
}
describe('BUILD-013 public Alchemy transport',()=>{
  it.each([undefined,'','   '])('fails closed before RPC when the public credential is %s',credential=>fixture(false,credential,async calls=>{
    const {lendingSimulate}=await import('./lending-action');
    expect(await lendingSimulate(workflow,OWNER)).toEqual({ok:false,code:'LENDING_PUBLIC_CREDENTIAL_NOT_CONFIGURED'});expect(calls).toHaveLength(0);
  }));
  it('uses only Base Sepolia and an environment bearer header for the unchanged full simulation',()=>fixture(false,'synthetic-test-credential',async calls=>{
    const {lendingSimulate}=await import('./lending-action');const result=await lendingSimulate(workflow,OWNER);expect(result.ok).toBe(true);
    for(const call of calls){expect(call.url).toBe('https://base-sepolia.g.alchemy.com/v2');expect(call.init.headers).toEqual({'content-type':'application/json',authorization:'Bearer synthetic-test-credential'});expect(call.init.redirect).toBe('error');}
    const simulations=calls.filter(c=>c.method==='eth_simulateV1');expect(simulations).toHaveLength(1);
    const payload=simulations[0]!.params[0] as {validation:boolean;blockStateCalls:{calls:unknown[];stateOverrides?:unknown;blockOverrides?:unknown}[]};
    expect(payload.validation).toBe(true);expect(payload.blockStateCalls).toHaveLength(1);expect(payload.blockStateCalls[0]!.calls).toHaveLength(47);
    expect(payload.blockStateCalls[0]!.stateOverrides).toBeUndefined();expect(payload.blockStateCalls[0]!.blockOverrides).toBeUndefined();
  }),30000);
  it('preserves the credentialless MOCKED loopback harness',()=>fixture(true,undefined,async calls=>{
    const {lendingSimulate}=await import('./lending-action');const result=await lendingSimulate(workflow,OWNER);expect(result.ok).toBe(true);
    for(const call of calls){expect(call.url).toBe('http://127.0.0.1:8554');expect(call.init.headers).toEqual({'content-type':'application/json'});}
  }));
});
