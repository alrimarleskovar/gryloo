// SPDX-License-Identifier: AGPL-3.0-only
/** One policy, one existing Roles swap. Reservation and evidence share one durable CAS append. */
import { randomUUID } from 'node:crypto';
import { serializeModeC as canonicalJson, hashRawBytes, hashModeCPolicy, hashModeCManifest, validateModeCPolicy, validateModeCExecutionPlan,
  hashArtifactBytes,hashModeBPermission, modeCCommitment, readModeCPoolObservation, modeCDipEligible, hashJournalBytes,
  type JournalEntry, type JournalLevel, type ExecutionJournal, type QuoteStateArtifact, type ModeCPolicy } from '@defi-workflow-engine/workflow-contracts';
import type { ModeCCompiled } from '@defi-workflow-engine/reference-compiler';
import type { ExecutionStorage } from './durable-storage.js';
import { createJournal,appendJournalState } from './journal.js';

export type ModeCTransaction = { readonly hash: string; readonly nonce: string; readonly raw: string;
  readonly beforeInput: string; readonly beforeOutput: string };
export type ModeCReconciliation = { readonly outcome: 'RECONCILED' | 'REVERTED' | 'INCONCLUSIVE' | 'DIVERGENT';
  readonly transactionHash: string; readonly details: unknown };
export type ModeCDriver = {
  readonly now: () => Promise<number>;
  readonly observe: () => Promise<{ artifact: QuoteStateArtifact; raw: string }>;
  /** Direct readback of installed verifier commitments, bytecode, Safe/Roles identity and effective scope. */
  readonly verifyInstalled: () => Promise<boolean>;
  /** Read-only evaluation of the installed Roles Custom checker in the current chain state. */
  readonly eligible: () => Promise<boolean>;
  readonly prepareExact: (call: { from: string; to: string; data: string; value: '0x0' }) => Promise<ModeCTransaction>;
  readonly submitExact: (tx: ModeCTransaction) => Promise<string>;
  readonly reconcile: (tx: ModeCTransaction) => Promise<ModeCReconciliation>;
  /** Must require successful owner receipts plus module/role/allowance readback. */
  readonly verifyRevoked: (receipts: readonly string[]) => Promise<boolean>;
};
export type ModeCAction = { chainId:number; tokenIn:string; tokenOut:string; recipient:string; router:string; functionId:string;
  amount:string; minimumOut:string; slippageBps:number; triggerDropBps:number };
export type ModeCLedger = { totalReserved:bigint; periodReserved:bigint; executions:number; lastReservedAt:number|null;
  observationHashes:readonly string[]; revoked:boolean; paused:boolean };
export type ModeCDecision = { eligible:boolean; code:string; freshness:'FRESH'|'STALE'|'INVALID'; observationHash:string|null;
  triggerMet:boolean|null; period:number|null };
