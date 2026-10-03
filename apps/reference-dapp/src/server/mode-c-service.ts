// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-016 local-only adapter. No HTTP action, owner signing or public-chain send endpoint. */
import { setTimeout as delay } from 'node:timers/promises';
import { readFile,stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { serializeModeC as canonicalJson } from '@defi-workflow-engine/workflow-contracts';
import { collectModeCObservation,modeCVerifierArguments,modeBCodeHash,fromHex,toHex,type ModeCCompiled } from '@defi-workflow-engine/reference-compiler';
import { createModeCExecutor,signModeBLocalTransaction,type ModeCDriver,type ModeCTransaction,type ExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { decodeModeBSignedTransaction,reconcileModeB,buildModeCEvidence,type ModeBChainEvidence } from '@defi-workflow-engine/reference-reconciler';

export function createModeCLocalService(input:{compiled:ModeCCompiled;storage:ExecutionStorage;rpcUrl:string;executorKeyFile:string}) {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(input.rpcUrl) || !isAbsolute(input.executorKeyFile) ||
    !input.executorKeyFile.startsWith('/tmp/')) throw new Error('MODE_C_LOCAL_PROFILE_INVALID');
  const c=JSON.parse(canonicalJson(input.compiled)) as ModeCCompiled,p=c.policy;
  let rpcId=0;
  const call=async(method:string,params:readonly unknown[]=[]):Promise<unknown>=>{
    const response=await fetch(input.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params}),signal:AbortSignal.timeout(20000)});
    const r=await response.json() as {result?:unknown;error?:unknown};
    if(!response.ok||r.error||!('result' in r))throw new Error('MODE_C_RPC_UNAVAILABLE');return r.result;
  };
  const selector=(s:string)=>modeBCodeHash(toHex(new TextEncoder().encode(s))).slice(0,10);
  const word=(n:bigint)=>n.toString(16).padStart(64,'0');
  const addr=(s:string)=>word(BigInt(s));
  const scalar=(v:unknown):bigint=>{if(typeof v!=='string'||!/^0x[0-9a-f]{64}$/.test(v))throw new Error('MODE_C_UNVERIFIABLE_STATE');return BigInt(v);};
  const read=(to:string,data:string,block:unknown='latest')=>call('eth_call',[{to,data},block]);
  const head=async()=>{
    if(await call('eth_chainId')!=='0x7a69')throw new Error('MODE_C_WRONG_CHAIN');
    const b=await call('eth_getBlockByNumber',['latest',false]) as {timestamp:string;baseFeePerGas:string;hash:string};
    if(!b||!/^0x[0-9a-f]{64}$/.test(b.hash)||!/^0x[0-9a-f]+$/.test(b.timestamp)||!/^0x[0-9a-f]+$/.test(b.baseFeePerGas))throw new Error('MODE_C_UNVERIFIABLE_STATE');
    return {...b,seconds:Number(BigInt(b.timestamp)),fee:BigInt(b.baseFeePerGas)};
  };
  const module=async(to:string,member:string,block:unknown='latest')=>scalar(await read(to,'0x2d9ad53d'+addr(member),block))===1n;
  const allowance=async(block:unknown='latest')=>{
    const v=await read(p.roles,'0x5e7c9fe8'+p.allowanceKey.slice(2),block);
    if(typeof v!=='string'||!/^0x[0-9a-f]{320}$/.test(v))throw new Error('MODE_C_UNVERIFIABLE_STATE');
    return BigInt('0x'+v.slice(194,258));
  };
  const balance=async(token:string,block:unknown='latest')=>scalar(await read(token,'0x70a08231'+addr(p.safe),block));
  const pin=async(to:string,expected:string)=>{
    const code=await call('eth_getCode',[to,'latest']);
    return typeof code==='string'&&modeBCodeHash(code)===expected;
  };
  // Pinned Roles 2.1.0 compilerInput storage layout: roles mapping slot 4,
  // Role.members +0, targets +1, scopeConfig +2. Reject wildcard/broadened scope.
  const scopeInstalled=async()=>{
    const scope=c.compiled.conditionalScope;if(!scope)return false;
    const mapping=(key:string,slot:bigint)=>modeBCodeHash('0x'+key+word(slot));
    const role=BigInt(mapping(p.roleKey.slice(2),4n));
    const member=scalar(await call('eth_getStorageAt',[p.roles,mapping(addr(p.executor),role),'latest'])),target=scalar(await call('eth_getStorageAt',[p.roles,mapping(addr(p.router),role+1n),'latest']));
    if(member!==1n||target!==2n)return false;
    const key=(p.router.slice(2)+p.functionId.slice(2)).padEnd(64,'0');
    const header=scalar(await call('eth_getStorageAt',[p.roles,mapping(key,role+2n),'latest']));
    const pointer='0x'+(header&((1n<<160n)-1n)).toString(16).padStart(40,'0');
    const code=await call('eth_getCode',[pointer,'latest']);
    if(header>>160n!==BigInt(scope.count)<<80n||code!==scope.runtime)return false;
    return true;
  };
  const termsExpected='0x'+modeCVerifierArguments(c);
  const driver:ModeCDriver={
    now:async()=>Math.max((await head()).seconds,Math.floor(Date.now()/1000)),
    observe:async()=>collectModeCObservation(call,p,c.executionPlan.segments[0]!.steps[0]!.nodeId,await driver.now()),
    verifyInstalled:async()=>{
      await head();
      if(!await pin(p.verifier.address,p.verifier.runtimeHash)||!await pin(p.safe,String(c.compiled.permission.safeCodeHash))||
        !await pin(p.roles,String(c.compiled.permission.rolesCodeHash)))return false;
      if(await read(p.verifier.address,selector('terms()'))!==termsExpected ||
        scalar(await read(p.roles,'0x8da5cb5b'))!==BigInt(p.safe)||scalar(await read(p.roles,'0x5aef7de6'))!==BigInt(p.safe)||
        scalar(await read(p.roles,'0xd4b83992'))!==BigInt(p.safe)||scalar(await read(p.safe,'0xe75235b8'))!==1n)return false;
      const owners=await read(p.safe,'0xa0e67e2b');
      if(typeof owners!=='string'||owners!=='0x'+word(32n)+word(1n)+addr(p.owner))return false;
      const budget=await read(p.roles,'0x5e7c9fe8'+p.allowanceKey.slice(2));
      return await scopeInstalled()&&await module(p.safe,p.roles)&&await module(p.roles,p.executor)&&await allowance()===1n&&
        typeof budget==='string'&&budget.slice(2,194)===word(0n)+word((1n<<128n)-1n)+word(0n)&&BigInt('0x'+budget.slice(258))<(1n<<64n);
    },
    eligible:async()=>{
      const payload=p.swapCalldata.slice(2),tag=c.policyHash.slice(2,26).padEnd(64,'0');
      const data=selector('check(address,uint256,bytes,uint8,uint256,uint256,bytes12)')+addr(p.router)+word(0n)+word(224n)+
        word(0n)+word(0n)+word(0n)+tag+word(BigInt(payload.length/2))+payload.padEnd(Math.ceil(payload.length/64)*64,'0');
      const result=await call('eth_call',[{from:p.roles,to:p.verifier.address,data},'latest']);
      return typeof result==='string'&&/^0x[0-9a-f]{128}$/.test(result)&&BigInt('0x'+result.slice(2,66))===1n;
    },
    prepareExact:async request=>{
      if(request.from!==p.executor||request.to!==p.roles||request.data!==p.executorCalldata||request.value!=='0x0')throw new Error('MODE_C_AUTHORITY_EXPANSION');
      const file=await stat(input.executorKeyFile);
      if(!file.isFile()||(file.mode&0o077)!==0)throw new Error('MODE_C_LOCAL_KEY_PERMISSIONS');
      const value=JSON.parse(await readFile(input.executorKeyFile,'utf8')) as {executor?:string};
      if(typeof value.executor!=='string'||!/^0x[0-9a-f]{64}$/.test(value.executor))throw new Error('MODE_C_LOCAL_KEY_INVALID');
      const key=fromHex(value.executor);let signed:ReturnType<typeof signModeBLocalTransaction>;
      const nonce=BigInt(await call('eth_getTransactionCount',[p.executor,'pending']) as string),b=await head();
      try {
        signed=signModeBLocalTransaction({expectedExecutor:p.executor,to:p.roles,data:p.executorCalldata,nonce,gasLimit:1800000n,maxFeePerGas:b.fee*2n+1000000n},key);
      } finally{key.fill(0);}
      return {hash:signed.hash,raw:signed.raw,nonce:nonce.toString(),beforeInput:(await balance(p.tokenIn)).toString(),beforeOutput:(await balance(p.tokenOut)).toString()};
    },
    submitExact:async(tx:ModeCTransaction)=>{
      const signed=decodeModeBSignedTransaction(fromHex(tx.raw),tx.hash);
      if(signed.signer!==p.executor||signed.to!==p.roles||signed.data!==p.executorCalldata||signed.nonce.toString()!==tx.nonce)
        throw new Error('MODE_C_AUTHORITY_EXPANSION');
      // Live condition recheck cannot replace the onchain Custom check; it fails closed before dispatch as well.
      if(!await driver.verifyInstalled()||!await driver.eligible())throw new Error('MODE_C_DISPATCH_RECHECK_FAILED');
      return await call('eth_sendRawTransaction',[tx.raw]) as string;
    },
    reconcile:async tx=>{
      const receipt=await call('eth_getTransactionReceipt',[tx.hash]) as {status:string;blockHash:string}|null;
      if(!receipt)return {outcome:'INCONCLUSIVE',transactionHash:tx.hash,details:{code:'MODE_C_RECEIPT_UNAVAILABLE',nonce:tx.nonce}};
      const raw=await call('eth_getRawTransactionByHash',[tx.hash]);
      if(typeof raw!=='string')throw new Error('MODE_C_UNVERIFIABLE_STATE');
      const signed=decodeModeBSignedTransaction(fromHex(raw),tx.hash),at={blockHash:receipt.blockHash,requireCanonical:true};
      const rolesOwner=scalar(await read(p.roles,'0x8da5cb5b',at));
      const owners=await read(p.safe,'0xa0e67e2b',at);
      if(typeof owners!=='string'||!/^0x[0-9a-f]{192}$/.test(owners)||owners.slice(2,130)!==word(32n)+word(1n))throw new Error('MODE_C_UNVERIFIABLE_STATE');
      const actualOwner='0x'+owners.slice(-40),threshold=Number(scalar(await read(p.safe,'0xe75235b8',at)));
      const chainEvidence:ModeBChainEvidence={chainId:Number(BigInt(await call('eth_chainId') as string)),safe:p.safe,roles:p.roles,
        rolesOwner:'0x'+rolesOwner.toString(16).padStart(40,'0'),executor:p.executor,transactionSigner:signed.signer,
        target:p.router,transactionTo:signed.to,transactionInput:signed.data,expectedInput:p.executorCalldata,
        safeCodeHash:modeBCodeHash(await call('eth_getCode',[p.safe,at]) as string),expectedSafeCodeHash:String(c.compiled.permission.safeCodeHash),
        rolesCodeHash:modeBCodeHash(await call('eth_getCode',[p.roles,at]) as string),expectedRolesCodeHash:String(c.compiled.permission.rolesCodeHash),
        owner:actualOwner,expectedOwner:p.owner,threshold,moduleEnabled:await module(p.safe,p.roles,at),roleAssigned:await module(p.roles,p.executor,at),
        allowanceRemaining:await allowance(at),transactionReceipt:{status:receipt.status==='0x1'?1:0,blockHash:receipt.blockHash},
        inputDebited:BigInt(tx.beforeInput)-await balance(p.tokenIn,at),outputCredited:await balance(p.tokenOut,at)-BigInt(tx.beforeOutput),
        amountIn:BigInt(p.maximumSwapAmount),minimumOut:BigInt(p.minimumOut),
        residualTokenAllowance:scalar(await read(p.tokenIn,'0xdd62ed3e'+addr(p.safe)+addr(p.router),at))};
      const outcome=reconcileModeB(chainEvidence);
      const committed=JSON.parse(JSON.stringify(chainEvidence,(_,v:unknown)=>typeof v==='bigint'?v.toString():v)) as unknown;
      const kind=outcome.outcome==='CONFIRMED_NOT_RECONCILED'?'INCONCLUSIVE':outcome.outcome;
      return {outcome:kind,transactionHash:tx.hash,details:{receipt,raw,nonce:tx.nonce,chainEvidence:committed,reconciliation:outcome}};
    },
    verifyRevoked:async hashes=>{
      if(hashes.length!==c.compiled.revocation.length)return false;
      for(const [i,h] of hashes.entries()) {
        const receipt=await call('eth_getTransactionReceipt',[h]) as {status:string}|null;
        const raw=await call('eth_getRawTransactionByHash',[h]);
        if(receipt?.status!=='0x1'||typeof raw!=='string')return false;
        const signed=decodeModeBSignedTransaction(fromHex(raw),h),expected=c.compiled.revocation[i]!;
        if(signed.signer!==p.owner||signed.to!==expected.to||signed.data!==expected.data)return false;
      }
      await head();
      return !await module(p.safe,p.roles)&&!await module(p.roles,p.executor)&&
        scalar(await read(p.tokenIn,'0xdd62ed3e'+addr(p.safe)+addr(p.router)))===0n;
    },
  };
  const worker=createModeCExecutor({compiled:c,storage:input.storage,driver});
  const watch=async(signal?:AbortSignal)=>{
    let lastAttempt:Awaited<ReturnType<typeof worker.attempt>>|null=null;
    for(;;) {
      if(signal?.aborted)return {status:'STOPPED' as const,lastAttempt};
      const now=await driver.now(),state=await worker.status();
      if(state.revoked||state.paused)return {status:'REVOKED_OR_PAUSED' as const,lastAttempt};
      if(now>=p.expiresAt)return {status:'EXPIRED' as const,lastAttempt};
      if(!state.actions)return {status:'CONSUMED' as const,lastAttempt};
      lastAttempt=await worker.attempt();
      if(!lastAttempt.remaining.actions)return {status:'CONSUMED' as const,lastAttempt};
      // One fixed conditional policy; no scheduler/plugin/strategy selection.
      // The signed minimum interval bounds polling as well as financial dispatch.
      try {await delay(p.frequencySeconds*1000,undefined,{signal});}
      catch(error) {if(signal?.aborted)return {status:'STOPPED' as const,lastAttempt};throw error;}
    }
  };
  return {worker,driver,watch,evidence:async(previous?:{version:number;hash:string})=>{
    if(previous) {
      const prior=await input.storage.log.read('dip-evidence-'+previous.hash.slice(2)+'.json');
      if(!prior)throw new Error('MODE_C_EVIDENCE_PREDECESSOR_MISSING');
      const archived=JSON.parse(new TextDecoder().decode(prior)) as {evidenceBundleHash:string;bundle:{version:number;policyHash:string;manifestHash:string}};
      if(archived.evidenceBundleHash!==previous.hash||archived.bundle.version!==previous.version||
        archived.bundle.policyHash!==c.policyHash||archived.bundle.manifestHash!==c.manifestHash)throw new Error('MODE_C_EVIDENCE_PREDECESSOR_MISMATCH');
    }
    const evidence=buildModeCEvidence(c,await worker.events(),previous);
    const name='dip-evidence-'+evidence.evidenceBundleHash.slice(2)+'.json';
    const bytes=new TextEncoder().encode(canonicalJson(evidence));
    if(!await input.storage.log.create(name,bytes)) {
      const stored=await input.storage.log.read(name);
      if(!stored||new TextDecoder().decode(stored)!==new TextDecoder().decode(bytes))throw new Error('MODE_C_EVIDENCE_CONFLICT');
    }
    return evidence;
  }};
}
