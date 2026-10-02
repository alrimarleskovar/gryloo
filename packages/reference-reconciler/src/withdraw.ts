// SPDX-License-Identifier: AGPL-3.0-only
import { AAVE_V3_BASE_SEPOLIA as p,readWithdrawState,compileWithdrawCalls,estimateWithdraw,borrowHealthFactor,supplyHex,supplyWord,supplyTopic,supplyHash,supplyArtifactHash,rpcUint,rpcRecord,rpcHash,SUPPLY_METAMASK,type SupplyReview,type SupplyState,type SupplyRpc } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes,type EvidenceBundle,type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
import { verifySupplyWalletEnvelope,logMatches,addressTopic,type SupplyChainAttempt,type SupplyObservation } from './supply.js';
import { verifyRepayOwnerSignature,type RepayOwnerProof } from './repay.js';
const ray=10n**27n,abs=(n:bigint)=>n<0n?-n:n;
export type WithdrawObservation=SupplyObservation & {ownerAuthorization?:RepayOwnerProof;walletDelta?:string;collateralDelta?:string;normalizedWithdrawal?:string;roundingBound?:string;withdrawEvent?:unknown};
/** Principal is proved from shares at execution index, separately from interest. */
export function verifyWithdrawEffects(amount:string,pre:SupplyState,post:SupplyState){
  const a=pre.borrow,b=post.borrow,n=BigInt(amount),index=BigInt(post.index),burn=BigInt(pre.scaledPosition)-BigInt(post.scaledPosition);
  if(!a||!b||index<ray||index<BigInt(pre.index))throw new Error('WITHDRAW_POSITION_MISMATCH');
  const nearest=(n*ray+index/2n)/index,ceil=(n*ray+index-1n)/index;
  const normalized=(burn*index+ray/2n)/ray,bound=(index+ray-1n)/ray+1n;
  if(burn<=0n||BigInt(post.scaledPosition)<=0n||burn!==nearest&&burn!==ceil||abs(normalized-n)>bound||abs(BigInt(pre.position)-(BigInt(pre.scaledPosition)*BigInt(pre.index)+ray/2n)/ray)>1n||abs(BigInt(post.position)-(BigInt(post.scaledPosition)*index+ray/2n)/ray)>1n||BigInt(post.position)>=BigInt(pre.position))throw new Error('WITHDRAW_COLLATERAL_INDEX_MISMATCH');
  const walletDelta=BigInt(post.balance)-BigInt(pre.balance);
  if(walletDelta!==n||pre.allowance!==post.allowance)throw new Error('WITHDRAW_WALLET_BALANCE_MISMATCH');
  for(const k of ['scaledDebt','reserveConfiguration','userConfiguration','ltvBps','liquidationThresholdBps','eMode','codeHash','variableDebtToken','baseCurrencyUnit'] as const)if(a[k]!==b[k])throw new Error('WITHDRAW_CONFIGURATION_OR_DEBT_MISMATCH');
  const debtIndex=BigInt(b.debtIndex),oldIndex=BigInt(a.debtIndex);
  if(debtIndex<oldIndex||debtIndex-oldIndex>oldIndex/1000n+2n||abs(BigInt(b.debt)-(BigInt(b.scaledDebt)*debtIndex+ray/2n)/ray)>1n||abs(BigInt(a.debt)-(BigInt(a.scaledDebt)*oldIndex+ray/2n)/ray)>1n||BigInt(b.debt)<BigInt(a.debt))throw new Error('WITHDRAW_DEBT_INTEREST_MISMATCH');
  if(abs(BigInt(b.price)-BigInt(a.price))>BigInt(a.price)/1000n||abs(BigInt(b.collateralBase)-BigInt(post.position)*BigInt(b.price)/1000000n)>2n||abs(BigInt(a.collateralBase)-BigInt(pre.position)*BigInt(a.price)/1000000n)>2n||abs(BigInt(b.debtBase)-BigInt(b.debt)*BigInt(b.price)/1000000n)>2n)throw new Error('WITHDRAW_ACCOUNT_MISMATCH');
  const health=BigInt(borrowHealthFactor(b.collateralBase,b.liquidationThresholdBps,b.debtBase));
  if(BigInt(b.healthFactor)<2n*10n**18n||abs(BigInt(b.healthFactor)-health)>health/1000000n+1n)throw new Error('WITHDRAW_HEALTH_FACTOR_MISMATCH');
  estimateWithdraw(amount,pre);
  return {walletDelta:walletDelta.toString(),collateralDelta:(BigInt(post.position)-BigInt(pre.position)).toString(),normalizedWithdrawal:normalized.toString(),roundingBound:bound.toString(),delta:normalized.toString(),scaledDelta:burn.toString()};
}
function assertWithdrawTransfers(logs:unknown[],owner:string,amount:string,pre:SupplyState,post:SupplyState):void {
  const topic=addressTopic(owner),transfer=supplyTopic('Transfer(address,address,uint256)'),zero='0x'+supplyWord(0n);
  const movements=logs.filter(value=>{const l=rpcRecord(value);return Array.isArray(l.topics)&&l.topics[0]===transfer&&(l.topics[1]===topic||l.topics[2]===topic);});
  const underlying=movements.filter(l=>rpcRecord(l).address===p.asset),collateral=movements.filter(l=>rpcRecord(l).address===p.aToken);
  if(movements.length!==2||underlying.length!==1||collateral.length!==1||!logMatches(underlying[0],p.asset,[transfer,addressTopic(p.aToken),topic],'0x'+supplyWord(BigInt(amount))))throw new Error('WITHDRAW_UNEXPECTED_ASSET_MOVEMENT_MISMATCH');
  const checkpoint=pre.withdrawState?.previousIndex;
  if(!checkpoint||post.withdrawState?.previousIndex!==post.index)throw new Error('WITHDRAW_COLLATERAL_CHECKPOINT_MISMATCH');
  const index=BigInt(post.index),scaled=BigInt(pre.scaledPosition),priorIndex=BigInt(checkpoint),l=rpcRecord(collateral[0]);
  const nearestBalance=(s:bigint,i:bigint)=>(s*i+ray/2n)/ray,floorBalance=(s:bigint,i:bigint)=>s*i/ray;
  const accrued=[nearestBalance(scaled,index)-nearestBalance(scaled,priorIndex),floorBalance(scaled,index)-floorBalance(scaled,priorIndex)];
  const burns=logs.filter(value=>{const v=rpcRecord(value);return v.address===p.aToken&&Array.isArray(v.topics)&&['Burn(address,address,uint256,uint256,uint256)','Mint(address,address,uint256,uint256,uint256)'].map(supplyTopic).includes(String(v.topics[0]))&&(v.topics[1]===topic||v.topics[2]===topic);});
  if(burns.length!==1)throw new Error('WITHDRAW_COLLATERAL_EVENT_MISMATCH');
  const event=rpcRecord(burns[0]);if(typeof event.data!=='string'||!/^0x[0-9a-f]{192}$/.test(event.data))throw new Error('WITHDRAW_COLLATERAL_EVENT_MISMATCH');
  const [net,increase,eventIndex]=event.data.slice(2).match(/.{64}/g)!.map(w=>BigInt('0x'+w));
  const mint=(event.topics as string[])[0]===supplyTopic('Mint(address,address,uint256,uint256,uint256)');
  const principal=mint?increase!-net!:increase!+net!,n=BigInt(amount),bound=(index+ray-1n)/ray+1n;
  // Legacy events use requested amount; current events use the exact balance
  // decrease represented by burned shares. Derive both supported encodings.
  const currentPrincipal=floorBalance(scaled,index)-floorBalance(BigInt(post.scaledPosition),index);
  if(eventIndex!==index||!accrued.includes(increase!)||principal!==n&&principal!==currentPrincipal||abs(principal-n)>bound||!logMatches(event,p.aToken,[supplyTopic(mint?'Mint(address,address,uint256,uint256,uint256)':'Burn(address,address,uint256,uint256,uint256)'),topic,topic],event.data)||!logMatches(l,p.aToken,[transfer,mint?zero:topic,mint?topic:zero],'0x'+supplyWord(net!)))throw new Error('WITHDRAW_COLLATERAL_EVENT_MISMATCH');
}
export async function reconcileWithdrawAttempt(review:SupplyReview,attempt:SupplyChainAttempt,rpc:SupplyRpc):Promise<WithdrawObservation> {
  const base:WithdrawObservation={verdict:'INCONCLUSIVE',reason:'TRANSACTION_NOT_OBSERVED',transaction:null,receipt:null,prePosition:null,postPosition:null,delta:null,scaledDelta:null,cost:null};
  if(!attempt.transactionHash)return base;
  try{
    if(rpcUint(await rpc('eth_chainId',[]))!==BigInt(p.chainId))throw new Error('WITHDRAW_WRONG_CHAIN');
    const [txValue,receiptValue]=await Promise.all([rpc('eth_getTransactionByHash',[attempt.transactionHash]),rpc('eth_getTransactionReceipt',[attempt.transactionHash])]);
    if(!txValue||!receiptValue)return base;
    const tx=rpcRecord(txValue),receipt=rpcRecord(receiptValue);base.transaction=tx;base.receipt=receipt;
    const expected=compileWithdrawCalls(review.workflow,review.account)[0]!;
    // Compare exact canonical fields, independent of serialized property order.
    const transactionFields=['from','to','value','chainId','data'] as const;
    const sameTransaction=Object.keys(attempt.transaction).length===transactionFields.length&&transactionFields.every(field=>Object.hasOwn(attempt.transaction,field)&&expected[field]===attempt.transaction[field]);
    if(!review.withdraw||review.borrow||review.repay||review.approvalRequired||attempt.step!=='WITHDRAW'||review.withdraw.expectedPostHealthFactor!==estimateWithdraw(review.amount,review.state).healthFactorAfter||review.pool!==p.pool||review.asset!==p.asset||review.chain!==p.chain||review.beneficiary!==review.account||!sameTransaction)throw new Error('WITHDRAW_SEMANTIC_MISMATCH');
    const receiptBlockHash=rpcHash(receipt.blockHash);
    if(rpcHash(tx.hash)!==attempt.transactionHash||rpcHash(receipt.transactionHash)!==attempt.transactionHash||typeof tx.from!=='string'||typeof tx.to!=='string'||receipt.from!==tx.from||receipt.to!==tx.to||rpcUint(tx.value)!==0n||rpcUint(tx.chainId)!==BigInt(p.chainId)||(tx.blockHash!==null&&rpcHash(tx.blockHash)!==receiptBlockHash)||rpcUint(tx.blockNumber)!==rpcUint(receipt.blockNumber)||rpcUint(tx.transactionIndex)!==rpcUint(receipt.transactionIndex))throw new Error('WITHDRAW_TRANSACTION_MISMATCH');
    const wrapped=tx.to===SUPPLY_METAMASK.manager;
    if(!wrapped&&(tx.from!==expected.from||tx.to!==expected.to||tx.input!==expected.data||rpcUint(tx.nonce)!==BigInt(attempt.nonce)))throw new Error('WITHDRAW_TRANSACTION_MISMATCH');
    const gasIndex=0;
    if(rpcUint(receipt.gasUsed)>rpcUint(tx.gas)||!wrapped&&(rpcUint(tx.gas)>BigInt(review.gasLimits[gasIndex]!)||rpcUint(receipt.effectiveGasPrice)>BigInt(review.gasPrice)||rpcUint(tx.maxFeePerGas??tx.gasPrice)>BigInt(review.gasPrice)))throw new Error('WITHDRAW_GAS_MISMATCH');
    const block=Number(rpcUint(receipt.blockNumber));if(!Number.isSafeInteger(block)||block<attempt.preparedAtBlock)throw new Error('WITHDRAW_BLOCK_MISMATCH');
    const canonical=rpcRecord(await rpc('eth_getBlockByNumber',[supplyHex(block),false]));
    if(rpcHash(canonical.hash)!==receiptBlockHash||rpcUint(canonical.number)!==BigInt(block))throw new Error('WITHDRAW_REORG');
    // A null transaction block hash is only missing provider metadata. Independently
    // bind inclusion to the canonical receipt block and its exact transaction slot.
    const transactionIndex=Number(rpcUint(receipt.transactionIndex));
    if(!Number.isSafeInteger(transactionIndex)||!Array.isArray(canonical.transactions)||canonical.transactions[transactionIndex]!==attempt.transactionHash)throw new Error('WITHDRAW_TRANSACTION_INDEX_MISMATCH');
    if(rpcUint(await rpc('eth_blockNumber',[]))<BigInt(block+2))return {...base,reason:'AWAITING_CONFIRMATIONS'};
    if(rpcUint(receipt.status)!==1n)return {...base,verdict:'DIVERGENT',reason:'WITHDRAW_REVERTED'};
    if(wrapped)base.walletEnvelope=await verifySupplyWalletEnvelope(review,attempt,tx,receipt,rpc);else base.ownerAuthorization=verifyRepayOwnerSignature(tx,review.account);
    if(!Array.isArray(receipt.logs))throw new Error('WITHDRAW_LOGS_INVALID');
    const pre=await readWithdrawState(rpc,review.account,review.account,supplyHex(block-1)),post=await readWithdrawState(rpc,review.account,review.account,supplyHex(block));base.prePosition=pre;base.postPosition=post;
    if(pre.blockHash!==rpcHash(canonical.parentHash)||post.blockHash!==rpcHash(receipt.blockHash)||pre.deploymentHash!==review.state.deploymentHash||post.deploymentHash!==review.state.deploymentHash)throw new Error('WITHDRAW_DEPLOYMENT_MISMATCH');
    assertWithdrawTransfers(receipt.logs,review.account,review.amount,pre,post);
    const final=rpcRecord(await rpc('eth_getBlockByNumber',[supplyHex(block),false]));if(rpcHash(final.hash)!==post.blockHash)throw new Error('WITHDRAW_REORG');
    if(receipt.l1Fee===undefined)throw new Error('WITHDRAW_NETWORK_COST_MISMATCH');
    base.cost=(rpcUint(receipt.gasUsed)*rpcUint(receipt.effectiveGasPrice)+rpcUint(receipt.l1Fee)).toString();
    if(!wrapped){
      const [beforeNonce,afterNonce]=await Promise.all([rpc('eth_getTransactionCount',[review.account,supplyHex(block-1)]),rpc('eth_getTransactionCount',[review.account,supplyHex(block)])]);
      if(rpcUint(beforeNonce)!==BigInt(attempt.nonce)||rpcUint(afterNonce)!==rpcUint(beforeNonce)+1n)throw new Error('WITHDRAW_OWNER_NONCE_MISMATCH');
      if(BigInt(pre.nativeBalance)-BigInt(post.nativeBalance)!==BigInt(base.cost))throw new Error('WITHDRAW_NATIVE_COST_MISMATCH');
    }
    const events=receipt.logs.filter(l=>rpcRecord(l).address===p.pool&&Array.isArray(rpcRecord(l).topics)&&(rpcRecord(l).topics as unknown[])[0]===supplyTopic('Withdraw(address,address,address,uint256)'));
    if(events.length!==1||!logMatches(events[0],p.pool,[supplyTopic('Withdraw(address,address,address,uint256)'),addressTopic(p.asset),addressTopic(review.account),addressTopic(review.account)],'0x'+supplyWord(BigInt(review.amount))))throw new Error('WITHDRAW_EVENT_MISMATCH');
    return {...base,...verifyWithdrawEffects(review.amount,pre,post),withdrawEvent:events[0],verdict:'RECONCILED',reason:'WITHDRAW_TRANSACTION_COLLATERAL_WALLET_DEBT_AND_HEALTH_VERIFIED'};
  }catch(cause){const reason=cause instanceof Error?cause.message:'WITHDRAW_OBSERVATION_FAILED';return {...base,reason,verdict:/MISMATCH|WRONG_CHAIN|REORG|INVALID|UNSUPPORTED/.test(reason)?'DIVERGENT':'INCONCLUSIVE'};}
}
export function buildWithdrawEvidence(input:{id:string;review:SupplyReview;journal:ExecutionJournal;provenance:'PUBLIC_TESTNET'|'MOCKED';ownerInitiated:boolean;observations:SupplyObservation[]}){
  const r=input.review,o=input.observations.at(-1) as WithdrawObservation|undefined;
  if(!r.withdraw||!o||o.verdict!=='RECONCILED'||!o.prePosition?.borrow||!o.postPosition?.borrow||!o.transaction||!o.receipt||!o.withdrawEvent||!(o.ownerAuthorization||o.walletEnvelope)||!input.ownerInitiated)throw new Error('WITHDRAW_EVIDENCE_NOT_RECONCILED');
  const effects=verifyWithdrawEffects(r.amount,o.prePosition,o.postPosition);
  const publicExecution={network:p.network,chainId:p.chainId,owner:r.account,recipient:r.beneficiary,pool:p.pool,asset:p.asset,aToken:p.aToken,amount:r.amount,withdrawTransactionHash:o.receipt.transactionHash,ownerAuthorization:o.ownerAuthorization??o.walletEnvelope,block:o.postPosition.block,transactionCost:o.cost,totalNetworkCost:o.cost,...effects,prePosition:o.prePosition,postPosition:o.postPosition,observations:input.observations,provenance:input.provenance,ownerInitiated:true};
  const head=hashJournalBytes(new TextEncoder().encode(JSON.stringify(input.journal))).at(-1);if(!head)throw new Error('WITHDRAW_JOURNAL_EMPTY');
  const asset={chainId:p.chain,address:p.asset,decimals:6};
  const bundle:EvidenceBundle={schemaVersion:'1.0.0',evidenceBundleId:input.id,version:1,supersedes:null,semanticWorkflowHash:r.manifest.semanticWorkflowHash,artifactSetHash:r.manifest.artifactSetHash,simulationHash:r.manifest.simulationHash,policyHash:r.manifest.policyHash,manifestHash:supplyArtifactHash('strategy-manifest',r.manifest),executionPlanHash:supplyArtifactHash('execution-plan',r.plan),journalHeadHash:head,observedAt:new Date().toISOString(),environment:input.provenance==='PUBLIC_TESTNET'?'TESTNET_EXECUTED':'MOCKED',outcome:'RECONCILED',receipts:[{receiptId:'withdraw-receipt',contentHash:supplyHash(o.receipt)}],differences:[],reconciliation:{balances:[{asset,amount:o.postPosition.balance}],allowances:[{asset,amount:o.postPosition.allowance}],debt:[{asset,amount:o.postPosition.borrow.debt}],positions:[{asset:{chainId:p.chain,address:p.aToken,decimals:6},amount:o.postPosition.position}],fees:[],residualAssets:[],ownership:[{chainId:p.chain,address:r.account}],limitations:['Exact canonical Withdraw event and wallet credit bind requested amount; scaled collateral burn is independently normalized at execution index.','Whole-block snapshots fail closed on inconsistent concurrent effects.']},evidence:[{evidenceId:'withdraw-public-observations',kind:'EXTERNAL_REFERENCE',contentHash:supplyHash(publicExecution)}]};
  return {bundle,bundleHash:supplyArtifactHash('evidence-bundle',bundle),publicExecution,artifacts:{workflow:r.workflow,artifactSet:r.artifactSet,simulation:r.simulation,policy:r.policy,manifest:r.manifest,plan:r.plan,journal:input.journal,review:r}};
}
