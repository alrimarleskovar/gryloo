// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, unlink, rmdir, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { validateAuthoringWorkflow, createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { simulateSupply, assertSupplyReview, readSupplyState, readBorrowState, readSupplyLatestNonce, rpcHash, supplyHex, supplyHash, type SupplyRpc, type SupplyReview } from '@defi-workflow-engine/reference-compiler';
import { createSupplyRun, prepareSupplyAttempt, supplyTransition, discoverSupplyTransaction, validateSupplyRun, writeExtendingFile,
  type SupplyRun, type SupplyAttempt } from '@defi-workflow-engine/reference-executor';
import { reconcileSupplyAttempt, buildSupplyEvidence, type SupplyObservation } from '@defi-workflow-engine/reference-reconciler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
export type SupplyWalletDiagnostic = { invoked:boolean; rejectionCode?:number; transaction:Record<string,string>|null; calls:{method:string;submission?:boolean;params:unknown[];result?:unknown;error?:unknown}[]; error:unknown; code:string };
export type SupplyAbsence = { outcome:'NOT_FOUND'; block:number; latestNonce:string; pendingNonce:string; allowance:string; observedAt:string };
export type SupplyRecord = SupplyRun & { observations: SupplyObservation[]; evidence: ReturnType<typeof buildSupplyEvidence> | null; error: string | null;
  absence?:SupplyAbsence; recoveryOf?:string; submissionError?:string; walletDiagnostic?:SupplyWalletDiagnostic; notSubmitted?:boolean; walletManagedNonce?:true; approvalProof?:{hash:string;observation:SupplyObservation}; priorApproval?:{runId:string;hash:string} };
