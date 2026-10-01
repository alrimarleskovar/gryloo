// SPDX-License-Identifier: AGPL-3.0-only
import { AAVE_V3_BASE_SEPOLIA as profile, readSupplyState, rpcRecord, rpcHash, rpcUint, rpcHex, supplyHex, supplyCall, supplyTopic,
  supplyWord, supplyHash, supplyArtifactHash, type SupplyRpc, type SupplyReview, type SupplyTransaction, type SupplyState } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type EvidenceBundle, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
export type SupplyChainAttempt = { step:'APPROVAL'|'SUPPLY'; nonce:string; transaction:SupplyTransaction; transactionHash:string|null; preparedAtBlock:number };
export type SupplyObservation = { verdict:'RECONCILED'|'DIVERGENT'|'INCONCLUSIVE'; reason:string; transaction:Record<string,unknown>|null;
  receipt:Record<string,unknown>|null; prePosition:SupplyState|null; postPosition:SupplyState|null; delta:string|null; scaledDelta:string|null; cost:string|null };
function logMatches(log: unknown, address: string, topics: string[], data: string): boolean {
  const l=rpcRecord(log);
  return typeof l.address==='string' && l.address.toLowerCase()===address && Array.isArray(l.topics) &&
    JSON.stringify(l.topics.map(t => rpcHex(t)))===JSON.stringify(topics) && typeof l.data==='string' && l.data.toLowerCase()===data && l.removed!==true;
}
const addressTopic = (v:string) => '0x'+supplyWord(v);
export function verifySupplyPosition(amount: string, pre: Pick<SupplyState,'scaledPosition'|'position'|'index'>, post: Pick<SupplyState,'scaledPosition'|'position'|'index'>): { delta:string; scaledDelta:string } {
  const ray=10n**27n, index=BigInt(post.index), scaledDelta=BigInt(post.scaledPosition)-BigInt(pre.scaledPosition);
  const delta=(scaledDelta*index+ray/2n)/ray;
  const tolerance=(index+ray-1n)/ray+1n;
  const abs=(x:bigint)=>x<0n?-x:x;
  if (index<BigInt(pre.index)||scaledDelta<=0n||abs(delta-BigInt(amount))>tolerance ||
      abs(BigInt(post.position)-(BigInt(post.scaledPosition)*index+ray/2n)/ray)>1n ||
      abs(BigInt(pre.position)-(BigInt(pre.scaledPosition)*BigInt(pre.index)+ray/2n)/ray)>1n) throw new Error('SUPPLY_POSITION_MISMATCH');
  return {delta:delta.toString(),scaledDelta:scaledDelta.toString()};
}
/** Independent public transaction, receipt, event and historical-state reads. */
export async function reconcileSupplyAttempt(review: SupplyReview, attempt: SupplyChainAttempt, rpc: SupplyRpc): Promise<SupplyObservation> {
  const base: SupplyObservation = {verdict:'INCONCLUSIVE',reason:'TRANSACTION_NOT_OBSERVED',transaction:null,receipt:null,prePosition:null,postPosition:null,delta:null,scaledDelta:null,cost:null};
  if (!attempt.transactionHash) return base;
  try {
    if (rpcUint(await rpc('eth_chainId',[]))!==BigInt(profile.chainId)) throw new Error('SUPPLY_WRONG_CHAIN');
    const [txValue,receiptValue]=await Promise.all([rpc('eth_getTransactionByHash',[attempt.transactionHash]),rpc('eth_getTransactionReceipt',[attempt.transactionHash])]);
    if (!txValue || !receiptValue) return base;
    const transaction=rpcRecord(txValue), receipt=rpcRecord(receiptValue);
    base.transaction=transaction; base.receipt=receipt;
    const tx=attempt.transaction;
    if (rpcHash(transaction.hash)!==attempt.transactionHash || rpcHash(receipt.transactionHash)!==attempt.transactionHash ||
        typeof transaction.from!=='string'||transaction.from.toLowerCase()!==review.account || typeof transaction.to!=='string'||transaction.to.toLowerCase()!==tx.to ||
        typeof receipt.from!=='string'||receipt.from.toLowerCase()!==review.account || typeof receipt.to!=='string'||receipt.to.toLowerCase()!==tx.to ||
        typeof transaction.input!=='string'||transaction.input.toLowerCase()!==tx.data || rpcUint(transaction.value)!==0n ||
        rpcUint(transaction.chainId)!==BigInt(profile.chainId)||rpcUint(transaction.nonce)!==BigInt(attempt.nonce) ||
        rpcHash(transaction.blockHash)!==rpcHash(receipt.blockHash) || rpcUint(transaction.blockNumber)!==rpcUint(receipt.blockNumber)) throw new Error('SUPPLY_TRANSACTION_MISMATCH');
    const expected = attempt.step==='APPROVAL' ? supplyCall('approve(address,uint256)',profile.pool,BigInt(review.amount)) : supplyCall('supply(address,uint256,address,uint16)',profile.asset,BigInt(review.amount),review.beneficiary,0n);
    if (tx.to!==(attempt.step==='APPROVAL'?profile.asset:profile.pool)||tx.from!==review.account||tx.data!==expected || review.pool!==profile.pool||review.asset!==profile.asset||review.aToken!==profile.aToken||review.chain!==profile.chain) throw new Error('SUPPLY_TRANSACTION_MISMATCH');
    const gasIndex=attempt.step==='APPROVAL'?0:review.gasLimits.length-1;
    if(rpcUint(transaction.gas)>BigInt(review.gasLimits[gasIndex]!)||rpcUint(receipt.gasUsed)>rpcUint(transaction.gas)||
        rpcUint(receipt.effectiveGasPrice)>BigInt(review.gasPrice)||
        rpcUint(transaction.maxFeePerGas??transaction.gasPrice)>BigInt(review.gasPrice))throw new Error('SUPPLY_TRANSACTION_MISMATCH');
    const block=Number(rpcUint(receipt.blockNumber));
    if (!Number.isSafeInteger(block)||block<attempt.preparedAtBlock) throw new Error('SUPPLY_BLOCK_MISMATCH');
    const canonical=rpcRecord(await rpc('eth_getBlockByNumber',[supplyHex(block),false]));
    const latest=Number(rpcUint(await rpc('eth_blockNumber',[])));
    if (rpcHash(canonical.hash)!==rpcHash(receipt.blockHash)) throw new Error('SUPPLY_REORG');
    if (latest<block+2) return {...base,reason:'AWAITING_CONFIRMATIONS'};
    if (rpcUint(receipt.status)!==1n) return {...base,verdict:'DIVERGENT',reason:attempt.step==='APPROVAL'?'APPROVAL_REVERTED':'SUPPLY_REVERTED'};
    if (!Array.isArray(receipt.logs)) throw new Error('SUPPLY_LOGS_INVALID');
    base.cost=(rpcUint(receipt.gasUsed)*rpcUint(receipt.effectiveGasPrice)+(receipt.l1Fee===undefined?0n:rpcUint(receipt.l1Fee))).toString();
    const post=await readSupplyState(rpc,review.account,review.beneficiary,supplyHex(block));
    if(post.blockHash!==rpcHash(receipt.blockHash))throw new Error('SUPPLY_REORG');
    if (post.deploymentHash!==review.state.deploymentHash) throw new Error('SUPPLY_DEPLOYMENT_MISMATCH');
    base.postPosition=post;
    if (attempt.step==='APPROVAL') {
      if (!receipt.logs.some(l => logMatches(l,profile.asset,[supplyTopic('Approval(address,address,uint256)'),addressTopic(review.account),addressTopic(profile.pool)],'0x'+supplyWord(BigInt(review.amount)))) || BigInt(post.allowance)<BigInt(review.amount)) throw new Error('SUPPLY_APPROVAL_MISMATCH');
      return {...base,verdict:'RECONCILED',reason:'EXACT_APPROVAL_VERIFIED'};
    }
    if (!receipt.logs.some(l => logMatches(l,profile.pool,[supplyTopic('Supply(address,address,address,uint256,uint16)'),addressTopic(profile.asset),addressTopic(review.beneficiary),'0x'+supplyWord(0n)],'0x'+supplyWord(review.account)+supplyWord(BigInt(review.amount))))) throw new Error('SUPPLY_EVENT_MISMATCH');
    if (!receipt.logs.some(l => logMatches(l,profile.asset,[supplyTopic('Transfer(address,address,uint256)'),addressTopic(review.account),addressTopic(profile.aToken)],'0x'+supplyWord(BigInt(review.amount))))) throw new Error('SUPPLY_TRANSFER_MISMATCH');
    const pre=await readSupplyState(rpc,review.account,review.beneficiary,supplyHex(block-1));
    base.prePosition=pre;
    const finalBlock=rpcRecord(await rpc('eth_getBlockByNumber',[supplyHex(block),false]));
    if(rpcHash(finalBlock.hash)!==rpcHash(receipt.blockHash)||rpcHash(finalBlock.parentHash)!==pre.blockHash)throw new Error('SUPPLY_REORG');
    const delta=verifySupplyPosition(review.amount,pre,post);
    return {...base,...delta,verdict:'RECONCILED',reason:'SUPPLY_TRANSACTION_AND_POSITION_VERIFIED'};
  } catch(cause) {
    const message=cause instanceof Error?cause.message:'SUPPLY_OBSERVATION_FAILED';
    // Provider failures and unavailable archival state remain ambiguous; mismatches never reconcile.
    const divergent=/MISMATCH|WRONG_CHAIN|REORG|LOGS_INVALID/.test(message);
    return {...base,verdict:divergent?'DIVERGENT':'INCONCLUSIVE',reason:message};
  }
}
export function buildSupplyEvidence(input:{id:string;review:SupplyReview;journal:ExecutionJournal;provenance:'PUBLIC_TESTNET'|'MOCKED';ownerInitiated:boolean;observations:SupplyObservation[]}): {bundle:EvidenceBundle;bundleHash:string;publicExecution:unknown;artifacts:unknown} {
  const supply=input.observations.at(-1), approval=input.review.approvalRequired?input.observations[0]:null;
  if (!supply||supply.verdict!=='RECONCILED'||!supply.prePosition||!supply.postPosition||!supply.receipt||!supply.transaction||
      (input.review.approvalRequired&&approval?.verdict!=='RECONCILED') || !input.ownerInitiated) throw new Error('SUPPLY_EVIDENCE_NOT_RECONCILED');
  const publicExecution={network:profile.network,chainId:profile.chainId,explorer:profile.explorer,officialSource:profile.officialSource,
    account:input.review.account,beneficiary:input.review.beneficiary,pool:profile.pool,token:profile.asset,aToken:profile.aToken,amount:input.review.amount,
    approvalTransactionHash:approval?.receipt?.transactionHash??null,supplyTransactionHash:supply.receipt.transactionHash,
    blockNumber:supply.postPosition.block,gasUsed:rpcUint(supply.receipt.gasUsed).toString(),transactionCost:supply.cost,
    prePosition:supply.prePosition,postPosition:supply.postPosition,reconciledDelta:supply.delta,scaledDelta:supply.scaledDelta,verdict:supply.verdict,
    observations:input.observations,provenance:input.provenance,ownerInitiated:input.ownerInitiated};
  const head=hashJournalBytes(new TextEncoder().encode(JSON.stringify(input.journal))).at(-1);
  if (!head) throw new Error('SUPPLY_JOURNAL_EMPTY');
  const review=input.review;
  const bundle:EvidenceBundle={schemaVersion:'1.0.0',evidenceBundleId:input.id,version:1,supersedes:null,
    semanticWorkflowHash:review.manifest.semanticWorkflowHash,artifactSetHash:review.manifest.artifactSetHash,simulationHash:review.manifest.simulationHash,
    policyHash:review.manifest.policyHash,manifestHash:supplyArtifactHash('strategy-manifest',review.manifest),executionPlanHash:supplyArtifactHash('execution-plan',review.plan),
    journalHeadHash:head,observedAt:new Date().toISOString(),environment:input.provenance==='PUBLIC_TESTNET'?'TESTNET_EXECUTED':'MOCKED',outcome:'RECONCILED',
    receipts:input.observations.map((o,i)=>({receiptId:`supply-receipt-${i}`,contentHash:supplyHash(o.receipt)})),differences:[],
    reconciliation:{balances:[{asset:{chainId:profile.chain,address:profile.asset,decimals:6},amount:supply.postPosition.balance}],
      allowances:[{asset:{chainId:profile.chain,address:profile.asset,decimals:6},amount:supply.postPosition.allowance}],debt:[],
      positions:[{asset:{chainId:profile.chain,address:profile.aToken,decimals:6},amount:supply.postPosition.position}],fees:[],residualAssets:[],
      ownership:[{chainId:profile.chain,address:review.beneficiary}],limitations:['Position delta uses scaled balances and the post-block liquidity index, with bounded ray rounding.','Block snapshots include all transactions in the block; inconsistent position effects fail closed.']},
    evidence:[{evidenceId:'supply-public-observations',kind:'EXTERNAL_REFERENCE',contentHash:supplyHash(publicExecution)}]};
  return {bundle,bundleHash:supplyArtifactHash('evidence-bundle',bundle),publicExecution,
    artifacts:{workflow:review.workflow,artifactSet:review.artifactSet,simulation:review.simulation,policy:review.policy,manifest:review.manifest,plan:review.plan,journal:input.journal,review}};
}
