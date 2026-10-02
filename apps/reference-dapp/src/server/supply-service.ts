// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, unlink, rmdir, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { validateAuthoringWorkflow, createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { simulateSupply, assertSupplyReview, readSupplyState, readBorrowState, readWithdrawState, readSupplyLatestNonce, rpcHash, supplyHex, supplyHash, type SupplyRpc, type SupplyReview } from '@defi-workflow-engine/reference-compiler';
import { createSupplyRun, prepareSupplyAttempt, supplyTransition, discoverSupplyTransaction, validateSupplyRun, writeExtendingFile,
  reserveEconomicIntent, type SupplyRun, type SupplyAttempt } from '@defi-workflow-engine/reference-executor';
import { reconcileSupplyAttempt, buildSupplyEvidence, type SupplyObservation } from '@defi-workflow-engine/reference-reconciler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
export type SupplyWalletDiagnostic = { invoked:boolean; rejectionCode?:number; transaction:Record<string,string>|null; calls:{method:string;submission?:boolean;params:unknown[];result?:unknown;error?:unknown}[]; error:unknown; code:string };
export type SupplyAbsence = { outcome:'NOT_FOUND'; block:number; latestNonce:string; pendingNonce:string; allowance:string; observedAt:string };
export type SupplyRecord = SupplyRun & { observations: SupplyObservation[]; evidence: ReturnType<typeof buildSupplyEvidence> | null; error: string | null;
  absence?:SupplyAbsence; recoveryOf?:string; submissionError?:string; walletDiagnostic?:SupplyWalletDiagnostic; notSubmitted?:boolean; walletManagedNonce?:true; approvalProof?:{hash:string;observation:SupplyObservation}; priorApproval?:{runId:string;hash:string} };
