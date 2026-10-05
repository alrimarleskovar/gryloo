// SPDX-License-Identifier: AGPL-3.0-only
import { reconcileWithdrawAttempt,buildWithdrawEvidence } from './withdraw.js';
import { reconcileRepayAttempt, buildRepayEvidence } from './repay.js';
import { reconcileBorrowAttempt, buildBorrowEvidence } from './borrow.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { lendingProfile, readSupplyState, rpcRecord, rpcHash, rpcUint, rpcHex, supplyHex, supplyCall, supplyTopic,
  SUPPLY_METAMASK, decodeSupplyWalletEnvelope, supplySelector, rlpEncode, rlpInteger, fromHex, toHex, type SupplyWalletEnvelope, supplyWord, supplyHash, supplyArtifactHash, type SupplyRpc, type SupplyReview, type SupplyTransaction, type SupplyState } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type EvidenceBundle, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
export type SupplyChainAttempt = { step:'APPROVAL'|'SUPPLY'|'BORROW'|'REPAY'|'WITHDRAW'; nonce:string; transaction:SupplyTransaction; transactionHash:string|null; preparedAtBlock:number };
export type SupplyObservation = { verdict:'RECONCILED'|'DIVERGENT'|'INCONCLUSIVE'; reason:string; transaction:Record<string,unknown>|null;
  receipt:Record<string,unknown>|null; prePosition:SupplyState|null; postPosition:SupplyState|null; delta:string|null; scaledDelta:string|null; cost:string|null; walletEnvelope?:SupplyWalletProof };
export function logMatches(log: unknown, address: string, topics: string[], data: string): boolean {
  const l=rpcRecord(log);
  return typeof l.address==='string' && l.address.toLowerCase()===address && Array.isArray(l.topics) &&
    JSON.stringify(l.topics.map(t => rpcHex(t)))===JSON.stringify(topics) && typeof l.data==='string' && l.data.toLowerCase()===data && l.removed!==true;
}
export const addressTopic = (v:string) => '0x'+supplyWord(v);
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

export type SupplyWalletProof={kind:'METAMASK_EIP7702';owner:string;outerSender:string;outerDestination:string;relayNonce:string;
  ownerAuthorizationNonce:string|null;ownerNonceBefore:string;ownerNonceAfter:string;implementation:string;delegationHash:string;signingDigest:string;
  authorization:unknown;delegation:SupplyWalletEnvelope;codeHashes:string[];callCountBefore:string;callCountAfter:string;feePayer:string;ownerNativeCost:'0'};
