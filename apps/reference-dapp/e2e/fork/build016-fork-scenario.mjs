// SPDX-License-Identifier: AGPL-3.0-only
/** Real-protocol BUILD-016 recording/replay scenario. No synthetic source, token/pool code or storage setters. */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TextEncoder } from 'node:util';
import { MODE_C_FACTORY, MODE_C_ROUTER, MODE_C_SOURCE, MODE_C_USDC, MODE_C_VERIFIER, MODE_C_WETH,
  createExactInputSwapNode, serializeModeC, hashArtifactBytes } from '../../../../packages/workflow-contracts/dist/index.js';
import { collectModeCObservation, compileModeB, compileModeC, encodeSwap, modeBCodeHash, modeCVerifierArguments,
  rlpEncode, rlpInteger, fromHex, toHex } from '../../../../packages/reference-compiler/dist/index.js';
import { forkAnvilArgs } from '../../../../packages/reference-compiler/dist/profile.js';
import { createFileExecutionStorage, createModeCExecutor } from '../../../../packages/reference-executor/dist/index.js';
import { MODE_B_LOCAL_DEPLOYER, createAddress, relinkRoles, scopeFunctionPackCalls, writeOncePointer } from './mode-b-harness.mjs';
import { probePort } from './harness.mjs';
import { contractInputs, SCENARIO as s, hash } from './build016-recording-config.mjs';
const require = createRequire(new URL('../../../../packages/reference-executor/package.json', import.meta.url));
const {secp256k1} = await import(require.resolve('@noble/curves/secp256k1.js'));
const {keccak_256} = await import(require.resolve('@noble/hashes/sha3.js'));
const word = n => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
const selector = t => modeBCodeHash(toHex(new TextEncoder().encode(t))).slice(0, 10);
const artifactHash = (kind, value) => hashArtifactBytes(kind, new TextEncoder().encode(serializeModeC(value)));
const must = (condition, code) => {if (!condition) throw new Error(code);};
export function integerDipBoundary(sqrt) {
  const n = sqrt * sqrt * 95n / 100n;
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {const y = (x + n / x) >> 1n; if (y >= x) return x; x = y;}
}
export function scenarioWorkflow() {
  const node = createExactInputSwapNode('dip-swap', {chain:'eip155:31337', input:{chainId:'eip155:31337',address:MODE_C_USDC,decimals:6},
    output:{chainId:'eip155:31337',address:MODE_C_WETH,decimals:18},amount:s.inputAmount,maximumAmount:s.inputAmount,
    slippageBps:s.maximumSlippageBps,protocols:['uniswap-v3']});
  node.requiredAuthorizationClass='MODE_C';
  return {schemaVersion:'1.0.0',workflowId:'buy-the-dip',revision:1,nodes:[node],resourceEdges:[]};
}

/** Setup-only ABI price limit: canonical delegated encodeSwap/decodeSwap remain zero-limit and unchanged. */
export function encodeFixturePriceMove(amount,recipient,deadline,limit) {
  must(limit>=0n&&limit<(1n<<160n),'BUILD016_SETUP_PRICE_LIMIT_INVALID');
  const data=encodeSwap({tokenIn:MODE_C_WETH,tokenOut:MODE_C_USDC,fee:500,recipient,amountIn:BigInt(amount),
    amountOutMinimum:1n,sqrtPriceLimitX96:0n,deadline});
  must(data.length===420,'BUILD016_ROUTER_ABI_CHANGED');
  data.set(fromHex('0x'+word(limit)),360);
  return toHex(data);
}

