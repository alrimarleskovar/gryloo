// SPDX-License-Identifier: AGPL-3.0-only
import { openSimulationDetails, acceptProductReview } from './fixtures';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { SupplyReview } from '@defi-workflow-engine/reference-compiler';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';
import type { SupplyRpc } from '@defi-workflow-engine/reference-compiler';
export const REPAY_OWNER='0x5975c152fe58cdcb7e25586a3c9b994a16dbb615';
export const repayOptions={owner:REPAY_OWNER,balance:'10000',scaledDebt:'8001',userConfig:'3'};
export const SUPPLY_OWNER='0x1111111111111111111111111111111111111111';
type Model={state:{owner:string;allowanceSlot:string;block:number;nonce:number;allowance:bigint;balance:bigint;nativeBalance:bigint;scaled:bigint;index:bigint;chain:string;scaledDebt:bigint;debtIndex:bigint;price:bigint;userConfig:bigint;reserveConfig:bigint;liquidity:bigint;revert:boolean;mismatch:boolean;ignoreOverride:boolean;previousIndex:bigint};
  rpc:SupplyRpc;transactions:Record<string,unknown>[];receipts:Map<string,Record<string,unknown>>;history:Map<number,unknown>};
export function supplyModel():Model{
  const module=createRequire(import.meta.url)('./supply-harness.mjs') as {createSupplyHarness:()=>Model};return module.createSupplyHarness();
}
/** `route` selects the harness reserve: '' is Base Sepolia USDC, '/ethereum-sepolia' is Ethereum Sepolia WBTC (BUILD-ETHEREUM-001). */
export type SupplyRoute=''|'/ethereum-sepolia';
export async function supplyHarnessRpc(method:string,params:unknown[]=[],route:SupplyRoute=''):Promise<unknown>{
  const response=await fetch('http://127.0.0.1:8549'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const value=await response.json() as {result?:unknown;error?:unknown};if(value.error)throw new Error('MOCK_HARNESS_ERROR');return value.result;
}
export async function installSupplyWallet(page:Page,options:{nonceFailure?:boolean;lateNonceFailure?:boolean;walletNonce?:unknown;providerFailure?:boolean;notBroadcast?:'APPROVAL'|'SUPPLY';pause?:'APPROVAL'|'SUPPLY';uncertain?:'APPROVAL'|'SUPPLY';reject?:'APPROVAL'|'SUPPLY';chain?:string;account?:string;connected?:boolean;
  /** BUILD-ETHEREUM-001: the harness reserve the wallet's reads and submissions go to. */ route?:SupplyRoute;
  /** Explicit owner switching: KNOWN switches; UNKNOWN answers 4902 until the chain is added. Absent: the owner declines every switch. */ switching?:'KNOWN'|'UNKNOWN'}={}){
  await page.exposeFunction('grylooSupplyTestRpc',supplyHarnessRpc);
  await page.addInitScript(({owner,options})=>{
    const requests:{method:string;params?:unknown[]}[]=[];
    const state={connected:options.connected!==false,chain:options.chain??'0x14a34',account:options.account??owner,added:new Set<string>()};
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const emit = (event: string, value: unknown) => { for (const listener of listeners.get(event) ?? []) listener(value); };
    const w=window as unknown as {ethereum:unknown;grylooSupplyTestRpc:(method:string,params:unknown[],route:string)=>Promise<unknown>;supplyWalletRequests:typeof requests;setSupplyWalletChain(chain: string): void;releaseSupplyWalletRequest?:()=>void};
    const route=options.route??'';
    w.supplyWalletRequests=requests;
    w.setSupplyWalletChain = chain => { state.chain = chain; emit('chainChanged', chain); };
    w.ethereum={on(event: string, listener: (...args: unknown[]) => void) { const group = listeners.get(event) ?? new Set(); group.add(listener); listeners.set(event, group); },
      removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); }, request:async(input:{method:string;params?:unknown[]})=>{
      requests.push(input);
      if(input.method==='eth_accounts')return state.connected?[state.account]:[];
      if(input.method==='eth_requestAccounts'){state.connected=true;return[state.account];}
      if(input.method==='eth_chainId')return state.chain;
      if(input.method==='wallet_switchEthereumChain'){
        const target=(input.params?.[0] as {chainId:string}).chainId;
        if(!options.switching)throw Object.assign(new Error('Owner declined the network switch'),{code:4001});
        if(options.switching==='UNKNOWN'&&!state.added.has(target))throw Object.assign(new Error('Unrecognized chain'),{code:4902});
        w.setSupplyWalletChain(target);return null;
      }
      if(input.method==='wallet_addEthereumChain'){state.added.add((input.params?.[0] as {chainId:string}).chainId);return null;}
      if(input.method==='eth_getTransactionCount'){if(options.nonceFailure||options.lateNonceFailure&&requests.filter(r=>r.method==='eth_getTransactionCount').length===2)throw Object.assign(new Error('MOCK_READ_FAILED_BEFORE_SUBMISSION',{cause:new Error('Disconnected transport')}),{code:4900,data:{stage:'READ_ONLY_PREFLIGHT'}});if(options.walletNonce!==undefined)return options.walletNonce;return w.grylooSupplyTestRpc('eth_getTransactionCount',input.params??[],route);}
      if(input.method==='eth_sendTransaction'){
        if(options.providerFailure)throw Object.assign(new Error('Provider refused malformed request',{cause:new Error('Validation')}),{code:-32602,data:{reason:'invalid transaction'}});
        // Approvals go to the reviewed token: Base Sepolia USDC or Ethereum Sepolia WBTC.
        const tx=input.params?.[0] as {to:string};const step=['0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f','0x29f2d40b0605204364af54ec677bd022da425d03'].includes(tx.to)?'APPROVAL':'SUPPLY';
        if(options.pause===step)await new Promise<void>(resolve=>{w.releaseSupplyWalletRequest=resolve;});
        if(options.reject===step)throw Object.assign(new Error('Owner rejected test request'),{code:4001});
        if(options.notBroadcast===step)throw new Error('MOCK_NOT_BROADCAST');
        const assigned={...tx,nonce:await w.grylooSupplyTestRpc('eth_getTransactionCount',[state.account,'pending'],route)};
        const hash=await w.grylooSupplyTestRpc('MOCK_submit',[assigned],route);if(options.uncertain===step)throw new Error('MOCK_RESPONSE_LOST');return hash;
      }
      throw new Error('MOCK_WALLET_METHOD_DENIED');
    }};
  },{owner:SUPPLY_OWNER,options});
}

