// SPDX-License-Identifier: AGPL-3.0-only
/** Independent canonical chain, owner-authority, and composed economic observations. */
import { AAVE_V3_BASE_SEPOLIA as p, LENDING_BASE_SEPOLIA as u } from '@defi-workflow-engine/action-registry';
import { readLendingSnapshot, assertLendingReview, compileLendingCalls, lendingRootChain, rpcRecord, rpcUint, rpcHash, supplyHex, supplyHash, supplyArtifactHash, supplyTopic, supplyWord,
  type SupplyRpc, type LendingSnapshot, type LendingReview, type LendingCall, type LendingStepId } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type ExecutionJournal, type EvidenceBundle } from '@defi-workflow-engine/workflow-contracts';
import { verifySupplyPosition, verifySupplyWalletEnvelope, addressTopic, logMatches, type SupplyWalletProof } from './supply.js';
import { verifyBorrowEffects } from './borrow.js';
import { verifyRepayOwnerSignature, type RepayOwnerProof } from './repay.js';
export type LendingChainAttempt={id:string;call:LendingCall;nonce:string;hash:string|null;preparedAtBlock:number;reviewCommitment:string};
export type LendingObservation={attemptId:string;reviewCommitment:string;step:LendingCall['id'];verdict:'RECONCILED'|'INCONCLUSIVE'|'DIVERGENT';reason:string;
  transaction:Record<string,unknown>|null;receipt:Record<string,unknown>|null;pre:LendingSnapshot|null;post:LendingSnapshot|null;
  cost:string|null;output:string|null;ownerProof:RepayOwnerProof|SupplyWalletProof|null;ownerNonceAfter:string|null};
