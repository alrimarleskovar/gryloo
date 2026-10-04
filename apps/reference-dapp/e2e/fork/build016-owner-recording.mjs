// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-016 preparation and one bounded recording attempt. `prepare` never accepts/reads transport files.
 * `record` is a separate, explicit command, requiring the sealed digest and both owner-selected paths. */
import { Buffer } from 'node:buffer';
import { spawn, execFileSync } from 'node:child_process';
import { openSync, closeSync, fsyncSync, writeFileSync, readFileSync, statSync, lstatSync, realpathSync, existsSync,
  mkdirSync, mkdtempSync, unlinkSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createReplayServer, canonical, verifyTranscriptDocument } from './replay-upstream.mjs';
import { RECORDING_POLICY, validateBilling, buildTranscript } from './recording-proxy.mjs';
import { toolInputs, SOLC_FLAGS, hash } from './build016-recording-config.mjs';
import { scenarioWorkflow, runBuild016Scenario } from './build016-fork-scenario.mjs';
import { probePort } from './harness.mjs';
const REPO=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const require=createRequire(new URL('../../../../packages/reference-executor/package.json',import.meta.url));
const {secp256k1}=await import(require.resolve('@noble/curves/secp256k1.js'));
const {keccak_256}=await import(require.resolve('@noble/hashes/sha3.js'));
const fail=code=>{throw new Error(code);};
const toHex=bytes=>'0x'+Buffer.from(bytes).toString('hex');
export const OWNER_BILLING_TEMPLATE=Object.freeze({format:'gryloo.build-003f-provider-billing.v1',provider:'Alchemy',
  plan:'<owner-observed plan; must be Free>',network:'Base Mainnet',
  reportedOn:'<recording UTC date YYYY-MM-DD>',usedMonthlyCu:'<owner-observed integer>',
  remainingMonthlyCu:'<owner-observed integer>',monthlyAllowanceCu:'<owner-observed integer; must be 30000000>',
  paymentMethod:'<owner-observed boolean; must be false>',paidAddOn:'<owner-observed boolean; must be false>',
  payAsYouGo:'<owner-observed boolean; must be false>',overage:'<owner-observed boolean; must be false>',
  autoUpgrade:'<owner-observed boolean; must be false>',credentialRotated:'<owner attestation after rotation; must be true>',
  previousCredentialDeleted:'<owner attestation after deletion; must be true>',rotatedOn:'<rotation UTC date YYYY-MM-DD>'});
