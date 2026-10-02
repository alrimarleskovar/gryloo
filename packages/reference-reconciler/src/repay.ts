// SPDX-License-Identifier: AGPL-3.0-only
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { AAVE_V3_BASE_SEPOLIA as p, readBorrowState, compileRepayCalls, borrowHealthFactor, supplyHex, supplyWord,
  supplyTopic, supplyHash, supplyArtifactHash, rpcUint, rpcRecord, rpcHash, rpcHex, SUPPLY_METAMASK,
  rlpEncode, rlpInteger, fromHex, toHex, type RlpValue, type SupplyReview, type SupplyState, type SupplyRpc } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type EvidenceBundle, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
import { verifySupplyWalletEnvelope, logMatches, addressTopic, type SupplyChainAttempt, type SupplyObservation } from './supply.js';
const ray=10n**27n,abs=(v:bigint)=>v<0n?-v:v;
export type RepayOwnerProof={kind:'DIRECT_EIP1559';owner:string;signingDigest:string;wireTransactionHash:string};
export type RepayObservation=SupplyObservation & {ownerAuthorization?:RepayOwnerProof;walletDelta?:string;debtDelta?:string;normalizedRepayment?:string;roundingBound?:string;repayEvent?:unknown};
/** Reconstruct the canonical signed wire transaction and recover its actual owner. */
export function verifyRepayOwnerSignature(tx:Record<string,unknown>,owner:string):RepayOwnerProof {
  if(rpcUint(tx.type)!==2n||rpcUint(tx.chainId)!==BigInt(p.chainId)||!Array.isArray(tx.accessList))throw new Error('REPAY_SIGNATURE_PROFILE_UNSUPPORTED');
  const access:RlpValue[]=tx.accessList.map(value=>{const item=rpcRecord(value);if(!Array.isArray(item.storageKeys)||rpcHex(item.address).length!==42)throw new Error('REPAY_SIGNATURE_INVALID');return [fromHex(rpcHex(item.address)),item.storageKeys.map(key=>fromHex(rpcHash(key)))];});
  const body:RlpValue[]=[rlpInteger(rpcUint(tx.chainId)),rlpInteger(rpcUint(tx.nonce)),rlpInteger(rpcUint(tx.maxPriorityFeePerGas)),rlpInteger(rpcUint(tx.maxFeePerGas)),rlpInteger(rpcUint(tx.gas)),fromHex(rpcHex(tx.to)),rlpInteger(rpcUint(tx.value)),fromHex(rpcHex(tx.input)),access];
  const digest=keccak_256(fromHex('0x02'+toHex(rlpEncode(body)).slice(2))),parity=rpcUint(tx.yParity??tx.v);
  if(parity>1n)throw new Error('REPAY_SIGNATURE_INVALID');
  const bytes=fromHex('0x'+supplyWord(rpcUint(tx.r))+supplyWord(rpcUint(tx.s)));
  const signature=secp256k1.Signature.fromBytes(bytes).addRecoveryBit(Number(parity));
  const pub=signature.recoverPublicKey(digest).toBytes(false),recovered=toHex(keccak_256(pub.slice(1)).slice(12));
  const hash=toHex(keccak_256(fromHex('0x02'+toHex(rlpEncode([...body,rlpInteger(parity),rlpInteger(rpcUint(tx.r)),rlpInteger(rpcUint(tx.s))])).slice(2))));
  if(recovered!==owner||tx.from!==owner||hash!==rpcHash(tx.hash)||!secp256k1.verify(bytes,digest,pub,{prehash:false}))throw new Error('REPAY_OWNER_AUTHORIZATION_MISMATCH');
  return {kind:'DIRECT_EIP1559',owner,signingDigest:toHex(digest),wireTransactionHash:hash};
}
export function verifyRepayEffects(amount:string,pre:SupplyState,post:SupplyState):{walletDelta:string;debtDelta:string;normalizedRepayment:string;roundingBound:string;delta:string;scaledDelta:string} {
  const a=pre.borrow,b=post.borrow,n=BigInt(amount);
  if(!a||!b)throw new Error('REPAY_POSITION_MISMATCH');
  const walletDelta=BigInt(post.balance)-BigInt(pre.balance),debtDelta=BigInt(b.debt)-BigInt(a.debt),burn=BigInt(a.scaledDebt)-BigInt(b.scaledDebt),index=BigInt(b.debtIndex);
  if(walletDelta!==-n)throw new Error('REPAY_WALLET_BALANCE_MISMATCH');
  // Principal comes from the scaled burn at the independently read execution index.
  // Nominal debt includes interest between observations and is never simple subtraction.
  const normalized=(burn*index+ray/2n)/ray,bound=(index+ray-1n)/ray+1n;
  const floor=n*ray/index,nearest=(n*ray+index/2n)/index;
  if(burn!==floor&&burn!==nearest)throw new Error('REPAY_DEBT_ROUNDING_MISMATCH');
  if(index<BigInt(a.debtIndex)||index<ray||burn<=0n||debtDelta>=0n||BigInt(b.debt)<=0n||abs(normalized-n)>bound||
    abs(BigInt(a.debt)-(BigInt(a.scaledDebt)*BigInt(a.debtIndex)+ray/2n)/ray)>1n||abs(BigInt(b.debt)-(BigInt(b.scaledDebt)*index+ray/2n)/ray)>1n)throw new Error('REPAY_DEBT_INDEX_MISMATCH');
  if(pre.scaledPosition!==post.scaledPosition||a.userConfiguration!==b.userConfiguration||a.reserveConfiguration!==b.reserveConfiguration||a.ltvBps!==b.ltvBps||a.liquidationThresholdBps!==b.liquidationThresholdBps||a.eMode!==b.eMode||a.codeHash!==b.codeHash||a.variableDebtToken!==b.variableDebtToken)throw new Error('REPAY_COLLATERAL_MISMATCH');
  if(abs(BigInt(b.price)-BigInt(a.price))>BigInt(a.price)/1000n||abs(BigInt(b.collateralBase)-BigInt(a.collateralBase))>BigInt(a.collateralBase)/1000n+2n)throw new Error('REPAY_COLLATERAL_MISMATCH');
  const allowance=BigInt(pre.allowance),expectedAllowance=allowance===(1n<<256n)-1n?allowance:allowance-n;
  if(allowance<n||BigInt(post.allowance)!==expectedAllowance)throw new Error('REPAY_ALLOWANCE_MISMATCH');
  if(abs(BigInt(b.debtBase)-BigInt(b.debt)*BigInt(b.price)/1000000n)>2n||BigInt(b.debtBase)>=BigInt(a.debtBase))throw new Error('REPAY_ACCOUNT_DEBT_MISMATCH');
  const health=BigInt(borrowHealthFactor(b.collateralBase,b.liquidationThresholdBps,b.debtBase));
  if(BigInt(b.healthFactor)<=BigInt(a.healthFactor)||abs(BigInt(b.healthFactor)-health)>health/1000000n+1n)throw new Error('REPAY_HEALTH_FACTOR_MISMATCH');
  return {walletDelta:walletDelta.toString(),debtDelta:debtDelta.toString(),normalizedRepayment:normalized.toString(),roundingBound:bound.toString(),delta:normalized.toString(),scaledDelta:burn.toString()};
}
function assertOwnerTransfers(logs:unknown[],owner:string,amount:string,approval:boolean):void {
  const topic=addressTopic(owner),transfer=supplyTopic('Transfer(address,address,uint256)');
  const movements=logs.filter(value=>{const l=rpcRecord(value);return Array.isArray(l.topics)&&l.topics[0]===transfer&&(l.topics[1]===topic||l.topics[2]===topic)&&l.address!==p.variableDebtToken;});
  if(approval?movements.length!==0:movements.length!==1||!logMatches(movements[0],p.asset,[transfer,topic,addressTopic(p.aToken)],'0x'+supplyWord(BigInt(amount))))throw new Error('REPAY_UNEXPECTED_ASSET_MOVEMENT_MISMATCH');
}
export async function reconcileRepayAttempt(review:SupplyReview,attempt:SupplyChainAttempt,rpc:SupplyRpc):Promise<RepayObservation> {
  const base:RepayObservation={verdict:'INCONCLUSIVE',reason:'TRANSACTION_NOT_OBSERVED',transaction:null,receipt:null,prePosition:null,postPosition:null,delta:null,scaledDelta:null,cost:null};
  if(!attempt.transactionHash)return base;
  try{
    if(rpcUint(await rpc('eth_chainId',[]))!==BigInt(p.chainId))throw new Error('REPAY_WRONG_CHAIN');
    const [txValue,receiptValue]=await Promise.all([rpc('eth_getTransactionByHash',[attempt.transactionHash]),rpc('eth_getTransactionReceipt',[attempt.transactionHash])]);
    if(!txValue||!receiptValue)return base;
    const tx=rpcRecord(txValue),receipt=rpcRecord(receiptValue);base.transaction=tx;base.receipt=receipt;
    const approval=attempt.step==='APPROVAL',calls=compileRepayCalls(review.workflow,review.account,review.allowance),expected=approval?calls[0]!:calls.at(-1)!;
    // Compare exact canonical fields, independent of serialized property order.
    const transactionFields=['from','to','value','chainId','data'] as const;
    const sameTransaction=Object.keys(attempt.transaction).length===transactionFields.length&&transactionFields.every(field=>Object.hasOwn(attempt.transaction,field)&&expected[field]===attempt.transaction[field]);
    if(!review.repay||review.borrow||!['APPROVAL','REPAY'].includes(attempt.step)||approval&&!review.approvalRequired||review.repay.interestRateMode!==2||review.pool!==p.pool||review.asset!==p.asset||review.chain!==p.chain||review.beneficiary!==review.account||!sameTransaction)throw new Error('REPAY_SEMANTIC_MISMATCH');
    const receiptBlockHash=rpcHash(receipt.blockHash);
    if(rpcHash(tx.hash)!==attempt.transactionHash||rpcHash(receipt.transactionHash)!==attempt.transactionHash||typeof tx.from!=='string'||typeof tx.to!=='string'||receipt.from!==tx.from||receipt.to!==tx.to||rpcUint(tx.value)!==0n||rpcUint(tx.chainId)!==BigInt(p.chainId)||(tx.blockHash!==null&&rpcHash(tx.blockHash)!==receiptBlockHash)||rpcUint(tx.blockNumber)!==rpcUint(receipt.blockNumber)||rpcUint(tx.transactionIndex)!==rpcUint(receipt.transactionIndex))throw new Error('REPAY_TRANSACTION_MISMATCH');
    const wrapped=tx.to===SUPPLY_METAMASK.manager;
    if(!wrapped&&(tx.from!==expected.from||tx.to!==expected.to||tx.input!==expected.data||rpcUint(tx.nonce)!==BigInt(attempt.nonce)))throw new Error('REPAY_TRANSACTION_MISMATCH');
    const gasIndex=approval?0:review.gasLimits.length-1;
    if(rpcUint(receipt.gasUsed)>rpcUint(tx.gas)||!wrapped&&(rpcUint(tx.gas)>BigInt(review.gasLimits[gasIndex]!)||rpcUint(receipt.effectiveGasPrice)>BigInt(review.gasPrice)||rpcUint(tx.maxFeePerGas??tx.gasPrice)>BigInt(review.gasPrice)))throw new Error('REPAY_GAS_MISMATCH');
    const block=Number(rpcUint(receipt.blockNumber));if(!Number.isSafeInteger(block)||block<attempt.preparedAtBlock)throw new Error('REPAY_BLOCK_MISMATCH');
    const canonical=rpcRecord(await rpc('eth_getBlockByNumber',[supplyHex(block),false]));
    if(rpcHash(canonical.hash)!==receiptBlockHash||rpcUint(canonical.number)!==BigInt(block))throw new Error('REPAY_REORG');
    // A null transaction block hash is only missing provider metadata. Independently
    // bind inclusion to the canonical receipt block and its exact transaction slot.
    const transactionIndex=Number(rpcUint(receipt.transactionIndex));
    if(!Number.isSafeInteger(transactionIndex)||!Array.isArray(canonical.transactions)||canonical.transactions[transactionIndex]!==attempt.transactionHash)throw new Error('REPAY_TRANSACTION_INDEX_MISMATCH');
    if(rpcUint(await rpc('eth_blockNumber',[]))<BigInt(block+2))return {...base,reason:'AWAITING_CONFIRMATIONS'};
    if(rpcUint(receipt.status)!==1n)return {...base,verdict:'DIVERGENT',reason:approval?'APPROVAL_REVERTED':'REPAY_REVERTED'};
    if(wrapped)base.walletEnvelope=await verifySupplyWalletEnvelope(review,attempt,tx,receipt,rpc);else base.ownerAuthorization=verifyRepayOwnerSignature(tx,review.account);
    if(!Array.isArray(receipt.logs))throw new Error('REPAY_LOGS_INVALID');
    assertOwnerTransfers(receipt.logs,review.account,review.amount,approval);
    const pre=await readBorrowState(rpc,review.account,review.account,supplyHex(block-1)),post=await readBorrowState(rpc,review.account,review.account,supplyHex(block));base.prePosition=pre;base.postPosition=post;
    if(pre.blockHash!==rpcHash(canonical.parentHash)||post.blockHash!==rpcHash(receipt.blockHash)||pre.deploymentHash!==review.state.deploymentHash||post.deploymentHash!==review.state.deploymentHash)throw new Error('REPAY_DEPLOYMENT_MISMATCH');
    const final=rpcRecord(await rpc('eth_getBlockByNumber',[supplyHex(block),false]));if(rpcHash(final.hash)!==post.blockHash)throw new Error('REPAY_REORG');
    base.cost=(rpcUint(receipt.gasUsed)*rpcUint(receipt.effectiveGasPrice)+(receipt.l1Fee===undefined?0n:rpcUint(receipt.l1Fee))).toString();
    if(!wrapped){
      const [beforeNonce,afterNonce]=await Promise.all([rpc('eth_getTransactionCount',[review.account,supplyHex(block-1)]),rpc('eth_getTransactionCount',[review.account,supplyHex(block)])]);
      if(rpcUint(beforeNonce)!==BigInt(attempt.nonce)||rpcUint(afterNonce)!==rpcUint(beforeNonce)+1n)throw new Error('REPAY_OWNER_NONCE_MISMATCH');
      if(BigInt(pre.nativeBalance)-BigInt(post.nativeBalance)!==BigInt(base.cost))throw new Error('REPAY_NATIVE_COST_MISMATCH');
    }
    if(approval){
      const events=receipt.logs.filter(l=>rpcRecord(l).address===p.asset&&Array.isArray(rpcRecord(l).topics)&&(rpcRecord(l).topics as unknown[])[0]===supplyTopic('Approval(address,address,uint256)'));
      if(events.length!==1||!logMatches(events[0],p.asset,[supplyTopic('Approval(address,address,uint256)'),addressTopic(review.account),addressTopic(p.pool)],'0x'+supplyWord(BigInt(review.amount)))||post.allowance!==review.amount||pre.balance!==post.balance||pre.scaledPosition!==post.scaledPosition||pre.borrow!.scaledDebt!==post.borrow!.scaledDebt||pre.borrow!.userConfiguration!==post.borrow!.userConfiguration)throw new Error('REPAY_APPROVAL_MISMATCH');
      return {...base,verdict:'RECONCILED',reason:'EXACT_REPAY_APPROVAL_VERIFIED'};
    }
    const events=receipt.logs.filter(l=>rpcRecord(l).address===p.pool&&Array.isArray(rpcRecord(l).topics)&&(rpcRecord(l).topics as unknown[])[0]===supplyTopic('Repay(address,address,address,uint256,bool)'));
    if(events.length!==1||!logMatches(events[0],p.pool,[supplyTopic('Repay(address,address,address,uint256,bool)'),addressTopic(p.asset),addressTopic(review.account),addressTopic(review.account)],'0x'+supplyWord(BigInt(review.amount))+supplyWord(0n)))throw new Error('REPAY_EVENT_MISMATCH');
    return {...base,...verifyRepayEffects(review.amount,pre,post),repayEvent:events[0],verdict:'RECONCILED',reason:'REPAY_TRANSACTION_DEBT_BALANCE_ALLOWANCE_AND_HEALTH_VERIFIED'};
  }catch(cause){const reason=cause instanceof Error?cause.message:'REPAY_OBSERVATION_FAILED';return {...base,reason,verdict:/MISMATCH|WRONG_CHAIN|REORG|INVALID|UNSUPPORTED/.test(reason)?'DIVERGENT':'INCONCLUSIVE'};}
}
export function buildRepayEvidence(input:{id:string;review:SupplyReview;journal:ExecutionJournal;provenance:'PUBLIC_TESTNET'|'MOCKED';ownerInitiated:boolean;observations:SupplyObservation[];approval?:SupplyObservation}):{bundle:EvidenceBundle;bundleHash:string;publicExecution:unknown;artifacts:unknown} {
  const o=input.observations.at(-1) as RepayObservation|undefined,r=input.review;
  const approval=(input.approval??input.observations.find(item=>item.reason==='EXACT_REPAY_APPROVAL_VERIFIED')) as RepayObservation|undefined;
  if(!r.repay||!o||o.verdict!=='RECONCILED'||!o.prePosition?.borrow||!o.postPosition?.borrow||!o.transaction||!o.receipt||!o.repayEvent||!(o.ownerAuthorization||o.walletEnvelope)||!input.ownerInitiated||r.approvalRequired&&(!approval?.receipt||approval.verdict!=='RECONCILED'||!(approval.ownerAuthorization||approval.walletEnvelope)))throw new Error('REPAY_EVIDENCE_NOT_RECONCILED');
  const effects=verifyRepayEffects(r.amount,o.prePosition,o.postPosition);
  const publicExecution={network:p.network,chainId:p.chainId,owner:r.account,onBehalfOf:r.beneficiary,pool:p.pool,asset:p.asset,amount:r.amount,rateMode:2,variableDebtToken:p.variableDebtToken,approvalTransactionHash:approval?.receipt?.transactionHash??null,approvalOwnerAuthorization:approval?.ownerAuthorization??approval?.walletEnvelope??null,repayTransactionHash:o.receipt.transactionHash,ownerAuthorization:o.ownerAuthorization??o.walletEnvelope,block:o.postPosition.block,gasUsed:rpcUint(o.receipt.gasUsed).toString(),transactionCost:o.cost,totalNetworkCost:(BigInt(o.cost!)+BigInt(approval?.cost??'0')).toString(),preWalletBalance:o.prePosition.balance,postWalletBalance:o.postPosition.balance,preDebt:o.prePosition.borrow.debt,postDebt:o.postPosition.borrow.debt,...effects,preAllowance:o.prePosition.allowance,postAllowance:o.postPosition.allowance,preHealthFactor:o.prePosition.borrow.healthFactor,postHealthFactor:o.postPosition.borrow.healthFactor,prePosition:o.prePosition,postPosition:o.postPosition,repayEvent:o.repayEvent,reconciliationVerdict:o.verdict,explorer:p.explorer,officialSource:p.officialSource,provenance:input.provenance,ownerInitiated:input.ownerInitiated,observations:input.observations,...approval?{approvalObservation:approval}:{}};
  const head=hashJournalBytes(new TextEncoder().encode(JSON.stringify(input.journal))).at(-1);if(!head)throw new Error('REPAY_JOURNAL_EMPTY');
  const asset={chainId:p.chain,address:p.asset,decimals:6};
  const bundle:EvidenceBundle={schemaVersion:'1.0.0',evidenceBundleId:input.id,version:1,supersedes:null,semanticWorkflowHash:r.manifest.semanticWorkflowHash,artifactSetHash:r.manifest.artifactSetHash,simulationHash:r.manifest.simulationHash,policyHash:r.manifest.policyHash,manifestHash:supplyArtifactHash('strategy-manifest',r.manifest),executionPlanHash:supplyArtifactHash('execution-plan',r.plan),journalHeadHash:head,observedAt:new Date().toISOString(),environment:input.provenance==='PUBLIC_TESTNET'?'TESTNET_EXECUTED':'MOCKED',outcome:'RECONCILED',receipts:[...approval?.receipt?[{receiptId:'repay-approval-receipt',contentHash:supplyHash(approval.receipt)}]:[],{receiptId:'repay-receipt',contentHash:supplyHash(o.receipt)}],differences:[],reconciliation:{balances:[{asset,amount:o.postPosition.balance}],allowances:[{asset,amount:o.postPosition.allowance}],debt:[{asset,amount:o.postPosition.borrow.debt}],positions:[],fees:[],residualAssets:[],ownership:[{chainId:p.chain,address:r.account}],limitations:['Exact wallet debit and canonical Repay event bind the requested amount. Scaled debt burn is normalized at the post-block debt index within the recorded ray rounding bound.','Historical block snapshots include every transaction in the block; inconsistent economic effects fail closed.']},evidence:[{evidenceId:'repay-public-observations',kind:'EXTERNAL_REFERENCE',contentHash:supplyHash(publicExecution)}]};
  return {bundle,bundleHash:supplyArtifactHash('evidence-bundle',bundle),publicExecution,artifacts:{workflow:r.workflow,artifactSet:r.artifactSet,simulation:r.simulation,policy:r.policy,manifest:r.manifest,plan:r.plan,journal:input.journal,review:r}};
}