export function evaluateModeC(p:ModeCPolicy, input:unknown, now:number, ledger:ModeCLedger, action?:ModeCAction):ModeCDecision {
  const decision:ModeCDecision = {eligible:false,code:'MODE_C_OBSERVATION_INVALID',freshness:'INVALID',observationHash:null,triggerMet:null,period:null};
  const no=(code:string)=>({...decision,code});
  if (!Number.isSafeInteger(now) || now<0) return no('MODE_C_CLOCK_INVALID');
  if (ledger.revoked) return no('MODE_C_REVOCATION_CONFIRMED');
  if (ledger.paused) return no('MODE_C_REVOCATION_REQUESTED');
  if (now < p.startsAt) return no('MODE_C_NOT_STARTED');
  if (now >= p.expiresAt) return no('MODE_C_EXPIRED');
  if (action && (action.chainId!==p.chainId || action.tokenIn!==p.tokenIn || action.tokenOut!==p.tokenOut ||
    action.recipient!==p.recipient || action.router!==p.router || action.functionId!==p.functionId ||
    action.amount!==p.maximumSwapAmount || action.minimumOut!==p.minimumOut || action.slippageBps!==p.maximumSlippageBps ||
    action.triggerDropBps!==p.triggerDropBps)) return no('MODE_C_AUTHORITY_EXPANSION');
  let observed:ReturnType<typeof readModeCPoolObservation>;
  try { observed=readModeCPoolObservation(input,p); }
  catch (e) {return no(e instanceof Error ? e.message : 'MODE_C_OBSERVATION_INVALID');}
  decision.observationHash=observed.hash;
  if (now<observed.observedAt || now<observed.retrievedAt || now>=observed.expiresAt) {
    decision.freshness='STALE';return no('MODE_C_STALE_OBSERVATION');
  }
  decision.freshness='FRESH';
  const reference=readModeCPoolObservation(p.reference,p);
  if (observed.blockNumber < reference.blockNumber || observed.observedAt < reference.observedAt || observed.hash===p.referenceHash)
    return no('MODE_C_OBSERVATION_NOT_NEW');
  decision.triggerMet=modeCDipEligible(observed.sqrt*observed.sqrt,1n,reference.sqrt*reference.sqrt,1n);
  decision.period=Math.floor((now-p.startsAt)/p.periodSeconds);
  if (!decision.triggerMet) return no('MODE_C_TRIGGER_NOT_MET');
  if (ledger.observationHashes.includes(observed.hash)) return no('MODE_C_REPLAY');
  if (ledger.lastReservedAt!==null && now<ledger.lastReservedAt+p.cooldownSeconds) return no('MODE_C_COOLDOWN');
  if (ledger.lastReservedAt!==null && now<ledger.lastReservedAt+p.frequencySeconds) return no('MODE_C_FREQUENCY');
  const amount=BigInt(p.maximumSwapAmount);
  if (ledger.totalReserved+amount>BigInt(p.totalBudget)) return no('MODE_C_TOTAL_BUDGET');
  if (ledger.periodReserved+amount>BigInt(p.perPeriodBudget)) return no('MODE_C_PERIOD_BUDGET');
  if (ledger.executions>=1) return no('MODE_C_ACTION_CONSUMED');
  return {...decision,eligible:true,code:'MODE_C_ELIGIBLE'};
}

export type ModeCEvent = { readonly sequence:number; readonly previousHash:string|null; readonly policyHash:string;
  readonly manifestHash:string; readonly recordedAt:string; readonly kind:'ATTEMPT'|'DECISION'|'RESERVED'|'SUBMITTING'|
    'SUBMITTED'|'RECONCILIATION'|'REVOCATION_REQUESTED'|'REVOCATION_CONFIRMED'; readonly details:unknown;
    readonly journal:ExecutionJournal; readonly hash:string };