const transfer=supplyTopic('Transfer(address,address,uint256)'), swapTopic=supplyTopic('Swap(address,address,int256,int256,uint160,uint128,int24)');
const delta=(a:string,b:string)=>BigInt(b)-BigInt(a);
function transferAmount(logs:unknown[],token:string,from:string,to:string):bigint {
  return logs.filter(l=>{const r=rpcRecord(l);return r.address===token&&Array.isArray(r.topics)&&r.topics.length===3&&r.topics[0]===transfer&&r.topics[1]===addressTopic(from)&&r.topics[2]===addressTopic(to);})
    .reduce<bigint>((sum,l)=>sum+rpcUint(rpcRecord(l).data),0n);
}
export function verifyLendingStepEffects(review:LendingReview,call:LendingCall,pre:LendingSnapshot,post:LendingSnapshot,logs:unknown[]):string|null {
  const f=review.fields, amount=call.id==='SUPPLY'||call.id==='POOL_APPROVAL'?BigInt(f.supplyAmount):BigInt(f.borrowAmount);
  const balance=delta(pre.aave.balance,post.aave.balance), weth=delta(pre.wethBalance,post.wethBalance);
  const a=pre.aave.borrow!,b=post.aave.borrow!;
  if(pre.aave.deploymentHash!==post.aave.deploymentHash||a.reserveConfiguration!==b.reserveConfiguration||a.codeHash!==b.codeHash||a.eMode!==b.eMode||
      a.ltvBps!==b.ltvBps||a.liquidationThresholdBps!==b.liquidationThresholdBps)throw Error('LENDING_POSITION_CONFIGURATION_MISMATCH');
  const movements=logs.filter(l=>{const r=rpcRecord(l);return Array.isArray(r.topics)&&r.topics[0]===transfer&&r.topics.length===3&&(r.topics[1]===addressTopic(f.owner)||r.topics[2]===addressTopic(f.owner))&&
    !([p.asset,u.weth,p.aToken,p.variableDebtToken] as string[]).includes(String(r.address));});
  if(movements.length)throw Error('LENDING_UNEXPECTED_ASSET_MOVEMENT');
  if(call.id!=='SUPPLY'&&pre.aave.scaledPosition!==post.aave.scaledPosition||call.id!=='BORROW'&&a.scaledDebt!==b.scaledDebt)throw Error('LENDING_SCALED_POSITION_MISMATCH');
  const spent=(allowance:string,value:bigint)=>(BigInt(allowance)===(1n<<256n)-1n?BigInt(allowance):BigInt(allowance)-value).toString();
  if(call.id!=='POOL_APPROVAL'&&post.aave.allowance!==(call.id==='SUPPLY'?spent(pre.aave.allowance,amount):pre.aave.allowance)||call.id!=='ROUTER_APPROVAL'&&post.routerAllowance!==(call.id==='SWAP'?spent(pre.routerAllowance,amount):pre.routerAllowance))throw Error('LENDING_ALLOWANCE_MISMATCH');
  if(call.id==='POOL_APPROVAL'||call.id==='ROUTER_APPROVAL') {
    const spender=call.id==='POOL_APPROVAL'?p.pool:u.router, allowance=call.id==='POOL_APPROVAL'?post.aave.allowance:post.routerAllowance;
    if(balance!==0n||weth!==0n||BigInt(allowance)!==amount||!logs.some(l=>logMatches(l,p.asset,[supplyTopic('Approval(address,address,uint256)'),addressTopic(f.owner),addressTopic(spender)],'0x'+supplyWord(amount))))throw Error('LENDING_APPROVAL_MISMATCH');
  } else if(call.id==='SUPPLY') {
    verifySupplyPosition(f.supplyAmount,pre.aave,post.aave);
    if(balance!==-amount||weth!==0n||transferAmount(logs,p.asset,f.owner,p.aToken)!==amount||
      !logs.some(l=>logMatches(l,p.pool,[supplyTopic('Supply(address,address,address,uint256,uint16)'),addressTopic(p.asset),addressTopic(f.owner),'0x'+supplyWord(0n)],'0x'+supplyWord(f.owner)+supplyWord(amount))))throw Error('LENDING_SUPPLY_SETTLEMENT_MISMATCH');
  } else if(call.id==='BORROW') {
    verifyBorrowEffects(f.borrowAmount,pre.aave,post.aave,p);
    const events=logs.filter(l=>{const r=rpcRecord(l);return r.address===p.pool&&Array.isArray(r.topics)&&r.topics[0]===supplyTopic('Borrow(address,address,address,uint256,uint8,uint256,uint16)');});
    if(events.length!==1||weth!==0n||transferAmount(logs,p.asset,p.aToken,f.owner)!==amount)throw Error('LENDING_BORROW_SETTLEMENT_MISMATCH');
    const e=rpcRecord(events[0]), data=typeof e.data==='string'?e.data.slice(2):'';
    if(data.length!==256||!logMatches(e,p.pool,[supplyTopic('Borrow(address,address,address,uint256,uint8,uint256,uint16)'),addressTopic(p.asset),addressTopic(f.owner),'0x'+supplyWord(0n)],'0x'+supplyWord(f.owner)+supplyWord(amount)+supplyWord(2n)+data.slice(192)))throw Error('LENDING_BORROW_EVENT_MISMATCH');
  } else {
    if(balance!==-amount||weth<BigInt(review.route.minimumOut)||transferAmount(logs,p.asset,f.owner,review.route.pool)!==amount||transferAmount(logs,u.weth,review.route.pool,f.owner)!==weth)throw Error('LENDING_SWAP_SETTLEMENT_MISMATCH');
    const events=logs.filter(l=>{const r=rpcRecord(l);return r.address===review.route.pool&&Array.isArray(r.topics)&&r.topics[0]===swapTopic;});
    if(events.length!==1)throw Error('LENDING_SWAP_EVENT_MISMATCH');
    const e=rpcRecord(events[0]), data=typeof e.data==='string'?e.data.slice(2):'';
    const signed=(v:bigint)=>v>=1n<<255n?v-(1n<<256n):v;
    if(data.length!==320||!Array.isArray(e.topics)||e.topics.length!==3||e.topics[1]!==addressTopic(u.router)||e.topics[2]!==addressTopic(f.owner))throw Error('LENDING_SWAP_EVENT_MISMATCH');
    const q0=signed(BigInt('0x'+data.slice(0,64))),q1=signed(BigInt('0x'+data.slice(64,128)));
    if((BigInt(p.asset)<BigInt(u.weth)?q0:q1)!==amount||(BigInt(p.asset)<BigInt(u.weth)?q1:q0)!==-weth)throw Error('LENDING_SWAP_EVENT_MISMATCH');
    if(BigInt(a.healthFactor)<2n*10n**18n||BigInt(b.healthFactor)<2n*10n**18n)throw Error('LENDING_SWAP_HEALTH_FACTOR_MISMATCH');
    return weth.toString();
  }
  return null;
}
export async function reconcileLendingAttempt(review:LendingReview,attempt:LendingChainAttempt,rpc:SupplyRpc):Promise<LendingObservation> {
  const o:LendingObservation={attemptId:attempt.id,reviewCommitment:review.commitment,step:attempt.call.id,verdict:'INCONCLUSIVE',reason:'TRANSACTION_NOT_OBSERVED',transaction:null,receipt:null,pre:null,post:null,cost:null,output:null,ownerProof:null,ownerNonceAfter:null};
  if(!attempt.hash)return o;
  try {
    if(rpcUint(await rpc('eth_chainId',[]))!==84532n)throw Error('LENDING_WRONG_CHAIN');
    const [tv,rv]=await Promise.all([rpc('eth_getTransactionByHash',[attempt.hash]),rpc('eth_getTransactionReceipt',[attempt.hash])]);
    if(!tv||!rv)return o;
    const tx=rpcRecord(tv),r=rpcRecord(rv), expected=attempt.call.tx;
    if(rpcHash(tx.hash)!==attempt.hash||rpcHash(r.transactionHash)!==attempt.hash||rpcUint(tx.chainId)!==84532n||rpcUint(tx.value)!==0n||tx.from!==r.from||tx.to!==r.to)throw Error('LENDING_TRANSACTION_MISMATCH');
    // Base Flashblocks serves preconfirmed receipts with an all-zero block hash before the block is sealed.
    // Only a receipt in the canonical block at its height, consistent with the transaction readback, is final;
    // anything else is observed again later: never a mismatch, never a resend and never evidence.
    const n=Number(rpcUint(r.blockNumber)),sealed=await rpc('eth_getBlockByNumber',[supplyHex(n),false]),canonical=sealed?rpcRecord(sealed):null;
    if(typeof r.blockHash!=='string'||/^0x0{64}$/.test(r.blockHash)||tx.blockHash!==r.blockHash||tx.blockNumber!==r.blockNumber||tx.transactionIndex!==r.transactionIndex||
      !canonical||canonical.hash!==r.blockHash||!Array.isArray(canonical.transactions)||!canonical.transactions.includes(attempt.hash))return {...o,reason:'LENDING_RECEIPT_NOT_CANONICAL'};
    o.transaction=tx;o.receipt=r;
    if(n<attempt.preparedAtBlock)throw Error('LENDING_CANONICAL_INCLUSION_MISMATCH');
    if(rpcUint(await rpc('eth_blockNumber',[]))<BigInt(n+2))return {...o,reason:'AWAITING_CONFIRMATIONS'};
    const wrapped=tx.to!==expected.to;
    if(wrapped)o.ownerProof=await verifySupplyWalletEnvelope({account:review.fields.owner},{transaction:expected,nonce:attempt.nonce},tx,r,rpc);
    else {
      if(tx.from!==expected.from||tx.input!==expected.data||rpcUint(tx.nonce)!==BigInt(attempt.nonce))throw Error('LENDING_PAYLOAD_MISMATCH');
      o.ownerProof=verifyRepayOwnerSignature(tx,expected.from,p.chainId);
    }
    o.ownerNonceAfter=o.ownerProof.kind==='METAMASK_EIP7702'?o.ownerProof.ownerNonceAfter:rpcUint(await rpc('eth_getTransactionCount',[expected.from,supplyHex(n)])).toString();
    if(r.l1Fee===undefined)throw Error('LENDING_FEE_DATA_UNAVAILABLE');
    o.cost=(rpcUint(r.gasUsed)*rpcUint(r.effectiveGasPrice)+rpcUint(r.l1Fee)).toString();
    if(rpcUint(r.gasUsed)>rpcUint(tx.gas)||!wrapped&&(rpcUint(tx.gas)>BigInt(attempt.call.gasLimit)||rpcUint(tx.maxFeePerGas??tx.gasPrice)>BigInt(review.gasPrice))||BigInt(o.cost)>BigInt(review.gasBudget))throw Error('LENDING_FEE_BUDGET_MISMATCH');
    if(rpcUint(r.status)!==1n)return {...o,verdict:'DIVERGENT',reason:'LENDING_TRANSACTION_REVERTED'};
    if(!Array.isArray(r.logs))throw Error('LENDING_LOGS_MISMATCH');
    const [pre,post]=await Promise.all([readLendingSnapshot(rpc,expected.from,supplyHex(n-1),false),readLendingSnapshot(rpc,expected.from,supplyHex(n),false)]);
    o.pre=pre;o.post=post;
    if(pre.aave.deploymentHash!==review.state.aave.deploymentHash||pre.aave.borrow!.codeHash!==review.state.aave.borrow!.codeHash||pre.aave.borrow!.reserveConfiguration!==review.state.aave.borrow!.reserveConfiguration)throw Error('LENDING_REVIEW_DEPLOYMENT_MISMATCH');
    if(post.aave.blockHash!==r.blockHash||canonical.parentHash!==pre.aave.blockHash||rpcHash(rpcRecord(await rpc('eth_getBlockByNumber',[supplyHex(n),false])).hash)!==r.blockHash)throw Error('LENDING_RPC_INCONSISTENT');
    const codes=await Promise.all([u.factory,u.router,u.quoter,review.route.pool,u.weth].map(to=>rpc('eth_getCode',[to,supplyHex(n)])));
    if(supplyHash(codes)!==review.route.codeHash)throw Error('LENDING_INFRASTRUCTURE_MISMATCH');
    o.output=verifyLendingStepEffects(review,attempt.call,pre,post,r.logs);
    return {...o,verdict:'RECONCILED',reason:'LENDING_STEP_AUTHORITY_AND_ECONOMICS_VERIFIED'};
  } catch(cause) {
    const reason=cause instanceof Error?cause.message:'LENDING_OBSERVATION_FAILED';
    return {...o,reason,verdict:/MISMATCH|WRONG_CHAIN|INVALID|UNEXPECTED/.test(reason)?'DIVERGENT':'INCONCLUSIVE'};
  }
}
export function verifyComposedLendingEffects(review:LendingReview,observations:LendingObservation[]) {
  const f=review.fields, supply=observations.find(o=>o.step==='SUPPLY'),borrow=observations.find(o=>o.step==='BORROW'),swap=observations.find(o=>o.step==='SWAP');
  if(!supply?.post||!borrow?.post||!swap?.post||!swap.output||observations.some(o=>o.verdict!=='RECONCILED'))throw Error('LENDING_COMPOSED_PROOF_INCOMPLETE');
  if(supplyHash(observations.map(o=>o.step))!==supplyHash(review.calls.map(c=>c.id)))throw Error('LENDING_STEP_ORDER_MISMATCH');
  if(observations.reduce((sum,o)=>sum+BigInt(o.cost??'0'),0n)>BigInt(review.manifest.gasBudgets[0]!.maximumAmount)||observations.reduce((sum,o)=>sum+rpcUint(o.receipt?.l1Fee??'0x0'),0n)>BigInt(review.manifest.feeBudgets[0]!.maximumAmount))throw Error('LENDING_AGGREGATE_FEE_MISMATCH');
  if(new Set(observations.map(o=>o.receipt?.transactionHash)).size!==observations.length)throw Error('LENDING_DUPLICATE_RECEIPT_MISMATCH');
  for(let i=1;i<observations.length;i++){
    const a=observations[i-1]!,b=observations[i]!;
    if(!a.receipt||!b.receipt||rpcUint(a.receipt.blockNumber)>=rpcUint(b.receipt.blockNumber))throw Error('LENDING_STEP_ORDER_MISMATCH');
    if(a.post!.aave.scaledPosition!==b.pre!.aave.scaledPosition||a.post!.aave.borrow!.scaledDebt!==b.pre!.aave.borrow!.scaledDebt||
      a.post!.aave.balance!==b.pre!.aave.balance||a.post!.wethBalance!==b.pre!.wethBalance||a.post!.aave.allowance!==b.pre!.aave.allowance||a.post!.routerAllowance!==b.pre!.routerAllowance||
      a.post!.aave.deploymentHash!==b.pre!.aave.deploymentHash||a.post!.aave.borrow!.reserveConfiguration!==b.pre!.aave.borrow!.reserveConfiguration||a.post!.aave.borrow!.codeHash!==b.pre!.aave.borrow!.codeHash)throw Error('LENDING_CROSS_STEP_MOVEMENT_MISMATCH');
  }
  const root=review.rootState, final=swap.post, first=observations[0]?.pre;
  if(!first || first.aave.scaledPosition!==root.aave.scaledPosition || first.aave.borrow!.scaledDebt!==root.aave.borrow!.scaledDebt || first.aave.balance!==root.aave.balance || first.wethBalance!==root.wethBalance)throw Error('LENDING_ROOT_POSITION_MISMATCH');
  if(BigInt(final.aave.balance)!==BigInt(root.aave.balance)-BigInt(f.supplyAmount)||BigInt(final.wethBalance)!==BigInt(root.wethBalance)+BigInt(swap.output)||
    final.aave.scaledPosition!==supply.post.aave.scaledPosition||final.aave.borrow!.scaledDebt!==borrow.post.aave.borrow!.scaledDebt)throw Error('LENDING_COMPOSED_EXPOSURE_MISMATCH');
  return {collateral:final.aave.position,debt:final.aave.borrow!.debt,healthFactor:final.aave.borrow!.healthFactor,
    walletUsdc:final.aave.balance,walletWeth:final.wethBalance,borrowedPrincipal:f.borrowAmount,swapInput:f.borrowAmount,swapOutput:swap.output,
    residualPoolAllowance:final.aave.allowance,residualRouterAllowance:final.routerAllowance,
    totalNetworkCost:observations.reduce((sum,o)=>sum+BigInt(o.cost??'0'),0n).toString()};
}
/**
 * Content digest of composed observations. Reviews enter by commitment (each binds its full content and is re-verified
 * on export), so the hashed preimage stays bounded however many Fresh Simulates a long run accumulated.
 */
