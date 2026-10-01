// SPDX-License-Identifier: AGPL-3.0-only
import { AAVE_V3_BASE_SEPOLIA as p, readBorrowState, compileBorrowCalls, borrowHealthFactor, BORROW_MINIMUM_HEALTH_FACTOR,
  supplyHex, supplyWord, supplyTopic, supplyHash, supplyArtifactHash, rpcUint, rpcRecord, rpcHash, SUPPLY_METAMASK,
  type SupplyReview, type SupplyState, type SupplyRpc } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type EvidenceBundle, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
import { verifySupplyWalletEnvelope, verifySupplyPosition, logMatches, addressTopic, type SupplyChainAttempt, type SupplyObservation } from './supply.js';
export type BorrowObservation = SupplyObservation & { walletDelta?:string; debtDelta?:string; preHealthFactor?:string; postHealthFactor?:string; borrowEvent?:unknown };
const abs=(v:bigint)=>v<0n?-v:v;
export function verifyBorrowEffects(amount:string,pre:SupplyState,post:SupplyState):{walletDelta:string;debtDelta:string;delta:string;scaledDelta:string;preHealthFactor:string;postHealthFactor:string} {
  const a=pre.borrow,b=post.borrow;
  if(!a||!b)throw new Error('BORROW_POSITION_MISMATCH');
  const walletDelta=BigInt(post.balance)-BigInt(pre.balance);
  if(walletDelta!==BigInt(amount))throw new Error('BORROW_WALLET_BALANCE_MISMATCH');
  const debt=verifySupplyPosition(amount,{scaledPosition:a.scaledDebt,position:a.debt,index:a.debtIndex},{scaledPosition:b.scaledDebt,position:b.debt,index:b.debtIndex});
  const debtDelta=BigInt(b.debt)-BigInt(a.debt);
  if(debtDelta<=0n||a.reserveConfiguration!==b.reserveConfiguration||BigInt(b.userConfiguration)!==(BigInt(a.userConfiguration)|1n)||a.eMode!==b.eMode||a.codeHash!==b.codeHash||a.variableDebtToken!==b.variableDebtToken)throw new Error('BORROW_DEBT_MISMATCH');
  // Existing debt accrues legitimately. The scaled principal check above remains exact within ray rounding.
  const expectedBase=((BigInt(b.debt)-BigInt(a.debt))*BigInt(b.price))/1000000n;
  if(abs(BigInt(b.debtBase)-BigInt(a.debtBase)-expectedBase)>2n+BigInt(a.debtBase)/1000n)throw new Error('BORROW_ACCOUNT_DEBT_MISMATCH');
  if(abs(BigInt(b.collateralBase)-BigInt(a.collateralBase))>2n+BigInt(a.collateralBase)/1000n||a.liquidationThresholdBps!==b.liquidationThresholdBps||a.ltvBps!==b.ltvBps||abs(BigInt(b.price)-BigInt(a.price))>BigInt(a.price)/1000n)throw new Error('BORROW_COLLATERAL_MISMATCH');
  const expected=BigInt(borrowHealthFactor(b.collateralBase,b.liquidationThresholdBps,b.debtBase));
  if(BigInt(b.healthFactor)<BORROW_MINIMUM_HEALTH_FACTOR||abs(BigInt(b.healthFactor)-expected)>expected/1000000n+1n)throw new Error('BORROW_HEALTH_FACTOR_MISMATCH');
  const expectedCapacity=(BigInt(b.collateralBase)*BigInt(b.ltvBps)+5000n)/10000n-BigInt(b.debtBase);
  if(abs(BigInt(b.availableBorrowBase)-(expectedCapacity>0n?expectedCapacity:0n))>2n||BigInt(b.availableBorrowBase)>=BigInt(a.availableBorrowBase))throw new Error('BORROW_CAPACITY_MISMATCH');
  return {walletDelta:walletDelta.toString(),debtDelta:debtDelta.toString(),...debt,preHealthFactor:a.healthFactor,postHealthFactor:b.healthFactor};
}
export async function reconcileBorrowAttempt(review:SupplyReview,attempt:SupplyChainAttempt,rpc:SupplyRpc):Promise<BorrowObservation> {
  const base:BorrowObservation={verdict:'INCONCLUSIVE',reason:'TRANSACTION_NOT_OBSERVED',transaction:null,receipt:null,prePosition:null,postPosition:null,delta:null,scaledDelta:null,cost:null};
  if(!attempt.transactionHash)return base;
  try{
    if(rpcUint(await rpc('eth_chainId',[]))!==BigInt(p.chainId))throw new Error('BORROW_WRONG_CHAIN');
    const [txValue,receiptValue]=await Promise.all([rpc('eth_getTransactionByHash',[attempt.transactionHash]),rpc('eth_getTransactionReceipt',[attempt.transactionHash])]);
    if(!txValue||!receiptValue)return base;
    const tx=rpcRecord(txValue),receipt=rpcRecord(receiptValue);base.transaction=tx;base.receipt=receipt;
    const expected=compileBorrowCalls(review.workflow,review.account)[0]!;
    if(!review.borrow||attempt.step!=='BORROW'||review.borrow.interestRateMode!==2||review.approvalRequired||review.pool!==p.pool||review.asset!==p.asset||review.chain!==p.chain||review.beneficiary!==review.account||JSON.stringify(expected)!==JSON.stringify(attempt.transaction)||review.amount!==BigInt('0x'+expected.data.slice(74,138)).toString())throw new Error('BORROW_SEMANTIC_MISMATCH');
    if(rpcHash(tx.hash)!==attempt.transactionHash||rpcHash(receipt.transactionHash)!==attempt.transactionHash||typeof tx.from!=='string'||typeof tx.to!=='string'||receipt.from!==tx.from||receipt.to!==tx.to||rpcUint(tx.value)!==0n||rpcUint(tx.chainId)!==BigInt(p.chainId)||rpcHash(tx.blockHash)!==rpcHash(receipt.blockHash)||rpcUint(tx.blockNumber)!==rpcUint(receipt.blockNumber))throw new Error('BORROW_TRANSACTION_MISMATCH');
    const wrapped=tx.to===SUPPLY_METAMASK.manager;
    if(!wrapped&&(tx.from!==expected.from||tx.to!==expected.to||tx.input!==expected.data||rpcUint(tx.nonce)!==BigInt(attempt.nonce)))throw new Error('BORROW_TRANSACTION_MISMATCH');
    if(rpcUint(receipt.gasUsed)>rpcUint(tx.gas)||!wrapped&&(rpcUint(tx.gas)>BigInt(review.gasLimits[0]!)||rpcUint(receipt.effectiveGasPrice)>BigInt(review.gasPrice)||rpcUint(tx.maxFeePerGas??tx.gasPrice)>BigInt(review.gasPrice)))throw new Error('BORROW_GAS_MISMATCH');
    const block=Number(rpcUint(receipt.blockNumber));
    if(!Number.isSafeInteger(block)||block<attempt.preparedAtBlock)throw new Error('BORROW_BLOCK_MISMATCH');
    const canonical=rpcRecord(await rpc('eth_getBlockByNumber',[supplyHex(block),false]));
    if(rpcHash(canonical.hash)!==rpcHash(receipt.blockHash))throw new Error('BORROW_REORG');
    if(rpcUint(await rpc('eth_blockNumber',[]))<BigInt(block+2))return {...base,reason:'AWAITING_CONFIRMATIONS'};
    if(rpcUint(receipt.status)!==1n)return {...base,verdict:'DIVERGENT',reason:'BORROW_REVERTED'};
    if(wrapped)base.walletEnvelope=await verifySupplyWalletEnvelope(review,attempt,tx,receipt,rpc);
    if(!Array.isArray(receipt.logs))throw new Error('BORROW_LOGS_INVALID');
    const events=receipt.logs.filter(l=>{const log=rpcRecord(l);return log.address===p.pool&&Array.isArray(log.topics)&&log.topics[0]===supplyTopic('Borrow(address,address,address,uint256,uint8,uint256,uint16)');});
    if(events.length!==1)throw new Error('BORROW_EVENT_MISMATCH');
    const event=rpcRecord(events[0]);
    const data=typeof event.data==='string'?event.data.slice(2):'';
    if(data.length!==256||!logMatches(event,p.pool,[supplyTopic('Borrow(address,address,address,uint256,uint8,uint256,uint16)'),addressTopic(p.asset),addressTopic(review.beneficiary),'0x'+supplyWord(0n)],'0x'+supplyWord(review.account)+supplyWord(BigInt(review.amount))+supplyWord(2n)+data.slice(192)))throw new Error('BORROW_EVENT_MISMATCH');
    if(!receipt.logs.some(l=>logMatches(l,p.asset,[supplyTopic('Transfer(address,address,uint256)'),addressTopic(p.aToken),addressTopic(review.account)],'0x'+supplyWord(BigInt(review.amount)))))throw new Error('BORROW_TRANSFER_MISMATCH');
    const pre=await readBorrowState(rpc,review.account,review.beneficiary,supplyHex(block-1)),post=await readBorrowState(rpc,review.account,review.beneficiary,supplyHex(block));
    base.prePosition=pre;base.postPosition=post;
    if(pre.blockHash!==rpcHash(canonical.parentHash)||post.blockHash!==rpcHash(receipt.blockHash)||post.deploymentHash!==review.state.deploymentHash)throw new Error('BORROW_REORG');
    const final=rpcRecord(await rpc('eth_getBlockByNumber',[supplyHex(block),false]));
    if(rpcHash(final.hash)!==post.blockHash)throw new Error('BORROW_REORG');
    base.cost=(rpcUint(receipt.gasUsed)*rpcUint(receipt.effectiveGasPrice)+(receipt.l1Fee===undefined?0n:rpcUint(receipt.l1Fee))).toString();
    const effects=verifyBorrowEffects(review.amount,pre,post);
    return {...base,...effects,borrowEvent:event,verdict:'RECONCILED',reason:'BORROW_TRANSACTION_DEBT_BALANCE_AND_HEALTH_VERIFIED'};
  }catch(cause){const reason=cause instanceof Error?cause.message:'BORROW_OBSERVATION_FAILED';return {...base,reason,verdict:/MISMATCH|WRONG_CHAIN|REORG|INVALID|UNSUPPORTED/.test(reason)?'DIVERGENT':'INCONCLUSIVE'};}
}
export function buildBorrowEvidence(input:{id:string;review:SupplyReview;journal:ExecutionJournal;provenance:'PUBLIC_TESTNET'|'MOCKED';ownerInitiated:boolean;observations:SupplyObservation[]}):{bundle:EvidenceBundle;bundleHash:string;publicExecution:unknown;artifacts:unknown} {
  const o=input.observations.at(-1) as BorrowObservation|undefined,r=input.review;
  if(!r.borrow||!o||o.verdict!=='RECONCILED'||!o.prePosition?.borrow||!o.postPosition?.borrow||!o.transaction||!o.receipt||!o.borrowEvent||!input.ownerInitiated)throw new Error('BORROW_EVIDENCE_NOT_RECONCILED');
  const effects=verifyBorrowEffects(r.amount,o.prePosition,o.postPosition);
  const publicExecution={network:p.network,chainId:p.chainId,owner:r.account,pool:p.pool,borrowedAsset:p.asset,amount:r.amount,rateMode:2,beneficiary:r.beneficiary,variableDebtToken:p.variableDebtToken,
    borrowTransactionHash:o.receipt.transactionHash,transactionEnvelope:o.walletEnvelope??{kind:'DIRECT',sender:o.transaction.from,to:o.transaction.to,nonce:rpcUint(o.transaction.nonce).toString()},block:o.postPosition.block,gasUsed:rpcUint(o.receipt.gasUsed).toString(),transactionCost:o.cost,
    preWalletBalance:o.prePosition.balance,postWalletBalance:o.postPosition.balance,walletDelta:effects.walletDelta,preDebt:o.prePosition.borrow.debt,postDebt:o.postPosition.borrow.debt,debtDelta:effects.debtDelta,principalDebtDelta:effects.delta,
    preHealthFactor:effects.preHealthFactor,postHealthFactor:effects.postHealthFactor,prePosition:o.prePosition,postPosition:o.postPosition,borrowEvent:o.borrowEvent,reconciliationVerdict:o.verdict,explorer:p.explorer,officialSource:p.officialSource,provenance:input.provenance,ownerInitiated:input.ownerInitiated,observations:input.observations};
  const head=hashJournalBytes(new TextEncoder().encode(JSON.stringify(input.journal))).at(-1);if(!head)throw new Error('BORROW_JOURNAL_EMPTY');
  const asset={chainId:p.chain,address:p.asset,decimals:6};
  const bundle:EvidenceBundle={schemaVersion:'1.0.0',evidenceBundleId:input.id,version:1,supersedes:null,semanticWorkflowHash:r.manifest.semanticWorkflowHash,artifactSetHash:r.manifest.artifactSetHash,simulationHash:r.manifest.simulationHash,policyHash:r.manifest.policyHash,manifestHash:supplyArtifactHash('strategy-manifest',r.manifest),executionPlanHash:supplyArtifactHash('execution-plan',r.plan),journalHeadHash:head,observedAt:new Date().toISOString(),environment:input.provenance==='PUBLIC_TESTNET'?'TESTNET_EXECUTED':'MOCKED',outcome:'RECONCILED',receipts:[{receiptId:'borrow-receipt',contentHash:supplyHash(o.receipt)}],differences:[],reconciliation:{balances:[{asset,amount:o.postPosition.balance}],allowances:[],debt:[{asset,amount:o.postPosition.borrow.debt}],positions:[],fees:[],residualAssets:[],ownership:[{chainId:p.chain,address:r.beneficiary}],limitations:['Debt principal uses scaled variable debt and the post-block index with bounded ray rounding.','Historical block snapshots include every transaction in the block; inconsistent economic effects fail closed.']},evidence:[{evidenceId:'borrow-public-observations',kind:'EXTERNAL_REFERENCE',contentHash:supplyHash(publicExecution)}]};
  return {bundle,bundleHash:supplyArtifactHash('evidence-bundle',bundle),publicExecution,artifacts:{workflow:r.workflow,artifactSet:r.artifactSet,simulation:r.simulation,policy:r.policy,manifest:r.manifest,plan:r.plan,journal:input.journal,review:r}};
}