const encoder=new TextEncoder();
const hashPattern=/^0x[0-9a-f]{64}$/;
export function createModeCExecutor(input:{compiled:ModeCCompiled;storage:ExecutionStorage;driver:ModeCDriver}) {
  const c=JSON.parse(canonicalJson(input.compiled)) as ModeCCompiled, p=validateModeCPolicy(c.policy);
  if (c.policyHash!==hashModeCPolicy(p) || c.manifestHash!==hashModeCManifest(p,c.manifest) ||
    c.executionPlanHash!==modeCCommitment('execution-plan',validateModeCExecutionPlan(p,c.manifest,c.executionPlan)) ||
    c.compiled.permissionHash!==p.permissionHash || c.compiled.executorCall.data!==p.executorCalldata ||
    c.compiled.executorCall.to!==p.roles) throw new Error('MODE_C_AUTHORITY_BINDING_INVALID');
  for(const [kind,value,expected] of [['semantic-workflow',c.workflow,p.semanticWorkflowHash],['artifact-set',c.artifactSet,p.artifactSetHash],['simulation-bundle',c.simulation,p.simulationHash]] as const)
    if(hashArtifactBytes(kind,new TextEncoder().encode(canonicalJson(value)))!==expected)throw new Error('MODE_C_ARTIFACT_BINDING_INVALID');
  if(hashModeBPermission(c.compiled.permission)!==p.permissionHash)throw new Error('MODE_C_AUTHORITY_BINDING_INVALID');
  // Key financial authority, rather than worker/observation identity. Cloned metadata cannot create another ledger.
  const authority=modeCCommitment('installed-authority',{chain:p.chainId,roles:p.roles,role:p.roleKey,allowance:p.allowanceKey});
  const name=`mode-c-${authority.slice(2)}.jsonl`, driver=input.driver, storage=input.storage;
  function parse(raw:Uint8Array|null):ModeCEvent[] {
    if (!raw) return [];
    const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
    if (!text.endsWith('\n')) throw new Error('MODE_C_JOURNAL_CORRUPT');
    const events:ModeCEvent[]=text.trimEnd().split('\n').map(line=>JSON.parse(line) as ModeCEvent);
    let reserved=0,submitted=0;
    for (const [i,e] of events.entries()) {
      const {hash,...body}=e;
      if (e.sequence!==i || e.previousHash!==(events[i-1]?.hash??null) || e.policyHash!==c.policyHash ||
        e.manifestHash!==c.manifestHash || hash!==modeCCommitment('journal-event',body) || !Number.isFinite(Date.parse(e.recordedAt)))
        throw new Error('MODE_C_JOURNAL_CORRUPT');
      if (e.kind==='RESERVED' && ++reserved>1) throw new Error('MODE_C_JOURNAL_CORRUPT');
      if (e.kind==='SUBMITTING' && (reserved!==1 || ++submitted>1)) throw new Error('MODE_C_JOURNAL_CORRUPT');
      hashJournalBytes(encoder.encode(canonicalJson(e.journal)));
      if (e.journal.manifestHash!==c.manifestHash || e.journal.executionPlanHash!==c.executionPlanHash ||
        e.journal.workflowId!==c.workflow.workflowId || (i>0 && canonicalJson(e.journal.entries.slice(0,events[i-1]!.journal.entries.length))!==
          canonicalJson(events[i-1]!.journal.entries))) throw new Error('MODE_C_JOURNAL_CORRUPT');
    }
    return events;
  }
  const events=async()=>parse(await storage.log.read(name));
  async function append(kind:ModeCEvent['kind'],details:unknown):Promise<ModeCEvent> {
    const prior=await storage.log.read(name), history=parse(prior);
    let journal=history.at(-1)?.journal??createJournal({journalId:`dip-journal-${authority.slice(2,26)}`,
      workflowId:c.workflow.workflowId,manifestHash:c.manifestHash,executionPlanHash:c.executionPlanHash});
    const parent=(level:JournalLevel,toState:JournalEntry['toState'])=>{
      journal=appendJournalState(journal,{level,entityId:level==='workflow'?c.workflow.workflowId:level==='segment'?'dip-segment':'dip-swap',
        segmentId:level==='workflow'?null:'dip-segment',stepId:level==='step'?'dip-swap':null,executionAttemptId:null,
        toState,recordedAt:new Date().toISOString()}).journal;
    };
    if(!journal.entries.length){parent('workflow','DRAFT');parent('segment','PLANNED');parent('step','PLANNED');}
    const transition=(toState:'PREPARED'|'SUBMITTING'|'PENDING'|'SUBMISSION_RESULT_UNKNOWN'|'CONFIRMED'|'REVERTED'|'RECONCILIATION_REQUIRED')=>{
      journal=appendJournalState(journal,{level:'attempt',entityId:'dip-swap-attempt',segmentId:'dip-segment',stepId:'dip-swap',
        executionAttemptId:'dip-swap-attempt',toState,recordedAt:new Date().toISOString()}).journal;
    };
    const last=()=>journal.entries.findLast(e=>e.level==='attempt')?.toState;
    if(kind==='RESERVED') {
      parent('workflow','REVIEWED');parent('workflow','SIMULATED');parent('workflow','AUTHORIZED');
      parent('segment','READY');parent('step','READY');transition('PREPARED');
    }
    if(kind==='SUBMITTING') {
      parent('workflow','EXECUTING');parent('segment','EXECUTING');parent('step','EXECUTING');transition('SUBMITTING');
    }
    if(kind==='SUBMITTED')transition('PENDING');
    if(kind==='RECONCILIATION') {
      const outcome=(details as ModeCReconciliation).outcome;
      if(outcome==='RECONCILED'||outcome==='REVERTED') {
        transition(outcome==='RECONCILED'?'CONFIRMED':'REVERTED');transition('RECONCILIATION_REQUIRED');
        for(const level of ['step','segment','workflow'] as const) {
          if(outcome==='RECONCILED'){parent(level,'RECONCILING');parent(level,'COMPLETED');}
          else parent(level,'FAILED');
        }
      } else if(last()==='SUBMITTING')transition('SUBMISSION_RESULT_UNKNOWN');
      if(outcome==='DIVERGENT'&&last()!=='RECONCILIATION_REQUIRED')transition('RECONCILIATION_REQUIRED');
    }
    const body={sequence:history.length,previousHash:history.at(-1)?.hash??null,policyHash:c.policyHash,
      manifestHash:c.manifestHash,recordedAt:new Date().toISOString(),kind,details,journal};
    const event={...body,hash:modeCCommitment('journal-event',body)};
    const next=encoder.encode((prior?new TextDecoder().decode(prior):'')+canonicalJson(event)+'\n');
    await storage.log.extend(name,next,b=>{parse(b);});
    return event;
  }
  function ledger(history:readonly ModeCEvent[],now:number):ModeCLedger {
    const reservations=history.filter(e=>e.kind==='RESERVED').map(e=>e.details as {at:number;observationHash:string;amount:string;period:number});
    const period=Math.floor((now-p.startsAt)/p.periodSeconds);
    return {totalReserved:reservations.reduce((s,r)=>s+BigInt(r.amount),0n),
      periodReserved:reservations.filter(r=>r.period===period).reduce((s,r)=>s+BigInt(r.amount),0n),
      executions:reservations.length,lastReservedAt:reservations.at(-1)?.at??null,
      observationHashes:reservations.map(r=>r.observationHash),revoked:history.some(e=>e.kind==='REVOCATION_CONFIRMED'),
      paused:history.some(e=>e.kind==='REVOCATION_REQUESTED')};
  }
  const remaining=(l:ModeCLedger)=>({total:(BigInt(p.totalBudget)-l.totalReserved).toString(),
    period:(BigInt(p.perPeriodBudget)-l.periodReserved).toString(),actions:Math.max(0,1-l.executions),revoked:l.revoked,paused:l.paused});
  async function reconcile(history:readonly ModeCEvent[]):Promise<ModeCReconciliation|null> {
    const prepared=history.find(e=>e.kind==='SUBMITTING')?.details as ModeCTransaction|undefined;
    if (!prepared) return null;
    const last=history.findLast(e=>e.kind==='RECONCILIATION')?.details as ModeCReconciliation|undefined;
    if (last?.outcome==='RECONCILED' || last?.outcome==='REVERTED' || last?.outcome==='DIVERGENT') return last;
    let result:ModeCReconciliation;
    try {result=await driver.reconcile(prepared);}
    catch {result={outcome:'INCONCLUSIVE',transactionHash:prepared.hash,details:{code:'MODE_C_RECONCILIATION_UNAVAILABLE'}};}
    if (result.transactionHash!==prepared.hash || !['RECONCILED','REVERTED','INCONCLUSIVE','DIVERGENT'].includes(result.outcome))
      result={outcome:'DIVERGENT',transactionHash:prepared.hash,details:{code:'MODE_C_RECONCILIATION_BINDING_INVALID'}};
    await append('RECONCILIATION',result);return result;
  }
  async function attempt(action?:ModeCAction) {
    const attemptId=`dip-attempt-${randomUUID()}`;
    const auditName=attemptId+'.jsonl';
    const begin=canonicalJson({attemptId,policyHash:c.policyHash,manifestHash:c.manifestHash,kind:'STARTED',recordedAt:new Date().toISOString(),ledgerName:name,observation:null,freshness:'NOT_EVALUATED',triggerEvaluation:null,budgetBefore:null,reservation:'NOT_ATTEMPTED',execution:null,reconciliation:null,remainingAuthority:null,revocation:'NOT_CHECKED',expiry:'NOT_CHECKED'})+'\n';
    if (!await storage.log.create(auditName,encoder.encode(begin))) throw new Error('MODE_C_ATTEMPT_COLLISION');
    try {
      const result=await storage.leases.hold(name,async()=>{
        await append('ATTEMPT',{attemptId});
        const now=await driver.now();
        const history=await events(), before=ledger(history,now);
        const priorResult=await reconcile(history); // read-only recovery even after expiry/revocation
        let observation:{artifact:QuoteStateArtifact;raw:string}|null=null;
        let decision:ModeCDecision;
        try {
          observation=await driver.observe();
          if (observation.artifact.rawResponseHash!==hashRawBytes('raw-response',encoder.encode(observation.raw)))
            throw new Error('MODE_C_RAW_OBSERVATION_MISMATCH');
          decision=evaluateModeC(p,observation.artifact,now,before,action);
        } catch (e) {
          decision={eligible:false,code:e instanceof Error && /^MODE_C_[A-Z_]+$/.test(e.message)?e.message:'MODE_C_MONITORING_UNAVAILABLE',
            freshness:'INVALID',observationHash:null,triggerMet:null,period:null};
        }
        if (decision.eligible) {
          let verified=false;
          try {verified=await driver.verifyInstalled() && await driver.eligible();} catch { /* unverifiable authority fails closed */ }
          if (!verified) decision={...decision,eligible:false,code:'MODE_C_AUTHORITY_UNVERIFIABLE'};
        }
        await append('DECISION',{attemptId,now,observation,decision,budgetBefore:remaining(before),
          revocation:before.revoked?'CONFIRMED':before.paused?'REQUESTED':'ACTIVE',expired:now>=p.expiresAt});
        if (!decision.eligible) return {attemptId,decision,reconciliation:priorResult,remaining:remaining(before)};
        // Single CAS extension atomically records amount, period, observation/action consumption AND evidence.
        await append('RESERVED',{attemptId,at:now,period:decision.period,observationHash:decision.observationHash,
          amount:p.maximumSwapAmount,budgetBefore:remaining(before),budgetAfter:remaining({ ...before,
            totalReserved:before.totalReserved+BigInt(p.maximumSwapAmount),periodReserved:before.periodReserved+BigInt(p.maximumSwapAmount),executions:1 })});
        let tx:ModeCTransaction;
        try {
          // Recheck the clock/live verifier after reservation. A failed recheck consumes the one attempt conservatively.
          const current=await driver.now();
          if (current>=p.expiresAt || current<now || !await driver.verifyInstalled() || !await driver.eligible())
            throw new Error('MODE_C_DISPATCH_RECHECK_FAILED');
          const fresh=readModeCPoolObservation(observation!.artifact,p);
          if (current>=fresh.expiresAt) throw new Error('MODE_C_STALE_OBSERVATION');
          tx=await driver.prepareExact({from:p.executor,to:p.roles,data:p.executorCalldata,value:'0x0'});
          if (!hashPattern.test(tx.hash) || !/^(?:0|[1-9][0-9]*)$/.test(tx.nonce) || !/^0x(?:[0-9a-f]{2})+$/.test(tx.raw))
            throw new Error('MODE_C_PREPARED_TRANSACTION_INVALID');
          await append('SUBMITTING',tx); // durable signed hash/nonce before possible broadcast
        } catch (e) {
          await append('DECISION',{attemptId,code:e instanceof Error && /^MODE_C_[A-Z_]+$/.test(e.message)?e.message:'MODE_C_PREPARATION_FAILED',reservationRetained:true});
          return {attemptId,decision:{...decision,eligible:false,code:'MODE_C_RESERVED_REQUIRES_REVIEW'},reconciliation:null,
            remaining:remaining(ledger(await events(),now))};
        }
        try {
          if (await driver.submitExact(tx)!==tx.hash) throw new Error('MODE_C_SUBMISSION_UNKNOWN');
          await append('SUBMITTED',{attemptId,transactionHash:tx.hash});
        } catch { /* possibly broadcast: do not release, prepare again or resubmit */ }
        const outcome=await reconcile(await events());
        return {attemptId,decision,reconciliation:outcome,remaining:remaining(ledger(await events(),now))};
      });
      const final=encoder.encode(begin+canonicalJson({kind:'RESULT',result})+'\n');
      await storage.log.extend(auditName,final,()=>undefined);
      return result;
    } catch (error) {
      const code=error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'MODE_C_ATTEMPT_FAILED';
      await storage.log.extend(auditName,encoder.encode(begin+canonicalJson({kind:'FAILED',code})+'\n'),()=>undefined);
      throw error;
    }
  }
  return {attempt,events,logName:name,
    recover:()=>storage.leases.hold(name,async()=>reconcile(await events())),
    status:async()=>remaining(ledger(await events(),await driver.now())),
    requestRevocation:()=>storage.leases.hold(name,async()=>append('REVOCATION_REQUESTED',{localPause:true})),
    confirmRevocation:(receipts:readonly string[])=>storage.leases.hold(name,async()=>{
      if (!receipts.length || receipts.some(r=>!hashPattern.test(r)) || !await driver.verifyRevoked(receipts)) throw new Error('MODE_C_REVOCATION_UNCONFIRMED');
      return append('REVOCATION_CONFIRMED',{receipts});
    }),
  };
}