export type SupplyBegin = { record:SupplyRecord; step:SupplyAttempt['step']; transaction:SupplyAttempt['transaction'] & {nonce:string;gas:string;gasPrice:string} };
const idCheck=(id:string)=>{if(!/^supply-[a-f0-9]{32}$/.test(id))throw new Error('SUPPLY_ID_INVALID');return id;};
// Only the historical null-blockHash parser failure may be re-observed from a terminal verdict.
function repayApprovalBlockHashFailure(record:SupplyRecord,observation=record.observations.at(-1)):boolean {
  const attempt=record.attempts[0];
  return Boolean(record.review.repay&&record.verdict==='DIVERGENT'&&record.attempts.length===1&&attempt?.step==='APPROVAL'&&attempt.state==='RECONCILIATION_REQUIRED'&&!attempt.reconciled&&attempt.transactionHash&&observation?.verdict==='DIVERGENT'&&observation.reason==='SUPPLY_RPC_INVALID'&&observation.transaction?.blockHash===null&&observation.transaction.hash===attempt.transactionHash&&observation.receipt?.transactionHash===attempt.transactionHash);
}
function recoveredRepayApproval(record:SupplyRecord):boolean {
  const proof=record.approvalProof;
  return Boolean(proof&&repayApprovalBlockHashFailure(record,record.observations.at(-2))&&proof.hash===record.attempts[0]?.transactionHash&&proof.observation.verdict==='RECONCILED'&&proof.observation.reason==='EXACT_REPAY_APPROVAL_VERIFIED'&&proof.observation.walletEnvelope?.owner===record.review.account);
}
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
              before.ownerNonceAfter&&before.ownerNonceAfter!==after.ownerNonceAfter||before.reconciled&&!after.reconciled||before.receipt&&JSON.stringify(before.receipt)!==JSON.stringify(after.receipt))throw new Error('SUPPLY_STORE_CORRUPT');
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
    if(!(record.review.repay&&source.review.repay&&attempt?.reconciled&&attempt.transactionHash===link.hash)&&(!source.approvalProof||source.approvalProof.hash!==link.hash)||source.review.account!==record.review.account||source.review.asset!==record.review.asset||source.review.pool!==record.review.pool||source.review.amount!==record.review.amount||source.review.beneficiary!==record.review.beneficiary||!attempt)throw new Error('SUPPLY_APPROVAL_PROOF_STALE');
    const proof=await reconcileSupplyAttempt(source.review,attempt,input.rpc);
    if(proof.verdict!=='RECONCILED'||!record.review.repay&&!proof.walletEnvelope||proof.receipt?.transactionHash!==link.hash)throw new Error('SUPPLY_APPROVAL_PROOF_STALE');
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
      if(record.review.repay){
        const last=record.attempts.at(-1);
        const verifiedRecovery=recoveredRepayApproval(record);
        const completedApproval=record.attempts.length===1&&last?.step==='APPROVAL'&&(last.reconciled||verifiedRecovery);
        if(record.verdict!=='PENDING'&&!verifiedRecovery||!last||!completedApproval&&(!record.notSubmitted||last.reconciled||last.transactionHash))throw new Error('REPAY_RECOVERY_OBSERVE_ONLY');
        const review=await simulateSupply(record.review.workflow,record.review.account,input.rpc);
        if(!completedApproval&&review.state.nonce!==last.nonce||JSON.stringify(review.transactions.at(-1))!==JSON.stringify(record.review.transactions.at(-1))||!completedApproval&&last.step==='APPROVAL'&&JSON.stringify(review.transactions)!==JSON.stringify(record.review.transactions))throw new Error('REPAY_RECOVERY_STATE_CHANGED');
        const priorApproval=record.attempts.find(a=>a.step==='APPROVAL'&&(a.reconciled||verifiedRecovery));
        if(priorApproval&&review.approvalRequired)throw new Error('REPAY_APPROVAL_PROOF_STALE');
        const fresh:SupplyRecord={...createSupplyRun('supply-'+randomBytes(16).toString('hex'),review,input.provenance),observations:[],evidence:null,error:null,recoveryOf:id,...priorApproval?{priorApproval:{runId:id,hash:priorApproval.transactionHash!}}:record.priorApproval?{priorApproval:record.priorApproval}:{}};
        if(fresh.priorApproval)await verifyPriorApproval(fresh);
        await save(fresh);return fresh;
      }
      if(record.review.borrow||record.review.withdraw){
        if(!record.notSubmitted||record.verdict!=='PENDING'||record.attempts.length!==1||attempt?.step!==(record.review.withdraw?'WITHDRAW':'BORROW')||attempt.transactionHash)throw new Error('BORROW_RECOVERY_OBSERVE_ONLY');
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
      const state=await (record.review.withdraw?readWithdrawState:record.review.borrow||record.review.repay?readBorrowState:readSupplyState)(input.rpc,record.review.account,record.review.beneficiary);
      assertSupplyReview(record.review,workflow,record.review.account,state);
      if(record.priorApproval)await verifyPriorApproval(record);
      const updated={...record,authorization:commitment};await save(updated);return updated;
    });},
    async invalidate(id:string):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{const record=await load(id);const next={...record,authorization:null,error:'SUPPLY_SEMANTIC_EDIT_REQUIRES_REVIEW'};await save(next);return next;});},
    async begin(id:string,account:string,workflow:SemanticWorkflow):Promise<SupplyBegin>{return locked(idCheck(id),async()=>{
      const record=await load(id),review=record.review;
      if(record.authorization!==review.commitment)throw new Error('SUPPLY_REVIEW_REQUIRED');
      const approvalConfirmed=record.attempts.some(a=>a.step==='APPROVAL'&&a.reconciled);
      const state=await (review.withdraw?readWithdrawState:review.borrow||review.repay?readBorrowState:readSupplyState)(input.rpc,account,review.beneficiary);
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
        async function reserveBorrowIntent(){if(review.borrow||review.withdraw){
          // Workflow IDs/revisions and the provider nonce cannot create a new economic
          // identity for the same owner, chain, Pool and exact Borrow calldata.
          const economicLease=join(input.journalDir,(review.withdraw?'withdraw-':'borrow-')+supplyHash({transactions:review.transactions}).slice(2)+'.intent');
          let previous:string|null=null;try{previous=await readFile(economicLease,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
          if(previous!==null){
            if(!record.recoveryOf||JSON.parse(previous.trimEnd().split('\n').at(-1)!).id!==record.recoveryOf||!(await load(record.recoveryOf)).notSubmitted)throw new Error('BORROW_EXISTING_INTENT_OBSERVE_ONLY');
            await writeExtendingFile(economicLease,new TextEncoder().encode(previous+JSON.stringify(entry)+'\n'),bytes=>{const history=new TextDecoder().decode(bytes).trimEnd().split('\n').map(line=>JSON.parse(line));if(history.some(item=>JSON.stringify(item.transaction)!==JSON.stringify(entry.transaction)))throw new Error('SUPPLY_STORE_CORRUPT');});
          }else{const handle=await open(economicLease,'wx',0o600);try{await handle.writeFile(JSON.stringify(entry)+'\n');await handle.sync();}finally{await handle.close();}}
        }}
        async function reserveRepayIntent(){if(!review.repay)return;
          const economicLease=join(input.journalDir,'repay-'+supplyHash(review.transactions.at(-1)).slice(2)+'.intent');
          await locked('repay-'+supplyHash(review.transactions.at(-1)).slice(2),async()=>{
            let prior:string|null=null;try{prior=await readFile(economicLease,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
            if(prior!==null){
              const previous=JSON.parse(prior.trimEnd().split('\n').at(-1)!);
              if(previous.id===id)return;
              if(!record.recoveryOf||previous.id!==record.recoveryOf)throw new Error('REPAY_EXISTING_INTENT_OBSERVE_ONLY');
              const source=await load(record.recoveryOf);
              if(!source.notSubmitted&&!(record.priorApproval?.runId===source.id&&source.attempts.length===1&&source.attempts[0]?.step==='APPROVAL'&&(source.attempts[0].reconciled||recoveredRepayApproval(source))))throw new Error('REPAY_EXISTING_INTENT_OBSERVE_ONLY');
              await writeExtendingFile(economicLease,new TextEncoder().encode(prior+JSON.stringify(entry)+'\n'),bytes=>{const history=new TextDecoder().decode(bytes).trimEnd().split('\n').map(line=>JSON.parse(line));if(history.some(item=>!/^supply-[a-f0-9]{32}$/.test(item.id)))throw new Error('SUPPLY_STORE_CORRUPT');});
            }else{const handle=await open(economicLease,'wx',0o600);try{await handle.writeFile(JSON.stringify(entry)+'\n');await handle.sync();}finally{await handle.close();}}
          });
        }
        let prior:string|null=null;try{prior=await readFile(lease,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
        if(prior!==null){
          const entries=prior.trimEnd().split('\n').map(line=>JSON.parse(line) as typeof entry),last=entries.at(-1)!;
          // A completed EIP-7702 call can leave the owner nonce unchanged. Reuse it only
          // after independently proving the prior economic intent completed exactly once.
          if((review.borrow||review.repay||review.withdraw)&&(!record.recoveryOf||review.repay&&last.step==='APPROVAL'&&record.priorApproval?.runId===last.id)){
            const priorRun=await load(last.id),priorAttempt=priorRun.attempts.find(a=>a.step===last.step);
            const continuingApproval=review.repay&&(last.id===id||record.priorApproval?.runId===last.id)&&last.step==='APPROVAL';
            if(!continuingApproval&&priorRun.verdict!=='RECONCILED'||!(priorAttempt?.reconciled||continuingApproval&&recoveredRepayApproval(priorRun))||priorAttempt?.nonce!==attempt.nonce||JSON.stringify(priorAttempt.transaction)!==JSON.stringify(last.transaction))throw new Error('SUPPLY_NONCE_ALREADY_RESERVED');
            const proof=await reconcileSupplyAttempt(priorRun.review,priorAttempt,input.rpc);
            if(proof.verdict!=='RECONCILED'||proof.walletEnvelope?.owner!==review.account||proof.walletEnvelope.ownerNonceAfter!==attempt.nonce)throw new Error('SUPPLY_NONCE_ALREADY_RESERVED');
            await reserveBorrowIntent();await reserveRepayIntent();
            await writeExtendingFile(lease,new TextEncoder().encode(prior+JSON.stringify(entry)+'\n'),bytes=>{
              const history=new TextDecoder('utf-8',{fatal:true}).decode(bytes).trimEnd().split('\n').map(line=>JSON.parse(line) as typeof entry);
              const unchanged=JSON.stringify(history)===JSON.stringify(entries);
              const extended=history.length===entries.length+1&&JSON.stringify(history.slice(0,-1))===JSON.stringify(entries)&&JSON.stringify(history.at(-1))===JSON.stringify(entry);
              if(!unchanged&&!extended)throw new Error('SUPPLY_STORE_CORRUPT');
            });
            return;
          }
          if(!record.recoveryOf)throw new Error('SUPPLY_NONCE_ALREADY_RESERVED');
          const source=await load(record.recoveryOf),original=review.repay?source.attempts.at(-1):source.attempts[0];
          if(last.id!==source.id||!['APPROVAL',...(review.borrow?['BORROW']:[]),...(review.withdraw?['WITHDRAW']:[]),...(review.repay?['REPAY']:[])].includes(last.step)||!(source.notSubmitted||!source.walletManagedNonce&&source.absence&&source.error==='SUPPLY_TRANSACTION_NOT_FOUND')||
              source.verdict!=='PENDING'||!review.repay&&source.attempts.length!==1||original?.reconciled||original?.transactionHash||
              original?.nonce!==attempt.nonce||JSON.stringify(last.transaction)!==JSON.stringify(attempt.transaction)||
              JSON.stringify(source.review.workflow)!==JSON.stringify(review.workflow)||JSON.stringify(review.repay?source.review.transactions.at(-1):source.review.transactions)!==JSON.stringify(review.repay?review.transactions.at(-1):review.transactions))throw new Error('SUPPLY_NONCE_ALREADY_RESERVED');
          await reserveBorrowIntent();await reserveRepayIntent();
          // Append ownership of the SAME nonce; never delete its durable economic identity.
          await writeExtendingFile(lease,new TextEncoder().encode(prior+(prior.endsWith('\n')?'':'\n')+JSON.stringify(entry)+'\n'),bytes=>{
            const history=new TextDecoder('utf-8',{fatal:true}).decode(bytes).trimEnd().split('\n').map(line=>JSON.parse(line) as typeof entry);
            if(history.some(item=>!/^supply-[a-f0-9]{32}$/.test(item.id)||(!review.borrow&&!review.repay&&!review.withdraw&&(item.step!==entry.step||JSON.stringify(item.transaction)!==JSON.stringify(entry.transaction))))||new Set(history.map(item=>item.id)).size!==history.length)throw new Error('SUPPLY_STORE_CORRUPT');
          });
        }else{
          if(record.recoveryOf&&!(review.repay&&record.priorApproval))throw new Error('SUPPLY_NONCE_ALREADY_RESERVED');
          await reserveBorrowIntent();await reserveRepayIntent();
          const handle=await open(lease,'wx',0o600);
          try{await handle.writeFile(JSON.stringify(entry)+'\n');await handle.sync();}finally{await handle.close();}
        }
      });
      await reserveEconomicIntent(input.journalDir, attempt.transaction, id, record.recoveryOf);
      const dirHandle=await open(input.journalDir,'r');try{await dirHandle.sync();}finally{await dirHandle.close();}
      await save(prepared); // Must complete BEFORE any uncertain wallet submission.
      return {record:prepared,step:attempt.step,transaction:{...attempt.transaction,nonce:supplyHex(attempt.nonce),gas:supplyHex(gas),gasPrice:supplyHex(review.gasPrice)}};
    });},
    async handoff(id:string,step:'APPROVAL'|'SUPPLY'|'BORROW'|'REPAY'|'WITHDRAW',walletManagedNonce=false):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      const record=await load(id),attempt=record.attempts.find(a=>a.step===step);
      if(record.review.borrow||record.review.repay||record.review.withdraw){const state=await (record.review.withdraw?readWithdrawState:readBorrowState)(input.rpc,record.review.account,record.review.beneficiary);assertSupplyReview(record.review,record.review.workflow,record.review.account,state,Date.now(),record.attempts.some(a=>a.step==='APPROVAL'&&a.reconciled));}
      if(!attempt||attempt.state!=='PREPARED'||record.authorization!==record.review.commitment||Date.now()>=Date.parse(record.review.expiresAt))throw new Error('SUPPLY_WALLET_HANDOFF_NOT_AUTHORIZED');
      if(walletManagedNonce&&record.recoveryOf&&!record.priorApproval&&!(await load(record.recoveryOf)).notSubmitted)throw new Error('SUPPLY_RECOVERY_NOT_AVAILABLE');
      const next={...record,...supplyTransition(record,attempt,'SUBMITTING'),...walletManagedNonce?{walletManagedNonce:true as const}:{}};await save(next);return next;
    });},
    // Diagnostics cannot authorize, send, or reconcile a transaction. An invoked send stays uncertain.
    async walletFailure(id:string,diagnostic:SupplyWalletDiagnostic):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      const record=await load(id),attempt=record.attempts.find(a=>!a.reconciled);
      if(JSON.stringify(diagnostic).length>65536||typeof diagnostic.invoked!=='boolean'||!/^(?:SUPPLY|BORROW|REPAY|WITHDRAW)_[A-Z0-9_]{2,70}$/.test(diagnostic.code)||!Array.isArray(diagnostic.calls))throw new Error('SUPPLY_DIAGNOSTIC_INVALID');
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
    async report(id:string,step:'APPROVAL'|'SUPPLY'|'BORROW'|'REPAY'|'WITHDRAW',result:{kind:'HASH';hash:string}|{kind:'UNKNOWN'|'REJECTED';code?:string}):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
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
      if(!record.approvalProof&&repayApprovalBlockHashFailure(record)){
        const attempt=record.attempts[0]!,proof=await reconcileSupplyAttempt(record.review,attempt,input.rpc);
        if(proof.verdict!=='RECONCILED'||!proof.walletEnvelope||proof.reason!=='EXACT_REPAY_APPROVAL_VERIFIED'||proof.receipt?.transactionHash!==attempt.transactionHash)return record;
        // Preserve the terminal journal and append independent proof of the SAME approval.
        // A fresh explicitly reviewed run may consume this proof, never send approval again.
        record={...record,approvalProof:{hash:attempt.transactionHash!,observation:proof},observations:[...record.observations,proof],authorization:null,error:null};
        await save(record);return record;
      }
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
      if(!record.review.withdraw&&!record.walletDiagnostic&&!attempt.transactionHash&&attempt.state==='SUBMISSION_RESULT_UNKNOWN'&&
          ['SUPPLY_WALLET_OR_AUTHORIZATION_CHANGED','SUPPLY_RPC_ERROR_BEFORE_WALLET_SUBMISSION'].includes(record.submissionError??'')){
        const state=await (record.review.withdraw?readWithdrawState:record.review.borrow||record.review.repay?readBorrowState:readSupplyState)(input.rpc,record.review.account,record.review.beneficiary),nonce=await readSupplyLatestNonce(input.rpc,record.review.account);
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
          const state=await (record.review.withdraw?readWithdrawState:record.review.borrow||record.review.repay?readBorrowState:readSupplyState)(input.rpc,record.review.account,record.review.beneficiary);
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
        attempts:record.attempts.map(a=>a.step===attempt.step?{...updated,state,reconciled:observation.verdict==='RECONCILED',receipt:observation.receipt,...record.review.repay&&observation.walletEnvelope?{ownerNonceAfter:observation.walletEnvelope.ownerNonceAfter}:{}}:a),
        verdict:observation.verdict==='DIVERGENT'?'DIVERGENT':attempt.step!=='APPROVAL'?'RECONCILED':'PENDING'};
      if(record.verdict==='RECONCILED'){const approval=record.priorApproval?await verifyPriorApproval(record):undefined;record={...record,evidence:buildSupplyEvidence({id:record.id,review:record.review,journal:record.journal,provenance:record.provenance,ownerInitiated:record.ownerInitiated,observations:record.observations,...approval?{approval}:{}})};}
      await save(record);return record;
    });},
  };
}
export type SupplyService=ReturnType<typeof createSupplyService>;
export type SupplyReviewData=SupplyReview;