export function lendingObservationsDigest(observations:{reviews:readonly LendingReview[]}&Record<string,unknown>):string {
  return supplyHash({...observations,reviews:observations.reviews.map(r=>r.commitment)});
}
export type LendingResolvedNotSubmitted={attemptId:string;step:LendingStepId;nonSubmission:{kind:'APPROVAL_NOT_SUBMITTED';provenAtBlock:number;blockHash:string;ownerNonce:string;allowance:string;discoveryWindow:[number,number]}};
export function buildLendingEvidence(input:{id:string;reviews:LendingReview[];journal:ExecutionJournal;observations:LendingObservation[];provenance:'MOCKED'|'PUBLIC_TESTNET';completed:boolean;previous?:{bundle:EvidenceBundle;bundleHash:string}|null;
  resolvedNotSubmitted?:LendingResolvedNotSubmitted[]}) {
  if(input.provenance==='PUBLIC_TESTNET'&&!input.observations.some(o=>o.receipt&&o.ownerProof&&(o.verdict==='RECONCILED'||o.reason==='LENDING_TRANSACTION_REVERTED')))throw Error('PUBLIC_OWNER_EXECUTION_NOT_PROVEN');
  const root=lendingRootChain(input.reviews).root, post=input.observations.filter(o=>o.post).at(-1)?.post;
  const effects=input.completed?verifyComposedLendingEffects(root,input.observations):null;
  const observations={format:'gryloo.lending-observations.v1',provenance:input.provenance,ownerInitiated:true,
    completed:input.completed,reviews:input.reviews,observations:input.observations,effects,resolvedNotSubmitted:input.resolvedNotSubmitted??[]};
  const asset=root.fields.borrowed,weth=root.fields.output;
  const bundle:EvidenceBundle={schemaVersion:'1.0.0',evidenceBundleId:input.id,version:(input.previous?.bundle.version??0)+1,supersedes:input.previous?.bundleHash??null,
    semanticWorkflowHash:root.manifest.semanticWorkflowHash,artifactSetHash:root.manifest.artifactSetHash,simulationHash:root.manifest.simulationHash,policyHash:root.manifest.policyHash,
    manifestHash:supplyArtifactHash('strategy-manifest',root.manifest),executionPlanHash:supplyArtifactHash('execution-plan',root.plan),
    journalHeadHash:hashJournalBytes(new TextEncoder().encode(JSON.stringify(input.journal))).at(-1)!,observedAt:new Date().toISOString(),
    environment:input.provenance==='MOCKED'?'MOCKED':'TESTNET_EXECUTED',outcome:effects?'RECONCILED':input.observations.some(o=>o.verdict==='DIVERGENT')?'DIVERGENT':'INCONCLUSIVE',
    receipts:input.observations.filter(o=>o.receipt).map(o=>({receiptId:o.attemptId,contentHash:supplyHash(o.receipt)})),differences:[],
    reconciliation:{balances:post?[{asset,amount:post.aave.balance},{asset:weth,amount:post.wethBalance}]:[],
      allowances:post?[{asset,amount:post.routerAllowance}]:[],debt:post?[{asset,amount:post.aave.borrow!.debt}]:[],
      positions:post?[{asset:{chainId:p.chain,address:p.aToken,decimals:6},amount:post.aave.position}]:[],
      fees:[{asset:{chainId:p.chain,nativeId:'ETH',decimals:18},amount:input.observations.reduce((sum,o)=>sum+BigInt(o.cost??'0'),0n).toString()}],
      residualAssets:post?[{asset,amount:post.aave.balance},{asset:weth,amount:post.wethBalance}]:[],ownership:[{chainId:p.chain,address:root.fields.owner}],
      limitations:['HF is observed at named checkpoints, not continuing liquidation protection.','Borrowed-token provenance is fungible accounting linkage.',
        'Historical block snapshots include all block transactions; inconsistent effects fail closed.','Submission guarantees cover durable Gryloo attempts, not all external wallet activity.']},
    evidence:[{evidenceId:'lending-composed-observations',kind:'EXTERNAL_REFERENCE',contentHash:lendingObservationsDigest(observations)}]};
  return {bundle,bundleHash:supplyArtifactHash('evidence-bundle',bundle),composedExecution:observations,
    artifacts:{review:root,reviews:input.reviews,workflow:root.workflow,artifactSet:root.artifactSet,simulation:root.simulation,policy:root.policy,manifest:root.manifest,plan:root.plan,journal:input.journal}};
}
export async function verifyLendingExport(exported:ReturnType<typeof buildLendingEvidence>,rpc:SupplyRpc) {
  const {bundle,artifacts,composedExecution:e}=exported;
  if(bundle.environment!=='TESTNET_EXECUTED'||bundle.outcome!=='RECONCILED'||e.provenance!=='PUBLIC_TESTNET'||!e.ownerInitiated||!e.completed)throw Error('PUBLIC_COMPOSED_OWNER_EVIDENCE_REQUIRED');
  if(supplyArtifactHash('evidence-bundle',bundle)!==exported.bundleHash||lendingObservationsDigest(e)!==bundle.evidence[0]?.contentHash||
    hashJournalBytes(new TextEncoder().encode(JSON.stringify(artifacts.journal))).at(-1)!==bundle.journalHeadHash)throw Error('LENDING_EVIDENCE_COMMITMENT_MISMATCH');
  for(const [field,kind,value] of [['semanticWorkflowHash','semantic-workflow',artifacts.workflow],['artifactSetHash','artifact-set',artifacts.artifactSet],['simulationHash','simulation-bundle',artifacts.simulation],
    ['policyHash','authorization-policy',artifacts.policy],['manifestHash','strategy-manifest',artifacts.manifest],['executionPlanHash','execution-plan',artifacts.plan]] as const)
    if(supplyArtifactHash(kind,value)!==bundle[field])throw Error('LENDING_ARTIFACT_COMMITMENT_MISMATCH');
  // The bundle binds to the composed baseline (first or re-rooted Review); the journal header to the run's first Review.
  let chain:ReturnType<typeof lendingRootChain>;try{chain=lendingRootChain(e.reviews);}catch{throw Error('LENDING_ARCHIVE_MISMATCH');}
  if(e.reviews.length!==artifacts.reviews.length||e.reviews.some((r,i)=>supplyHash(r)!==supplyHash(artifacts.reviews[i]))||supplyHash(chain.root)!==supplyHash(artifacts.review)||
    supplyArtifactHash('strategy-manifest',artifacts.review.manifest)!==bundle.manifestHash||supplyArtifactHash('execution-plan',artifacts.review.plan)!==bundle.executionPlanHash||
    artifacts.journal.manifestHash!==supplyArtifactHash('strategy-manifest',e.reviews[0]!.manifest)||artifacts.journal.executionPlanHash!==supplyArtifactHash('execution-plan',e.reviews[0]!.plan))throw Error('LENDING_ARCHIVE_MISMATCH');
  // Approvals whose wallet result was unknown and that were proven absent from chain carry no observation.
  const resolved=new Map((e.resolvedNotSubmitted??[]).map(x=>[x.attemptId,x]));
  const submissions=artifacts.journal.entries.filter(j=>j.toState==='SUBMITTING'&&!resolved.has(j.entityId));
  if(submissions.length!==e.observations.length||submissions.some(j=>!e.observations.some(o=>o.attemptId===j.entityId)))throw Error('LENDING_JOURNAL_SUBMISSION_MISMATCH');
  const attempts=new Set(artifacts.journal.entries.filter(j=>j.level==='attempt').map(j=>j.entityId));
  if([...resolved.keys()].some(id=>!attempts.has(id)))throw Error('LENDING_JOURNAL_SUBMISSION_MISMATCH');
  for(const id of attempts){const rows=artifacts.journal.entries.filter(j=>j.entityId===id),proven=resolved.get(id);
    if(proven){
      if(e.observations.some(o=>o.attemptId===id)||JSON.stringify(rows.map(j=>j.toState))!==JSON.stringify(['PREPARED','SUBMITTING','SUBMISSION_RESULT_UNKNOWN','NOT_FOUND'])||
        (proven.step!=='POOL_APPROVAL'&&proven.step!=='ROUTER_APPROVAL')||rows.some(j=>j.stepId!==proven.step))throw Error('LENDING_JOURNAL_SUBMISSION_MISMATCH');
      // Re-proved independently at the recorded block: same block, owner nonce unchanged, allowance never set.
      const p=proven.nonSubmission,owner=e.reviews[0]!.fields.owner,at=await readLendingSnapshot(rpc,owner,supplyHex(p.provenAtBlock),false);
      const nonceAtBlock=rpcUint(await rpc('eth_getTransactionCount',[owner,supplyHex(p.provenAtBlock)])).toString();
      if(p.kind!=='APPROVAL_NOT_SUBMITTED'||p.provenAtBlock<=p.discoveryWindow[1]||at.aave.blockHash!==p.blockHash||nonceAtBlock!==p.ownerNonce||
        (proven.step==='POOL_APPROVAL'?at.aave.allowance:at.routerAllowance)!==p.allowance)throw Error('LENDING_NON_SUBMISSION_PROOF_MISMATCH');
      continue;
    }
    if(!e.observations.some(o=>o.attemptId===id)&&(rows.at(-1)?.toState!=='CANCELLED'||rows.some(j=>j.toState==='SUBMITTING')))throw Error('LENDING_JOURNAL_SUBMISSION_MISMATCH');
  }
  for(const review of e.reviews){
    assertLendingReview(review,review.workflow,review.fields.owner,Date.parse(review.simulation.freshness.observedAt));
    const compiled=compileLendingCalls(review.workflow,review.fields.owner,review.state,review.route.minimumOut,review.completed);
    if(supplyHash(compiled.map(c=>({id:c.id,tx:c.tx})))!==supplyHash(review.calls.map(c=>({id:c.id,tx:c.tx})))||supplyHash(review.workflow)!==supplyHash(artifacts.workflow))throw Error('LENDING_ARCHIVE_MISMATCH');
    if(review.policy.accountRiskRules.length!==2||review.policy.accountRiskRules.some(c=>c.minimumHealthFactorNumerator!=='2'||c.minimumHealthFactorDenominator!=='1')||review.manifest.spendLimits[0]?.maximumAmount!==(BigInt(review.fields.supplyAmount)+BigInt(review.fields.borrowAmount)).toString())throw Error('LENDING_POLICY_MISMATCH');
  }
  const observed:LendingObservation[]=[];
  for(const archived of e.observations){
    const review=e.reviews.find(r=>r.commitment===archived.reviewCommitment);
    const call=review?.calls.find(c=>c.id===archived.step);if(!review||!call||!archived.receipt||!archived.transaction||e.reviews.indexOf(review)<chain.index)throw Error('LENDING_ARCHIVE_MISMATCH');
    const entries=artifacts.journal.entries.filter(j=>j.entityId===archived.attemptId);
    if(entries[0]?.toState!=='PREPARED'||entries.at(-1)?.toState!=='CONFIRMED'||entries.filter(j=>j.toState==='SUBMITTING').length!==1||entries.some(j=>j.stepId!==call.id))throw Error('LENDING_JOURNAL_SUBMISSION_MISMATCH');
    verifyIndependentLendingCalldata(review,call);
    const fresh=await reconcileLendingAttempt(review,{id:archived.attemptId,call,nonce:archived.ownerProof?.kind==='METAMASK_EIP7702'?archived.ownerProof.ownerNonceBefore:rpcUint(archived.transaction.nonce).toString(),
      hash:rpcHash(archived.receipt.transactionHash),preparedAtBlock:review.state.aave.block,reviewCommitment:review.commitment},rpc);
    if(fresh.verdict!=='RECONCILED'||supplyHash(fresh.receipt)!==supplyHash(archived.receipt)||fresh.output!==archived.output||fresh.cost!==archived.cost)throw Error('LENDING_INDEPENDENT_OBSERVATION_MISMATCH');
    observed.push(fresh);
  }
  const effects=verifyComposedLendingEffects(artifacts.review,observed);
  const final=observed.at(-1)!.post!;
  const f=artifacts.review.fields,asset=(actual:unknown,expected:unknown)=>supplyHash(actual)===supplyHash(expected);
  if(bundle.reconciliation.balances.length!==2||!asset(bundle.reconciliation.balances[0]?.asset,f.borrowed)||!asset(bundle.reconciliation.balances[1]?.asset,f.output)||
    bundle.reconciliation.debt.length!==1||!asset(bundle.reconciliation.debt[0]?.asset,f.borrowed)||bundle.reconciliation.positions.length!==1||!asset(bundle.reconciliation.positions[0]?.asset,{chainId:p.chain,address:p.aToken,decimals:6})||
    bundle.reconciliation.allowances.length!==1||!asset(bundle.reconciliation.allowances[0]?.asset,f.borrowed)||bundle.reconciliation.allowances[0]?.amount!==final.routerAllowance||
    bundle.reconciliation.fees.length!==1||!asset(bundle.reconciliation.fees[0]?.asset,{chainId:p.chain,nativeId:'ETH',decimals:18})||!asset(bundle.reconciliation.ownership,[{chainId:p.chain,address:f.owner}])||
    !asset(bundle.reconciliation.residualAssets,bundle.reconciliation.balances))throw Error('LENDING_EVIDENCE_ASSET_MISMATCH');
  if(bundle.reconciliation.debt[0]?.amount!==final.aave.borrow!.debt||bundle.reconciliation.positions[0]?.amount!==final.aave.position||bundle.reconciliation.balances[0]?.amount!==final.aave.balance||bundle.reconciliation.balances[1]?.amount!==final.wethBalance||bundle.reconciliation.fees[0]?.amount!==effects.totalNetworkCost)throw Error('LENDING_EVIDENCE_EXPOSURE_MISMATCH');
  if(supplyHash(effects)!==supplyHash(e.effects))throw Error('LENDING_INDEPENDENT_EXPOSURE_MISMATCH');
  // Separate arithmetic reconstruction, without using the runtime scaled-share verifier.
  const s=observed.find(o=>o.step==='SUPPLY')!,b=observed.find(o=>o.step==='BORROW')!,q=observed.find(o=>o.step==='SWAP')!;
  for(const [amount,shares,index] of [[artifacts.review.fields.supplyAmount,BigInt(s.post!.aave.scaledPosition)-BigInt(s.pre!.aave.scaledPosition),BigInt(s.post!.aave.index)],
    [artifacts.review.fields.borrowAmount,BigInt(b.post!.aave.borrow!.scaledDebt)-BigInt(b.pre!.aave.borrow!.scaledDebt),BigInt(b.post!.aave.borrow!.debtIndex)]] as const){
    const actual=(shares*index+10n**27n/2n)/10n**27n,expected=BigInt(amount),difference=actual>expected?actual-expected:expected-actual;
    if(difference>(index+10n**27n-1n)/10n**27n+1n)throw Error('LENDING_INDEPENDENT_SHARE_MISMATCH');
  }
  if(BigInt(q.pre!.aave.balance)-BigInt(q.post!.aave.balance)!==BigInt(artifacts.review.fields.borrowAmount))throw Error('LENDING_INDEPENDENT_SWAP_INPUT_MISMATCH');
  return {status:'TESTNET_EXECUTED',verdict:'INDEPENDENTLY_RECONCILED',readOnly:true,evidenceBundleHash:exported.bundleHash,effects,observations:observed};
}

