// SPDX-License-Identifier: AGPL-3.0-only
/** MOCKED local EVM proof: real pinned Safe/Roles, synthetic pool/token/router.
 * Synthetic state is never described as observed Base state or FORK_REPRODUCED. */
import { spawn,execFileSync,type ChildProcess } from 'node:child_process';
import { readFile,mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { describe,it,beforeAll,afterAll,expect } from 'vitest';
import { MODE_C_USDC,MODE_C_WETH,MODE_C_FACTORY,MODE_C_ROUTER,MODE_C_SOURCE,MODE_C_VERIFIER,
  type SimulationBundle } from '@defi-workflow-engine/workflow-contracts';
import { collectModeCObservation,compileModeC,compileModeB,encodeSafeOwnerCall,modeCVerifierArguments,modeBCodeHash,rlpEncode,rlpInteger,toHex,fromHex,sqrtRatioAtTick,
  type ModeCCompiled } from '@defi-workflow-engine/reference-compiler';
import { createModeCLocalService } from '../../../apps/reference-dapp/src/server/mode-c-service.js';
import { MODE_B_PINS,MODE_B_LOCAL_DEPLOYER,createAddress,relinkRoles } from '../../../apps/reference-dapp/e2e/fork/mode-b-harness.mjs';
import { createFileExecutionStorage } from '../src/durable-storage.js';
import { signModeBLocalTransaction } from '../src/mode-b.js';
import { fixture,artifactHash,S,addr } from './mode-c-fixture.js';

const enabled=process.env.GRYLOO_BUILD016_LOCAL==='1';
describe.skipIf(!enabled)('BUILD-016 independent local EVM boundary (MOCKED)',()=>{
  let simulationResponse:unknown;
  let anvil:ChildProcess,dir:string,c:ModeCCompiled,service:ReturnType<typeof createModeCLocalService>,snapshot:string;
  const url='http://127.0.0.1:19545';let id=0;
  const ownerKey=secp256k1.utils.randomSecretKey(),executorKey=secp256k1.utils.randomSecretKey();
  const keyAddress=(key:Uint8Array)=>toHex(keccak_256(secp256k1.getPublicKey(key,false).slice(1)).slice(-20));
  const owner=keyAddress(ownerKey),executor=keyAddress(executorKey),pool=addr(800);
  const word=(v:bigint)=>BigInt.asUintN(256,v).toString(16).padStart(64,'0');
  const aw=(a:string)=>word(BigInt(a));
  const selector=(s:string)=>modeBCodeHash(toHex(new TextEncoder().encode(s))).slice(0,10);
  async function rpc(method:string,params:unknown[]=[]):Promise<unknown> {
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
    const v=await r.json() as {result?:unknown;error?:{message:string}};
    if(v.error)throw new Error(`${method}: ${v.error.message}`);return v.result;
  }
  const read=(to:string,data:string)=>rpc('eth_call',[{to,data},'latest']);
  async function receipt(h:string) {
    for(let i=0;i<50;i++) {
      const r=await rpc('eth_getTransactionReceipt',[h]) as {status:string;contractAddress:string;blockHash:string}|null;
      if(r)return r;await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw new Error('LOCAL_RECEIPT_MISSING');
  }
  async function ownerTx(to:string|null,data:string):Promise<string> {
    const nonce=BigInt(await rpc('eth_getTransactionCount',[owner,'pending']) as string);
    const fields=[rlpInteger(31337n),rlpInteger(nonce),rlpInteger(1000000n),rlpInteger(10000000000n),rlpInteger(12000000n),
      to?fromHex(to):new Uint8Array(),rlpInteger(0n),fromHex(data),[]];
    const unsigned=Uint8Array.of(2,...rlpEncode(fields));
    const sig=secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(unsigned),ownerKey,{prehash:false,format:'recovered'}),'recovered');
    const raw=toHex(Uint8Array.of(2,...rlpEncode([...fields,rlpInteger(BigInt(sig.recovery!)),rlpInteger(sig.r),rlpInteger(sig.s)])));
    const hash=await rpc('eth_sendRawTransaction',[raw]) as string;await receipt(hash);return hash;
  }
  async function setPool(sqrt:bigint) {
    let lo=-887272,hi=887272;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(sqrtRatioAtTick(mid)<=sqrt)lo=mid;else hi=mid-1;}
    expect((await receipt(await ownerTx(pool,selector('init(uint160,int24)')+word(sqrt)+word(BigInt(lo))))).status).toBe('0x1');
  }
  beforeAll(async()=>{
    if(!process.env.GRYLOO_ANVIL_BIN||!process.env.GRYLOO_BUILD016_SOLC||!process.env.GRYLOO_BUILD016_INPUTS)throw new Error('LOCAL_TEST_INPUTS_REQUIRED');
    dir=await mkdtemp(join(tmpdir(),'build016-evm-'));
    const solc=process.env.GRYLOO_BUILD016_SOLC;
    expect(createHash('sha256').update(await readFile(solc)).digest('hex')).toBe('f2857a898be15c69e8de5598dcd3f3e169e94964a0ce9a0bbb1b111f145a81df');
    execFileSync(solc,['--via-ir','--optimize','--optimize-runs','200','--evm-version','shanghai','--bin','--bin-runtime','--abi',
      resolve('packages/reference-executor/contracts/BuyDipCondition.sol'),resolve('packages/reference-executor/test/contracts/BuyDipFixtures.sol'),'-o',dir]);
    anvil=spawn(process.env.GRYLOO_ANVIL_BIN,['--silent','--host','127.0.0.1','--port','19545','--chain-id','31337'],{stdio:'ignore'});
    let ready=false;
    for(let i=0;i<100;i++){try{await rpc('eth_chainId');ready=true;break;}catch{await new Promise(r=>setTimeout(r,50));}}
    if(!ready)throw new Error('LOCAL_ANVIL_NOT_READY');
    await rpc('anvil_setBalance',[MODE_B_LOCAL_DEPLOYER,'0x56bc75e2d63100000']);
    await rpc('anvil_setBalance',[owner,'0x56bc75e2d63100000']);await rpc('anvil_setBalance',[executor,'0x56bc75e2d63100000']);
    await rpc('anvil_impersonateAccount',[MODE_B_LOCAL_DEPLOYER]);
    const inputs=process.env.GRYLOO_BUILD016_INPUTS;
    async function pinned(p:string,digest:string){const b=await readFile(p);expect(createHash('sha256').update(b).digest('hex')).toBe(digest);return b;}
    const safeL2=JSON.parse((await pinned(join(inputs,'safe/package/build/artifacts/contracts/SafeL2.sol/SafeL2.json'),MODE_B_PINS.safeL2ArtifactSha256)).toString()) as {bytecode:string};
    const safeProxy=JSON.parse((await pinned(join(inputs,'safe/package/build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json'),MODE_B_PINS.safeProxyArtifactSha256)).toString()) as {bytecode:string};
    const roles=JSON.parse((await pinned(join(inputs,'roles-mastercopies.json'),MODE_B_PINS.rolesMastercopiesSha256)).toString()) as Record<string,Record<string,{bytecode:string}>>;
    const singleton='0x'+(await pinned(join(inputs,'erc2470-initcode.bin'),MODE_B_PINS.eip2470InitCodeSha256)).toString('hex');
    const targets={safeSingleton:createAddress(MODE_B_LOCAL_DEPLOYER,0),safe:createAddress(MODE_B_LOCAL_DEPLOYER,1),
      singletonFactory:createAddress(MODE_B_LOCAL_DEPLOYER,2),integrity:createAddress(MODE_B_LOCAL_DEPLOYER,3),
      packer:createAddress(MODE_B_LOCAL_DEPLOYER,4),roles:createAddress(MODE_B_LOCAL_DEPLOYER,5)};
    const codes=[safeL2.bytecode,safeProxy.bytecode+aw(targets.safeSingleton),singleton,roles.Integrity!['2.1.0']!.bytecode,
      roles.Packer!['2.1.0']!.bytecode,relinkRoles(roles.Roles!['2.1.0']!.bytecode,targets)+aw(owner)+aw(targets.safe)+aw(targets.safe)];
    for(const data of codes)expect((await receipt(await rpc('eth_sendTransaction',[{from:MODE_B_LOCAL_DEPLOYER,data,gas:'0xe4e1c0'}]) as string)).status).toBe('0x1');
    const setup='0xb63e800d'+word(256n)+word(1n)+word(0n)+word(320n)+word(0n)+word(0n)+word(0n)+word(0n)+word(1n)+aw(owner)+word(0n);
    expect((await receipt(await ownerTx(targets.safe,setup))).status).toBe('0x1');
    for(const [a,name] of [[MODE_C_WETH,'MockDipToken'],[MODE_C_USDC,'MockDipToken'],[MODE_C_FACTORY,'MockDipFactory'],[MODE_C_ROUTER,'MockDipRouter']] as const)
      await rpc('anvil_setCode',[a,'0x'+(await readFile(join(dir,name+'.bin-runtime'),'utf8')).trim()]);
    const poolCode='0x'+(await readFile(join(dir,'MockDipPool.bin-runtime'),'utf8')).trim();await rpc('anvil_setCode',[pool,poolCode]);
    // Explicit synthetic fixtures on an entirely isolated unforked node.
    await ownerTx(MODE_C_WETH,selector('init(uint8)')+word(18n));await ownerTx(MODE_C_USDC,selector('init(uint8)')+word(6n));
    await ownerTx(MODE_C_FACTORY,selector('init(address)')+aw(pool));
    await ownerTx(pool,selector('alter(address,address,uint24,bool)')+aw(MODE_C_WETH)+aw(MODE_C_USDC)+word(500n)+word(0n));
    await setPool(S);await ownerTx(MODE_C_USDC,selector('mint(address,uint256)')+aw(targets.safe)+word(1000000n));
    const current=await rpc('eth_getBlockByNumber',['latest',false]) as {timestamp:string};const now=Number(BigInt(current.timestamp));
    const sample=fixture(),source={id:MODE_C_SOURCE,pool,poolCodeHash:modeBCodeHash(poolCode),factory:MODE_C_FACTORY,fee:500 as const,maximumAgeSeconds:30};
    const reference=(await collectModeCObservation((m,p=[])=>rpc(m,[...p]),{source,semanticWorkflowHash:sample.policy.semanticWorkflowHash},'dip-swap',now)).artifact;
    const set={...sample.input.artifactSet,artifacts:[{artifactId:reference.artifactId,nodeId:reference.nodeId,artifactHash:artifactHash('quote-state-artifact',reference)}]};
    // Reuse the existing Mode B simulation mechanism for the unchanged financial primitive.
    // Conditional eligibility is separately verified by the installed view-only checker.
    const simProfile={...sample.input.profile,...targets,owner,executor};
    const probe=compileModeB(simProfile,{tokenIn:MODE_C_USDC,tokenOut:MODE_C_WETH,fee:500,recipient:targets.safe,
      amountIn:1000000n,amountOutMinimum:990n,sqrtPriceLimitX96:0n,deadline:BigInt(now+1799)},sample.input.salt);
    const ownerNonce=BigInt(await rpc('eth_getTransactionCount',[owner,'latest']) as string);
    const executorNonce=BigInt(await rpc('eth_getTransactionCount',[executor,'latest']) as string);
    const simCalls=probe.installation.map((tx,i)=>({from:owner,to:tx.to,data:tx.data,nonce:'0x'+(ownerNonce+BigInt(i)).toString(16),gas:'0xb71b00',maxFeePerGas:'0x2540be400',maxPriorityFeePerGas:'0xf4240',value:'0x0'}));
    simCalls.push({...simCalls[0]!,from:executor,to:probe.executorCall.to,data:probe.executorCall.data,nonce:'0x'+executorNonce.toString(16)});
    for(const [i,token] of [MODE_C_USDC,MODE_C_WETH].entries())simCalls.push({...simCalls[0]!,to:token,
      data:selector('balanceOf(address)')+aw(targets.safe),nonce:'0x'+(ownerNonce+BigInt(probe.installation.length+i)).toString(16)});
    const simulated=await rpc('eth_simulateV1',[{blockStateCalls:[{calls:simCalls}],validation:true,traceTransfers:false,returnFullTransactions:false},'latest']) as {calls:{status:string;returnData:string}[]}[];
    simulationResponse=simulated;
    expect(simulated[0]!.calls.every(row=>row.status==='0x1')).toBe(true);
    expect(BigInt(simulated[0]!.calls.at(-2)!.returnData)).toBe(0n);expect(BigInt(simulated[0]!.calls.at(-1)!.returnData)).toBe(1000n);
    const quantity=(n:string)=>({asset:{chainId:'eip155:31337',address:MODE_C_WETH,decimals:18},amount:n});
    const simulation:SimulationBundle={...sample.input.simulation,artifactSetHash:artifactHash('artifact-set',set),freshness:reference.freshness,
      outputs:[{nodeId:'dip-swap',outputId:'weth-output',expected:quantity('1000'),minimum:quantity('990'),adverse:quantity('990')}],
      uncertainty:[{code:'SIMULATION_RESPONSE_HASH',description:artifactHash('quote-state-artifact',reference)+'; '+modeBCodeHash(toHex(new TextEncoder().encode(JSON.stringify(simulated))))}],
      unsupportedAssumptions:['MOCKED local pool/token/router. Mode B financial call simulation; future trigger is independently checked onchain.']};
    const guardBin='0x'+(await readFile(join(dir,'BuyDipCondition.bin'),'utf8')).trim(),guardRuntime='0x'+(await readFile(join(dir,'BuyDipCondition.bin-runtime'),'utf8')).trim();
    const nonce=Number(BigInt(await rpc('eth_getTransactionCount',[owner,'pending']) as string)),guard=createAddress(owner,nonce);
    c=compileModeC({...sample.input,reference,artifactSet:set,simulation,startsAt:now,expiresAt:now+1800,source,minimumOut:'990',frequencySeconds:1,cooldownSeconds:1,
      profile:{...sample.input.profile,...targets,owner,executor,safeCodeHash:modeBCodeHash(await rpc('eth_getCode',[targets.safe,'latest']) as string),
        rolesCodeHash:modeBCodeHash(await rpc('eth_getCode',[targets.roles,'latest']) as string),quoteHash:artifactHash('quote-state-artifact',reference),
        simulationHash:artifactHash('simulation-bundle',simulation)},
      verifier:{id:MODE_C_VERIFIER,address:guard,templateHash:modeBCodeHash(guardBin),runtimeHash:modeBCodeHash(guardRuntime)}});
    const deployment=await receipt(await ownerTx(null,guardBin+modeCVerifierArguments(c)));
    expect(deployment.status).toBe('0x1');expect(deployment.contractAddress).toBe(guard);
    for(const tx of c.compiled.installation) {
      const h=await ownerTx(tx.to,tx.data),r=await receipt(h);
      if(r.status!=='0x1')throw new Error(tx.label+': '+JSON.stringify(await rpc('debug_traceTransaction',[h,{tracer:'callTracer'}])));
    }
    const keyFile=join(dir,'executor.json');await writeFile(keyFile,JSON.stringify({executor:toHex(executorKey)}),{mode:0o600});
    const storage=createFileExecutionStorage(join(dir,'journal'),'MODE_C_BUSY');
    service=createModeCLocalService({compiled:c,storage,rpcUrl:url,executorKeyFile:keyFile});
    expect(await service.driver.verifyInstalled()).toBe(true);expect(await service.driver.eligible()).toBe(false);
    snapshot=await rpc('evm_snapshot') as string;
  },60000);
  afterAll(async()=>{ownerKey.fill(0);executorKey.fill(0);anvil?.kill('SIGTERM');if(dir)await rm(dir,{recursive:true,force:true});});
  async function direct(data=c.policy.executorCalldata,to=c.policy.roles) {
    const nonce=BigInt(await rpc('eth_getTransactionCount',[executor,'pending']) as string);
    const signed=signModeBLocalTransaction({expectedExecutor:executor,to,data,nonce,gasLimit:1800000n,maxFeePerGas:10000000000n},executorKey);
    return receipt(await rpc('eth_sendRawTransaction',[signed.raw]) as string);
  }
  const alter=(data:string,at:number,n:number,v:string)=>data.slice(0,2+at*2)+v.padStart(n*2,'0')+data.slice(2+(at+n)*2);
  it('direct executor bypass cannot trade before the approved 5% condition',async()=>{
    expect((await direct()).status).toBe('0x0');expect(await service.driver.verifyInstalled()).toBe(true);
  });
  it('wrong pair/fee/unavailable/malformed/wrong pool fail at the independent verifier',async()=>{
    await setPool(S*97n/100n);
    for(const [a,b,fee,unavailable] of [[addr(7),MODE_C_USDC,500,0],[MODE_C_WETH,MODE_C_USDC,3000,0],[MODE_C_WETH,MODE_C_USDC,500,1]] as const) {
      await ownerTx(pool,selector('alter(address,address,uint24,bool)')+aw(a)+aw(b)+word(BigInt(fee))+word(BigInt(unavailable)));
      expect((await direct()).status).toBe('0x0');
    }
    await ownerTx(pool,selector('alter(address,address,uint24,bool)')+aw(MODE_C_WETH)+aw(MODE_C_USDC)+word(500n)+word(0n));
    await ownerTx(MODE_C_FACTORY,selector('init(address)')+aw(addr(7)));expect((await direct()).status).toBe('0x0');
    await ownerTx(MODE_C_FACTORY,selector('init(address)')+aw(pool));
  });
  it('malformed live slot0 and wrong local chain fail independently of worker decisions',async()=>{
    await ownerTx(pool,selector('malform(bool)')+word(1n));expect((await direct()).status).toBe('0x0');
    await expect(service.driver.observe()).rejects.toThrow('MODE_C_OBSERVATION_INVALID');
    await ownerTx(pool,selector('malform(bool)')+word(0n));
    try {
      await rpc('anvil_setChainId',[8453]);expect(await service.driver.eligible()).toBe(false);
      await expect(service.driver.observe()).rejects.toThrow('MODE_C_WRONG_CHAIN');
      await expect(direct()).rejects.toThrow();
    } finally {await rpc('anvil_setChainId',[31337]);}
  });
  it('a mismatched canonical reference block prevents owner verifier deployment',async()=>{
    const code='0x'+(await readFile(join(dir,'BuyDipCondition.bin'),'utf8')).trim();
    const args=modeCVerifierArguments(c);const bad=args.slice(0,6*64)+word(1n)+args.slice(7*64);
    expect((await receipt(await ownerTx(null,code+bad))).status).toBe('0x0');
  });
  it('the integer observation nearest 5% is eligible, the next higher value is not',async()=>{
    const target=S*S*95n/100n;let lo=0n,hi=S;
    while(lo<hi){const mid=(lo+hi+1n)/2n;if(mid*mid<=target)lo=mid;else hi=mid-1n;}
    await setPool(lo+1n);expect(await service.driver.eligible()).toBe(false);expect((await direct()).status).toBe('0x0');
    await setPool(lo);expect(await service.driver.eligible()).toBe(true);
  });
  it('a broadened installed target fails exact scope readback and worker dispatch',async()=>{
    const snap=await rpc('evm_snapshot');await setPool(S*97n/100n);
    const data=selector('allowTarget(bytes32,address,uint8)')+c.policy.roleKey.slice(2)+aw(c.policy.router)+word(0n);
    expect((await receipt(await ownerTx(c.policy.safe,encodeSafeOwnerCall(c.policy.safe,owner,c.policy.roles,data)))).status).toBe('0x1');
    expect(await service.driver.verifyInstalled()).toBe(false);
    expect((await service.worker.attempt()).decision.code).toBe('MODE_C_AUTHORITY_UNVERIFIABLE');
    await rpc('evm_revert',[snap]);
  });
  it('wrong token/recipient/router/function/amount/slippage cannot expand existing swap authority',async()=>{
    await setPool(S*97n/100n);const data=c.policy.executorCalldata;
    for(const modified of [alter(data,4,32,addr(7).slice(2)),alter(data,228,4,'04e45aaf'),alter(data,396,32,addr(7).slice(2)),
      alter(data,492,32,owner.slice(2)),alter(data,524,32,word(1000001n)),alter(data,556,32,word(99n))])
      expect((await direct(modified)).status).toBe('0x0');
  });
  it('confirmed revocation with valid unused authority stops a later trigger',async()=>{
    const snap=await rpc('evm_snapshot');await setPool(S*97n/100n);
    await service.worker.requestRevocation();const hashes=[];
    for(const tx of c.compiled.revocation){const h=await ownerTx(tx.to,tx.data);expect((await receipt(h)).status).toBe('0x1');hashes.push(h);}
    await service.worker.confirmRevocation(hashes);
    expect((await service.worker.attempt()).decision.code).toBe('MODE_C_REVOCATION_CONFIRMED');expect((await direct()).status).toBe('0x0');
    await rpc('evm_revert',[snap]);
    // New worker ledger only for the independent fixture below; never erase historical evidence.
    const keyFile=join(dir,'executor.json');service=createModeCLocalService({compiled:c,storage:createFileExecutionStorage(join(dir,'execute-journal'),'MODE_C_BUSY'),rpcUrl:url,executorKeyFile:keyFile});
  });
  it('expiry rejects direct execution without spending the unused allowance',async()=>{
    const snap=await rpc('evm_snapshot');await setPool(S*97n/100n);await rpc('evm_setNextBlockTimestamp',[c.policy.expiresAt]);await rpc('evm_mine');
    expect((await direct()).status).toBe('0x0');await rpc('evm_revert',[snap]);
  });
  it('same-block direct competing calls produce exactly one success and one revert',async()=>{
    const snap=await rpc('evm_snapshot');await setPool(S*97n/100n);await rpc('evm_setAutomine',[false]);
    const nonce=BigInt(await rpc('eth_getTransactionCount',[executor,'pending']) as string),hashes=[];
    for(const n of [nonce,nonce+1n]) {
      const signed=signModeBLocalTransaction({expectedExecutor:executor,to:c.policy.roles,data:c.policy.executorCalldata,nonce:n,gasLimit:1800000n,maxFeePerGas:10000000000n},executorKey);
      hashes.push(await rpc('eth_sendRawTransaction',[signed.raw]) as string);
    }
    await rpc('evm_mine');await rpc('evm_setAutomine',[true]);expect((await Promise.all(hashes.map(receipt))).map(r=>r.status).sort()).toEqual(['0x0','0x1']);await rpc('evm_revert',[snap]);
  });
  it('valid trigger executes the existing canonical USDC→WETH call, reconciles and cannot replay',async()=>{
    await setPool(S);const monitoring=service.watch();
    await new Promise(resolve=>setTimeout(resolve,100));await setPool(S*97n/100n);
    const monitored=await monitoring;expect(monitored.status).toBe('CONSUMED');
    const result=monitored.lastAttempt!;expect(result.decision.eligible).toBe(true);expect(result.reconciliation?.outcome).toBe('RECONCILED');
    expect(result.remaining.actions).toBe(0);expect(BigInt(await read(MODE_C_ROUTER,selector('swaps()')) as string)).toBe(1n);
    expect((await direct()).status).toBe('0x0');
    const first=await service.evidence();expect(first.bundle.environment).toBe('MOCKED');expect(first.bundle.outcome).toBe('RECONCILED');
    const second=await service.evidence({version:first.bundle.version,hash:first.evidenceBundleHash});
    expect(second.bundle.supersedes).toBe(first.evidenceBundleHash);expect(second.bundle.version).toBe(2);
    const path=process.env.GRYLOO_BUILD016_EVIDENCE;
    if(path)await writeFile(path,JSON.stringify({environment:'MOCKED',outcome:'RECONCILED',chainId:31337,compiled:c,
      result,simulationResponse,evidence:await service.evidence(),events:await service.worker.events(),limitations:['Synthetic pool, token and router; real pinned Safe/Roles and verifier. No public-chain transaction.']},null,2)+'\n');
    await rpc('evm_revert',[snapshot]);
  });
});