export async function setSupplyWalletChain(page: Page, chain: string) {
  await page.evaluate(value => (window as unknown as { setSupplyWalletChain(chain: string): void }).setSupplyWalletChain(value), chain);
}

export async function resetSupplyHarness(options:Record<string,unknown>={},route:SupplyRoute=''){
  if(process.env.GRYLOO_SUPPLY_E2E!=='MOCKED_LOOPBACK_ONLY'||!process.env.GRYLOO_SUPPLY_JOURNAL?.startsWith(join(tmpdir(),'gryloo-build012a-')))throw new Error('MOCK_RESET_DENIED');
  await rm(process.env.GRYLOO_SUPPLY_JOURNAL,{recursive:true,force:true});await supplyHarnessRpc('MOCK_reset',[options],route);
}
export async function authorSupply(page:Page,amount='10',beneficiary=SUPPLY_OWNER){
  await page.goto('/');await page.getByRole('button',{name:'Add supply',exact:true}).click();
  const card=page.locator('.build-flow-surface .composer-card.active');
  await card.getByRole('textbox',{name:'Source amount (USDC)',exact:true}).fill(amount);
  await card.getByRole('button',{name:'Review Supply change',exact:true}).click();
  await card.getByRole('button',{name:'Apply proposal',exact:true}).click();
  await page.locator('.build-flow-surface .composer-card.active').getByRole('button',{name:'Advanced Settings',exact:true}).click();
  const form=page.getByRole('form',{name:'Edit Supply'});
  const unchanged = await form.getByLabel('Supply amount (USDC)').inputValue() === amount && await form.getByLabel('Supply beneficiary').inputValue() === beneficiary;
  await form.getByLabel('Supply amount (USDC)').fill(amount);await form.getByLabel('Supply beneficiary').fill(beneficiary);
  if (unchanged) return;
  await page.locator('.build-flow-surface .composer-card.active').getByRole('button',{name:'Review Supply change',exact:true}).click();
  await page.getByRole('button',{name:'Apply proposal',exact:true}).click();
}
export async function reviewSupply(page:Page){
  await page.getByRole('button',{name:'Simular Fees'}).click(); await openSimulationDetails(page);await page.getByRole('button',{name:'Simulate Supply',exact:true}).click();
  await acceptProductReview(page);
}
export async function supplySendCount(page:Page):Promise<number>{return page.evaluate(()=>{
  const w=window as unknown as {supplyWalletRequests:{method:string}[]};return w.supplyWalletRequests.filter(r=>r.method==='eth_sendTransaction').length;
});}

// Captured read-only RPC responses for the real owner-signed Base Sepolia approval.
export const realWrappedApprovalFixture = JSON.parse(inflateSync(Buffer.from(
  [
    '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',
  ].join(''),'base64')).toString()) as {review:SupplyReview;attempt:{step:'APPROVAL';nonce:string;transaction:{from:string;to:string;data:string;value:string;chainId:string};transactionHash:string;preparedAtBlock:number};responses:Record<string,unknown>};
