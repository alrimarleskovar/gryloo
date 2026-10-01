// SPDX-License-Identifier: AGPL-3.0-only
import { createJournal, appendJournalState } from './journal.js';
import { supplyHash, supplyArtifactHash, SUPPLY_METAMASK, decodeSupplyWalletEnvelope, rpcRecord, rpcUint, rpcHash, supplyHex, type SupplyReview, type SupplyRpc, type SupplyTransaction } from '@defi-workflow-engine/reference-compiler';
import { hashJournalBytes, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
export type SupplyAttempt = { step: 'APPROVAL' | 'SUPPLY'; state: 'PREPARED' | 'CANCELLED' | 'NOT_FOUND' | 'SUBMITTING' | 'SUBMISSION_RESULT_UNKNOWN' | 'PENDING' | 'CONFIRMED' | 'REVERTED' | 'RECONCILIATION_REQUIRED';
  nonce: string; preparedAtBlock: number; transaction: SupplyTransaction; transactionHash: string | null; receipt: Record<string, unknown> | null; reconciled: boolean };
export type SupplyRun = { format: 'gryloo.supply-run.v1'; id: string; review: SupplyReview; provenance: 'PUBLIC_TESTNET' | 'MOCKED';
  authorization: string | null; attempts: SupplyAttempt[]; journal: ExecutionJournal; verdict: 'PENDING' | 'RECONCILED' | 'DIVERGENT' | 'INCONCLUSIVE'; ownerInitiated: boolean };
export function createSupplyRun(id: string, review: SupplyReview, provenance: SupplyRun['provenance']): SupplyRun {
  let journal=createJournal({journalId:id,workflowId:review.workflow.workflowId,executionPlanHash:supplyArtifactHash('execution-plan',review.plan),manifestHash:supplyArtifactHash('strategy-manifest',review.manifest)});
  const append=(level:'workflow'|'segment'|'step',entityId:string,toState:'DRAFT'|'PLANNED'|'REVIEWED'|'SIMULATED',stepId:string|null)=>{
    journal=appendJournalState(journal,{level,entityId,segmentId:level==='workflow'?null:'supply-segment',stepId,executionAttemptId:null,toState,recordedAt:new Date().toISOString()}).journal;
  };
  append('workflow',review.workflow.workflowId,'DRAFT',null);
  append('segment','supply-segment','PLANNED',null);
  for(const step of review.plan.segments[0]!.steps)append('step',step.stepId,'PLANNED',step.stepId);
  append('workflow',review.workflow.workflowId,'REVIEWED',null);
  append('workflow',review.workflow.workflowId,'SIMULATED',null);
  return {format:'gryloo.supply-run.v1',id,review,provenance,authorization:null,attempts:[],verdict:'PENDING',ownerInitiated:false,journal};
}
export function supplyTransition(run: SupplyRun, attempt: SupplyAttempt, state: SupplyAttempt['state']): SupplyRun {
  if (attempt.state === state && [...run.journal.entries].reverse().find(e => e.entityId === `${run.id}.${attempt.step}`)?.toState === state) return run;
  const journal = appendJournalState(run.journal,{level:'attempt',entityId:`${run.id}.${attempt.step}`,segmentId:'supply-segment',stepId:attempt.step==='APPROVAL'?'supply-approval':'supply-deposit',
    executionAttemptId:`${run.id}.${attempt.step}`,toState:state,recordedAt:new Date().toISOString()}).journal;
  return {...run,journal,attempts:run.attempts.map(a => a.step===attempt.step?{...a,state}:a)};
}
/** Pure preparation is persisted by the coordinator BEFORE releasing a wallet request. */
export function prepareSupplyAttempt(run: SupplyRun, block: number, nonce: string, submitting=true): SupplyRun {
  if (run.verdict !== 'PENDING') throw new Error('SUPPLY_RUN_TERMINAL');
  const step = run.review.approvalRequired && !run.attempts.some(a => a.step==='APPROVAL'&&a.reconciled) ? 'APPROVAL' : 'SUPPLY';
  // Every existing attempt, including unknown/missing/rejected, is observation-only.
  if (run.attempts.some(a => a.step===step)) throw new Error('SUPPLY_EXISTING_ATTEMPT_OBSERVE_ONLY');
  if (step==='SUPPLY' && run.review.approvalRequired && !run.attempts.some(a => a.step==='APPROVAL'&&a.reconciled)) throw new Error('SUPPLY_APPROVAL_NOT_RECONCILED');
  const expectedNonce = BigInt(run.review.state.nonce)+(step==='SUPPLY'&&run.review.approvalRequired?1n:0n);
  if (BigInt(nonce)!==expectedNonce || !Number.isSafeInteger(block) || block<run.review.state.block) throw new Error('SUPPLY_NONCE_CHANGED');
  const tx = run.review.transactions[step==='APPROVAL'?0:run.review.transactions.length-1]!;
  const attempt: SupplyAttempt = {step,state:submitting?'SUBMITTING':'PREPARED',nonce,preparedAtBlock:block,transaction:tx,transactionHash:null,receipt:null,reconciled:false};
  const prepared = {...run,ownerInitiated:true,attempts:[...run.attempts,attempt]};
  // The DApp persists PREPARED first; its handoff boundary separately persists SUBMITTING.
  const journal = appendJournalState(prepared.journal,{level:'attempt',entityId:`${run.id}.${step}`,segmentId:'supply-segment',stepId:step==='APPROVAL'?'supply-approval':'supply-deposit',
    executionAttemptId:`${run.id}.${step}`,toState:'PREPARED',recordedAt:new Date().toISOString()}).journal;
  return submitting?supplyTransition({...prepared,journal},attempt,'SUBMITTING'):{...prepared,journal};
}
export function matchSupplyTransaction(attempt: SupplyAttempt, transaction: unknown): boolean {
  const tx = rpcRecord(transaction), expected = attempt.transaction;
  if(typeof tx.input!=='string'||typeof tx.to!=='string'||rpcUint(tx.value)!==0n||rpcUint(tx.chainId)!==BigInt(expected.chainId))return false;
  if(typeof tx.from==='string'&&tx.from.toLowerCase()===expected.from&&tx.to.toLowerCase()===expected.to&&tx.input.toLowerCase()===expected.data&&rpcUint(tx.nonce)===BigInt(attempt.nonce))return true;
  // Candidate only. Cryptographic authorization, pinned contracts and state are checked by the reconciler.
  if(tx.to.toLowerCase()!==SUPPLY_METAMASK.manager)return false;
  try{const e=decodeSupplyWalletEnvelope(tx.input);return e.owner===expected.from&&e.call.to===expected.to&&e.call.data===expected.data&&e.call.value==='0';}
  catch{return false;}
}
/** Bounded discovery of the SAME account/nonce. No send function exists in recovery. */
export async function discoverSupplyTransaction(attempt: SupplyAttempt, rpc: SupplyRpc): Promise<{ hash: string | null; mismatch: boolean; exhausted: boolean }> {
  if (rpcUint(await rpc('eth_chainId',[]))!==BigInt(attempt.transaction.chainId)) throw new Error('SUPPLY_WRONG_CHAIN');
  if (attempt.transactionHash) return {hash:attempt.transactionHash,mismatch:false,exhausted:false};
  const latest = Number(rpcUint(await rpc('eth_blockNumber',[])));
  if (!Number.isSafeInteger(latest) || latest<attempt.preparedAtBlock) throw new Error('SUPPLY_RPC_INVALID');
  const end = Math.min(latest,attempt.preparedAtBlock+128);
  for (let n=attempt.preparedAtBlock;n<=end;n++) {
    const block = rpcRecord(await rpc('eth_getBlockByNumber',[supplyHex(n),true]));
    if (!Array.isArray(block.transactions)) throw new Error('SUPPLY_RPC_INVALID');
    for (const value of block.transactions) {
      const tx=rpcRecord(value);
      if ((typeof tx.from==='string' && tx.from.toLowerCase()===attempt.transaction.from && rpcUint(tx.nonce)===BigInt(attempt.nonce))||typeof tx.to==='string'&&tx.to.toLowerCase()===SUPPLY_METAMASK.manager&&matchSupplyTransaction(attempt,tx))
        return {hash:rpcHash(tx.hash),mismatch:!matchSupplyTransaction(attempt,tx),exhausted:false};
    }
  }
  // Wallet may still publish a pending transaction. Inspect it once, also without resubmission.
  const pending = await rpc('eth_getBlockByNumber',['pending',true]);
  if (pending) {
    const block=rpcRecord(pending);
    if (Array.isArray(block.transactions)) for (const value of block.transactions) {
      const tx=rpcRecord(value);
      if ((typeof tx.from==='string'&&tx.from.toLowerCase()===attempt.transaction.from&&rpcUint(tx.nonce)===BigInt(attempt.nonce))||typeof tx.to==='string'&&tx.to.toLowerCase()===SUPPLY_METAMASK.manager&&matchSupplyTransaction(attempt,tx))
        return {hash:rpcHash(tx.hash),mismatch:!matchSupplyTransaction(attempt,tx),exhausted:false};
    }
  }
  return {hash:null,mismatch:false,exhausted:latest>attempt.preparedAtBlock+128};
}
export type SupplyPersistence = { read: () => Promise<SupplyRun>; write: (next: SupplyRun) => Promise<void> };
export async function persistSupplyPreparation(store: SupplyPersistence, block: number, nonce: string): Promise<SupplyRun> {
  const run = prepareSupplyAttempt(await store.read(),block,nonce);
  await store.write(run); // rejection must prevent the wallet request
  return run;
}
export function validateSupplyRun(run: SupplyRun): void {
  if (run.format!=='gryloo.supply-run.v1'||!/^supply-[a-f0-9]{32}$/.test(run.id)||!['PUBLIC_TESTNET','MOCKED'].includes(run.provenance)||
      new Set(run.attempts.map(a=>a.step)).size!==run.attempts.length||run.attempts.length>2) throw new Error('SUPPLY_STORE_CORRUPT');
  const {commitment,...review}=run.review;
  if (supplyHash(review)!==commitment || supplyArtifactHash('execution-plan',run.review.plan)!==run.journal.executionPlanHash ||
      supplyArtifactHash('strategy-manifest',run.review.manifest)!==run.journal.manifestHash || run.journal.journalId!==run.id ||
      run.journal.workflowId!==run.review.workflow.workflowId || run.authorization!==null&&run.authorization!==commitment ||
      typeof run.ownerInitiated!=='boolean' || run.ownerInitiated!==(run.attempts.length>0) ||
      !['PENDING','RECONCILED','DIVERGENT','INCONCLUSIVE'].includes(run.verdict)) throw new Error('SUPPLY_STORE_CORRUPT');
  hashJournalBytes(new TextEncoder().encode(JSON.stringify(run.journal)));
  for(const [index,attempt] of run.attempts.entries()){
    const expectedStep=run.review.approvalRequired&&index===0?'APPROVAL':'SUPPLY';
    const expectedTx=run.review.transactions[attempt.step==='APPROVAL'?0:run.review.transactions.length-1];
    const entry=[...run.journal.entries].reverse().find(e=>e.entityId===`${run.id}.${attempt.step}`);
    if(attempt.step!==expectedStep || JSON.stringify(attempt.transaction)!==JSON.stringify(expectedTx) ||
        BigInt(attempt.nonce)!==BigInt(run.review.state.nonce)+BigInt(index) || !Number.isSafeInteger(attempt.preparedAtBlock) ||
        attempt.preparedAtBlock<run.review.state.block || entry?.toState!==attempt.state || typeof attempt.reconciled!=='boolean' ||
        attempt.transactionHash!==null&&!/^0x[0-9a-f]{64}$/.test(attempt.transactionHash) ||
        attempt.reconciled&&(attempt.state!=='CONFIRMED'||!attempt.receipt||!attempt.transactionHash) ||
        index>0&&!run.attempts[index-1]?.reconciled) throw new Error('SUPPLY_STORE_CORRUPT');
  }
  if(run.verdict==='RECONCILED'&&!run.attempts.some(a=>a.step==='SUPPLY'&&a.reconciled))throw new Error('SUPPLY_STORE_CORRUPT');
}
