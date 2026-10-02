// SPDX-License-Identifier: AGPL-3.0-only
/** Independent read-only acceptance verifier. No wallet, signing or submission method. */
import {readFile,writeFile} from 'node:fs/promises';
import {AAVE_V3_BASE_SEPOLIA as p,readBorrowState,simulateSupply,supplyHash,supplyArtifactHash} from '../packages/reference-compiler/dist/index.js';
import {createWithdrawNode,hashJournalBytes} from '../packages/workflow-contracts/dist/index.js';
import {reconcileWithdrawAttempt,verifyWithdrawEffects} from '../packages/reference-reconciler/dist/index.js';
const owner='0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b',amount='100000';
const allowed=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getTransactionByHash','eth_getTransactionReceipt','eth_call','eth_estimateGas','eth_getCode','eth_getBalance','eth_getTransactionCount','eth_gasPrice']);
const transcript=[];let queue=Promise.resolve();
function rpc(method,params){
  if(!allowed.has(method))throw Error('READ_ONLY_METHOD_REQUIRED');
  const job=queue.then(async()=>{
    for(let attempt=0;attempt<4;attempt++){
      await new Promise(resolve=>globalThis.setTimeout(resolve,attempt?1000*attempt:250));
      const response=await globalThis.fetch(p.rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:transcript.length+1,method,params}),signal:globalThis.AbortSignal.timeout(30000)});
      const body=await response.json();transcript.push({method,params,response:body});
      if(response.status===429||body.error?.code===-32005){if(attempt<3)continue;throw Error('PUBLIC_RPC_RATE_LIMITED');}
      if(!response.ok||body.error)throw Error('PUBLIC_RPC_READ_FAILED');return body.result;
    }
  });queue=job.catch(()=>undefined);return job;
}
const [mode,inputPath,outputPath]=process.argv.slice(2);
if(!['--prestate','--evidence'].includes(mode)||!inputPath||mode==='--evidence'&&!outputPath)throw Error('Usage: --prestate output.json | --evidence owner-exported-evidence.json verification.json');
const officialUrl='https://raw.githubusercontent.com/aave-dao/aave-address-book/main/src/AaveV3BaseSepolia.sol';
const response=await globalThis.fetch(officialUrl,{signal:globalThis.AbortSignal.timeout(30000)});if(!response.ok)throw Error('OFFICIAL_PROFILE_READ_FAILED');const official=await response.text();
for(const field of ['pool','provider','oracle','asset','aToken','variableDebtToken'])if(!official.toLowerCase().includes(p[field]))throw Error('OFFICIAL_PROFILE_MISMATCH');
let result;
if(mode==='--prestate'){
  const state=await readBorrowState(rpc,owner,owner);
  const prerequisites={collateralClearlyAboveAcceptance:BigInt(state.position)>BigInt(amount)*5n,comfortableHealthFactor:BigInt(state.borrow.healthFactor)>10n*10n**18n,existingPartialDebt:BigInt(state.borrow.debt)>0n,verifiedProfile:true};
  if(!Object.values(prerequisites).every(Boolean))result={status:'STOP_PREREQUISITES_FAILED',readOnly:true,prerequisites,state};
  else{
    const workflow={schemaVersion:'1.0.0',workflowId:'build-012d-readonly',revision:0,nodes:[createWithdrawNode('withdraw',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount,recipient:'CONNECTED_OWNER'})],resourceEdges:[]};
    const review=await simulateSupply(workflow,owner,rpc);
    if(BigInt(review.withdraw.expectedPostHealthFactor)<10n*10n**18n)throw Error('STOP_UNSAFE_ACCEPTANCE');
    result={status:'READ_ONLY_SIMULATION_VERIFIED',readOnly:true,ownerExecution:false,owner,amount,recipient:owner,prerequisites,review};
  }
}else{
  const evidence=JSON.parse(await readFile(inputPath,'utf8')),r=evidence.artifacts?.review,journal=evidence.artifacts?.journal,bundle=evidence.bundle,publicExecution=evidence.publicExecution;
  if(!r?.withdraw||r.repay||r.borrow||r.account!==owner||r.beneficiary!==owner||r.amount!==amount||r.chain!==p.chain||r.pool!==p.pool||r.asset!==p.asset||r.aToken!==p.aToken||r.approvalRequired||r.transactions.length!==1||bundle?.environment!=='TESTNET_EXECUTED'||bundle.outcome!=='RECONCILED'||publicExecution?.provenance!=='PUBLIC_TESTNET'||publicExecution.ownerInitiated!==true)throw Error('REAL_OWNER_DAPP_WITHDRAW_EVIDENCE_REQUIRED');
  const {commitment,...reviewContent}=r;if(supplyHash(reviewContent)!==commitment)throw Error('REVIEW_COMMITMENT_MISMATCH');
  if(supplyArtifactHash('evidence-bundle',bundle)!==evidence.bundleHash)throw Error('EVIDENCE_HASH_MISMATCH');
  for(const [field,kind,value] of [['semanticWorkflowHash','semantic-workflow',r.workflow],['artifactSetHash','artifact-set',r.artifactSet],['simulationHash','simulation-bundle',r.simulation],['policyHash','authorization-policy',r.policy],['manifestHash','strategy-manifest',r.manifest],['executionPlanHash','execution-plan',r.plan]])if(supplyArtifactHash(kind,value)!==bundle[field])throw Error('ARTIFACT_HASH_MISMATCH');
  if(hashJournalBytes(new globalThis.TextEncoder().encode(JSON.stringify(journal))).at(-1)!==bundle.journalHeadHash)throw Error('JOURNAL_HASH_MISMATCH');
  if(supplyHash(publicExecution)!==bundle.evidence.find(item=>item.evidenceId==='withdraw-public-observations')?.contentHash)throw Error('OBSERVATION_HASH_MISMATCH');
  const archived=publicExecution.observations?.at(-1);if(!archived?.withdrawEvent||publicExecution.observations.length!==1)throw Error('ONE_WITHDRAW_OBSERVATION_REQUIRED');
  const observed=await reconcileWithdrawAttempt(r,{step:'WITHDRAW',nonce:archived.walletEnvelope?.ownerNonceBefore??BigInt(archived.transaction.nonce).toString(),transaction:r.transactions[0],transactionHash:archived.receipt.transactionHash,preparedAtBlock:r.state.block},rpc);
  if(observed.verdict!=='RECONCILED')throw Error('INDEPENDENT_RECONCILIATION_FAILED: '+observed.reason);
  const stable=state=>Object.fromEntries(Object.entries(state).filter(([key])=>!['observedAt','gasPrice','nonce'].includes(key)));
  if(supplyHash(observed.ownerAuthorization??observed.walletEnvelope)!==supplyHash(archived.ownerAuthorization??archived.walletEnvelope)||supplyHash(observed.ownerAuthorization??observed.walletEnvelope)!==supplyHash(publicExecution.ownerAuthorization)||supplyHash(observed.withdrawEvent)!==supplyHash(archived.withdrawEvent)||observed.cost!==archived.cost||supplyHash(observed.receipt)!==supplyHash(archived.receipt)||supplyHash(stable(observed.prePosition))!==supplyHash(stable(archived.prePosition))||supplyHash(stable(observed.postPosition))!==supplyHash(stable(archived.postPosition)))throw Error('ARCHIVED_CANONICAL_STATE_MISMATCH');
  const call=observed.walletEnvelope?.delegation.call??{to:observed.transaction.to,value:observed.transaction.value,data:observed.transaction.input},word=value=>BigInt(value).toString(16).padStart(64,'0');
  const data='0x69328dec'+word(p.asset)+word(amount)+word(owner);
  if(call.to!==p.pool||BigInt(call.value)!==0n||call.data!==data)throw Error('INDEPENDENT_ABI_MISMATCH');
  const expectedReceipts=[{receiptId:'withdraw-receipt',contentHash:supplyHash(observed.receipt)}];
  if(supplyHash(bundle.receipts)!==supplyHash(expectedReceipts)||publicExecution.withdrawTransactionHash!==observed.receipt.transactionHash||publicExecution.transactionCost!==observed.cost||publicExecution.totalNetworkCost!==observed.cost||publicExecution.owner!==owner||publicExecution.recipient!==owner||publicExecution.amount!==amount||publicExecution.pool!==p.pool||publicExecution.asset!==p.asset||publicExecution.aToken!==p.aToken||publicExecution.chainId!==p.chainId||supplyHash(stable(publicExecution.prePosition))!==supplyHash(stable(observed.prePosition))||supplyHash(stable(publicExecution.postPosition))!==supplyHash(stable(observed.postPosition)))throw Error('PUBLIC_OBSERVATION_MISMATCH');
  const effects=verifyWithdrawEffects(amount,observed.prePosition,observed.postPosition);
  for(const [field,value] of Object.entries(effects))if(value!==publicExecution[field])throw Error('ARCHIVED_ECONOMIC_MISMATCH');
  // Independently reconstruct scaled principal; underlying credit remains exact.
  const ray=10n**27n,index=BigInt(observed.postPosition.index),burn=BigInt(observed.prePosition.scaledPosition)-BigInt(observed.postPosition.scaledPosition),n=BigInt(amount);
  const nearest=(n*ray+index/2n)/index,ceil=(n*ray+index-1n)/index;
  if(burn!==nearest&&burn!==ceil||BigInt(observed.postPosition.balance)-BigInt(observed.prePosition.balance)!==n||observed.prePosition.borrow.scaledDebt!==observed.postPosition.borrow.scaledDebt)throw Error('INDEPENDENT_COLLATERAL_OR_DEBT_MISMATCH');
  result={status:'TESTNET_EXECUTED',verdict:'INDEPENDENTLY_RECONCILED',owner,recipient:owner,amount,readOnly:true,evidenceBundleHash:evidence.bundleHash,independentAbi:{function:'withdraw(address,uint256,address)',asset:p.asset,amount,to:owner,data},independentCollateral:{executionIndex:index.toString(),scaledBurn:burn.toString(),nearestScaledBurn:nearest.toString(),ceilScaledBurn:ceil.toString()},observations:[observed],effects};
}
const protocolSources=[];
for(const url of ['https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/protocol/libraries/logic/SupplyLogic.sol','https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/protocol/libraries/helpers/TokenMath.sol','https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/protocol/tokenization/AToken.sol']){const response=await globalThis.fetch(url,{signal:globalThis.AbortSignal.timeout(30000)});if(!response.ok)throw Error('PROTOCOL_SOURCE_READ_FAILED');protocolSources.push({url,contentHash:supplyHash(await response.text())});}
result={...result,observedAt:new Date().toISOString(),officialSource:officialUrl,officialSourceHash:supplyHash(official),protocolSources,rpc:p.rpc,rpcTranscript:transcript};
await writeFile(mode==='--prestate'?inputPath:outputPath,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,readOnly:true,rpcReadCount:transcript.length,output:mode==='--prestate'?inputPath:outputPath}));
if(result.status==='STOP_PREREQUISITES_FAILED')process.exitCode=1;