const hashHex=(hex:string)=>toHex(keccak_256(fromHex(hex)));
/** EIP-712 digest the owner signs for the delegation, bound to the reviewed chain id. */
export function supplyWalletDelegationDigest(e:SupplyWalletEnvelope,chainId:number|bigint):{domain:string;delegationHash:string;digest:string} {
  const caveatHashes=e.caveats.map(c=>hashHex(supplyTopic('Caveat(address enforcer,bytes terms)')+supplyWord(c.enforcer)+hashHex(c.terms).slice(2)));
  const delegationHash=hashHex(supplyTopic('Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)')+supplyWord(e.delegate)+supplyWord(e.owner)+'f'.repeat(64)+hashHex('0x'+caveatHashes.map(h=>h.slice(2)).join('')).slice(2)+supplyWord(BigInt(e.salt)));
  const domain=hashHex(supplyTopic('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')+supplyTopic('DelegationManager').slice(2)+supplyTopic('1').slice(2)+supplyWord(BigInt(chainId))+supplyWord(SUPPLY_METAMASK.manager));
  return {domain,delegationHash,digest:hashHex('0x1901'+domain.slice(2)+delegationHash.slice(2))};
}
function signatureOwner(digest:string,signature:string):string {
  try{const bytes=fromHex(signature);if(bytes.length!==65||![27,28].includes(bytes[64]!))throw new Error();
    const sig=secp256k1.Signature.fromBytes(bytes.slice(0,64)).addRecoveryBit(bytes[64]!-27),pub=sig.recoverPublicKey(fromHex(digest)).toBytes(false);
    if(!secp256k1.verify(sig.toBytes('compact'),fromHex(digest),pub,{prehash:false}))throw new Error();
    return toHex(keccak_256(pub.slice(1)).slice(12));
  }catch{throw new Error('SUPPLY_OWNER_AUTHORIZATION_MISMATCH');}
}
export async function verifySupplyWalletEnvelope(review:Pick<SupplyReview,'account'>,attempt:Pick<SupplyChainAttempt,'transaction'|'nonce'>,transaction:Record<string,unknown>,receipt:Record<string,unknown>,rpc:SupplyRpc):Promise<SupplyWalletProof> {
  // The reviewed transaction's own chain binds the delegation domain and any EIP-7702 authorization.
  const chainId=rpcUint(attempt.transaction.chainId);
  const e=decodeSupplyWalletEnvelope(transaction.input),m=SUPPLY_METAMASK,block=rpcUint(receipt.blockNumber),tag=supplyHex(block),preTag=supplyHex(block-1n);
  if(transaction.to!==m.manager||e.owner!==review.account||e.call.to!==attempt.transaction.to||e.call.data!==attempt.transaction.data||e.call.value!=='0'||transaction.from===review.account)throw new Error('SUPPLY_ENVELOPE_MISMATCH');
  const hashes=await Promise.all([m.manager,m.implementation,m.limited,m.exact].map(async address=>hashHex(rpcHex(await rpc('eth_getCode',[address,tag])))));
  if(JSON.stringify(hashes)!==JSON.stringify(m.codeHashes))throw new Error('SUPPLY_WALLET_CODE_MISMATCH');
  const {domain,delegationHash,digest}=supplyWalletDelegationDigest(e,chainId);
  if(signatureOwner(digest,e.signature)!==review.account)throw new Error('SUPPLY_OWNER_AUTHORIZATION_MISMATCH');
  const call=async(to:string,data:string,at=tag)=>rpcHex(await rpc('eth_call',[{to,data},at]));
  if(await call(m.manager,supplyCall('getDomainHash()'))!==domain||rpcUint(await call(m.implementation,supplyCall('delegationManager()')))!==BigInt(m.manager))throw new Error('SUPPLY_OWNER_AUTHORIZATION_MISMATCH');
  const [preCode,postCode,preNonce,postNonce,preNative,postNative]=await Promise.all([
    rpc('eth_getCode',[review.account,preTag]),rpc('eth_getCode',[review.account,tag]),rpc('eth_getTransactionCount',[review.account,preTag]),rpc('eth_getTransactionCount',[review.account,tag]),rpc('eth_getBalance',[review.account,preTag]),rpc('eth_getBalance',[review.account,tag])]);
  const pointer='0xef0100'+m.implementation.slice(2);if(postCode!==pointer||rpcUint(preNonce)!==BigInt(attempt.nonce)||rpcUint(postNative)<rpcUint(preNative))throw new Error('SUPPLY_OWNER_AUTHORIZATION_MISMATCH');
  let ownerAuthorizationNonce:string|null=null;
  const authorizations=transaction.authorizationList??[];if(!Array.isArray(authorizations)||authorizations.length>1)throw new Error('SUPPLY_OWNER_AUTHORIZATION_MISMATCH');
  if(authorizations.length){const a=rpcRecord(authorizations[0]);
    if(rpcUint(transaction.type)!==4n||rpcUint(a.chainId)!==chainId||a.address!==m.implementation||rpcUint(a.nonce)!==rpcUint(preNonce)||rpcUint(postNonce)!==rpcUint(preNonce)+1n||rpcUint(a.yParity)>1n)throw new Error('SUPPLY_OWNER_AUTHORIZATION_MISMATCH');
    const authDigest=hashHex('0x05'+toHex(rlpEncode([rlpInteger(chainId),fromHex(m.implementation),rlpInteger(rpcUint(a.nonce))])).slice(2));
    const sig='0x'+supplyWord(rpcUint(a.r))+supplyWord(rpcUint(a.s))+(27+Number(rpcUint(a.yParity))).toString(16);
    if(signatureOwner(authDigest,sig)!==review.account)throw new Error('SUPPLY_OWNER_AUTHORIZATION_MISMATCH');ownerAuthorizationNonce=rpcUint(a.nonce).toString();
  }else if(preCode!==pointer||rpcUint(postNonce)!==rpcUint(preNonce))throw new Error('SUPPLY_OWNER_AUTHORIZATION_MISMATCH');
  const countData=supplySelector('callCounts(address,bytes32)')+supplyWord(m.manager)+delegationHash.slice(2);
  const before=rpcUint(await call(m.limited,countData,preTag)),after=rpcUint(await call(m.limited,countData));
  if(before!==0n||after!==1n)throw new Error('SUPPLY_OWNER_AUTHORIZATION_MISMATCH');
  if(!Array.isArray(receipt.logs))throw new Error('SUPPLY_LOGS_INVALID');
  const redemptionData='0x'+supplyWord(32n)+e.delegationTuple.slice(2);
  const redeemer=String(transaction.from).toLowerCase();
  const redemptions=receipt.logs.filter(l=>rpcRecord(l).address===m.manager&&Array.isArray(rpcRecord(l).topics)&&(rpcRecord(l).topics as unknown[])[0]===supplyTopic('RedeemedDelegation(address,address,(address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))'));
  if(redemptions.length!==1||!logMatches(redemptions[0],m.manager,[supplyTopic('RedeemedDelegation(address,address,(address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))'),addressTopic(review.account),addressTopic(redeemer)],redemptionData)||
    !receipt.logs.some(l=>logMatches(l,m.limited,[supplyTopic('IncreasedCount(address,address,bytes32,uint256,uint256)'),addressTopic(m.manager),addressTopic(redeemer),delegationHash],'0x'+supplyWord(1n)+supplyWord(1n))))throw new Error('SUPPLY_OWNER_AUTHORIZATION_MISMATCH');
  return {kind:'METAMASK_EIP7702',owner:review.account,outerSender:redeemer,outerDestination:m.manager,relayNonce:rpcUint(transaction.nonce).toString(),ownerAuthorizationNonce,ownerNonceBefore:rpcUint(preNonce).toString(),ownerNonceAfter:rpcUint(postNonce).toString(),implementation:m.implementation,delegationHash,signingDigest:digest,authorization:authorizations[0]??null,delegation:e,codeHashes:hashes,callCountBefore:before.toString(),callCountAfter:after.toString(),feePayer:redeemer,ownerNativeCost:'0'};
}
/** Independent public transaction, receipt, event and historical-state reads. */
export async function reconcileSupplyAttempt(review: SupplyReview, attempt: SupplyChainAttempt, rpc: SupplyRpc): Promise<SupplyObservation> {
  if(review.withdraw) return reconcileWithdrawAttempt(review,attempt,rpc);
  if(review.repay) return reconcileRepayAttempt(review,attempt,rpc);
  if(review.borrow) return reconcileBorrowAttempt(review,attempt,rpc);
  const base: SupplyObservation = {verdict:'INCONCLUSIVE',reason:'TRANSACTION_NOT_OBSERVED',transaction:null,receipt:null,prePosition:null,postPosition:null,delta:null,scaledDelta:null,cost:null};
  if (!attempt.transactionHash) return base;
  try {
    // The reviewed chain selects the deployment; the RPC and the reviewed transaction must both be on it.
    const profile=lendingProfile(review.chain,'SUPPLY_WRONG_CHAIN');
    if (rpcUint(await rpc('eth_chainId',[]))!==BigInt(profile.chainId)||attempt.transaction.chainId!==profile.chainHex) throw new Error('SUPPLY_WRONG_CHAIN');
    const [txValue,receiptValue]=await Promise.all([rpc('eth_getTransactionByHash',[attempt.transactionHash]),rpc('eth_getTransactionReceipt',[attempt.transactionHash])]);
    if (!txValue || !receiptValue) return base;
    const transaction=rpcRecord(txValue), receipt=rpcRecord(receiptValue);
    base.transaction=transaction; base.receipt=receipt;
    const tx=attempt.transaction;
    if (rpcHash(transaction.hash)!==attempt.transactionHash || rpcHash(receipt.transactionHash)!==attempt.transactionHash ||
        typeof transaction.from!=='string'||typeof transaction.to!=='string'||receipt.from!==transaction.from||receipt.to!==transaction.to||
        typeof transaction.input!=='string'||rpcUint(transaction.value)!==0n||rpcUint(transaction.chainId)!==BigInt(profile.chainId)||
        rpcHash(transaction.blockHash)!==rpcHash(receipt.blockHash)||rpcUint(transaction.blockNumber)!==rpcUint(receipt.blockNumber))throw new Error('SUPPLY_TRANSACTION_MISMATCH');
    const expected = attempt.step==='APPROVAL' ? supplyCall('approve(address,uint256)',profile.pool,BigInt(review.amount)) : supplyCall('supply(address,uint256,address,uint16)',profile.asset,BigInt(review.amount),review.beneficiary,0n);
    if (tx.to!==(attempt.step==='APPROVAL'?profile.asset:profile.pool)||tx.from!==review.account||tx.data!==expected || review.pool!==profile.pool||review.asset!==profile.asset||review.aToken!==profile.aToken||review.chain!==profile.chain) throw new Error('SUPPLY_TRANSACTION_MISMATCH');
    const wrapped=transaction.to===SUPPLY_METAMASK.manager;
    if(!wrapped&&(transaction.from!==review.account||transaction.to!==tx.to||transaction.input!==tx.data||rpcUint(transaction.nonce)!==BigInt(attempt.nonce)))throw new Error('SUPPLY_TRANSACTION_MISMATCH');
    const gasIndex=attempt.step==='APPROVAL'?0:review.gasLimits.length-1;
    if(rpcUint(receipt.gasUsed)>rpcUint(transaction.gas)||!wrapped&&(rpcUint(transaction.gas)>BigInt(review.gasLimits[gasIndex]!)||rpcUint(receipt.effectiveGasPrice)>BigInt(review.gasPrice)||rpcUint(transaction.maxFeePerGas??transaction.gasPrice)>BigInt(review.gasPrice)))throw new Error('SUPPLY_TRANSACTION_MISMATCH');
    const block=Number(rpcUint(receipt.blockNumber));
    if (!Number.isSafeInteger(block)||block<attempt.preparedAtBlock) throw new Error('SUPPLY_BLOCK_MISMATCH');
    const canonical=rpcRecord(await rpc('eth_getBlockByNumber',[supplyHex(block),false]));
    const latest=Number(rpcUint(await rpc('eth_blockNumber',[])));
    if (rpcHash(canonical.hash)!==rpcHash(receipt.blockHash)) throw new Error('SUPPLY_REORG');
    if (latest<block+2) return {...base,reason:'AWAITING_CONFIRMATIONS'};
    if (rpcUint(receipt.status)!==1n) return {...base,verdict:'DIVERGENT',reason:attempt.step==='APPROVAL'?'APPROVAL_REVERTED':'SUPPLY_REVERTED'};
    if(wrapped)base.walletEnvelope=await verifySupplyWalletEnvelope(review,attempt,transaction,receipt,rpc);
    if (!Array.isArray(receipt.logs)) throw new Error('SUPPLY_LOGS_INVALID');
    base.cost=(rpcUint(receipt.gasUsed)*rpcUint(receipt.effectiveGasPrice)+(receipt.l1Fee===undefined?0n:rpcUint(receipt.l1Fee))).toString();
    const post=await readSupplyState(rpc,profile,review.account,review.beneficiary,supplyHex(block));
    if(post.blockHash!==rpcHash(receipt.blockHash))throw new Error('SUPPLY_REORG');
    if (post.deploymentHash!==review.state.deploymentHash) throw new Error('SUPPLY_DEPLOYMENT_MISMATCH');
    base.postPosition=post;
    if (attempt.step==='APPROVAL') {
      if (!receipt.logs.some(l => logMatches(l,profile.asset,[supplyTopic('Approval(address,address,uint256)'),addressTopic(review.account),addressTopic(profile.pool)],'0x'+supplyWord(BigInt(review.amount)))) || BigInt(post.allowance)!==BigInt(review.amount)) throw new Error('SUPPLY_APPROVAL_MISMATCH');
      return {...base,verdict:'RECONCILED',reason:'EXACT_APPROVAL_VERIFIED'};
    }
    if (!receipt.logs.some(l => logMatches(l,profile.pool,[supplyTopic('Supply(address,address,address,uint256,uint16)'),addressTopic(profile.asset),addressTopic(review.beneficiary),'0x'+supplyWord(0n)],'0x'+supplyWord(review.account)+supplyWord(BigInt(review.amount))))) throw new Error('SUPPLY_EVENT_MISMATCH');
    if (!receipt.logs.some(l => logMatches(l,profile.asset,[supplyTopic('Transfer(address,address,uint256)'),addressTopic(review.account),addressTopic(profile.aToken)],'0x'+supplyWord(BigInt(review.amount))))) throw new Error('SUPPLY_TRANSFER_MISMATCH');
    const pre=await readSupplyState(rpc,profile,review.account,review.beneficiary,supplyHex(block-1));
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
export function buildSupplyEvidence(input:{id:string;review:SupplyReview;journal:ExecutionJournal;provenance:'PUBLIC_TESTNET'|'MOCKED';ownerInitiated:boolean;observations:SupplyObservation[];approval?:SupplyObservation}): {bundle:EvidenceBundle;bundleHash:string;publicExecution:unknown;artifacts:unknown} {
  if(input.review.withdraw) return buildWithdrawEvidence(input);
  if(input.review.repay) return buildRepayEvidence(input);
  if(input.review.borrow) return buildBorrowEvidence(input);
  const supply=input.observations.at(-1), approval=input.approval??(input.review.approvalRequired?input.observations.find(o=>o.verdict==='RECONCILED'):null);
  if (!supply||supply.verdict!=='RECONCILED'||!supply.prePosition||!supply.postPosition||!supply.receipt||!supply.transaction||
      (input.review.approvalRequired&&approval?.verdict!=='RECONCILED') || !input.ownerInitiated) throw new Error('SUPPLY_EVIDENCE_NOT_RECONCILED');
  const profile=lendingProfile(input.review.chain,'SUPPLY_EVIDENCE_NOT_RECONCILED');
  const publicExecution={network:profile.network,chainId:profile.chainId,explorer:profile.explorer,officialSource:profile.officialSource,
    account:input.review.account,beneficiary:input.review.beneficiary,pool:profile.pool,token:profile.asset,aToken:profile.aToken,amount:input.review.amount,
    approvalTransactionHash:approval?.receipt?.transactionHash??null,approvalNonce:approval?.walletEnvelope?.relayNonce??(approval?.transaction?rpcUint(approval.transaction.nonce).toString():null),approvalBlock:approval?.receipt?Number(rpcUint(approval.receipt.blockNumber)):null,approvalEnvelope:approval?.walletEnvelope??null,supplyNonce:supply.walletEnvelope?.relayNonce??rpcUint(supply.transaction.nonce).toString(),supplyEnvelope:supply.walletEnvelope??null,supplyTransactionHash:supply.receipt.transactionHash,
    blockNumber:supply.postPosition.block,gasUsed:rpcUint(supply.receipt.gasUsed).toString(),transactionCost:supply.cost,
    prePosition:supply.prePosition,postPosition:supply.postPosition,reconciledDelta:supply.delta,scaledDelta:supply.scaledDelta,verdict:supply.verdict,
    observations:approval&&!input.observations.includes(approval)?[approval,...input.observations]:input.observations,provenance:input.provenance,ownerInitiated:input.ownerInitiated};
  const head=hashJournalBytes(new TextEncoder().encode(JSON.stringify(input.journal))).at(-1);
  if (!head) throw new Error('SUPPLY_JOURNAL_EMPTY');
  const review=input.review;
  const bundle:EvidenceBundle={schemaVersion:'1.0.0',evidenceBundleId:input.id,version:1,supersedes:null,
    semanticWorkflowHash:review.manifest.semanticWorkflowHash,artifactSetHash:review.manifest.artifactSetHash,simulationHash:review.manifest.simulationHash,
    policyHash:review.manifest.policyHash,manifestHash:supplyArtifactHash('strategy-manifest',review.manifest),executionPlanHash:supplyArtifactHash('execution-plan',review.plan),
    journalHeadHash:head,observedAt:new Date().toISOString(),environment:input.provenance==='PUBLIC_TESTNET'?'TESTNET_EXECUTED':'MOCKED',outcome:'RECONCILED',
    receipts:(approval&&!input.observations.includes(approval)?[approval,...input.observations]:input.observations).map((o,i)=>({receiptId:`supply-receipt-${i}`,contentHash:supplyHash(o.receipt)})),differences:[],
    reconciliation:{balances:[{asset:{chainId:profile.chain,address:profile.asset,decimals:profile.decimals},amount:supply.postPosition.balance}],
      allowances:[{asset:{chainId:profile.chain,address:profile.asset,decimals:profile.decimals},amount:supply.postPosition.allowance}],debt:[],
      positions:[{asset:{chainId:profile.chain,address:profile.aToken,decimals:profile.decimals},amount:supply.postPosition.position}],fees:[],residualAssets:[],
      ownership:[{chainId:profile.chain,address:review.beneficiary}],limitations:['Position delta uses scaled balances and the post-block liquidity index, with bounded ray rounding.','Block snapshots include all transactions in the block; inconsistent position effects fail closed.']},
    evidence:[{evidenceId:'supply-public-observations',kind:'EXTERNAL_REFERENCE',contentHash:supplyHash(publicExecution)}]};
  return {bundle,bundleHash:supplyArtifactHash('evidence-bundle',bundle),publicExecution,
    artifacts:{workflow:review.workflow,artifactSet:review.artifactSet,simulation:review.simulation,policy:review.policy,manifest:review.manifest,plan:review.plan,journal:input.journal,review}};
}
