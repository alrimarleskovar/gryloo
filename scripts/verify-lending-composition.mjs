// SPDX-License-Identifier: AGPL-3.0-only
/** Separate read-only CLI. It never creates a wallet or exposes a submission method. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AAVE_V3_BASE_SEPOLIA as p, LENDING_BASE_SEPOLIA as u } from '../packages/action-registry/dist/index.js';
const [mode, input, output] = process.argv.slice(2);
if (!['--route', '--preflight', '--evidence'].includes(mode) || !input || mode !== '--route' && !output) throw Error('Usage: --route output.json | --preflight owner output.json | --evidence export.json verification.json');
const allowed = new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_simulateV1','eth_getBalance','eth_getTransactionCount','eth_gasPrice','eth_getTransactionByHash','eth_getTransactionReceipt']);
const transcript = []; let queue = Promise.resolve();
const endpoints = ['https://sepolia.base.org', p.rpc];
function rpcAt(endpoint, method, params) {
  if (!allowed.has(method)) throw Error('READ_ONLY_METHOD_REQUIRED');
  const job = queue.then(async () => {
    for (let attempt=0; attempt<3; attempt++) {
      await new Promise(resolve => globalThis.setTimeout(resolve, attempt ? 1000*attempt : 150));
      const response = await globalThis.fetch(endpoint, {method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:transcript.length+1,method,params}),signal:globalThis.AbortSignal.timeout(30000)});
      const body=await response.json(); transcript.push({endpoint,method,params,response:body});
      if(response.status===429||body.error?.code===-32005) { if(attempt<2) continue; throw Error('READ_ONLY_RPC_RATE_LIMITED'); }
      if (!response.ok || body.error || !('result' in body)) throw Error('READ_ONLY_RPC_FAILED'); return body.result;
    }
  }); queue=job.catch(()=>undefined); return job;
}
const word = v => BigInt(v).toString(16).padStart(64,'0');
const data = '0x1698ee82'+word(p.asset)+word(u.weth)+word(500);
let result;
if(mode==='--route') {
  const observations=[];
  for (const endpoint of endpoints) {
    try {
      if(BigInt(await rpcAt(endpoint,'eth_chainId',[]))!==84532n) throw Error('CHAIN_MISMATCH');
      const block=await rpcAt(endpoint,'eth_getBlockByNumber',['latest',false]), tag=block.number;
      const call=(to,data)=>rpcAt(endpoint,'eth_call',[{to,data},tag]);
      const address=BigInt(await call(u.factory,data));
      if(address===0n) { observations.push({endpoint,block,pool:null,viable:false,blocker:'COMPATIBLE_POOL_NOT_FOUND'}); continue; }
      const pool='0x'+address.toString(16).padStart(40,'0');
      const [token0,token1,fee,factory,liquidity,slot0,poolUsdc,poolWeth]=await Promise.all([
        call(pool,'0x0dfe1681'),call(pool,'0xd21220a7'),call(pool,'0xddca3f43'),call(pool,'0xc45a0155'),call(pool,'0x1a686502'),call(pool,'0x3850c7bd'),
        call(p.asset,'0x70a08231'+word(pool)),call(u.weth,'0x70a08231'+word(pool))]);
      const identity=[BigInt(token0),BigInt(token1)].includes(BigInt(p.asset))&&[BigInt(token0),BigInt(token1)].includes(BigInt(u.weth))&&BigInt(fee)===500n&&BigInt(factory)===BigInt(u.factory);
      let quote=null, quoteError=null;
      try { quote=await call(u.quoter,'0xc6a5026a'+word(p.asset)+word(u.weth)+word(10000)+word(500)+word(0)); } catch(e) { quoteError=e.message; }
      const codes=await Promise.all([u.factory,u.router,u.quoter,pool,p.asset,u.weth].map(to=>rpcAt(endpoint,'eth_getCode',[to,tag])));
      const codeHashes=codes.map(code=>'0x'+createHash('sha256').update(code).digest('hex'));
      const end=await rpcAt(endpoint,'eth_getBlockByNumber',[tag,false]);
      const viable=identity&&BigInt(liquidity)>0n&&quote!==null&&BigInt('0x'+quote.slice(2,66))>0n&&end.hash===block.hash;
      observations.push({endpoint,block:{number:tag,hash:block.hash,timestamp:block.timestamp},pool,token0,token1,fee,factory,liquidity,slot0,poolUsdc,poolWeth,quote,quoteError,codeHashes,
        viable,blocker:!identity?'POOL_IDENTITY_MISMATCH':BigInt(liquidity)===0n?'COMPATIBLE_POOL_HAS_NO_ACTIVE_LIQUIDITY':!quote?'COMPATIBLE_POOL_QUOTE_UNAVAILABLE':null});
    } catch(e) { observations.push({endpoint,viable:false,blocker:e.message}); }
  }
  const urls=[p.officialSource.replace('https://github.com/','https://raw.githubusercontent.com/').replace('/blob/','/'),u.source];
  const sources=[];
  for(const url of urls) { const response=await globalThis.fetch(url,{signal:globalThis.AbortSignal.timeout(30000)}); if(!response.ok) throw Error('OFFICIAL_SOURCE_UNAVAILABLE'); const body=await response.text();const expected=url.includes('raw.githubusercontent.com')?[p.asset,p.pool,p.aToken,p.variableDebtToken,p.oracle]:[u.factory,u.router,u.quoter,u.weth];
    const verifiedAddresses=expected.filter(address=>body.toLowerCase().includes(address.toLowerCase()));if(verifiedAddresses.length!==expected.length)throw Error('OFFICIAL_DEPLOYMENT_IDENTITY_MISMATCH');sources.push({url,sha256:createHash('sha256').update(body).digest('hex'),verifiedAddresses}); }
  if(observations.every(o=>o.viable)&&JSON.stringify(observations[0].codeHashes)!==JSON.stringify(observations[1].codeHashes))throw Error('INDEPENDENT_RPC_CODE_MISMATCH');
  result={status:observations.every(o=>o.viable)?'ROUTE_OBSERVED_NOT_EXECUTION_READY':'PUBLIC_EXECUTION_BLOCKED',readOnly:true,ownerExecution:false,
    asset:p.asset,output:u.weth,amount:'10000',fee:500,observations,sources};
} else if(mode==='--preflight') {
  const {simulateLendingComposition}=await import('../packages/reference-compiler/dist/index.js');
  const {createLendingCompositionWorkflow}=await import('../packages/workflow-contracts/dist/index.js');
  const owner=input.toLowerCase(), workflow=createLendingCompositionWorkflow('build-013-public',0,{chain:p.chain,
    collateral:{chainId:p.chain,address:p.asset,decimals:6},borrowed:{chainId:p.chain,address:p.asset,decimals:6},output:{chainId:p.chain,address:u.weth,decimals:18},
    supplyAmount:'100000',borrowAmount:'10000',slippageBps:50,owner});
  try { const review=await simulateLendingComposition(workflow,owner,(m,a)=>rpcAt(p.rpc,m,a)); result={status:'READY_FOR_OWNER_EXECUTION',readOnly:true,ownerExecution:false,review}; }
  catch(e) { result={status:'PUBLIC_EXECUTION_BLOCKED',readOnly:true,ownerExecution:false,blocker:e.message,workflow}; }
} else {
  const {verifyLendingExport}=await import('../packages/reference-reconciler/dist/index.js');
  // Read through the official Base endpoint, distinct from the runtime's Tenderly provider.
  // Never fall back to the runtime provider if independent reads fail.
  result=await verifyLendingExport(JSON.parse(await readFile(input,'utf8')),(m,a)=>rpcAt(endpoints[0],m,a));
  if(result.verdict!=='INDEPENDENTLY_RECONCILED') throw Error('INDEPENDENT_RECONCILIATION_FAILED');
}
await writeFile(mode==='--route'?input:output,JSON.stringify({...result,observedAt:new Date().toISOString(),transcript},null,2)+'\n');
process.stdout.write(JSON.stringify({status:result.status,blocker:result.blocker,observations:result.observations?.map(o=>({pool:o.pool,liquidity:o.liquidity,blocker:o.blocker}))})+'\n');