/** Separate literal ABI reconstruction from the runtime compiler, no signing or transport. */
function verifyIndependentLendingCalldata(review:LendingReview,call:LendingCall):void {
  const f=review.fields,encode=(v:string|bigint)=>BigInt(v).toString(16).padStart(64,'0');
  const abi:Record<LendingCall['id'],{selector:string;to:string;args:(string|bigint)[]}>= {
    POOL_APPROVAL:{selector:'095ea7b3',to:p.asset,args:[p.pool,BigInt(f.supplyAmount)]},
    SUPPLY:{selector:'617ba037',to:p.pool,args:[p.asset,BigInt(f.supplyAmount),f.owner,0n]},
    BORROW:{selector:'a415bcad',to:p.pool,args:[p.asset,BigInt(f.borrowAmount),2n,0n,f.owner]},
    ROUTER_APPROVAL:{selector:'095ea7b3',to:p.asset,args:[u.router,BigInt(f.borrowAmount)]},
    SWAP:{selector:'04e45aaf',to:u.router,args:[p.asset,u.weth,500n,f.owner,BigInt(f.borrowAmount),BigInt(review.route.minimumOut),0n]},
  };
  const expected=abi[call.id];
  if(call.tx.to!==expected.to||call.tx.from!==f.owner||call.tx.chainId!=='0x14a34'||call.tx.value!=='0x0'||call.tx.data!=='0x'+expected.selector+expected.args.map(encode).join(''))throw Error('LENDING_INDEPENDENT_CALLDATA_MISMATCH');
}