export async function runBuild016Scenario({inputs, runtime, source, keys, clockSeconds, guard, phase}) {
  must(['record','replay'].includes(phase), 'BUILD016_PHASE_REQUIRED');
  must(source.chainId===8453 && Number.isSafeInteger(source.number) && /^0x[0-9a-f]{64}$/.test(source.hash), 'BUILD016_SOURCE_REQUIRED');
  const url='http://127.0.0.1:20547'; let id=0; const localTransactions=[];
  const forbidden=new Set(['anvil_setCode','anvil_setStorageAt','anvil_reset','anvil_setChainId']);
  const rpc=async(method,params=[])=>{
    must(!forbidden.has(method),'BUILD016_SOURCE_MUTATION_FORBIDDEN');
    const response=await globalThis.fetch(url,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:globalThis.AbortSignal.timeout(120000)});
    const body=await response.json();
    if(!response.ok||body.error||!Object.hasOwn(body,'result'))throw new Error('BUILD016_LOCAL_RPC_'+method);
    return body.result;
  };
  const args=[...forkAnvilArgs({port:20547,forkUrl:'http://127.0.0.1:8546',forkBlockNumber:source.number,timeoutMs:20000})];
  args[args.indexOf('--accounts')+1]='0';
  must(await probePort(20547)==='free','BUILD016_PORT_OCCUPIED');
  const anvil=spawn(inputs.files.anvil.path,args,{stdio:['ignore','ignore','ignore']});
  let vite, ownerKey, executorKey;
  try {
    for(let i=0;i<200;i++){try{if(await rpc('eth_chainId')==='0x7a69')break;}catch{await delay(50);}}
    must(await rpc('eth_chainId')==='0x7a69','BUILD016_LOCAL_CHAIN_REQUIRED');
    const meta=await rpc('anvil_metadata');must(meta.forkedNetwork?.forkBlockHash===source.hash,'BUILD016_FORK_HASH_REQUIRED');
    await rpc('anvil_setBlockTimestampInterval',[1]);
    const keyData=JSON.parse(await readFile(keys,'utf8')); ownerKey=fromHex(keyData.owner);executorKey=fromHex(keyData.executor);
    const keyAddress=k=>toHex(keccak_256(secp256k1.getPublicKey(k,false).slice(1)).slice(-20));
    const owner=keyAddress(ownerKey),executor=keyAddress(executorKey),deployer=MODE_B_LOCAL_DEPLOYER;
    const targets={safeSingleton:createAddress(deployer,0),safe:createAddress(deployer,1),singletonFactory:createAddress(deployer,2),
      integrity:createAddress(deployer,3),packer:createAddress(deployer,4),roles:createAddress(deployer,5)};
    const empty={nonce:0,balance:'0x0',code:'0x',storage:{}};
    const protocol=new Set([MODE_C_USDC,MODE_C_WETH,MODE_C_FACTORY,MODE_C_ROUTER,s.pool]);
    const declare=async(accounts)=>{
      must(Object.keys(accounts).every(a=>!protocol.has(a)),'BUILD016_PROTOCOL_ACCOUNT_DECLARATION_FORBIDDEN');
      return rpc('anvil_loadState',[toHex(new TextEncoder().encode(JSON.stringify({block:null,accounts,best_block_number:null,blocks:[],transactions:[]})))]);
    };
    await declare(Object.fromEntries([deployer,owner,executor,...Object.values(targets)].map(a=>[a,{...empty,balance:[deployer,owner,executor].includes(a)?'0x'+BigInt(s.localNativeFundingWei).toString(16):'0x0'}])));
    await rpc('evm_setNextBlockTimestamp',[clockSeconds]);await rpc('evm_mine');
    const receipt=async h=>{for(let i=0;i<100;i++){const r=await rpc('eth_getTransactionReceipt',[h]);if(r)return r;await delay(50);}throw new Error('BUILD016_RECEIPT_MISSING');};
    const send=async(to,data,value='0x0')=>{
      must(await rpc('eth_chainId')==='0x7a69','BUILD016_LOCAL_CHAIN_REQUIRED');
      const h=await rpc('eth_sendTransaction',[{from:deployer,...to?{to}:{},data,value,gas:'0xb71b00'}]);
      const r=await receipt(h);must(r.status==='0x1','BUILD016_SETUP_REVERTED');localTransactions.push({kind:'LOCAL_SETUP',hash:h,to,data,receipt:r});return r;
    };
    const signed=async(key,to,data,wait=true)=>{
      const who=keyAddress(key),nonce=BigInt(await rpc('eth_getTransactionCount',[who,'pending']));
      const b=await rpc('eth_getBlockByNumber',['latest',false]);
      const fields=[rlpInteger(31337n),rlpInteger(nonce),rlpInteger(1000000n),rlpInteger(BigInt(b.baseFeePerGas)*2n+1000000n),
        rlpInteger(12000000n),to?fromHex(to):new Uint8Array(),rlpInteger(0n),fromHex(data),[]];
      const signature=secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(Uint8Array.of(2,...rlpEncode(fields))),key,{prehash:false,format:'recovered'}),'recovered');
      const raw=toHex(Uint8Array.of(2,...rlpEncode([...fields,rlpInteger(BigInt(signature.recovery)),rlpInteger(signature.r),rlpInteger(signature.s)])));
      must(await rpc('eth_chainId')==='0x7a69','BUILD016_LOCAL_CHAIN_REQUIRED');
      const h=await rpc('eth_sendRawTransaction',[raw]);must(h===modeBCodeHash(raw),'BUILD016_SIGNED_HASH_CHANGED');
      const r=wait?await receipt(h):{transactionHash:h};localTransactions.push({kind:'LOCAL_SIGNED',signer:who,hash:h,raw,to,data,receipt:wait?r:null});return r;
    };
    await rpc('anvil_impersonateAccount',[deployer]);
    const code=contractInputs(inputs);
    for(const [i,data] of [code.safeL2,code.safeProxy+word(targets.safeSingleton),code.singletonFactory,code.integrity,code.packer,
      relinkRoles(code.roles,targets)+word(owner)+word(targets.safe)+word(targets.safe)].entries())
      must((await send(null,data)).contractAddress.toLowerCase()===Object.values(targets)[i],'BUILD016_DEPLOYMENT_ADDRESS_CHANGED');
    await send(targets.safe,'0xb63e800d'+word(256)+word(1)+word(0)+word(320)+word(0)+word(0)+word(0)+word(0)+word(1)+word(owner)+word(0));
    const read=(to,data)=>rpc('eth_call',[{to,data},'latest']);
    const balance=async(token,address)=>BigInt(await read(token,selector('balanceOf(address)')+word(address)));
    must('0x'+(await read(MODE_C_FACTORY,'0x1698ee82'+word(MODE_C_WETH)+word(MODE_C_USDC)+word(500))).slice(-40)===s.pool,'BUILD016_POOL_CHANGED');
    const poolCode=await rpc('eth_getCode',[s.pool,'latest']);
    const sourcePolicy={id:MODE_C_SOURCE,pool:s.pool,poolCodeHash:modeBCodeHash(poolCode),factory:MODE_C_FACTORY,fee:500,maximumAgeSeconds:s.maximumAgeSeconds};
    // Genuine token funding: only local ETH is declared; WETH deposit, swap and USDC transfer use real contracts.
    await send(MODE_C_WETH,'0xd0e30db0','0x'+BigInt(s.wrappedFundingWei).toString(16));
    await send(MODE_C_WETH,'0x095ea7b3'+word(MODE_C_ROUTER)+word(s.wrappedFundingWei));
    const trade=async(amount,limit)=>{
      const head=await rpc('eth_getBlockByNumber',['latest',false]);
      return send(MODE_C_ROUTER,encodeFixturePriceMove(amount,deployer,BigInt(head.timestamp)+1800n,limit));
    };
    await trade(s.fundingSwapInputWei,0n);
    must(await balance(MODE_C_USDC,deployer)>=BigInt(s.inputAmount),'BUILD016_REAL_FUNDING_INSUFFICIENT');
    await send(MODE_C_USDC,'0xa9059cbb'+word(targets.safe)+word(s.inputAmount));
    must(await balance(MODE_C_USDC,targets.safe)===BigInt(s.inputAmount),'BUILD016_SAFE_FUNDING_NOT_EXACT');
    const workflow=scenarioWorkflow(),wh=artifactHash('semantic-workflow',workflow);
    const head=await rpc('eth_getBlockByNumber',['latest',false]),now=Number(BigInt(head.timestamp));
    const reference=await collectModeCObservation(rpc,{source:sourcePolicy,semanticWorkflowHash:wh},'dip-swap',now);
    const refHash=artifactHash('quote-state-artifact',reference.artifact),set={schemaVersion:'1.0.0',artifactSetId:'dip-artifacts',semanticWorkflowHash:wh,
      artifacts:[{artifactId:reference.artifact.artifactId,nodeId:'dip-swap',artifactHash:refHash}]};
    const profile={chainId:31337,...targets,owner,executor,safeCodeHash:modeBCodeHash(await rpc('eth_getCode',[targets.safe,'latest'])),
      rolesCodeHash:modeBCodeHash(await rpc('eth_getCode',[targets.roles,'latest'])),semanticWorkflowHash:wh,quoteHash:refHash,simulationHash:refHash,sourceBlockHash:source.hash};
    const salt=modeBCodeHash(toHex(new TextEncoder().encode('gryloo/BUILD-016/real-fork-certification/v1')));
    const declareScopes=async installation=>{
      for(const data of scopeFunctionPackCalls(installation.map(t=>t.data))) {
        const packed=await read(targets.packer,data),length=Number(BigInt('0x'+packed.slice(66,130)));
        const pointer=writeOncePointer(targets.singletonFactory,'0x'+packed.slice(130,130+length*2));
        await declare({[pointer]:empty});
      }
    };
    const probe=compileModeB(profile,{tokenIn:MODE_C_USDC,tokenOut:MODE_C_WETH,fee:500,recipient:targets.safe,
      amountIn:BigInt(s.inputAmount),amountOutMinimum:1n,sqrtPriceLimitX96:0n,deadline:BigInt(now+s.durationSeconds-1)},salt);
    await declareScopes(probe.installation);
    const ownerNonce=BigInt(await rpc('eth_getTransactionCount',[owner,'pending'])),executorNonce=BigInt(await rpc('eth_getTransactionCount',[executor,'pending']));
    const calls=probe.installation.map((t,i)=>({from:owner,to:t.to,data:t.data,nonce:'0x'+(ownerNonce+BigInt(i)).toString(16),
      gas:'0xb71b00',maxFeePerGas:'0x2540be400',maxPriorityFeePerGas:'0xf4240',value:'0x0'}));
    calls.push({...calls[0],from:executor,to:probe.executorCall.to,data:probe.executorCall.data,nonce:'0x'+executorNonce.toString(16)});
    for(const [i,token] of [MODE_C_USDC,MODE_C_WETH].entries())calls.push({...calls[0],to:token,data:selector('balanceOf(address)')+word(targets.safe),
      nonce:'0x'+(ownerNonce+BigInt(probe.installation.length+i)).toString(16)});
    const simulationResponse=await rpc('eth_simulateV1',[{blockStateCalls:[{calls}],validation:true,traceTransfers:false,returnFullTransactions:false},'latest']);
    must(simulationResponse[0].calls.every(c=>c.status==='0x1'),'BUILD016_REAL_SIMULATION_FAILED');
    must(BigInt(simulationResponse[0].calls.at(-2).returnData)===0n,'BUILD016_SIMULATION_DEBIT_CHANGED');
    const expected=BigInt(simulationResponse[0].calls.at(-1).returnData),minimum=expected*99n/100n;must(minimum>0n,'BUILD016_SIMULATION_OUTPUT_INVALID');
    const quantity=n=>({asset:{chainId:'eip155:31337',address:MODE_C_WETH,decimals:18},amount:n.toString()});
    const simulation={schemaVersion:'1.0.0',simulationId:'dip-simulation',semanticWorkflowRevision:1,semanticWorkflowHash:wh,artifactSetHash:artifactHash('artifact-set',set),
      adapters:[],contracts:[],outputs:[{nodeId:'dip-swap',outputId:'weth-output',expected:quantity(expected),minimum:quantity(minimum),adverse:quantity(minimum)}],
      propagatedOutputs:[],failurePaths:[],uncertainty:[{code:'SIMULATION_RESPONSE_HASH',description:hash(serializeModeC(simulationResponse))}],
      unsupportedAssumptions:['Local fork only; future trigger is independently enforced. No public-chain execution.'],freshness:reference.artifact.freshness};
    const guardAddress=createAddress(owner,Number(ownerNonce));await declare({[guardAddress]:empty});
    const c=compileModeC({workflow,reference:reference.artifact,artifactSet:set,simulation,profile:{...profile,simulationHash:artifactHash('simulation-bundle',simulation)},salt,
      source:sourcePolicy,verifier:{id:MODE_C_VERIFIER,address:guardAddress,templateHash:modeBCodeHash(guard.creation),runtimeHash:modeBCodeHash(guard.runtime)},
      startsAt:now,expiresAt:now+s.durationSeconds,maximumSlippageBps:s.maximumSlippageBps,minimumOut:minimum.toString(),totalBudget:s.totalBudget,
      perPeriodBudget:s.perPeriodBudget,periodSeconds:s.periodSeconds,frequencySeconds:s.frequencySeconds,cooldownSeconds:s.cooldownSeconds});
    must((await signed(ownerKey,null,guard.creation+modeCVerifierArguments(c))).status==='0x1','BUILD016_VERIFIER_DEPLOYMENT_FAILED');
    await declareScopes(c.compiled.installation);
    for(const t of c.compiled.installation)must((await signed(ownerKey,t.to,t.data)).status==='0x1','BUILD016_INSTALLATION_FAILED');
    const {createServer}=await import('vite');vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
    const {createModeCLocalService}=await vite.ssrLoadModule('/apps/reference-dapp/src/server/mode-c-service.ts');
    const keyFile=join(runtime,'executor.json');await writeFile(keyFile,JSON.stringify({executor:keyData.executor}),{mode:0o600,flag:'wx'});
    const serviceAt=(dir,storage=createFileExecutionStorage(join(runtime,dir),'MODE_C_BUSY'))=>createModeCLocalService({compiled:c,storage,rpcUrl:url,executorKeyFile:keyFile});
    let service=serviceAt('below-journal');const checks=[];
    must(await service.driver.verifyInstalled(),'BUILD016_INSTALLED_SCOPE_INVALID');
    must(!await service.driver.eligible(),'BUILD016_EARLY_TRIGGER');
    const below=await service.worker.attempt();must(!below.decision.eligible,'BUILD016_EARLY_ACTION');checks.push('trigger-below-5');
    const refSqrt=BigInt(reference.artifact.normalizedValues.find(v=>v.name==='sqrt-price-x96').value),target=integerDipBoundary(refSqrt);
    const dip=await trade(s.dipMaximumInputWei,target);
    const after=await read(s.pool,'0x3850c7bd');must(BigInt('0x'+after.slice(2,66))===target,'BUILD016_REAL_PRICE_TRANSITION_INSUFFICIENT');
    service=serviceAt('eligibility-journal');must(await service.driver.eligible(),'BUILD016_BOUNDARY_INELIGIBLE');checks.push('real-trade-at-integer-5-boundary');
    // A second real trade leaves a >5% margin after the authorized USDC buy; no price storage setter is used.
    await trade(s.dipMaximumInputWei, integerDipBoundary(refSqrt * 9999n / 10000n));
    const alter=(data,at,n,v)=>data.slice(0,2+at*2)+v.padStart(n*2,'0')+data.slice(2+(at+n)*2);
    for(const data of [alter(c.policy.executorCalldata,4,32,word(owner)),alter(c.policy.executorCalldata,228,4,'04e45aaf'),
      alter(c.policy.executorCalldata,396,32,word(owner)),alter(c.policy.executorCalldata,492,32,word(owner)),
      alter(c.policy.executorCalldata,524,32,word(1000001)),alter(c.policy.executorCalldata,556,32,word(1))])
      must((await signed(executorKey,c.policy.roles,data)).status==='0x0','BUILD016_AUTHORITY_EXPANSION_SUCCEEDED');
    checks.push('authority-expansion');
    const observed=await service.driver.observe(), staleSnap=await rpc('evm_snapshot');
    await rpc('evm_setNextBlockTimestamp',[Number(BigInt((await rpc('eth_getBlockByNumber',['latest',false])).timestamp))+30]);await rpc('evm_mine');
    const staleWorker=createModeCExecutor({compiled:c,storage:createFileExecutionStorage(join(runtime,'stale-journal'),'MODE_C_BUSY'),
      driver:{...service.driver,observe:async()=>observed}});
    must((await staleWorker.attempt()).decision.code==='MODE_C_STALE_OBSERVATION','BUILD016_STALE_ACTION');checks.push('stale-observation');
    must(await rpc('evm_revert',[staleSnap]),'BUILD016_SNAPSHOT_RESTORE_FAILED');
    const invalidWorker=createModeCExecutor({compiled:c,storage:createFileExecutionStorage(join(runtime,'invalid-source-journal'),'MODE_C_BUSY'),
      driver:{...service.driver,observe:async()=>({...observed,artifact:{...observed.artifact,sourceId:'REJECTED_INVALID_TEST_INPUT'}})}});
    must(!(await invalidWorker.attempt()).decision.eligible,'BUILD016_WRONG_SOURCE_ACTION');checks.push('wrong-source');
    const directSnap=await rpc('evm_snapshot');
    await rpc('evm_setAutomine',[false]);
    const queuedOne=await signed(executorKey,c.policy.roles,c.policy.executorCalldata,false),queuedTwo=await signed(executorKey,c.policy.roles,c.policy.executorCalldata,false);
    await rpc('evm_mine');await rpc('evm_setAutomine',[true]);
    const directOne=await receipt(queuedOne.transactionHash),directTwo=await receipt(queuedTwo.transactionHash);
    for(const r of [directOne,directTwo])localTransactions.find(t=>t.hash===r.transactionHash).receipt=r;
    must(directOne.status==='0x1'&&directTwo.status==='0x0'&&directOne.blockHash===directTwo.blockHash,'BUILD016_DIRECT_ONE_USE_FAILED');checks.push('direct-concurrent-one-effect');
    must(await rpc('evm_revert',[directSnap]),'BUILD016_SNAPSHOT_RESTORE_FAILED');
    const snap=await rpc('evm_snapshot');
    service=serviceAt('revoked-journal');await service.worker.requestRevocation();const revocations=[];
    for(const t of c.compiled.revocation){const r=await signed(ownerKey,t.to,t.data);must(r.status==='0x1','BUILD016_REVOCATION_FAILED');revocations.push(r.transactionHash);}
    await service.worker.confirmRevocation(revocations);must((await service.worker.attempt()).decision.code==='MODE_C_REVOCATION_CONFIRMED','BUILD016_REVOKED_ACTION');
    must((await signed(executorKey,c.policy.roles,c.policy.executorCalldata)).status==='0x0','BUILD016_DIRECT_REVOKED_ACTION');
    checks.push('confirmed-unused-revocation');must(await rpc('evm_revert',[snap]),'BUILD016_SNAPSHOT_RESTORE_FAILED');
    const expirySnap=await rpc('evm_snapshot');await rpc('evm_setNextBlockTimestamp',[c.policy.expiresAt]);await rpc('evm_mine');
    service=serviceAt('expired-journal');must((await service.worker.attempt()).decision.code==='MODE_C_EXPIRED','BUILD016_EXPIRED_ACTION');must((await signed(executorKey,c.policy.roles,c.policy.executorCalldata)).status==='0x0','BUILD016_DIRECT_EXPIRED_ACTION');checks.push('expiry');
    must(await rpc('evm_revert',[expirySnap]),'BUILD016_SNAPSHOT_RESTORE_FAILED');
    // Isolated failpoints preserve their own durable ledgers; they are never reused as fresh financial authority.
    const crashSnap=await rpc('evm_snapshot');
    const beforeCrash=createModeCExecutor({compiled:c,storage:createFileExecutionStorage(join(runtime,'crash-before-journal'),'MODE_C_BUSY'),
      driver:{...service.driver,now:async()=>{throw new Error('LOCAL_CRASH_BEFORE_RESERVATION');}}});
    try {await beforeCrash.attempt();} catch { /* expected failpoint, inspected below */ }
    must((await beforeCrash.events()).filter(e=>e.kind==='RESERVED').length===0,'BUILD016_CRASH_BEFORE_RESERVED');
    const crashStorage=createFileExecutionStorage(join(runtime,'crash-after-journal'),'MODE_C_BUSY');
    const afterCrash=createModeCExecutor({compiled:c,storage:crashStorage,driver:{...service.driver,prepareExact:async()=>{throw new Error('LOCAL_CRASH_AFTER_RESERVATION');}}});
    await afterCrash.attempt();
    const afterRestart=createModeCExecutor({compiled:c,storage:crashStorage,driver:service.driver});
    must((await afterRestart.status()).actions===0 && (await afterRestart.events()).filter(e=>e.kind==='SUBMITTING').length===0,'BUILD016_CRASH_AFTER_RESTORED_AUTHORITY');
    await afterRestart.attempt();must((await afterRestart.events()).filter(e=>e.kind==='SUBMITTING').length===0,'BUILD016_CRASH_AFTER_RESUBMITTED');
    checks.push('crash-before-reservation','crash-after-reservation');must(await rpc('evm_revert',[crashSnap]),'BUILD016_SNAPSHOT_RESTORE_FAILED');
    const storage=createFileExecutionStorage(join(runtime,'positive-journal'),'MODE_C_BUSY');service=serviceAt('positive-journal',storage);
    let sends=0, hideReceipt=true;
    const driver={...service.driver,submitExact:async tx=>{sends++;await service.driver.submitExact(tx);throw new Error('LOCAL_RESPONSE_WITHHELD_AFTER_ACTUAL_BROADCAST');},
      reconcile:async tx=>hideReceipt?{outcome:'INCONCLUSIVE',transactionHash:tx.hash,details:{code:'LOCAL_RECEIPT_WITHHELD'}}:service.driver.reconcile(tx)};
    const worker=createModeCExecutor({compiled:c,storage,driver}),competitor=createModeCExecutor({compiled:c,storage,driver});
    const race=await Promise.allSettled([worker.attempt(),competitor.attempt()]);
    must((await worker.events()).filter(e=>e.kind==='RESERVED').length===1 && sends===1,'BUILD016_DUPLICATE_RESERVATION_OR_SEND');
    hideReceipt=false;const restarted=serviceAt('positive-journal');const recovered=await restarted.worker.recover();
    must(recovered?.outcome==='RECONCILED','BUILD016_RECOVERY_NOT_RECONCILED');
    must((await restarted.worker.status()).actions===0,'BUILD016_RESTART_AUTHORITY_RESET');
    await restarted.worker.attempt();must(sends===1,'BUILD016_BLIND_RESUBMIT');
    const events=await restarted.worker.events(),tx=events.find(e=>e.kind==='SUBMITTING').details;
    const chain=recovered.details.chainEvidence;must(chain.inputDebited===s.inputAmount && BigInt(chain.outputCredited)>=minimum,'BUILD016_FINANCIAL_EFFECT_CHANGED');
    must(events.filter(e=>e.kind==='SUBMITTING').length===1,'BUILD016_DUPLICATE_PREPARATION');
    const reservedAt=events.find(e=>e.kind==='RESERVED').details.at;
    await rpc('evm_setNextBlockTimestamp',[reservedAt+3]);await rpc('evm_mine');
    must((await restarted.worker.attempt()).decision.code==='MODE_C_COOLDOWN','BUILD016_COOLDOWN_FAILED');
    await rpc('evm_setNextBlockTimestamp',[reservedAt+10]);await rpc('evm_mine');
    must((await restarted.worker.attempt()).decision.code==='MODE_C_FREQUENCY','BUILD016_FREQUENCY_FAILED');
    await rpc('evm_setNextBlockTimestamp',[reservedAt+21]);await rpc('evm_mine');
    must((await restarted.worker.attempt()).decision.code==='MODE_C_TOTAL_BUDGET','BUILD016_TOTAL_BUDGET_FAILED');
    checks.push('atomic-worker-race','restart','uncertain-result-read-only-recovery','duplicate-trigger','budget-exhausted','cooldown-frequency');
    const publicProof={format:'gryloo.build-003f-scenario-results.v1',build:'BUILD-016',environment:'NOT_EVIDENCE',
      status:'LOCAL_RECONCILIATION_PENDING_CLOSED_REPLAY',sourceBlockNumber:source.number,sourceBlockHash:source.hash,
      sourcePool:s.pool,clockSeconds,policyHash:c.policyHash,manifestHash:c.manifestHash,permissionHash:c.compiled.permissionHash,
      financialTransactionHash:tx.hash,inputDebited:chain.inputDebited,outputCredited:chain.outputCredited,checks};
    await writeFile(join(runtime,'financial-proof.json'),serializeModeC({compiled:c,events:await restarted.worker.events(),recovered,referenceRaw:reference.raw,simulationResponse,
      localTransactions,dipTransactionHash:dip.transactionHash,race,source,clockSeconds})+'\n',{flag:'wx',mode:0o600});
    return {result:publicProof,runtime,compiled:c,events,recovered};
  } finally {ownerKey?.fill(0);executorKey?.fill(0);if(vite)await vite.close();anvil.kill('SIGTERM');await new Promise(done=>{if(anvil.exitCode!==null)done();else anvil.once('exit',done);});}
}
