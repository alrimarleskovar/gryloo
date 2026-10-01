// SPDX-License-Identifier: AGPL-3.0-only
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import type { SupplyRpc } from '@defi-workflow-engine/reference-compiler';
export const SUPPLY_OWNER='0x1111111111111111111111111111111111111111';
type Model={state:{block:number;nonce:number;allowance:bigint;balance:bigint;nativeBalance:bigint;scaled:bigint;index:bigint;chain:string;revert:boolean;mismatch:boolean;ignoreOverride:boolean};
  rpc:SupplyRpc;transactions:Record<string,unknown>[];receipts:Map<string,Record<string,unknown>>;history:Map<number,unknown>};
export function supplyModel():Model{
  const module=createRequire(import.meta.url)('./supply-harness.mjs') as {createSupplyHarness:()=>Model};return module.createSupplyHarness();
}
export async function supplyHarnessRpc(method:string,params:unknown[]=[]):Promise<unknown>{
  const response=await fetch('http://127.0.0.1:8549',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const value=await response.json() as {result?:unknown;error?:unknown};if(value.error)throw new Error('MOCK_HARNESS_ERROR');return value.result;
}
export async function installSupplyWallet(page:Page,options:{nonceFailure?:boolean;lateNonceFailure?:boolean;walletNonce?:unknown;providerFailure?:boolean;notBroadcast?:'APPROVAL'|'SUPPLY';pause?:'APPROVAL'|'SUPPLY';uncertain?:'APPROVAL'|'SUPPLY';reject?:'APPROVAL'|'SUPPLY';chain?:string;account?:string;connected?:boolean}={}){
  await page.exposeFunction('grylooSupplyTestRpc',supplyHarnessRpc);
  await page.addInitScript(({owner,options})=>{
    const requests:{method:string;params?:unknown[]}[]=[];
    const state={connected:options.connected!==false,chain:options.chain??'0x14a34',account:options.account??owner};
    const w=window as unknown as {ethereum:unknown;grylooSupplyTestRpc:(method:string,params:unknown[])=>Promise<unknown>;supplyWalletRequests:typeof requests;releaseSupplyWalletRequest?:()=>void};
    w.supplyWalletRequests=requests;
    w.ethereum={request:async(input:{method:string;params?:unknown[]})=>{
      requests.push(input);
      if(input.method==='eth_accounts')return state.connected?[state.account]:[];
      if(input.method==='eth_requestAccounts'){state.connected=true;return[state.account];}
      if(input.method==='eth_chainId')return state.chain;
      if(input.method==='eth_getTransactionCount'){if(options.nonceFailure||options.lateNonceFailure&&requests.filter(r=>r.method==='eth_getTransactionCount').length===2)throw Object.assign(new Error('MOCK_READ_FAILED_BEFORE_SUBMISSION',{cause:new Error('Disconnected transport')}),{code:4900,data:{stage:'READ_ONLY_PREFLIGHT'}});if(options.walletNonce!==undefined)return options.walletNonce;return w.grylooSupplyTestRpc('eth_getTransactionCount',input.params??[]);}
      if(input.method==='eth_sendTransaction'){
        if(options.providerFailure)throw Object.assign(new Error('Provider refused malformed request',{cause:new Error('Validation')}),{code:-32602,data:{reason:'invalid transaction'}});
        const tx=input.params?.[0] as {to:string};const step=tx.to==='0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f'?'APPROVAL':'SUPPLY';
        if(options.pause===step)await new Promise<void>(resolve=>{w.releaseSupplyWalletRequest=resolve;});
        if(options.reject===step)throw Object.assign(new Error('Owner rejected test request'),{code:4001});
        if(options.notBroadcast===step)throw new Error('MOCK_NOT_BROADCAST');
        const hash=await w.grylooSupplyTestRpc('MOCK_submit',input.params??[]);if(options.uncertain===step)throw new Error('MOCK_RESPONSE_LOST');return hash;
      }
      throw new Error('MOCK_WALLET_METHOD_DENIED');
    }};
  },{owner:SUPPLY_OWNER,options});
}

export async function resetSupplyHarness(options:Record<string,unknown>={}){
  if(process.env.GRYLOO_SUPPLY_E2E!=='MOCKED_LOOPBACK_ONLY'||!process.env.GRYLOO_SUPPLY_JOURNAL?.startsWith('/tmp/gryloo-build012a-'))throw new Error('MOCK_RESET_DENIED');
  await rm(process.env.GRYLOO_SUPPLY_JOURNAL,{recursive:true,force:true});await supplyHarnessRpc('MOCK_reset',[options]);
}
export async function authorSupply(page:Page){
  await page.goto('/');await page.getByRole('button',{name:'Add supply',exact:true}).click();
  const form=page.getByRole('form',{name:'Create Supply'});
  await form.getByLabel('Supply amount (USDC)').fill('10');await form.getByLabel('Supply beneficiary').fill(SUPPLY_OWNER);
  await form.getByRole('button',{name:'Add Supply',exact:true}).click();
}
export async function reviewSupply(page:Page){
  await page.getByRole('button',{name:'Continue to Simulate'}).click();await page.getByRole('button',{name:'Simulate Supply',exact:true}).click();
  await page.getByRole('button',{name:'Review Supply',exact:true}).click();await page.getByRole('button',{name:'Accept Supply review'}).click();
}
export async function supplySendCount(page:Page):Promise<number>{return page.evaluate(()=>{
  const w=window as unknown as {supplyWalletRequests:{method:string}[]};return w.supplyWalletRequests.filter(r=>r.method==='eth_sendTransaction').length;
});}