export type SupplyBegin = { record:SupplyRecord; step:SupplyAttempt['step']; transaction:SupplyAttempt['transaction'] & {nonce:string;gas:string;gasPrice:string} };
const idCheck=(id:string)=>{if(!/^supply-[a-f0-9]{32}$/.test(id))throw new Error('SUPPLY_ID_INVALID');return id;};
export function createSupplyService(input:{rpc:SupplyRpc;journalDir:string;provenance:'PUBLIC_TESTNET'|'MOCKED'}) {
  if(!isAbsolute(input.journalDir)||input.journalDir.includes('/.git/'))throw new Error('SUPPLY_STORAGE_INVALID');
  const path=(id:string)=>join(input.journalDir,idCheck(id)+'.jsonl');
  const validate=(bytes:Uint8Array)=>{
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(!text.endsWith('\n')||bytes.length>16_777_216)throw new Error('SUPPLY_STORE_CORRUPT');
    let prior:SupplyRecord|null=null;
    for(const line of text.trimEnd().split('\n')) {
      const record=JSON.parse(line) as SupplyRecord;validateSupplyRun(record);
      if(record.recoveryOf&&(idCheck(record.recoveryOf)===record.id)||record.absence&&(record.absence.outcome!=='NOT_FOUND'||!Number.isSafeInteger(record.absence.block)||
          record.attempts[0]?.step!=='APPROVAL'||record.absence.block<=record.attempts[0].preparedAtBlock+128||record.absence.latestNonce!==record.attempts[0].nonce||record.absence.latestNonce!==record.absence.pendingNonce||!/^[0-9]+$/.test(record.absence.latestNonce)||record.absence.allowance!=='0'||!Number.isFinite(Date.parse(record.absence.observedAt))))throw new Error('SUPPLY_STORE_CORRUPT');
      if(record.approvalProof&&(!record.attempts[0]||record.attempts[0].step!=='APPROVAL'||record.attempts[0].transactionHash!==record.approvalProof.hash||record.attempts[0].state!=='RECONCILIATION_REQUIRED'||record.verdict!=='DIVERGENT'||record.approvalProof.observation.verdict!=='RECONCILED'||!record.approvalProof.observation.walletEnvelope||JSON.stringify(record.observations.at(-1))!==JSON.stringify(record.approvalProof.observation)))throw new Error('SUPPLY_STORE_CORRUPT');
      if(record.priorApproval&&(!/^supply-[a-f0-9]{32}$/.test(record.priorApproval.runId)||!/^0x[0-9a-f]{64}$/.test(record.priorApproval.hash)||record.review.approvalRequired))throw new Error('SUPPLY_STORE_CORRUPT');
      if(record.notSubmitted&&(!record.walletDiagnostic||record.attempts.some(a=>!a.reconciled&&(a.transactionHash||!['CANCELLED','NOT_FOUND'].includes(a.state)))))throw new Error('SUPPLY_STORE_CORRUPT');
      if(record.provenance!==input.provenance||prior&&(record.id!==prior.id||record.review.commitment!==prior.review.commitment||record.attempts.length<prior.attempts.length||record.recoveryOf!==prior.recoveryOf||prior.absence&&JSON.stringify(record.absence)!==JSON.stringify(prior.absence)))throw new Error('SUPPLY_STORE_CORRUPT');
      if(prior){
        const prefix=(before:unknown[],after:unknown[])=>after.length>=before.length&&JSON.stringify(after.slice(0,before.length))===JSON.stringify(before);
        if(!prefix(prior.journal.entries,record.journal.entries)||!prefix(prior.observations,record.observations)||
            prior.ownerInitiated&&!record.ownerInitiated || prior.verdict!=='PENDING'&&record.verdict!==prior.verdict ||
            prior.walletManagedNonce&&!record.walletManagedNonce || prior.approvalProof&&JSON.stringify(record.approvalProof)!==JSON.stringify(prior.approvalProof) || prior.priorApproval&&JSON.stringify(record.priorApproval)!==JSON.stringify(prior.priorApproval) || prior.evidence&&JSON.stringify(record.evidence)!==JSON.stringify(prior.evidence))throw new Error('SUPPLY_STORE_CORRUPT');
        for(const [index,before] of prior.attempts.entries()){
          const after=record.attempts[index]!;
          if(before.step!==after.step||before.nonce!==after.nonce||before.preparedAtBlock!==after.preparedAtBlock||
              JSON.stringify(before.transaction)!==JSON.stringify(after.transaction)||before.transactionHash&&before.transactionHash!==after.transactionHash||
              before.reconciled&&!after.reconciled||before.receipt&&JSON.stringify(before.receipt)!==JSON.stringify(after.receipt))throw new Error('SUPPLY_STORE_CORRUPT');
        }
      }
      prior=record;
    }
  };
  const load=async(id:string):Promise<SupplyRecord>=>{const bytes=await readFile(path(id));validate(bytes);return JSON.parse(bytes.toString().trimEnd().split('\n').at(-1)!) as SupplyRecord;};
  const save=async(record:SupplyRecord)=>{
    let prior='';try{prior=await readFile(path(record.id),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    await writeExtendingFile(path(record.id),new TextEncoder().encode(prior+JSON.stringify(record)+'\n'),validate);
  };
  async function locked<T>(key:string,action:()=>Promise<T>):Promise<T>{
    await mkdir(input.journalDir,{recursive:true,mode:0o700});
    const directory=join(input.journalDir,key+'.lock');
    try{await mkdir(directory,{mode:0o700});}catch(e){
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      const before=await stat(directory);
      let pid:number;try{pid=Number(await readFile(join(directory,'pid'),'utf8'));}catch(cause){throw new Error('SUPPLY_BUSY',{cause});}
      if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('SUPPLY_BUSY',{cause:e});
      try{process.kill(pid,0);throw new Error('SUPPLY_BUSY',{cause:e});}catch(cause){if((cause as NodeJS.ErrnoException).code!=='ESRCH')throw cause;}
      const after=await stat(directory);if(before.ino!==after.ino)throw new Error('SUPPLY_BUSY',{cause:e});
      await unlink(join(directory,'pid'));await rmdir(directory);await mkdir(directory,{mode:0o700});
    }
    const handle=await open(join(directory,'pid'),'wx',0o600);
    try{await handle.writeFile(String(process.pid));await handle.sync();}finally{await handle.close();}
    try{return await action();}finally{await unlink(join(directory,'pid'));await rmdir(directory);}
  }
  async function verifyPriorApproval(record:SupplyRecord):Promise<SupplyObservation>{
    const link=record.priorApproval;if(!link)throw new Error('SUPPLY_APPROVAL_PROOF_MISSING');
    const source=await load(link.runId),attempt=source.attempts[0];
    if(!source.approvalProof||source.approvalProof.hash!==link.hash||source.review.account!==record.review.account||source.review.asset!==record.review.asset||source.review.pool!==record.review.pool||source.review.amount!==record.review.amount||source.review.beneficiary!==record.review.beneficiary||!attempt)throw new Error('SUPPLY_APPROVAL_PROOF_STALE');
    const proof=await reconcileSupplyAttempt(source.review,attempt,input.rpc);
    if(proof.verdict!=='RECONCILED'||!proof.walletEnvelope||proof.receipt?.transactionHash!==link.hash)throw new Error('SUPPLY_APPROVAL_PROOF_STALE');
    return proof;
  }
  return {
    load,
    async simulate(workflowInput:unknown,account:string):Promise<SupplyRecord>{
      const workflow=validateAuthoringWorkflow(workflowInput,createBaseSepoliaReviewContext());
      const review=await simulateSupply(workflow,account,input.rpc);
      const id='supply-'+randomBytes(16).toString('hex');
      const record:SupplyRecord={...createSupplyRun(id,review,input.provenance),observations:[],evidence:null,error:null};
      await save(record);return record;
    },
    // Read-only preparation of a fresh authorization for the SAME nonce and economic intent.
    // The original unknown attempt remains observable; absence is never proof of non-broadcast.
    async recoverReview(id:string):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      const record=await load(id),attempt=record.attempts[0];
      if(record.review.borrow){
        if(!record.notSubmitted||record.verdict!=='PENDING'||record.attempts.length!==1||attempt?.step!=='BORROW'||attempt.transactionHash)throw new Error('BORROW_RECOVERY_OBSERVE_ONLY');
        const review=await simulateSupply(record.review.workflow,record.review.account,input.rpc);
        if(review.state.nonce!==attempt.nonce||JSON.stringify(review.transactions)!==JSON.stringify(record.review.transactions))throw new Error('BORROW_RECOVERY_STATE_CHANGED');
        const fresh:SupplyRecord={...createSupplyRun('supply-'+randomBytes(16).toString('hex'),review,input.provenance),observations:[],evidence:null,error:null,recoveryOf:id};
        await save(fresh);return fresh;
      }
      if(record.approvalProof){
        const proof=await reconcileSupplyAttempt(record.review,attempt!,input.rpc);
        if(proof.verdict!=='RECONCILED'||!proof.walletEnvelope||proof.receipt?.transactionHash!==record.approvalProof.hash)throw new Error('SUPPLY_APPROVAL_PROOF_STALE');
        const review=await simulateSupply(record.review.workflow,record.review.account,input.rpc);
        if(review.approvalRequired||review.account!==record.review.account||review.amount!==record.review.amount||review.pool!==record.review.pool||review.asset!==record.review.asset||review.beneficiary!==record.review.beneficiary||BigInt(review.allowance)<BigInt(review.amount))throw new Error('SUPPLY_APPROVAL_PROOF_STALE');
        const fresh:SupplyRecord={...createSupplyRun('supply-'+randomBytes(16).toString('hex'),review,input.provenance),observations:[],evidence:null,error:null,priorApproval:{runId:id,hash:record.approvalProof.hash}};
        await save(fresh);return fresh;
      }
      if(!(record.notSubmitted||!record.walletManagedNonce&&record.absence&&record.error==='SUPPLY_TRANSACTION_NOT_FOUND')||record.verdict!=='PENDING'||record.attempts.length!==1||
          attempt?.step!=='APPROVAL'||attempt.reconciled||attempt.transactionHash)throw new Error('SUPPLY_RECOVERY_NOT_AVAILABLE');
      const review=await simulateSupply(record.review.workflow,record.review.account,input.rpc);
      const latestNonce=await readSupplyLatestNonce(input.rpc,review.account);
      if(latestNonce!==attempt.nonce||review.state.nonce!==attempt.nonce||review.allowance!=='0'||
          JSON.stringify(review.transactions)!==JSON.stringify(record.review.transactions))throw new Error('SUPPLY_RECOVERY_STATE_CHANGED_OBSERVE_EXISTING');
      const recovered:SupplyRecord={...createSupplyRun('supply-'+randomBytes(16).toString('hex'),review,input.provenance),observations:[],evidence:null,error:null,recoveryOf:id};
      await save(recovered);return recovered;
    });},
    async review(id:string,commitment:string,workflow:SemanticWorkflow):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      const record=await load(id);
      if(record.attempts.length||record.review.commitment!==commitment)throw new Error('SUPPLY_AUTHORIZATION_REPLACED');
      const state=await (record.review.borrow?readBorrowState:readSupplyState)(input.rpc,record.review.account,record.review.beneficiary);
      assertSupplyReview(record.review,workflow,record.review.account,state);
      if(record.priorApproval)await verifyPriorApproval(record);
      const updated={...record,authorization:commitment};await save(updated);return updated;
    });},
    async invalidate(id:string):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{const record=await load(id);const next={...record,authorization:null,error:'SUPPLY_SEMANTIC_EDIT_REQUIRES_REVIEW'};await save(next);return next;});},
    async begin(id:string,account:string,workflow:SemanticWorkflow):Promise<SupplyBegin>{return locked(idCheck(id),async()=>{
      const record=await load(id),review=record.review;
      if(record.authorization!==review.commitment)throw new Error('SUPPLY_REVIEW_REQUIRED');
      const approvalConfirmed=record.attempts.some(a=>a.step==='APPROVAL'&&a.reconciled);
      const state=await (review.borrow?readBorrowState:readSupplyState)(input.rpc,account,review.beneficiary);
      if(record.priorApproval)await verifyPriorApproval(record);
      assertSupplyReview(review,workflow,account,state,Date.now(),approvalConfirmed);
      const index=approvalConfirmed?review.transactions.length-1:0;
      const gas=review.gasLimits[index]!;
      if(BigInt(state.nativeBalance)<BigInt(gas)*BigInt(review.gasPrice)+10_000_000_000_000n||BigInt(state.gasPrice)>BigInt(review.gasPrice))throw new Error('SUPPLY_INSUFFICIENT_ETH');
      const prepared={...prepareSupplyAttempt(record,state.block,state.nonce,false),observations:record.observations,evidence:record.evidence,error:null};
      const attempt=prepared.attempts.at(-1)!;
      // Permanent nonce lease across runs/processes. Uncertainty never releases economic intent.
      const leaseKey=`${review.account}-${attempt.nonce}`,lease=join(input.journalDir,leaseKey+'.intent');
      await locked(leaseKey,async()=>{
        const entry={id,step:attempt.step,transaction:attempt.transaction};
        async function reserveBorrowIntent(){if(review.borrow){
          // Workflow IDs/revisions and the provider nonce cannot create a new economic
          // identity for the same owner, chain, Pool and exact Borrow calldata.
          const economicLease=join(input.journalDir,'borrow-'+supplyHash({transactions:review.transactions}).slice(2)+'.intent');
          let previous:string|null=null;try{previous=await readFile(economicLease,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
          if(previous!==null){
            if(!record.recoveryOf||JSON.parse(previous.trimEnd().split('\n').at(-1)!).id!==record.recoveryOf||!(await load(record.recoveryOf)).notSubmitted)throw new Error('BORROW_EXISTING_INTENT_OBSERVE_ONLY');
            await writeExtendingFile(economicLease,new TextEncoder().encode(previous+JSON.stringify(entry)+'\n'),bytes=>{const history=new TextDecoder().decode(bytes).trimEnd().split('\n').map(line=>JSON.parse(line));if(history.some(item=>JSON.stringify(item.transaction)!==JSON.stringify(entry.transaction)))throw new Error('SUPPLY_STORE_CORRUPT');});
          }else{const handle=await open(economicLease,'wx',0o600);try{await handle.writeFile(JSON.stringify(entry)+'\n');await handle.sync();}finally{await handle.close();}}
        }}
        let prior:string|null=null;try{prior=await readFile(lease,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
        if(prior!==null){
          const entries=prior.trimEnd().split('\n').map(line=>JSON.parse(line) as typeof entry),last=entries.at(-1)!;
          // A completed EIP-7702 call can leave the owner nonce unchanged. Reuse it only
          // after independently proving the prior economic intent completed exactly once.
          if(review.borrow&&!record.recoveryOf){
            const priorRun=await load(last.id),priorAttempt=priorRun.attempts.find(a=>a.step===last.step);
            if(priorRun.verdict!=='RECONCILED'||!priorAttempt?.reconciled||priorAttempt.nonce!==attempt.nonce||JSON.stringify(priorAttempt.transaction)!==JSON.stringify(last.transaction))throw new Error('SUPPLY_NONCE_ALREADY_RESERVED');
            const proof=await reconcileSupplyAttempt(priorRun.review,priorAttempt,input.rpc);
            if(proof.verdict!=='RECONCILED'||proof.walletEnvelope?.owner!==review.account||proof.walletEnvelope.ownerNonceAfter!==attempt.nonce)throw new Error('SUPPLY_NONCE_ALREADY_RESERVED');
            await reserveBorrowIntent();
            await writeExtendingFile(lease,new TextEncoder().encode(prior+JSON.stringify(entry)+'\n'),bytes=>{
              const history=new TextDecoder('utf-8',{fatal:true}).decode(bytes).trimEnd().split('\n').map(line=>JSON.parse(line) as typeof entry);
              const unchanged=JSON.stringify(history)===JSON.stringify(entries);
              const extended=history.length===entries.length+1&&JSON.stringify(history.slice(0,-1))===JSON.stringify(entries)&&JSON.stringify(history.at(-1))===JSON.stringify(entry);
              if(!unchanged&&!extended)throw new Error('SUPPLY_STORE_CORRUPT');
            });
            return;
          }
          if(!record.recoveryOf)throw new Error('SUPPLY_NONCE_ALREADY_RESERVED');
          const source=await load(record.recoveryOf),original=source.attempts[0];
          if(last.id!==source.id||!['APPROVAL',...(review.borrow?['BORROW']:[])].includes(last.step)||!(source.notSubmitted||!source.walletManagedNonce&&source.absence&&source.error==='SUPPLY_TRANSACTION_NOT_FOUND')||
              source.verdict!=='PENDING'||source.attempts.length!==1||original?.reconciled||original?.transactionHash||
              original?.nonce!==attempt.nonce||JSON.stringify(last.transaction)!==JSON.stringify(attempt.transaction)||
              JSON.stringify(source.review.workflow)!==JSON.stringify(review.workflow)||JSON.stringify(source.review.transactions)!==JSON.stringify(review.transactions))throw new Error('SUPPLY_NONCE_ALREADY_RESERVED');
          await reserveBorrowIntent();
          // Append ownership of the SAME nonce; never delete its durable economic identity.
          await writeExtendingFile(lease,new TextEncoder().encode(prior+(prior.endsWith('\n')?'':'\n')+JSON.stringify(entry)+'\n'),bytes=>{
            const history=new TextDecoder('utf-8',{fatal:true}).decode(bytes).trimEnd().split('\n').map(line=>JSON.parse(line) as typeof entry);
            if(history.some(item=>!/^supply-[a-f0-9]{32}$/.test(item.id)||(!review.borrow&&(item.step!==entry.step||JSON.stringify(item.transaction)!==JSON.stringify(entry.transaction))))||new Set(history.map(item=>item.id)).size!==history.length)throw new Error('SUPPLY_STORE_CORRUPT');
          });
        }else{
          if(record.recoveryOf)throw new Error('SUPPLY_NONCE_ALREADY_RESERVED');
          await reserveBorrowIntent();
          const handle=await open(lease,'wx',0o600);
          try{await handle.writeFile(JSON.stringify(entry)+'\n');await handle.sync();}finally{await handle.close();}
        }
      });
      const dirHandle=await open(input.journalDir,'r');try{await dirHandle.sync();}finally{await dirHandle.close();}
      await save(prepared); // Must complete BEFORE any uncertain wallet submission.
      return {record:prepared,step:attempt.step,transaction:{...attempt.transaction,nonce:supplyHex(attempt.nonce),gas:supplyHex(gas),gasPrice:supplyHex(review.gasPrice)}};
    });},
    async handoff(id:string,step:'APPROVAL'|'SUPPLY'|'BORROW',walletManagedNonce=false):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      const record=await load(id),attempt=record.attempts.find(a=>a.step===step);
      if(record.review.borrow){const state=await readBorrowState(input.rpc,record.review.account,record.review.beneficiary);assertSupplyReview(record.review,record.review.workflow,record.review.account,state);}
      if(!attempt||attempt.state!=='PREPARED'||record.authorization!==record.review.commitment||Date.now()>=Date.parse(record.review.expiresAt))throw new Error('SUPPLY_WALLET_HANDOFF_NOT_AUTHORIZED');
      if(walletManagedNonce&&record.recoveryOf&&!(await load(record.recoveryOf)).notSubmitted)throw new Error('SUPPLY_RECOVERY_NOT_AVAILABLE');
      const next={...record,...supplyTransition(record,attempt,'SUBMITTING'),...walletManagedNonce?{walletManagedNonce:true as const}:{}};await save(next);return next;
    });},
    // Diagnostics cannot authorize, send, or reconcile a transaction. An invoked send stays uncertain.
    async walletFailure(id:string,diagnostic:SupplyWalletDiagnostic):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      const record=await load(id),attempt=record.attempts.find(a=>!a.reconciled);
      if(JSON.stringify(diagnostic).length>65536||typeof diagnostic.invoked!=='boolean'||!/^(?:SUPPLY|BORROW)_[A-Z0-9_]{2,70}$/.test(diagnostic.code)||!Array.isArray(diagnostic.calls))throw new Error('SUPPLY_DIAGNOSTIC_INVALID');
      const send=diagnostic.calls.find(c=>c.submission===true),error=send?.error as {code?:unknown}|undefined;
      const refused=diagnostic.invoked&&send&&send.result===undefined&&typeof error?.code==='number'&&error.code===diagnostic.rejectionCode&&[4001,4100,4200,-32600,-32601,-32602].includes(error.code);
      if((diagnostic.invoked||send)&&!refused||attempt?.transactionHash||attempt?.reconciled)throw new Error('SUPPLY_DIAGNOSTIC_NOT_PRE_SUBMISSION');
      let next=record;
      if(attempt){
        if(!['PREPARED','SUBMITTING','SUBMISSION_RESULT_UNKNOWN','NOT_FOUND','CANCELLED'].includes(attempt.state))throw new Error('SUPPLY_DIAGNOSTIC_NOT_PRE_SUBMISSION');
        if(attempt.state==='PREPARED')next={...next,...supplyTransition(next,attempt,'CANCELLED')};
        if(attempt.state==='SUBMITTING')next={...next,...supplyTransition(next,attempt,'SUBMISSION_RESULT_UNKNOWN')};
        if(['SUBMITTING','SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state))next={...next,...supplyTransition(next,next.attempts.at(-1)!,'NOT_FOUND')};
      }
      next={...next,authorization:!attempt&&record.attempts.some(a=>a.reconciled)?record.authorization:null,error:diagnostic.code,submissionError:diagnostic.code,walletDiagnostic:diagnostic,notSubmitted:Boolean(attempt)};
      await save(next);return next;
    });},
    async walletTrace(id:string,diagnostic:SupplyWalletDiagnostic):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      const record=await load(id);
      if(JSON.stringify(diagnostic).length>65536||typeof diagnostic.invoked!=='boolean'||!Array.isArray(diagnostic.calls))throw new Error('SUPPLY_DIAGNOSTIC_INVALID');
      const next={...record,walletDiagnostic:diagnostic};await save(next);return next;
    });},
    async report(id:string,step:'APPROVAL'|'SUPPLY'|'BORROW',result:{kind:'HASH';hash:string}|{kind:'UNKNOWN'|'REJECTED';code?:string}):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      const record=await load(id),attempt=record.attempts.find(a=>a.step===step);
      if(!attempt)throw new Error('SUPPLY_ATTEMPT_MISSING');
      if(result.kind==='HASH'){
        const hash=rpcHash(result.hash);if(attempt.transactionHash&&attempt.transactionHash!==hash)throw new Error('SUPPLY_HASH_DIVERGENT');
        if(attempt.reconciled||['REVERTED','RECONCILIATION_REQUIRED'].includes(attempt.state))return record;
        const submitted=attempt.state==='PREPARED'?supplyTransition(record,attempt,'SUBMITTING'):record;
        const updated={...submitted,attempts:submitted.attempts.map(a=>a.step===step?{...a,transactionHash:hash}:a)};
        const next={...supplyTransition(updated,updated.attempts.find(a=>a.step===step)!,'PENDING'),observations:record.observations,evidence:record.evidence,error:null};await save(next);return next;
      }
      if(!['SUBMITTING','SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state))return record;
      const next={...supplyTransition(record,attempt,'SUBMISSION_RESULT_UNKNOWN'),observations:record.observations,evidence:record.evidence,
        error:result.kind==='REJECTED'?(step==='APPROVAL'?'SUPPLY_APPROVAL_REJECTED':'SUPPLY_REJECTED'):'SUPPLY_SUBMISSION_UNKNOWN',
        ...result.code&&/^[A-Z][A-Z0-9_]{2,80}$/.test(result.code)?{submissionError:result.code}:{}};
      await save(next);return next;
    });},
    async observe(id:string):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      let record=await load(id);
      if(record.verdict==='DIVERGENT'&&!record.approvalProof&&record.attempts.length===1&&record.attempts[0]?.step==='APPROVAL'&&record.attempts[0].state==='RECONCILIATION_REQUIRED'&&record.error==='SUPPLY_TRANSACTION_MISMATCH'&&record.attempts[0].transactionHash){
        const proof=await reconcileSupplyAttempt(record.review,record.attempts[0],input.rpc);
        if(proof.verdict==='RECONCILED'&&proof.walletEnvelope){record={...record,approvalProof:{hash:record.attempts[0].transactionHash,observation:proof},observations:[...record.observations,proof],error:null};await save(record);}
      }
      const attempt=record.attempts.find(a=>!a.reconciled);
      if(!attempt||record.verdict!=='PENDING')return record;
      if(attempt.state==='PREPARED'){
        const diagnostic:SupplyWalletDiagnostic={invoked:false,transaction:null,calls:[],error:{message:'Restart before durable wallet handoff'},code:'SUPPLY_WALLET_NOT_SUBMITTED'};
        record={...record,...supplyTransition(record,attempt,'CANCELLED'),authorization:null,notSubmitted:true,walletDiagnostic:diagnostic,error:diagnostic.code};await save(record);return record;
      }
      if(!record.walletDiagnostic&&!attempt.transactionHash&&attempt.state==='SUBMISSION_RESULT_UNKNOWN'&&
          ['SUPPLY_WALLET_OR_AUTHORIZATION_CHANGED','SUPPLY_RPC_ERROR_BEFORE_WALLET_SUBMISSION'].includes(record.submissionError??'')){
        const state=await (record.review.borrow?readBorrowState:readSupplyState)(input.rpc,record.review.account,record.review.beneficiary),nonce=await readSupplyLatestNonce(input.rpc,record.review.account);
        if(nonce===attempt.nonce&&state.nonce===attempt.nonce&&state.allowance===record.review.allowance){
          const diagnostic:SupplyWalletDiagnostic={invoked:false,transaction:null,calls:[],error:{message:record.submissionError,legacy:true,detail:'The recorded pre-call guard threw before the wallet submission method; individual guard inputs were not logged.'},code:'SUPPLY_WALLET_NOT_SUBMITTED'};
          record={...record,...supplyTransition(record,attempt,'NOT_FOUND'),authorization:null,notSubmitted:true,walletDiagnostic:diagnostic,error:diagnostic.code};await save(record);return record;
        }
      }
      if(record.notSubmitted)return record;
      const found=await discoverSupplyTransaction(attempt,input.rpc);
      if(found.mismatch){record={...record,verdict:'DIVERGENT',error:'SUPPLY_REPLACED_TRANSACTION_MISMATCH'};await save(record);return record;}
      if(!found.hash){
        record={...record,error:found.exhausted?'SUPPLY_OBSERVATION_BOUND_REACHED':'SUPPLY_TRANSACTION_NOT_OBSERVED'};
        if(!record.walletManagedNonce&&found.exhausted&&attempt.step==='APPROVAL'&&record.attempts.length===1){
          const state=await (record.review.borrow?readBorrowState:readSupplyState)(input.rpc,record.review.account,record.review.beneficiary);
          const latestNonce=await readSupplyLatestNonce(input.rpc,state.account);
          if(latestNonce===attempt.nonce&&state.nonce===attempt.nonce&&state.allowance==='0'){
            record={...record,authorization:null,error:'SUPPLY_TRANSACTION_NOT_FOUND',absence:record.absence??{outcome:'NOT_FOUND',block:state.block,latestNonce:attempt.nonce,pendingNonce:state.nonce,allowance:state.allowance,observedAt:new Date().toISOString()}};
          }
        }
        await save(record);return record;
      }
      let updated:SupplyAttempt={...attempt,transactionHash:found.hash};
      record={...record,attempts:record.attempts.map(a=>a.step===attempt.step?updated:a)};
      if (['SUBMITTING','SUBMISSION_RESULT_UNKNOWN'].includes(updated.state)) {
        record={...supplyTransition(record,updated,'PENDING'),observations:record.observations,evidence:record.evidence,error:null};
        updated=record.attempts.find(a=>a.step===attempt.step)!;
        await save(record);
      }
      const observation=await reconcileSupplyAttempt(record.review,updated,input.rpc);
      if(observation.verdict==='INCONCLUSIVE'){record={...record,error:observation.reason};await save(record);return record;}
      const reverted=observation.reason.endsWith('_REVERTED');
      const state=reverted?'REVERTED':observation.verdict==='RECONCILED'?'CONFIRMED':'RECONCILIATION_REQUIRED';
      record={...supplyTransition(record,updated,state),observations:[...record.observations,observation],evidence:record.evidence,error:observation.verdict==='RECONCILED'?null:observation.reason,
        attempts:record.attempts.map(a=>a.step===attempt.step?{...updated,state,reconciled:observation.verdict==='RECONCILED',receipt:observation.receipt}:a),
        verdict:observation.verdict==='DIVERGENT'?'DIVERGENT':attempt.step!=='APPROVAL'?'RECONCILED':'PENDING'};
      if(record.verdict==='RECONCILED'){const approval=record.priorApproval?await verifyPriorApproval(record):undefined;record={...record,evidence:buildSupplyEvidence({id:record.id,review:record.review,journal:record.journal,provenance:record.provenance,ownerInitiated:record.ownerInitiated,observations:record.observations,...approval?{approval}:{}})};}
      await save(record);return record;
    });},
  };
}
export type SupplyService=ReturnType<typeof createSupplyService>;
export type SupplyReviewData=SupplyReview;