export function validateOwnerBilling(value,currentDate=new Date().toISOString().slice(0,10)) {
  validateBilling(value);
  if(canonical(Object.keys(value).sort())!==canonical(Object.keys(OWNER_BILLING_TEMPLATE).sort()))fail('BUILD016_BILLING_FIELDS_INVALID');
  if(value.payAsYouGo!==false||value.reportedOn!==currentDate||value.rotatedOn!==currentDate||
    !Number.isSafeInteger(value.usedMonthlyCu)||value.usedMonthlyCu<0||value.monthlyAllowanceCu!==30000000||
    value.usedMonthlyCu+value.remainingMonthlyCu!==value.monthlyAllowanceCu)fail('BUILD016_CURRENT_BILLING_REQUIRED');
  return value;
}
function privateCreate(path,value) {
  const fd=openSync(path,'wx',0o600);
  try {writeFileSync(fd,value);fsyncSync(fd);}finally{closeSync(fd);}
  const dir=openSync(resolve(path,'..'),'r');try{fsyncSync(dir);}finally{closeSync(dir);}
}
function filePins() {
  const tracked=execFileSync('git',['ls-files','packages','apps/reference-dapp/src/server/mode-c-service.ts','apps/reference-dapp/e2e/fork',
    'pnpm-lock.yaml','pnpm-workspace.yaml','docs/specs/MASTER_SPEC_V3.2.md','prompts/DEFI_WORKFLOW_ENGINE_MASTER_PROMPT_ASTRA_v1.2_EN.md','docs/adr'],{cwd:REPO,encoding:'utf8'}).trim().split('\n');
  const build016=['apps/reference-dapp/e2e/fork/build016-recording-config.mjs','apps/reference-dapp/e2e/fork/build016-fork-scenario.mjs',
    'apps/reference-dapp/e2e/fork/build016-owner-recording.mjs','apps/reference-dapp/e2e/fork/build016-fork-evidence.mjs'];
  const pins=Object.fromEntries([...new Set([...tracked,...build016])].sort().map(path=>[path,hash(readFileSync(join(REPO,path)))]));
  function dist(dir) {for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())dist(path);
    else if(entry.name.endsWith('.js'))pins[path.slice(REPO.length+1)]=hash(readFileSync(path));}}
  for(const pkg of readdirSync(join(REPO,'packages')))if(existsSync(join(REPO,'packages',pkg,'dist')))dist(join(REPO,'packages',pkg,'dist'));
  return pins;
}
async function check(command,args,root,index) {
  const path=join(root,`check-${index}.log`),fd=openSync(path,'wx',0o600);
  const child=spawn(command,args,{cwd:REPO,env:{...process.env,TURBO_CACHE_DIR:join(root,'turbo')},stdio:['ignore',fd,fd]});
  const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});closeSync(fd);
  if(code!==0)fail('BUILD016_OFFLINE_CHECK_FAILED_'+index);
  return {command,args,exitCode:code,outputSha256:hash(readFileSync(path))};
}
export async function prepareBuild016() {
  const root=mkdtempSync('/tmp/gryloo-b016-recording-');
  process.stdout.write(JSON.stringify({status:'PREPARATION_STARTED',root,authenticatedRequests:0})+'\n');
  const inputs=toolInputs();
  if(execFileSync('pnpm',['--version'],{encoding:'utf8'}).trim()!=='11.22.0')fail('BUILD016_PNPM_PIN_MISMATCH');
  for(const port of [8546,20547])if(await probePort(port)!=='free')fail('BUILD016_PORT_OCCUPIED');
  const compiled=join(root,'compiled');mkdirSync(compiled,{mode:0o700});
  execFileSync(inputs.files.solc.path,[...SOLC_FLAGS,'--bin','--bin-runtime','--abi',join(REPO,'packages/reference-executor/contracts/BuyDipCondition.sol'),'-o',compiled],{stdio:'ignore'});
  const guard={creation:'0x'+readFileSync(join(compiled,'BuyDipCondition.bin'),'utf8').trim(),runtime:'0x'+readFileSync(join(compiled,'BuyDipCondition.bin-runtime'),'utf8').trim()};
  if(!/^0x(?:[0-9a-f]{2})+$/.test(guard.creation)||!/^0x(?:[0-9a-f]{2})+$/.test(guard.runtime))fail('BUILD016_VERIFIER_COMPILE_FAILED');
  const {validateArtifact}=await import('../../../../packages/workflow-contracts/dist/schemas.js');
  validateArtifact('semantic-workflow',scenarioWorkflow());
  // The actual service module must load before sealing. It performs no RPC until explicitly constructed/invoked.
  const {createServer}=await import('vite');const vite=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
  try {const module=await vite.ssrLoadModule('/apps/reference-dapp/src/server/mode-c-service.ts');if(typeof module.createModeCLocalService!=='function')fail('BUILD016_SERVICE_IMPORT_FAILED');}finally{await vite.close();}
  const checks=[];
  for(const [index,[command,args]] of [['pnpm',['check']],['python3',['-m','unittest','discover','-s','scripts','-p','test_governance_lite.py']],
    ['python3',['scripts/governance_lite.py']]].entries())checks.push(await check(command,args,root,index));
  const owner=secp256k1.utils.randomSecretKey(),executor=secp256k1.utils.randomSecretKey();
  const address=k=>toHex(keccak_256(secp256k1.getPublicKey(k,false).slice(1)).slice(-20));
  const accounts={owner:address(owner),executor:address(executor)};
  privateCreate(join(root,'local-keys.json'),JSON.stringify({owner:toHex(owner),executor:toHex(executor)})+'\n');owner.fill(0);executor.fill(0);
  privateCreate(join(root,'guard.json'),canonical(guard)+'\n');
  privateCreate(join(root,'owner-billing.template.json'),JSON.stringify(OWNER_BILLING_TEMPLATE,null,2)+'\n');
  const notBeforeMs=Date.now(),completedAt=new Date(notBeforeMs).toISOString();
  const manifest={format:'gryloo.build016.owner-recording-preflight.v1',status:'CREDENTIAL_FREE_READY',environment:'NOT_EVIDENCE',
    notBeforeMs,completedAt,preparedFromHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),inputs,filePins:filePins(),
    guard:{creationSha256:hash(guard.creation),runtimeSha256:hash(guard.runtime)},accounts,checks,
    source:{status:'UNRESOLVED_UNTIL_AUTHENTICATED_FINALIZED_READ',chainId:8453,number:null,hash:null},
    billing:{status:'OWNER_INPUT_REQUIRED',values:null},credential:{status:'OWNER_INPUT_REQUIRED_AFTER_PREFLIGHT',notBeforeMs},
    providerReservations:{requests:0,reservedCu:0,limits:RECORDING_POLICY,mechanism:'Existing RecordingSession.forward durably reserves each request before sending'},
    soleExternalBlockers:['current-owner-billing-attestation-file','fresh-owner-credential-file']};
  privateCreate(join(root,'preflight-manifest.json'),canonical(manifest)+'\n');
  const digest=hash(readFileSync(join(root,'preflight-manifest.json')));
  privateCreate(join(root,'preparation-journal.json'),canonical({format:'gryloo.build016.preparation-journal.v1',status:'WAITING_FOR_OWNER_TRANSPORT_FILES',
    completedAt,manifestSha256:digest,providerRequests:0,reservedCu:0,providerSessionStarted:false,attemptConsumed:false})+'\n');
  privateCreate(join(root,'reservations.jsonl'),canonical({kind:'LIMITS_PREPARED_NO_REQUEST_RESERVED',manifestSha256:digest,
    maximumRequests:1500,maximumReservedCu:39000,requests:0,reservedCu:0})+'\n');
  return {status:'CREDENTIAL_FREE_READY',root,completedAt,notBeforeMs,manifestSha256:digest,manifest};
}
export function validateTransportPaths(billingPath,credentialPath,notBeforeMs) {
  for(const path of [billingPath,credentialPath]){
    if(!isAbsolute(path)||path===REPO||path.startsWith(REPO+'/'))fail('BUILD016_OWNER_FILE_OUTSIDE_GIT_REQUIRED');
    const st=lstatSync(path),actual=realpathSync(path);
    if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o777)!==0o600||st.uid!==process.getuid()||actual===REPO||actual.startsWith(REPO+'/'))fail('BUILD016_OWNER_FILE_INVALID');
    // Reject files anywhere inside another checkout as well. Do not read file contents here.
    for(let dir=resolve(actual,'..');dir!==resolve(dir,'..');dir=resolve(dir,'..'))if(existsSync(join(dir,'.git')))fail('BUILD016_OWNER_FILE_OUTSIDE_GIT_REQUIRED');
  }
  if(realpathSync(billingPath)===realpathSync(credentialPath))fail('BUILD016_DISTINCT_OWNER_FILES_REQUIRED');
  if(statSync(credentialPath).mtimeMs<=notBeforeMs)fail('BUILD016_CREDENTIAL_NOT_FRESH');
}
function removeCredential(path) {
  const fd=openSync(path,'r+');try{writeFileSync(fd,Buffer.alloc(statSync(path).size));fsyncSync(fd);}finally{closeSync(fd);}unlinkSync(path);
}
async function waitPort(port,child) {
  for(let i=0;i<200;i++){if(child.exitCode!==null)fail('BUILD016_PROXY_EXITED');if(await probePort(port)==='listening')return;await delay(50);}fail('BUILD016_PROXY_NOT_READY');
}
async function stop(child,signal) {
  if(child.exitCode!==null)return child.exitCode;
  child.kill(signal);return new Promise(done=>child.once('exit',done));
}
export async function recordBuild016(root,digest,billingPath,credentialPath) {
  if(!root?.startsWith('/tmp/gryloo-b016-recording-')||!/^[0-9a-f]{64}$/.test(digest??''))fail('BUILD016_SEALED_PREFLIGHT_REQUIRED');
  if(realpathSync(root)!==root||!statSync(root).isDirectory()||(statSync(root).mode&0o777)!==0o700)fail('BUILD016_PREFLIGHT_ROOT_INVALID');
  const manifestBytes=readFileSync(join(root,'preflight-manifest.json'));if(hash(manifestBytes)!==digest)fail('BUILD016_PREFLIGHT_DIGEST_MISMATCH');
  const m=JSON.parse(manifestBytes);
  if(m.status!=='CREDENTIAL_FREE_READY'||canonical(m.inputs)!==canonical(toolInputs())||canonical(m.filePins)!==canonical(filePins()))fail('BUILD016_PREFLIGHT_INPUTS_CHANGED');
  if(existsSync(join(root,'attempt-claim.json')))fail('BUILD016_ATTEMPT_ALREADY_USED');
  validateTransportPaths(billingPath,credentialPath,m.notBeforeMs);
  validateOwnerBilling(JSON.parse(readFileSync(billingPath,'utf8')));
  for(const port of [8546,20547])if(await probePort(port)!=='free')fail('BUILD016_PORT_OCCUPIED');
  const keyData=JSON.parse(readFileSync(join(root,'local-keys.json'))),address=k=>toHex(keccak_256(secp256k1.getPublicKey(Buffer.from(k.slice(2),'hex'),false).slice(1)).slice(-20));
  if(address(keyData.owner)!==m.accounts.owner||address(keyData.executor)!==m.accounts.executor)fail('BUILD016_LOCAL_ACCOUNTS_CHANGED');
  const guard=JSON.parse(readFileSync(join(root,'guard.json')));
  if(hash(guard.creation)!==m.guard.creationSha256||hash(guard.runtime)!==m.guard.runtimeSha256)fail('BUILD016_GUARD_CHANGED');
  const session=join(root,'provider-session');mkdirSync(session,{mode:0o700});
  privateCreate(join(root,'attempt-claim.json'),canonical({manifestSha256:digest,startedAt:new Date().toISOString(),status:'ONE_ATTEMPT_CLAIMED'})+'\n');
  let proxy,result;
  try {
    proxy=spawn(process.execPath,[join(REPO,'apps/reference-dapp/e2e/fork/recording-proxy.mjs'),'serve',session,billingPath,credentialPath,String(m.notBeforeMs)],
      {cwd:REPO,env:{PATH:process.env.PATH},stdio:['ignore','ignore','ignore']});
    await waitPort(8546,proxy);
    const rpc=async(method,params)=>{const r=await globalThis.fetch('http://127.0.0.1:8546',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:globalThis.AbortSignal.timeout(35000)});const v=await r.json();if(v.error||!r.ok)fail('BUILD016_SOURCE_REQUEST_STOPPED');return v.result;};
    const block=await rpc('eth_getBlockByNumber',['finalized',false]);if(await rpc('eth_chainId',[])!=='0x2105')fail('BUILD016_SOURCE_CHAIN_MISMATCH');
    const source={chainId:8453,number:Number(BigInt(block.number)),hash:block.hash};
    const clockSeconds=Math.max(Number(BigInt(block.timestamp))+1,Math.floor(Date.now()/1000)+3600);
    const runtime=join(root,'record');mkdirSync(runtime,{mode:0o700});
    const scenario=await runBuild016Scenario({inputs:m.inputs,runtime,source,keys:join(root,'local-keys.json'),clockSeconds,guard,phase:'record'});
    privateCreate(join(session,'scenario-results.json'),canonical(scenario.result)+'\n');
    if(await stop(proxy,'SIGTERM')!==0)fail('BUILD016_RECORDING_COMPLETION_REFUSED');proxy=null;
    const journal=JSON.parse(readFileSync(join(session,'journal.json')));
    const identity={format:'gryloo.base-fork-state-transcript.v1',sourceChainId:8453,sourceBlockNumber:source.number,sourceBlockHash:source.hash,
      forkChainId:31337,localAccountsSource:'LOCAL_SETUP_NOT_BASE_OBSERVED',accounts:[]};
    const transcript=buildTranscript({logPath:join(session,'requests.jsonl'),journal,identity,identityHash:'0x'+hash(JSON.stringify(identity)),
      scenarioResultsSha256:hash(readFileSync(join(session,'scenario-results.json'))),codeFingerprints:{build016:{clockSeconds,accounts:m.accounts}}});
    verifyTranscriptDocument(transcript,{accounts:[]});privateCreate(join(root,'source-transcript.json'),JSON.stringify(transcript,null,2)+'\n');
    const server=createReplayServer(transcript);await new Promise((done,reject)=>{server.once('error',reject);server.listen(8546,'127.0.0.1',done);});
    let replay;
    try {const runtime=join(root,'replay');mkdirSync(runtime,{mode:0o700});replay=await runBuild016Scenario({inputs:m.inputs,runtime,source,
      keys:join(root,'local-keys.json'),clockSeconds,guard,phase:'replay'});}finally{await new Promise(done=>server.close(done));}
    if(canonical(scenario.result)!==canonical(replay.result))fail('BUILD016_CLOSED_REPLAY_DIFFERS');
    const {assembleBuild016ForkEvidence}=await import('./build016-fork-evidence.mjs');
    const evidence=assembleBuild016ForkEvidence(replay.compiled,replay.events,replay.recovered,{transcript,manifestSha256:digest,
      transcriptSha256:hash(readFileSync(join(root,'source-transcript.json'))),replayStatus:'REPLAY_BYTE_IDENTICAL'});
    privateCreate(join(root,'fork-evidence.json'),canonical(evidence)+'\n');
    result={status:'FORK_REPRODUCED_RECONCILED',manifestSha256:digest,evidenceBundleHash:evidence.evidenceBundleHash,
      transcriptSha256:hash(readFileSync(join(root,'source-transcript.json'))),financialTransactionHash:replay.result.financialTransactionHash};
  } catch {result={status:'STOPPED_NOT_CERTIFIED',manifestSha256:digest};if(proxy)await stop(proxy,'SIGUSR2');}
  finally{removeCredential(credentialPath);}
  privateCreate(join(root,'summary.json'),canonical(result)+'\n');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [mode,...args]=process.argv.slice(2);let result;
    if(mode==='prepare'&&args.length===0)result=await prepareBuild016();
    else if(mode==='record'&&args.length===4)result=await recordBuild016(...args);
    else fail('Usage: prepare | record <preparation-root> <manifest-SHA256> <owner-billing-path> <owner-credential-path>');
    const {manifest,...summary}=result;void manifest;process.stdout.write(JSON.stringify(summary)+'\n');
    if(result.status==='STOPPED_NOT_CERTIFIED')process.exitCode=1;
  }catch(error){const code=/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'CHECK_LOGS_IN_PREPARATION_ROOT';process.stderr.write('BUILD016_PREPARATION_OR_RECORDING_REFUSED:'+code+'\n');process.exitCode=1;}
}
