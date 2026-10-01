// SPDX-License-Identifier: AGPL-3.0-only
/** Independent acceptance verification. Read-only public RPC; no wallet/sign/send capability. */
import { readFile,writeFile } from 'node:fs/promises';
import { AAVE_V3_BASE_SEPOLIA as p,readBorrowState,simulateSupply,supplyHash,supplyArtifactHash } from '../packages/reference-compiler/dist/index.js';
import { createRepayNode,hashJournalBytes } from '../packages/workflow-contracts/dist/index.js';
import { reconcileRepayAttempt,verifyRepayEffects } from '../packages/reference-reconciler/dist/index.js';
const owner='0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b';
const allowed=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getTransactionByHash','eth_getTransactionReceipt','eth_call','eth_estimateGas','eth_getCode','eth_getBalance','eth_getTransactionCount','eth_gasPrice']);
const transcript=[];let queue=Promise.resolve();
function rpc(method,params){
  if(!allowed.has(method))throw Error('READ_ONLY_METHOD_REQUIRED');
  const action=queue.then(async()=>{
    for(let attempt=0;attempt<4;attempt++){
      await new Promise(resolve=>setTimeout(resolve,attempt?1000*attempt:150));
      const response=await fetch(p.rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:transcript.length+1,method,params}),signal:AbortSignal.timeout(30000)});
      const body=await response.json();transcript.push({method,params,response:body});
      if(response.status===429||body.error?.code===-32005){if(attempt<3)continue;throw Error('PUBLIC_RPC_RATE_LIMITED');}
      if(!response.ok||body.error)throw Error('PUBLIC_RPC_READ_FAILED');return body.result;
    }
  });queue=action.catch(()=>undefined);return action;
}
const [mode,inputPath,outputPath]=process.argv.slice(2);
if(!['--prestate','--evidence'].includes(mode)||!inputPath||mode==='--evidence'&&!outputPath)throw Error('Usage: node scripts/verify-aave-repay.mjs --prestate output.json | --evidence exported-evidence.json verification.json');
const officialUrl='https://raw.githubusercontent.com/aave-dao/aave-address-book/main/src/AaveV3BaseSepolia.sol';
const officialResponse=await fetch(officialUrl,{signal:AbortSignal.timeout(30000)});
if(!officialResponse.ok)throw Error('OFFICIAL_PROFILE_READ_FAILED');
const official=await officialResponse.text();
for(const field of ['pool','provider','oracle','asset','aToken','variableDebtToken'])if(!official.toLowerCase().includes(p[field]))throw Error('OFFICIAL_PROFILE_MISMATCH');
let result;
if(mode==='--prestate'){
  const state=await readBorrowState(rpc,owner,owner);
  const prerequisites={debtExists:BigInt(state.borrow.debt)>0n,debtAbove5000:BigInt(state.borrow.debt)>5000n,walletAtLeast5000:BigInt(state.balance)>=5000n,verifiedDeployment:true};
  if(!Object.values(prerequisites).every(Boolean)){
    result={status:'STOP_PREREQUISITES_FAILED',readOnly:true,prerequisites,state};
  }else{
    const workflow={schemaVersion:'1.0.0',workflowId:'build-012c-readonly',revision:0,nodes:[createRepayNode('repay',{chain:p.chain,asset:{chainId:p.chain,address:p.asset,decimals:6},amount:'5000',beneficiary:owner,interestRateMode:2})],resourceEdges:[]};
    const review=await simulateSupply(workflow,owner,rpc);
    result={status:'READ_ONLY_SIMULATION_VERIFIED',readOnly:true,ownerExecution:false,prerequisites,review};
  }
}else{
  const evidence=JSON.parse(await readFile(inputPath,'utf8')),r=evidence.artifacts?.review,journal=evidence.artifacts?.journal,bundle=evidence.bundle,publicExecution=evidence.publicExecution;
  if(!r?.repay||r.account!==owner||r.beneficiary!==owner||r.amount!=='5000'||r.chain!==p.chain||r.pool!==p.pool||r.asset!==p.asset||r.repay.interestRateMode!==2||bundle?.environment!=='TESTNET_EXECUTED'||bundle.outcome!=='RECONCILED'||publicExecution?.provenance!=='PUBLIC_TESTNET'||publicExecution.ownerInitiated!==true)throw Error('REAL_OWNER_DAPP_REPAY_EVIDENCE_REQUIRED');
  const {commitment,...reviewContent}=r;if(supplyHash(reviewContent)!==commitment)throw Error('REVIEW_COMMITMENT_MISMATCH');
  if(supplyArtifactHash('evidence-bundle',bundle)!==evidence.bundleHash)throw Error('EVIDENCE_HASH_MISMATCH');
  for(const [field,kind,value] of [['semanticWorkflowHash','semantic-workflow',r.workflow],['artifactSetHash','artifact-set',r.artifactSet],['simulationHash','simulation-bundle',r.simulation],['policyHash','authorization-policy',r.policy],['manifestHash','strategy-manifest',r.manifest],['executionPlanHash','execution-plan',r.plan]])if(supplyArtifactHash(kind,value)!==bundle[field])throw Error('ARTIFACT_HASH_MISMATCH');
  if(hashJournalBytes(new TextEncoder().encode(JSON.stringify(journal))).at(-1)!==bundle.journalHeadHash)throw Error('JOURNAL_HASH_MISMATCH');
  if(supplyHash(publicExecution)!==bundle.evidence.find(item=>item.evidenceId==='repay-public-observations')?.contentHash)throw Error('OBSERVATION_HASH_MISMATCH');
  const observations=[];
  const stablePosition=position=>{const {observedAt,gasPrice,nonce,...historical}=position;return historical;};
  for(const archived of [publicExecution.approvalObservation,...publicExecution.observations].filter(Boolean)){
    const approval=archived.reason==='EXACT_REPAY_APPROVAL_VERIFIED';
    if(!approval&&!archived.repayEvent)continue;
    if(observations.some(item=>item.receipt.transactionHash===archived.receipt.transactionHash))continue;
    const archivedReview=approval&&r.transactions.length===1?{...r,approvalRequired:true,allowance:'0'}:r;
    const transaction=approval?{from:owner,to:p.asset,value:'0x0',chainId:p.chainHex,data:publicExecution.approvalOwnerAuthorization?.delegation?.call?.data??archived.transaction.input}:r.transactions.at(-1);
    const observed=await reconcileRepayAttempt(archivedReview,{step:approval?'APPROVAL':'REPAY',nonce:approval&&archived.walletEnvelope?archived.walletEnvelope.ownerNonceBefore:archived.walletEnvelope?.ownerNonceBefore??BigInt(archived.transaction.nonce).toString(),transaction,transactionHash:archived.receipt.transactionHash,preparedAtBlock:approval?0:r.state.block},rpc);
    if(observed.verdict!=='RECONCILED')throw Error('INDEPENDENT_RECONCILIATION_FAILED: '+observed.reason);
    if(supplyHash(observed.receipt)!==supplyHash(archived.receipt))throw Error('CANONICAL_RECEIPT_MISMATCH');
    if(supplyHash(stablePosition(observed.prePosition))!==supplyHash(stablePosition(archived.prePosition))||supplyHash(stablePosition(observed.postPosition))!==supplyHash(stablePosition(archived.postPosition))||observed.cost!==archived.cost)throw Error('ARCHIVED_POSITION_OR_COST_MISMATCH');
    const call=observed.walletEnvelope?.delegation.call??{to:observed.transaction.to,value:observed.transaction.value,data:observed.transaction.input};
    const word=value=>BigInt(value).toString(16).padStart(64,'0');
    const canonicalData=approval?'0x095ea7b3'+word(p.pool)+word(5000):'0x573ade81'+word(p.asset)+word(5000)+word(2)+word(owner);
    if(call.to!==(approval?p.asset:p.pool)||BigInt(call.value)!==0n||call.data!==canonicalData)throw Error('INDEPENDENT_ABI_MISMATCH');
    observations.push(observed);
  }
  const repayment=observations.find(item=>item.repayEvent);if(!repayment)throw Error('REPAY_OBSERVATION_REQUIRED');
  const approval=observations.find(item=>item.reason==='EXACT_REPAY_APPROVAL_VERIFIED');
  if(r.approvalRequired&&!approval||Boolean(publicExecution.approvalTransactionHash)!==Boolean(approval))throw Error('APPROVAL_PROOF_REQUIRED');
  const expectedReceipts=[...approval?[{receiptId:'repay-approval-receipt',contentHash:supplyHash(approval.receipt)}]:[],{receiptId:'repay-receipt',contentHash:supplyHash(repayment.receipt)}];
  if(supplyHash(expectedReceipts)!==supplyHash(bundle.receipts))throw Error('RECEIPT_COMMITMENT_MISMATCH');
  if(publicExecution.repayTransactionHash!==repayment.receipt.transactionHash||publicExecution.approvalTransactionHash!==(approval?.receipt.transactionHash??null)||publicExecution.transactionCost!==repayment.cost||publicExecution.totalNetworkCost!==(BigInt(repayment.cost)+BigInt(approval?.cost??'0')).toString()||supplyHash(stablePosition(publicExecution.prePosition))!==supplyHash(stablePosition(repayment.prePosition))||supplyHash(stablePosition(publicExecution.postPosition))!==supplyHash(stablePosition(repayment.postPosition)))throw Error('PUBLIC_OBSERVATION_MISMATCH');
  const effects=verifyRepayEffects('5000',repayment.prePosition,repayment.postPosition);
  for(const field of ['walletDelta','debtDelta','normalizedRepayment'])if(effects[field]!==publicExecution[field])throw Error('ARCHIVED_ECONOMIC_MISMATCH');
  const ray=10n**27n,index=BigInt(repayment.postPosition.borrow.debtIndex),burn=BigInt(repayment.prePosition.borrow.scaledDebt)-BigInt(repayment.postPosition.borrow.scaledDebt);
  const floor=5000n*ray/index,nearest=(5000n*ray+index/2n)/index;
  if(burn!==floor&&burn!==nearest||BigInt(repayment.postPosition.balance)-BigInt(repayment.prePosition.balance)!==-5000n||BigInt(repayment.postPosition.borrow.debt)>=BigInt(repayment.prePosition.borrow.debt))throw Error('INDEPENDENT_DEBT_OR_WALLET_MISMATCH');
  const protocolSources=[];
  for(const url of ['https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/protocol/libraries/logic/BorrowLogic.sol','https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/protocol/libraries/helpers/TokenMath.sol','https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/protocol/tokenization/VariableDebtToken.sol']){const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('PROTOCOL_SOURCE_READ_FAILED');protocolSources.push({url,contentHash:supplyHash(await response.text())});}
  result={protocolSources,independentAbi:{function:'repay(address,uint256,uint256,address)',asset:p.asset,amount:'5000',interestRateMode:2,onBehalfOf:owner},independentDebt:{executionIndex:index.toString(),scaledBurn:burn.toString(),floorScaledBurn:floor.toString(),nearestScaledBurn:nearest.toString()},status:'TESTNET_EXECUTED',verdict:'INDEPENDENTLY_RECONCILED',owner,amount:'5000',rateMode:2,onBehalfOf:owner,readOnly:true,evidenceBundleHash:evidence.bundleHash,observations,effects};
}
result={...result,observedAt:new Date().toISOString(),officialSource:officialUrl,officialSourceHash:supplyHash(official),rpc:p.rpc,rpcTranscript:transcript};
await writeFile(mode==='--prestate'?inputPath:outputPath,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,readOnly:true,rpcReadCount:transcript.length,output:mode==='--prestate'?inputPath:outputPath}));
if(result.status==='STOP_PREREQUISITES_FAILED')process.exitCode=1;
