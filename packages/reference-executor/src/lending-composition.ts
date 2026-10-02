// SPDX-License-Identifier: AGPL-3.0-only
import { hashJournalBytes, type ExecutionJournal, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { assertLendingReview, supplyArtifactHash, supplyHash, rpcHash, lendingSteps,
  type LendingReview, type LendingCall, type LendingStepId } from '@defi-workflow-engine/reference-compiler';
import { createJournal, appendJournalState } from './journal.js';
export type LendingAttempt = {id:string;step:LendingStepId;call:LendingCall;nonce:string;preparedAtBlock:number;
  state:'PREPARED'|'SUBMITTING'|'SUBMISSION_RESULT_UNKNOWN'|'PENDING'|'CONFIRMED'|'REVERTED'|'CANCELLED'|'RECONCILIATION_REQUIRED';
  hash:string|null;reconciled:boolean;ownerInitiated:boolean;notSubmitted?:boolean;reviewCommitment:string};
export type LendingRun = {format:'gryloo.lending-run.v1';id:string;reviews:LendingReview[];authorization:string|null;
  attempts:LendingAttempt[];journal:ExecutionJournal;provenance:'MOCKED'|'PUBLIC_TESTNET';
  status:'SIMULATED'|'AUTHORIZED'|'EXECUTING'|'PAUSED'|'PARTIALLY_COMPLETED'|'RECOVERY_REQUIRED'|'COMPLETED'|'FAILED';
  error:string|null;recoveryOf?:string};
export function createLendingRun(id:string,review:LendingReview,provenance:LendingRun['provenance']):LendingRun {
  let journal=createJournal({journalId:id,workflowId:review.workflow.workflowId,executionPlanHash:supplyArtifactHash('execution-plan',review.plan),manifestHash:supplyArtifactHash('strategy-manifest',review.manifest)});
  const append=(level:'workflow'|'segment'|'step',entityId:string,toState:'DRAFT'|'PLANNED'|'REVIEWED'|'SIMULATED',stepId:string|null)=>{journal=appendJournalState(journal,{level,entityId,segmentId:level==='workflow'?null:'lending-segment',stepId,executionAttemptId:null,toState,recordedAt:new Date().toISOString()}).journal;};
  append('workflow',review.workflow.workflowId,'DRAFT',null);append('segment','lending-segment','PLANNED',null);
  for(const c of review.calls)append('step',c.id,'PLANNED',c.id);
  append('workflow',review.workflow.workflowId,'REVIEWED',null);append('workflow',review.workflow.workflowId,'SIMULATED',null);
  return {format:'gryloo.lending-run.v1',id,reviews:[review],authorization:null,attempts:[],journal,provenance,status:'SIMULATED',error:null};
}
export const currentLendingReview=(run:LendingRun)=>run.reviews.at(-1)!;
export function lendingAttemptTransition(run:LendingRun,id:string,state:LendingAttempt['state']):LendingRun {
  const attempt=run.attempts.find(a=>a.id===id);if(!attempt)throw Error('LENDING_ATTEMPT_MISSING');
  if(attempt.state===state)return run;
  const journal=appendJournalState(run.journal,{level:'attempt',entityId:id,segmentId:'lending-segment',stepId:attempt.step,
    executionAttemptId:id,toState:state,recordedAt:new Date().toISOString()}).journal;
  return {...run,journal,attempts:run.attempts.map(a=>a.id===id?{...a,state}:a)};
}
export function prepareLendingAttempt(run:LendingRun,workflow:SemanticWorkflow,account:string,block:number,nonce:string):LendingRun {
  const review=currentLendingReview(run);assertLendingReview(review,workflow,account);
  if(run.authorization!==review.commitment||['COMPLETED','FAILED','RECOVERY_REQUIRED'].includes(run.status))throw Error('LENDING_AUTHORIZATION_REQUIRED');
  if(run.attempts.some(a=>!a.reconciled&&!a.notSubmitted))throw Error('LENDING_EXISTING_ATTEMPT_OBSERVE_ONLY');
  const call=review.calls.find(c=>!run.attempts.some(a=>a.step===c.id&&a.reconciled));
  if(!call||run.attempts.some(a=>a.step===call.id&&!a.notSubmitted))throw Error('LENDING_EXISTING_ATTEMPT_OBSERVE_ONLY');
  if(!Number.isSafeInteger(block)||block<review.state.aave.block||!/^(0|[1-9][0-9]*)$/.test(nonce))throw Error('LENDING_PREPARATION_INVALID');
  const attempt:LendingAttempt={id:run.id+'.'+call.id+'.'+run.attempts.length,step:call.id,call,nonce,preparedAtBlock:block,state:'PREPARED',
    hash:null,reconciled:false,ownerInitiated:true,reviewCommitment:review.commitment};
  const journal=appendJournalState(run.journal,{level:'attempt',entityId:attempt.id,segmentId:'lending-segment',stepId:call.id,
    executionAttemptId:attempt.id,toState:'PREPARED',recordedAt:new Date().toISOString()}).journal;
  return {...run,journal,attempts:[...run.attempts,attempt],status:'EXECUTING',error:null};
}
export function validateLendingRun(run:LendingRun):void {
  if(run.format!=='gryloo.lending-run.v1'||!/^lending-[a-f0-9]{32}$/.test(run.id)||!run.reviews.length||run.reviews.length>64||
      !['SIMULATED','AUTHORIZED','EXECUTING','PAUSED','PARTIALLY_COMPLETED','RECOVERY_REQUIRED','COMPLETED','FAILED'].includes(run.status)||new Set(run.attempts.map(a=>a.id)).size!==run.attempts.length||!['MOCKED','PUBLIC_TESTNET'].includes(run.provenance)||run.attempts.length>10||run.journal.journalId!==run.id||
      run.authorization!==null&&run.authorization!==currentLendingReview(run).commitment)throw Error('LENDING_STORE_CORRUPT');
  const first=run.reviews[0]!;
  if(run.journal.manifestHash!==supplyArtifactHash('strategy-manifest',first.manifest)||run.journal.executionPlanHash!==supplyArtifactHash('execution-plan',first.plan))throw Error('LENDING_STORE_CORRUPT');
  for(const r of run.reviews){const {commitment,...value}=r;if(supplyHash(value)!==commitment||supplyHash(r.workflow)!==supplyHash(first.workflow)||supplyHash(r.rootState)!==supplyHash(first.rootState))throw Error('LENDING_STORE_CORRUPT');}
  hashJournalBytes(new TextEncoder().encode(JSON.stringify(run.journal)));
  const successful=new Set<LendingStepId>();
  for(const a of run.attempts){
    const review=run.reviews.find(r=>r.commitment===a.reviewCommitment), call=review?.calls.find(c=>c.id===a.step);
    const entry=[...run.journal.entries].reverse().find(e=>e.entityId===a.id);
    if(!call||supplyHash(call)!==supplyHash(a.call)||entry?.toState!==a.state||a.reconciled&&a.state!=='CONFIRMED'||a.hash!==null&&rpcHash(a.hash)!==a.hash||
        !a.ownerInitiated||!Number.isSafeInteger(a.preparedAtBlock)||!/^(0|[1-9][0-9]*)$/.test(a.nonce)||successful.has(a.step))throw Error('LENDING_STORE_CORRUPT');
    if(a.step==='BORROW'&&!successful.has('SUPPLY')||a.step==='SWAP'&&!successful.has('BORROW'))throw Error('LENDING_STORE_CORRUPT');
    if(a.reconciled)successful.add(a.step);
    if(a.notSubmitted&&(a.hash||a.reconciled||a.state!=='CANCELLED'))throw Error('LENDING_STORE_CORRUPT');
  }
  const completed=run.attempts.filter(a=>a.reconciled).map(a=>a.step);
  if(completed.some((s,i)=>i>0&&lendingSteps.indexOf(s)<=lendingSteps.indexOf(completed[i-1]!))||run.status==='COMPLETED'&&!successful.has('SWAP'))throw Error('LENDING_STORE_CORRUPT');
}
