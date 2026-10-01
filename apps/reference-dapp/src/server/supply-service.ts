// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, unlink, rmdir, stat } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { validateAuthoringWorkflow, createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { simulateSupply, assertSupplyReview, readSupplyState, rpcHash, supplyHex, type SupplyRpc, type SupplyReview } from '@defi-workflow-engine/reference-compiler';
import { createSupplyRun, prepareSupplyAttempt, supplyTransition, discoverSupplyTransaction, validateSupplyRun, writeExtendingFile,
  type SupplyRun, type SupplyAttempt } from '@defi-workflow-engine/reference-executor';
import { reconcileSupplyAttempt, buildSupplyEvidence, type SupplyObservation } from '@defi-workflow-engine/reference-reconciler';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
export type SupplyRecord = SupplyRun & { observations: SupplyObservation[]; evidence: ReturnType<typeof buildSupplyEvidence> | null; error: string | null };
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
      if(record.provenance!==input.provenance||prior&&(record.id!==prior.id||record.review.commitment!==prior.review.commitment||record.attempts.length<prior.attempts.length))throw new Error('SUPPLY_STORE_CORRUPT');
      if(prior){
        const prefix=(before:unknown[],after:unknown[])=>after.length>=before.length&&JSON.stringify(after.slice(0,before.length))===JSON.stringify(before);
        if(!prefix(prior.journal.entries,record.journal.entries)||!prefix(prior.observations,record.observations)||
            prior.ownerInitiated&&!record.ownerInitiated || prior.verdict!=='PENDING'&&record.verdict!==prior.verdict ||
            prior.evidence&&JSON.stringify(record.evidence)!==JSON.stringify(prior.evidence))throw new Error('SUPPLY_STORE_CORRUPT');
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
  return {
    load,
    async simulate(workflowInput:unknown,account:string):Promise<SupplyRecord>{
      const workflow=validateAuthoringWorkflow(workflowInput,createBaseSepoliaReviewContext());
      const review=await simulateSupply(workflow,account,input.rpc);
      const id='supply-'+randomBytes(16).toString('hex');
      const record:SupplyRecord={...createSupplyRun(id,review,input.provenance),observations:[],evidence:null,error:null};
      await save(record);return record;
    },
    async review(id:string,commitment:string,workflow:SemanticWorkflow):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      const record=await load(id);
      if(record.attempts.length||record.review.commitment!==commitment)throw new Error('SUPPLY_AUTHORIZATION_REPLACED');
      const state=await readSupplyState(input.rpc,record.review.account,record.review.beneficiary);
      assertSupplyReview(record.review,workflow,record.review.account,state);
      const updated={...record,authorization:commitment};await save(updated);return updated;
    });},
    async invalidate(id:string):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{const record=await load(id);const next={...record,authorization:null,error:'SUPPLY_SEMANTIC_EDIT_REQUIRES_REVIEW'};await save(next);return next;});},
    async begin(id:string,account:string,workflow:SemanticWorkflow):Promise<SupplyBegin>{return locked(idCheck(id),async()=>{
      const record=await load(id),review=record.review;
      if(record.authorization!==review.commitment)throw new Error('SUPPLY_REVIEW_REQUIRED');
      const approvalConfirmed=record.attempts.some(a=>a.step==='APPROVAL'&&a.reconciled);
      const state=await readSupplyState(input.rpc,account,review.beneficiary);
      assertSupplyReview(review,workflow,account,state,Date.now(),approvalConfirmed);
      const index=approvalConfirmed?review.transactions.length-1:0;
      const gas=review.gasLimits[index]!;
      if(BigInt(state.nativeBalance)<BigInt(gas)*BigInt(review.gasPrice)+10_000_000_000_000n||BigInt(state.gasPrice)>BigInt(review.gasPrice))throw new Error('SUPPLY_INSUFFICIENT_ETH');
      const prepared={...prepareSupplyAttempt(record,state.block,state.nonce),observations:record.observations,evidence:record.evidence,error:null};
      const attempt=prepared.attempts.at(-1)!;
      // Permanent nonce lease across runs/processes. Uncertainty never releases economic intent.
      const lease=join(input.journalDir,`${review.account}-${attempt.nonce}.intent`);
      const handle=await open(lease,'wx',0o600).catch(()=>{throw new Error('SUPPLY_NONCE_ALREADY_RESERVED');});
      try{await handle.writeFile(JSON.stringify({id,step:attempt.step,transaction:attempt.transaction}));await handle.sync();}finally{await handle.close();}
      const dirHandle=await open(input.journalDir,'r');try{await dirHandle.sync();}finally{await dirHandle.close();}
      await save(prepared); // Must complete BEFORE any uncertain wallet submission.
      return {record:prepared,step:attempt.step,transaction:{...attempt.transaction,nonce:supplyHex(attempt.nonce),gas:supplyHex(gas),gasPrice:supplyHex(review.gasPrice)}};
    });},
    async report(id:string,step:'APPROVAL'|'SUPPLY',result:{kind:'HASH';hash:string}|{kind:'UNKNOWN'|'REJECTED'}):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      const record=await load(id),attempt=record.attempts.find(a=>a.step===step);
      if(!attempt)throw new Error('SUPPLY_ATTEMPT_MISSING');
      if(result.kind==='HASH'){
        const hash=rpcHash(result.hash);if(attempt.transactionHash&&attempt.transactionHash!==hash)throw new Error('SUPPLY_HASH_DIVERGENT');
        if(attempt.reconciled||['REVERTED','RECONCILIATION_REQUIRED'].includes(attempt.state))return record;
        const updated={...record,attempts:record.attempts.map(a=>a.step===step?{...a,transactionHash:hash}:a)};
        const next={...supplyTransition(updated,updated.attempts.find(a=>a.step===step)!,'PENDING'),observations:record.observations,evidence:record.evidence,error:null};await save(next);return next;
      }
      if(!['SUBMITTING','SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state))return record;
      const next={...supplyTransition(record,attempt,'SUBMISSION_RESULT_UNKNOWN'),observations:record.observations,evidence:record.evidence,
        error:result.kind==='REJECTED'?(step==='APPROVAL'?'SUPPLY_APPROVAL_REJECTED':'SUPPLY_REJECTED'):'SUPPLY_SUBMISSION_UNKNOWN'};
      await save(next);return next;
    });},
    async observe(id:string):Promise<SupplyRecord>{return locked(idCheck(id),async()=>{
      let record=await load(id);
      const attempt=record.attempts.find(a=>!a.reconciled);
      if(!attempt||record.verdict!=='PENDING')return record;
      const found=await discoverSupplyTransaction(attempt,input.rpc);
      if(found.mismatch){record={...record,verdict:'DIVERGENT',error:'SUPPLY_REPLACED_TRANSACTION_MISMATCH'};await save(record);return record;}
      if(!found.hash){record={...record,error:found.exhausted?'SUPPLY_OBSERVATION_BOUND_REACHED':'SUPPLY_TRANSACTION_NOT_OBSERVED'};await save(record);return record;}
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
        verdict:observation.verdict==='DIVERGENT'?'DIVERGENT':attempt.step==='SUPPLY'?'RECONCILED':'PENDING'};
      if(record.verdict==='RECONCILED')record={...record,evidence:buildSupplyEvidence({id:record.id,review:record.review,journal:record.journal,provenance:record.provenance,ownerInitiated:record.ownerInitiated,observations:record.observations})};
      await save(record);return record;
    });},
  };
}
export type SupplyService=ReturnType<typeof createSupplyService>;
export type SupplyReviewData=SupplyReview;
