// SPDX-License-Identifier: AGPL-3.0-only
import { rm } from 'node:fs/promises';
import type { Page } from '@playwright/test';
export const LENDING_OWNER='0x5975c152fe58cdcb7e25586a3c9b994a16dbb615';
export async function lendingRpc(method:string,params:unknown[]=[]):Promise<unknown>{
  const response=await fetch('http://127.0.0.1:8554',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const value=await response.json() as {result?:unknown;error?:unknown};if(value.error)throw Error('MOCK_LENDING_RPC_ERROR');return value.result;
}
export async function resetLending(options:Record<string,unknown>={}){
  const directory=process.env.GRYLOO_LENDING_JOURNAL;
  if(process.env.GRYLOO_LENDING_E2E!=='MOCKED_LOOPBACK_ONLY'||!directory?.startsWith('/tmp/gryloo-build013-'))throw Error('MOCK_LENDING_RESET_DENIED');
  await rm(directory,{recursive:true,force:true});await lendingRpc('MOCK_reset',[options]);
}
export async function installLendingWallet(page:Page,options:{chain?:string;uncertainAt?:number;disconnectedAt?:number;revertAt?:number;nonceMismatchOnce?:boolean}={}){
  await page.exposeFunction('grylooLendingTestRpc',lendingRpc);
  await page.addInitScript(({owner,options})=>{
    const requests:{method:string;params?:unknown[]}[]=[],state={chain:options.chain??'0x14a34',account:owner,sends:0,nonceReads:0};
    const w=window as unknown as {ethereum:unknown;lendingRequests:typeof requests;grylooLendingTestRpc:(method:string,params:unknown[])=>Promise<unknown>};
    w.lendingRequests=requests;
    w.ethereum={request:async(input:{method:string;params?:unknown[]})=>{
      requests.push(input);
      if(input.method==='eth_accounts'||input.method==='eth_requestAccounts')return[state.account];
      if(input.method==='eth_chainId')return state.chain;
      if(input.method==='eth_getTransactionCount'){const nonce=await w.grylooLendingTestRpc(input.method,input.params??[]) as string;return options.nonceMismatchOnce&&++state.nonceReads===1?'0x'+(BigInt(nonce)+1n).toString(16):nonce;}
      if(input.method==='eth_sendTransaction'){
        state.sends++;if(options.disconnectedAt===state.sends)throw Object.assign(Error('MOCK_WALLET_DISCONNECTED'),{code:4900});
        const tx=input.params?.[0] as Record<string,unknown>;
        if(options.revertAt===state.sends)await w.grylooLendingTestRpc('MOCK_patch',[{revert:true}]);
        const hash=await w.grylooLendingTestRpc('MOCK_submit',[{...tx,nonce:await w.grylooLendingTestRpc('eth_getTransactionCount',[owner,'pending'])}]);
        if(options.uncertainAt===state.sends)throw Error('MOCK_RESPONSE_LOST');return hash;
      }
      throw Error('MOCK_LENDING_WALLET_METHOD_DENIED');
    }};
  },{owner:LENDING_OWNER,options});
}
export const lendingSends=(page:Page)=>page.evaluate(()=>((window as unknown as {lendingRequests:{method:string}[]}).lendingRequests??[]).filter(r=>r.method==='eth_sendTransaction').length);
