// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { mkdir, open, readFile, unlink, rmdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { validateAuthoringWorkflow, createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { assertLendingReview, assertLendingReviewLifetime, assertLendingFresh, assertLendingPrincipalContinuity, lendingRootChain, simulateLendingComposition, readLendingSnapshot, readLendingRoute, rpcRecord, supplyHash, supplyHex,
  rpcHash, rpcUint, lendingFeeCeilings, assertLendingFeeBudgets, readLendingL1FeeUpperBound, type SupplyRpc, type LendingSnapshot } from '@defi-workflow-engine/reference-compiler';
import { createLendingRun, validateLendingRun, currentLendingReview, prepareLendingAttempt, lendingAttemptTransition,
  writeExtendingFile, reserveEconomicIntent, discoverSupplyTransaction, type LendingRun } from '@defi-workflow-engine/reference-executor';
import { reconcileLendingAttempt, reconcileSupplyAttempt, buildLendingEvidence, verifyComposedLendingEffects, type LendingObservation } from '@defi-workflow-engine/reference-reconciler';
import { createSupplyService } from './supply-service';
import { supplyAddress, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
export type LendingRecord = LendingRun & {observations:LendingObservation[];currentPosition:LendingSnapshot|null;evidence:ReturnType<typeof buildLendingEvidence>|null};
// Every run line is a full snapshot whose evidence repeats every Review, so a run grows with each Fresh Simulate;
// the real pilot passed 100 MB by ROUTER_APPROVAL. Lending run files therefore get a much larger bound than the shared 16 MiB.
const LENDING_RUN_MAX_BYTES=536_870_912,LENDING_HANDOFF_HEADROOM_LINES=16;
const idCheck=(id:string)=>{if(!/^lending-[a-f0-9]{32}$/.test(id))throw Error('LENDING_ID_INVALID');return id;};
const completed=(r:LendingRecord)=>r.attempts.filter(a=>a.reconciled).map(a=>a.step);
const proofs=(r:LendingRecord)=>r.attempts.map(a=>r.observations.filter(o=>o.attemptId===a.id).at(-1)).filter((o):o is LendingObservation=>Boolean(o));
// Append-only prefix check, element by element: one preimage per item stays far below the canonical 1 MiB hash bound.
const samePrefix=(next:readonly unknown[],prior:readonly unknown[])=>prior.every((item,i)=>supplyHash(next[i])===supplyHash(item));
export function createLendingCompositionService(input:{rpc:SupplyRpc;journalDir:string;provenance:'MOCKED'|'PUBLIC_TESTNET';maxRunBytes?:number}) {
  const maxRunBytes=input.maxRunBytes??LENDING_RUN_MAX_BYTES;
  if(!isAbsolute(input.journalDir)||input.journalDir.includes('/.git/'))throw Error('LENDING_STORAGE_INVALID');
  const path=(id:string)=>join(input.journalDir,idCheck(id)+'.jsonl');
  // Cache only a fully validated, exact serialized prefix, never live authority or RPC proof.
  // Every load still reads the file; changed/truncated history is validated from scratch.
  // Keep the parsed predecessor private so callers cannot mutate the cached validation.
  let validatedBytes=Buffer.alloc(0),validatedText='',validatedRecord:LendingRecord|null=null;
  const validate=(bytes:Uint8Array)=>{
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!text.endsWith('\n'))throw Error('LENDING_STORE_CORRUPT');
    const raw=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const extendsValidated=validatedBytes.length>0&&raw.subarray(0,validatedBytes.length).equals(validatedBytes);
    const remaining=extendsValidated?text.slice(validatedText.length):text;
    if(!remaining&&extendsValidated)return;
    let prior:LendingRecord|null=extendsValidated?validatedRecord:null;
    for(const line of remaining.trimEnd().split('\n')){
      const r=JSON.parse(line) as LendingRecord;validateLendingRun(r);
      if(r.provenance!==input.provenance||prior&&(r.id!==prior.id||r.reviews.length<prior.reviews.length||r.attempts.length<prior.attempts.length||r.observations.length<prior.observations.length||
        !samePrefix(r.reviews,prior.reviews)||!samePrefix(r.journal.entries,prior.journal.entries)||
        !samePrefix(r.observations,prior.observations)))throw Error('LENDING_STORE_CORRUPT');
      if(prior)for(const a of prior.attempts){const next=r.attempts.find(b=>b.id===a.id);if(!next||next.nonce!==a.nonce||next.reviewCommitment!==a.reviewCommitment||supplyHash(next.call)!==supplyHash(a.call)||
        next.preparedAtBlock!==a.preparedAtBlock||a.hash&&next.hash!==a.hash||a.reconciled&&!next.reconciled||a.notSubmitted&&!next.notSubmitted)throw Error('LENDING_STORE_CORRUPT');}
      if(r.status==='COMPLETED'&&(r.evidence?.bundle.outcome!=='RECONCILED'||!r.evidence.composedExecution.completed))throw Error('LENDING_STORE_CORRUPT');
      prior=r;
    }
    // Publish only after the entire suffix and its predecessor links pass.
    validatedBytes=Buffer.from(bytes);validatedText=text;validatedRecord=prior;
  };
  const load=async(id:string):Promise<LendingRecord>=>{const bytes=await readFile(path(id));validate(bytes);return JSON.parse(bytes.toString().trimEnd().split('\n').at(-1)!);};
  const save=async(r:LendingRecord)=>{let previous='';try{previous=await readFile(path(r.id),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    await writeExtendingFile(path(r.id),new TextEncoder().encode(previous+JSON.stringify(r)+'\n'),validate,undefined,maxRunBytes);return r;};
  async function locked<T>(key:string,action:()=>Promise<T>):Promise<T>{
    await mkdir(input.journalDir,{recursive:true,mode:0o700});const directory=join(input.journalDir,key+'.lock');
    try{await mkdir(directory,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      const before=await stat(directory),pid=Number(await readFile(join(directory,'pid'),'utf8'));
      if(!Number.isSafeInteger(pid)||pid<=0)throw Error('LENDING_BUSY',{cause:e});
      try{process.kill(pid,0);throw Error('LENDING_BUSY',{cause:e});}catch(cause){if((cause as NodeJS.ErrnoException).code!=='ESRCH')throw cause;}
      if((await stat(directory)).ino!==before.ino)throw Error('LENDING_BUSY',{cause:e});await unlink(join(directory,'pid'));await rmdir(directory);await mkdir(directory,{mode:0o700});}
    const handle=await open(join(directory,'pid'),'wx',0o600);try{await handle.writeFile(String(process.pid));await handle.sync();}finally{await handle.close();}
    try{return await action();}finally{await unlink(join(directory,'pid'));await rmdir(directory);}
  }
  async function verifyPredecessors(r:LendingRecord) {
    for(const a of r.attempts.filter(a=>a.reconciled)){
      const review=r.reviews.find(v=>v.commitment===a.reviewCommitment)!;
      const proof=await reconcileLendingAttempt(review,a,input.rpc);if(proof.verdict!=='RECONCILED')throw Error('LENDING_PREDECESSOR_PROOF_CHANGED');
      const old=r.observations.find(o=>o.attemptId===a.id&&o.verdict==='RECONCILED');
      if(!old||supplyHash(old.receipt)!==supplyHash(proof.receipt)||old.output!==proof.output)throw Error('LENDING_PREDECESSOR_PROOF_CHANGED');
    }
  }
  const lastEntry=async(path:string):Promise<{id?:unknown}|null>=>{try{return JSON.parse((await readFile(path,'utf8')).trimEnd().split('\n').at(-1)!);}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};
  /**
   * A run may take a fresh starting state only while nothing ever reached a wallet: no completed step, no observation,
   * every attempt cancelled from PREPARED with no hash, and every nonce/economic reservation still held by this run.
   */
  async function rerootable(r:LendingRecord):Promise<boolean> {
    if(completed(r).length||!r.attempts.length||r.observations.length||!['PAUSED','SIMULATED','AUTHORIZED'].includes(r.status))return false;
    for(const a of r.attempts)if(a.state!=='CANCELLED'||a.notSubmitted!==true||a.hash!==null||a.reconciled||
      JSON.stringify(r.journal.entries.filter(e=>e.entityId===a.id).map(e=>e.toState))!==JSON.stringify(['PREPARED','CANCELLED']))return false;
    const owner=currentLendingReview(r).fields.owner;
    for(const nonce of new Set(r.attempts.map(a=>a.nonce)))if((await lastEntry(join(input.journalDir,owner+'-'+nonce+'.intent')))?.id!==r.id)return false;
    for(const review of r.reviews)for(const call of review.calls){
      const last=await lastEntry(join(input.journalDir,'economic-'+supplyHash(call.tx).slice(2)+'.intent'));if(last&&last.id!==r.id)return false;
    }
    return true;
  }
  /**
   * Fast release gate immediately before the wallet request. begin() ran the complete public gate for this exact attempt
   * moments earlier; this rechecks, without a new simulation, everything that could have changed since. Any difference
   * fails closed and needs a fresh Simulate; the Review is never updated here.
   */
  async function handoffGate(r:LendingRecord,a:LendingRecord['attempts'][number]):Promise<LendingSnapshot> {
    const review=currentLendingReview(r),owner=review.fields.owner;assertLendingReview(review,review.workflow,owner);assertLendingReviewLifetime(review);
    if(rpcUint(await input.rpc('eth_chainId',[]))!==84532n)throw Error('LENDING_WRONG_CHAIN');
    if(a.call.tx.from!==owner)throw Error('LENDING_WRONG_ACCOUNT');
    const next=review.calls.find(c=>!r.attempts.some(x=>x.step===c.id&&x.reconciled));
    if(!next||next.id!==a.step||supplyHash(next.tx)!==supplyHash(a.call.tx)||r.attempts.some(x=>x.id!==a.id&&!x.reconciled&&!x.notSubmitted))throw Error('LENDING_EXISTING_ATTEMPT_OBSERVE_ONLY');
    for(const done of r.attempts.filter(x=>x.reconciled)){
      const old=r.observations.find(o=>o.attemptId===done.id&&o.verdict==='RECONCILED'),value=await input.rpc('eth_getTransactionReceipt',[done.hash]);
      if(!old?.receipt||!value)throw Error('LENDING_PREDECESSOR_PROOF_CHANGED');
      const receipt=rpcRecord(value),block=await input.rpc('eth_getBlockByNumber',[receipt.blockNumber,false]),canonical=block?rpcRecord(block):null;
      if(!canonical||rpcUint(receipt.status)!==1n||receipt.blockHash!==old.receipt.blockHash||canonical.hash!==old.receipt.blockHash||
        !Array.isArray(canonical.transactions)||!canonical.transactions.includes(done.hash))throw Error('LENDING_PREDECESSOR_PROOF_CHANGED');
    }
    const latest=await readLendingSnapshot(input.rpc,owner),reference=proofs(r).filter(o=>o.verdict==='RECONCILED').at(-1)?.post??review.state;
    assertLendingFresh(reference,latest);
    const f=review.fields,need=(ok:boolean)=>{if(!ok)throw Error('LENDING_STEP_PRECONDITION_CHANGED');};
    if(a.step==='POOL_APPROVAL'||a.step==='SUPPLY')need(BigInt(latest.aave.balance)>=BigInt(f.supplyAmount));
    if(a.step==='SUPPLY')need(BigInt(latest.aave.allowance)>=BigInt(f.supplyAmount));
    if(a.step==='ROUTER_APPROVAL'||a.step==='SWAP')need(BigInt(latest.aave.balance)>=BigInt(f.borrowAmount));
    if(a.step==='SWAP')need(BigInt(latest.routerAllowance)>=BigInt(f.borrowAmount));
    // While the Swap is still ahead, its reviewed route must still exist and still quote at least the reviewed minimum.
    if(!completed(r).includes('SWAP')){const route=await readLendingRoute(input.rpc,f.borrowAmount,f.slippageBps,Date.now(),'latest',review.route.minimumOut);
      if(route.codeHash!==review.route.codeHash||route.pool!==review.route.pool)throw Error('LENDING_REVIEW_STALE');}
    if(latest.aave.nonce!==a.nonce)throw Error('LENDING_NONCE_CHANGED');
    const lease=await lastEntry(join(input.journalDir,owner+'-'+a.nonce+'.intent')) as {id?:unknown;attemptId?:unknown}|null;
    if(lease?.id!==r.id||lease.attemptId!==a.id)throw Error('LENDING_NONCE_ALREADY_RESERVED');
    if((await lastEntry(join(input.journalDir,'economic-'+supplyHash(a.call.tx).slice(2)+'.intent')))?.id!==r.id)throw Error('ECONOMIC_EXISTING_INTENT_OBSERVE_ONLY');
    const root=lendingRootChain(r.reviews).root,reconciled=proofs(r).filter(o=>o.verdict==='RECONCILED');
    const consumedNetwork=reconciled.reduce((sum,o)=>sum+BigInt(o.cost??'0'),0n),consumedL1=reconciled.reduce((sum,o)=>sum+rpcUint(o.receipt?.l1Fee??'0x0'),0n);
    const remaining=review.calls.filter(c=>!completed(r).includes(c.id)),execution=remaining.reduce((sum,c)=>sum+BigInt(c.gasLimit)*BigInt(review.gasPrice),0n);
    const l1=await readLendingL1FeeUpperBound(input.rpc,remaining.length,supplyHex(latest.aave.block));
    if(BigInt(latest.aave.gasPrice)>BigInt(review.gasPrice)||BigInt(latest.aave.nativeBalance)<execution+BigInt(l1))throw Error('LENDING_REVIEW_STALE');
    assertLendingFeeBudgets(review,l1,(execution+BigInt(l1)).toString(),root,consumedNetwork.toString(),consumedL1.toString());
    assertLendingReview(review,review.workflow,owner);
    return latest;
  }
  /** The entire remaining path is tested before releasing ANY owner transaction (at Review and preparation). */
  async function publicGate(r:LendingRecord,workflow:SemanticWorkflow,account:string) {
    const review=currentLendingReview(r);assertLendingReview(review,workflow,account);assertLendingReviewLifetime(review);await verifyPredecessors(r);
    const root=lendingRootChain(r.reviews).root,rootBudget=lendingFeeCeilings(root),acceptedBudget=lendingFeeCeilings(review);
    const reconciled=proofs(r).filter(o=>o.verdict==='RECONCILED');
    const consumedNetwork=reconciled.reduce((sum,o)=>sum+BigInt(o.cost??'0'),0n),consumedL1=reconciled.reduce((sum,o)=>sum+rpcUint(o.receipt?.l1Fee??'0x0'),0n);
    if(consumedL1>rootBudget.maximumL1Fee)throw Error('LENDING_FINAL_L1_FEE_BUDGET_CHANGED');
    const remainingL1=rootBudget.maximumL1Fee-consumedL1,maximumL1Fee=(acceptedBudget.maximumL1Fee<remainingL1?acceptedBudget.maximumL1Fee:remainingL1).toString();
    const latest=await readLendingSnapshot(input.rpc,account), reference=proofs(r).filter(o=>o.verdict==='RECONCILED').at(-1)?.post??review.state;
    assertLendingFresh(reference,latest);
    const fresh=await simulateLendingComposition(workflow,account,input.rpc,{completed:completed(r),rootState:review.rootState,minimumOut:review.route.minimumOut,maximumL1Fee});
    if(fresh.route.codeHash!==review.route.codeHash||fresh.route.pool!==review.route.pool||BigInt(fresh.gasPrice)>BigInt(review.gasPrice)||
      BigInt(fresh.gasBudget)>BigInt(review.gasBudget)||BigInt(fresh.gasBudget)+consumedNetwork>rootBudget.maximumNetworkFee)throw Error('LENDING_REVIEW_STALE');
    assertLendingFeeBudgets(review,fresh.l1FeeUpperBound,fresh.gasBudget,root,consumedNetwork.toString(),consumedL1.toString());
    for(const call of fresh.calls){const approved=review.calls.find(c=>c.id===call.id);if(!approved||supplyHash(call.tx)!==supplyHash(approved.tx)||BigInt(call.gasLimit)>BigInt(approved.gasLimit))throw Error('LENDING_REVIEW_STALE');}
    // Reads can take long enough for state or the reviewed deadline to change. Recheck at release.
    const final=await readLendingSnapshot(input.rpc,account);
    assertLendingFresh(reference,fresh.state);assertLendingFresh(fresh.state,final);
    const finalL1=await readLendingL1FeeUpperBound(input.rpc,fresh.calls.length,supplyHex(final.aave.block));
    const finalNetworkMaximum=(BigInt(fresh.gasBudget)-BigInt(maximumL1Fee)+BigInt(finalL1)).toString();
    assertLendingFeeBudgets(review,finalL1,finalNetworkMaximum,root,consumedNetwork.toString(),consumedL1.toString());
    assertLendingReview(review,workflow,account);
    if(final.aave.nonce!==fresh.state.aave.nonce||BigInt(final.aave.gasPrice)>BigInt(review.gasPrice)||BigInt(final.aave.nativeBalance)<BigInt(fresh.gasBudget))throw Error('LENDING_REVIEW_STALE');
    return final;
  }
  return {
    load,
    async simulate(workflowInput:unknown,account:string):Promise<LendingRecord>{
      const workflow=validateAuthoringWorkflow(workflowInput,createBaseSepoliaReviewContext());
      const review=await simulateLendingComposition(workflow,account,input.rpc),id='lending-'+randomBytes(16).toString('hex');
      return save({...createLendingRun(id,review,input.provenance),observations:[],currentPosition:review.state,evidence:null});
    },
    async review(id:string,commitment:string,workflow:SemanticWorkflow):Promise<LendingRecord>{return locked(idCheck(id),async()=>{
      const r=await load(id),review=currentLendingReview(r);if(commitment!==review.commitment||r.attempts.some(a=>!a.reconciled&&!a.notSubmitted)||r.status==='COMPLETED'||r.status==='FAILED')throw Error('LENDING_REVIEW_NOT_AVAILABLE');
      const currentPosition=await publicGate(r,workflow,review.fields.owner);return save({...r,authorization:commitment,status:'AUTHORIZED',error:null,currentPosition});
    });},
    async begin(id:string,account:string,workflow:SemanticWorkflow){return locked(idCheck(id),async()=>{
      account=supplyAddress(account);
      const r=await load(id),review=currentLendingReview(r);if(r.authorization!==review.commitment)throw Error('LENDING_REVIEW_REQUIRED');
      // Never hand a step to the wallet unless the run journal can still record its submission and reconciliation.
      if((await stat(path(id))).size+LENDING_HANDOFF_HEADROOM_LINES*(JSON.stringify(r).length+1)>maxRunBytes)throw Error('LENDING_JOURNAL_CAPACITY_INSUFFICIENT');
      const state=await publicGate(r,workflow,account),prepared=prepareLendingAttempt(r,workflow,account,state.aave.block,state.aave.nonce),attempt=prepared.attempts.at(-1)!;
      await locked(account+'-'+attempt.nonce,async()=>{
        const noncePath=join(input.journalDir,account+'-'+attempt.nonce+'.intent');
        let previous:string|null=null;try{previous=await readFile(noncePath,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
        if(previous){const prior=JSON.parse(previous.trimEnd().split('\n').at(-1)!);
          if(typeof prior.id==='string'&&/^supply-[a-f0-9]{32}$/.test(prior.id)){
            // A previously completed BUILD-012 owner delegation can leave this nonce unchanged.
            // Accept only fresh canonical proof, never an absent or ambiguous old transaction.
            const priorRun=await createSupplyService(input).load(prior.id),a=priorRun.attempts.find(a=>a.step===prior.step);
            if(priorRun.verdict!=='RECONCILED'||!a?.reconciled||a.nonce!==attempt.nonce||supplyHash(a.transaction)!==supplyHash(prior.transaction))throw Error('LENDING_NONCE_ALREADY_RESERVED');
            const proof=await reconcileSupplyAttempt(priorRun.review,a,input.rpc);
            if(proof.verdict!=='RECONCILED'||proof.walletEnvelope?.owner!==account||proof.walletEnvelope.ownerNonceAfter!==attempt.nonce)throw Error('LENDING_NONCE_ALREADY_RESERVED');
          }else {const priorRun=await load(prior.id),a=priorRun.attempts.find(a=>a.id===prior.attemptId);
          // EIP-7702 may keep the owner nonce unchanged; positive predecessor proof is mandatory.
          if(prior.id!==id||!a?.reconciled&&!(a?.notSubmitted&&a.state==='CANCELLED'))throw Error('LENDING_NONCE_ALREADY_RESERVED');
          if(a.reconciled)await verifyPredecessors(priorRun);
          }
        }
        const nonceEntry=JSON.stringify({id,attemptId:attempt.id,step:attempt.step,transaction:attempt.call.tx})+'\n';
        if(previous)await writeExtendingFile(noncePath,new TextEncoder().encode(previous+nonceEntry),()=>undefined);
        else {const handle=await open(noncePath,'wx',0o600);try{await handle.writeFile(nonceEntry);await handle.sync();}finally{await handle.close();}}
        // Reserve the whole remaining economic path BEFORE the first owner request.
        // An unrelated run cannot supply again and only later discover a borrowed-intent conflict.
        for(const call of review.calls)await reserveEconomicIntent(input.journalDir,call.tx,id);
        const dirHandle=await open(input.journalDir,'r');try{await dirHandle.sync();}finally{await dirHandle.close();}
        await save({...prepared,observations:r.observations,currentPosition:state,evidence:r.evidence});
      });
      return {record:await load(id),attemptId:attempt.id,transaction:{...attempt.call.tx,nonce:supplyHex(attempt.nonce),gas:supplyHex(attempt.call.gasLimit),gasPrice:supplyHex(review.gasPrice)}};
    });},
    async handoff(id:string,attemptId:string){return locked(idCheck(id),async()=>{
      const r=await load(id),a=r.attempts.find(a=>a.id===attemptId),review=currentLendingReview(r);
      if(!a||a.state!=='PREPARED'||r.authorization!==review.commitment||a.reviewCommitment!==review.commitment)throw Error('LENDING_HANDOFF_NOT_AUTHORIZED');
      const state=await handoffGate(r,a);
      return save({...r,...lendingAttemptTransition(r,a.id,'SUBMITTING'),currentPosition:state});
    });},
    async report(id:string,attemptId:string,result:{kind:'HASH';hash:string}|{kind:'UNKNOWN'}){return locked(idCheck(id),async()=>{
      const r=await load(id),a=r.attempts.find(a=>a.id===attemptId);if(!a||!['SUBMITTING','SUBMISSION_RESULT_UNKNOWN','PENDING'].includes(a.state))throw Error('LENDING_REPORT_INVALID');
      if(result.kind==='HASH') {const hash=rpcHash(result.hash);if(a.hash&&a.hash!==hash)throw Error('LENDING_HASH_MISMATCH');
        const next={...r,attempts:r.attempts.map(v=>v.id===a.id?{...v,hash}:v)};return save({...next,...lendingAttemptTransition(next,a.id,'PENDING')});}
      if(a.state==='PENDING')return r;
      return save({...r,...lendingAttemptTransition(r,a.id,'SUBMISSION_RESULT_UNKNOWN'),status:'RECOVERY_REQUIRED',error:'LENDING_SUBMISSION_UNKNOWN'});
    });},
    async cancelPrepared(id:string,attemptId:string){return locked(idCheck(id),async()=>{
      const r=await load(id),a=r.attempts.find(a=>a.id===attemptId);if(!a||a.state!=='PREPARED'||a.hash)throw Error('LENDING_CANCELLATION_OBSERVE_ONLY');
      const next=lendingAttemptTransition(r,a.id,'CANCELLED');return save({...r,...next,authorization:null,status:'PAUSED',error:'LENDING_CANCELLED_BEFORE_HANDOFF',
        attempts:next.attempts.map(v=>v.id===a.id?{...v,notSubmitted:true}:v)});
    });},
    async refreshReview(id:string){return locked(idCheck(id),async()=>{
      const r=await load(id),review=currentLendingReview(r);
      if(r.attempts.some(a=>!a.reconciled&&!a.notSubmitted)||['COMPLETED','FAILED'].includes(r.status))throw Error('LENDING_RECOVERY_OBSERVE_ONLY');
      await verifyPredecessors(r);
      const latest=await readLendingSnapshot(input.rpc,review.fields.owner);
      if(await rerootable(r)){
        // New baseline from current canonical state; prior Reviews stay as history and the full path is simulated again.
        if(latest.aave.block<review.state.aave.block)throw Error('LENDING_RPC_INCONSISTENT');
        const reviewNext=await simulateLendingComposition(review.workflow,review.fields.owner,input.rpc,{rerootOf:lendingRootChain(r.reviews).root.commitment});
        return save({...r,reviews:[...r.reviews,reviewNext],authorization:null,status:'SIMULATED',error:null,currentPosition:reviewNext.state});
      }
      assertLendingPrincipalContinuity(proofs(r).filter(o=>o.verdict==='RECONCILED').at(-1)?.post??review.state,latest);
      const reviewNext=await simulateLendingComposition(review.workflow,review.fields.owner,input.rpc,{completed:completed(r),rootState:review.rootState});
      return save({...r,reviews:[...r.reviews,reviewNext],authorization:null,status:'SIMULATED',error:null,currentPosition:reviewNext.state});
    });},
    async invalidate(id:string){return locked(idCheck(id),async()=>{const r=await load(id);return save({...r,authorization:null,status:r.status==='COMPLETED'?'COMPLETED':'PAUSED',error:'LENDING_SEMANTIC_EDIT_REQUIRES_REVIEW'});});},
    async observe(id:string):Promise<LendingRecord>{return locked(idCheck(id),async()=>{
      let r=await load(id),a=r.attempts.find(a=>!a.reconciled&&!a.notSubmitted);
      if(!a){try{r={...r,currentPosition:await readLendingSnapshot(input.rpc,currentLendingReview(r).fields.owner,'latest',false)};}catch{r={...r,error:'LENDING_CURRENT_POSITION_UNAVAILABLE'};}return save(r);}
      if(a.state==='PREPARED'||a.state==='CANCELLED')return r; // recovery never invokes handoff
      if(!a.hash){
        try{r={...r,currentPosition:await readLendingSnapshot(input.rpc,currentLendingReview(r).fields.owner,'latest',false)};}catch{r={...r,error:'LENDING_CURRENT_POSITION_UNAVAILABLE'};}
        const found=await discoverSupplyTransaction({nonce:a.nonce,preparedAtBlock:a.preparedAtBlock,transaction:a.call.tx,transactionHash:null,step:'SUPPLY',state:'SUBMITTING',receipt:null,reconciled:false},input.rpc);
        if(found.mismatch)return save({...r,status:'RECOVERY_REQUIRED',authorization:null,error:'LENDING_NONCE_PAYLOAD_MISMATCH'});
        if(!found.hash)return save({...r,status:'RECOVERY_REQUIRED',authorization:null,error:'LENDING_UNKNOWN_OBSERVE_ONLY'});
        r={...r,attempts:r.attempts.map(v=>v.id===a!.id?{...v,hash:found.hash}:v)};r=lendingAttemptTransition(r,a.id,'PENDING') as LendingRecord;a=r.attempts.find(v=>v.id===a!.id)!;
      }
      const review=r.reviews.find(v=>v.commitment===a!.reviewCommitment)!,o=await reconcileLendingAttempt(review,a,input.rpc);
      r={...r,observations:[...r.observations,o]};
      try{r.currentPosition=await readLendingSnapshot(input.rpc,review.fields.owner,'latest',false);}catch{r.currentPosition=o.post??r.currentPosition;}
      if(o.verdict==='RECONCILED'){
        if(a.state!=='CONFIRMED')r={...r,...lendingAttemptTransition(r,a.id,'CONFIRMED')};
        r={...r,attempts:r.attempts.map(v=>v.id===a!.id?{...v,reconciled:true}:v),status:a.step==='SWAP'?'COMPLETED':'PARTIALLY_COMPLETED',error:null};
        if(a.step==='SWAP')try{verifyComposedLendingEffects(lendingRootChain(r.reviews).root,proofs(r));}catch(cause){r={...r,status:'RECOVERY_REQUIRED',authorization:null,error:cause instanceof Error?cause.message:'LENDING_COMPOSED_PROOF_INCOMPLETE'};}
      } else if(o.verdict==='DIVERGENT'){
        const reverted=o.reason==='LENDING_TRANSACTION_REVERTED';r={...r,...lendingAttemptTransition(r,a.id,reverted?'REVERTED':'RECONCILIATION_REQUIRED'),
          status:completed(r).includes('BORROW')?'PARTIALLY_COMPLETED':'FAILED',authorization:null,error:o.reason};
      } else r={...r,status:'RECOVERY_REQUIRED',error:o.reason};
      const observations=proofs(r);
      if(r.provenance==='MOCKED'||observations.some(o=>o.receipt&&o.ownerProof&&(o.verdict==='RECONCILED'||o.reason==='LENDING_TRANSACTION_REVERTED')))
        r.evidence=buildLendingEvidence({id, reviews:r.reviews,journal:r.journal,observations,provenance:r.provenance,completed:r.status==='COMPLETED',previous:r.evidence});
      return save(r);
    });},
  };
}
export type LendingCompositionService=ReturnType<typeof createLendingCompositionService>;
