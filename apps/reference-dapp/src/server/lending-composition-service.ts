// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { isAbsolute, join } from 'node:path';
import { validateAuthoringWorkflow, createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { SUPPLY_METAMASK, supplyCall, assertLendingReview, assertLendingReviewLifetime, assertLendingFresh, assertLendingPrincipalContinuity, lendingRootChain, simulateLendingComposition, readLendingSnapshot, readLendingRoute, rpcRecord, supplyHash, supplyHex,
  rpcHash, rpcUint, lendingFeeCeilings, assertLendingFeeBudgets, readLendingL1FeeUpperBound, type SupplyRpc, type LendingSnapshot } from '@defi-workflow-engine/reference-compiler';
import { createLendingRun, validateLendingRun, currentLendingReview, prepareLendingAttempt, lendingAttemptTransition,
  writeExtendingFile, reserveEconomicIntentIn, discoverSupplyTransaction, createFileExecutionStorage, assertLogName, logMissing, utf8, type ExecutionStorage,
  type LendingRun, type LendingNonSubmissionProof } from '@defi-workflow-engine/reference-executor';
import { reconcileLendingAttempt, reconcileSupplyAttempt, buildLendingEvidence, verifyComposedLendingEffects, type LendingObservation } from '@defi-workflow-engine/reference-reconciler';
import { createSupplyService } from './supply-service.ts';
import { supplyAddress, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
export type LendingRecord = LendingRun & {observations:LendingObservation[];currentPosition:LendingSnapshot|null;evidence:ReturnType<typeof buildLendingEvidence>|null};
// Every run line is a full snapshot whose evidence repeats every Review, so a run grows with each Fresh Simulate;
// the real pilot passed 100 MB by ROUTER_APPROVAL. Lending run files therefore get a much larger bound than the shared 16 MiB.
const LENDING_RUN_MAX_BYTES=536_870_912,LENDING_HANDOFF_HEADROOM_LINES=16,LENDING_STRANDED_HANDOFF_MS=1_800_000;
const idCheck=(id:string)=>{if(!/^lending-[a-f0-9]{32}$/.test(id))throw Error('LENDING_ID_INVALID');return id;};
const completed=(r:LendingRecord)=>r.attempts.filter(a=>a.reconciled).map(a=>a.step);
const proofs=(r:LendingRecord)=>r.attempts.map(a=>r.observations.filter(o=>o.attemptId===a.id).at(-1)).filter((o):o is LendingObservation=>Boolean(o));
// Append-only prefix check, element by element: one preimage per item stays far below the canonical 1 MiB hash bound.
const samePrefix=(next:readonly unknown[],prior:readonly unknown[])=>prior.every((item,i)=>supplyHash(next[i])===supplyHash(item));
/**
 * BUILD-CLOUD-PARITY-001: like the Aave Supply family, the composition persists only through the storage ports. Locally they are the
 * original journal directory (same paths, bytes, fsyncs and PID locks; run logs keep the 512 MiB bound). In the cloud the caller
 * passes the Aave Supply family's shared durable storage, so owner-nonce and economic-intent reservations stay shared with single-step
 * Aave runs exactly as the shared local directory shares them, and `maxRunBytes` is that store's bound: the begin() capacity guard
 * then refuses a step BEFORE any wallet request when its submission and reconciliation might not fit.
 */
export function createLendingCompositionService(input:{rpc:SupplyRpc;journalDir?:string;storage?:ExecutionStorage;provenance:'MOCKED'|'PUBLIC_TESTNET';maxRunBytes?:number}) {
  const maxRunBytes=input.maxRunBytes??LENDING_RUN_MAX_BYTES;
  if(!input.storage&&(!input.journalDir||!isAbsolute(input.journalDir)||input.journalDir.includes('/.git/')))throw Error('LENDING_STORAGE_INVALID');
  const storage:ExecutionStorage=input.storage??(()=>{
    const local=createFileExecutionStorage(input.journalDir!,'LENDING_BUSY'),dir=input.journalDir!;
    // Run logs outgrow the shared 16 MiB default locally; every other primitive is the original file store.
    return {leases:local.leases,log:{...local.log,extend:(name,next,validate)=>writeExtendingFile(join(dir,assertLogName(name)),next,validate,undefined,maxRunBytes)}};
  })();
  const {log,leases}=storage;
  const path=(id:string)=>idCheck(id)+'.jsonl';
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
  const load=async(id:string):Promise<LendingRecord>=>{const bytes=await log.read(path(id));if(!bytes)throw logMissing(path(id));validate(bytes);return JSON.parse(utf8(bytes).trimEnd().split('\n').at(-1)!);};
  const save=async(r:LendingRecord)=>{const previous=utf8(await log.read(path(r.id)));
    await log.extend(path(r.id),new TextEncoder().encode(previous+JSON.stringify(r)+'\n'),validate);return r;};
  // Cross-process exclusive section: the original PID lock directory locally, a fenced lease in shared storage.
  const locked=<T,>(key:string,action:()=>Promise<T>):Promise<T>=>leases.hold(key,action);
  async function verifyPredecessors(r:LendingRecord) {
    for(const a of r.attempts.filter(a=>a.reconciled)){
      const review=r.reviews.find(v=>v.commitment===a.reviewCommitment)!;
      const proof=await reconcileLendingAttempt(review,a,input.rpc);if(proof.verdict!=='RECONCILED')throw Error('LENDING_PREDECESSOR_PROOF_CHANGED');
      const old=r.observations.find(o=>o.attemptId===a.id&&o.verdict==='RECONCILED');
      if(!old||supplyHash(old.receipt)!==supplyHash(proof.receipt)||old.output!==proof.output)throw Error('LENDING_PREDECESSOR_PROOF_CHANGED');
    }
  }
  const lastEntry=async(name:string):Promise<{id?:unknown}|null>=>{const bytes=await log.read(name);return bytes===null?null:JSON.parse(utf8(bytes).trimEnd().split('\n').at(-1)!);};
  /**
   * A run may take a fresh starting state only while nothing ever reached a wallet: no completed step, no observation,
   * every attempt cancelled from PREPARED with no hash, and every nonce/economic reservation still held by this run.
   */
  async function rerootable(r:LendingRecord):Promise<boolean> {
    if(completed(r).length||!r.attempts.length||r.observations.length||!['PAUSED','SIMULATED','AUTHORIZED'].includes(r.status))return false;
    for(const a of r.attempts)if(a.state!=='CANCELLED'||a.notSubmitted!==true||a.hash!==null||a.reconciled||
      JSON.stringify(r.journal.entries.filter(e=>e.entityId===a.id).map(e=>e.toState))!==JSON.stringify(['PREPARED','CANCELLED']))return false;
    const owner=currentLendingReview(r).fields.owner;
    for(const nonce of new Set(r.attempts.map(a=>a.nonce)))if((await lastEntry(owner+'-'+nonce+'.intent'))?.id!==r.id)return false;
    for(const review of r.reviews)for(const call of review.calls){
      const last=await lastEntry('economic-'+supplyHash(call.tx).slice(2)+'.intent');if(last&&last.id!==r.id)return false;
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
    const lease=await lastEntry(owner+'-'+a.nonce+'.intent') as {id?:unknown;attemptId?:unknown}|null;
    if(lease?.id!==r.id||lease.attemptId!==a.id)throw Error('LENDING_NONCE_ALREADY_RESERVED');
    if((await lastEntry('economic-'+supplyHash(a.call.tx).slice(2)+'.intent'))?.id!==r.id)throw Error('ECONOMIC_EXISTING_INTENT_OBSERVE_ONLY');
    const root=lendingRootChain(r.reviews).root,reconciled=proofs(r).filter(o=>o.verdict==='RECONCILED');
    const consumedNetwork=reconciled.reduce((sum,o)=>sum+BigInt(o.cost??'0'),0n),consumedL1=reconciled.reduce((sum,o)=>sum+rpcUint(o.receipt?.l1Fee??'0x0'),0n);
    const remaining=review.calls.filter(c=>!completed(r).includes(c.id)),execution=remaining.reduce((sum,c)=>sum+BigInt(c.gasLimit)*BigInt(review.gasPrice),0n);
    const l1=await readLendingL1FeeUpperBound(input.rpc,remaining.length,supplyHex(latest.aave.block));
    if(BigInt(latest.aave.gasPrice)>BigInt(review.gasPrice)||BigInt(latest.aave.nativeBalance)<execution+BigInt(l1))throw Error('LENDING_REVIEW_STALE');
    assertLendingFeeBudgets(review,l1,(execution+BigInt(l1)).toString(),root,consumedNetwork.toString(),consumedL1.toString());
    assertLendingReview(review,review.workflow,owner);
    return latest;
  }
  /**
   * Proves an approval whose wallet result was unknown never reached the chain: discovery covered its whole window, the
   * owner nonce (latest and pending) is still the attempt's, and the allowance it would set still has its reviewed value.
   * An approval sets rather than adds, so even a late broadcast of the same request cannot double an economic effect.
   * Every other step stays observe-only.
   */
  async function nonSubmissionProof(r:LendingRecord,a:LendingRecord['attempts'][number]):Promise<LendingNonSubmissionProof|null> {
    if(a.state!=='SUBMISSION_RESULT_UNKNOWN'&&a.state!=='SUBMITTING'||a.hash!==null||(a.step!=='POOL_APPROVAL'&&a.step!=='ROUTER_APPROVAL'))return null;
    // A wallet that never answered may still be showing the request: only a long-stranded handoff qualifies.
    const handedOff=Date.parse(r.journal.entries.filter(e=>e.entityId===a.id&&e.toState==='SUBMITTING').at(-1)?.recordedAt??'');
    if(a.state==='SUBMITTING'&&!(Date.now()-handedOff>=LENDING_STRANDED_HANDOFF_MS))return null;
    const review=r.reviews.find(v=>v.commitment===a.reviewCommitment)!,owner=review.fields.owner,window:[number,number]=[a.preparedAtBlock,a.preparedAtBlock+128];
    const reviewed=a.step==='POOL_APPROVAL'?review.state.aave.allowance:review.state.routerAllowance,target=BigInt('0x'+a.call.tx.data.slice(-64));
    // Snapshots read the nonce at 'pending'; the proof also needs it exactly at the proof block.
    const latest=await readLendingSnapshot(input.rpc,owner,'latest',false),pending=rpcUint(await input.rpc('eth_getTransactionCount',[owner,'pending']));
    const atBlock=rpcUint(await input.rpc('eth_getTransactionCount',[owner,supplyHex(latest.aave.block)])),allowance=a.step==='POOL_APPROVAL'?latest.aave.allowance:latest.routerAllowance;
    if(latest.aave.block<=window[1]||atBlock!==BigInt(a.nonce)||pending!==BigInt(a.nonce)||allowance!==reviewed||BigInt(reviewed)===target)return null;
    return {kind:'APPROVAL_NOT_SUBMITTED',provenAtBlock:latest.aave.block,blockHash:latest.aave.blockHash,ownerNonce:a.nonce,allowance,discoveryWindow:window};
  }
  /**
   * Finds a submission that landed after the bounded discovery window (e.g. a wallet confirmed long after handoff and the
   * page could not report the hash): the first block where the owner nonce passed the attempt nonce (direct) or, for an
   * approval, where the allowance became the approved amount (relayed). Only a transaction in that block from the owner at
   * the attempt nonce, or a relayed call carrying the exact calldata, is returned; reconciliation then verifies it fully.
   */
  async function lateSubmission(r:LendingRecord,a:LendingRecord['attempts'][number]):Promise<{hash:string;mismatch:boolean}|null> {
    const owner=r.reviews.find(v=>v.commitment===a.reviewCommitment)!.fields.owner,latest=Number(rpcUint(await input.rpc('eth_blockNumber',[])));
    const nonceAfter=async(b:number)=>rpcUint(await input.rpc('eth_getTransactionCount',[owner,supplyHex(b)]))>BigInt(a.nonce);
    const approval=a.step==='POOL_APPROVAL'||a.step==='ROUTER_APPROVAL',target=BigInt('0x'+a.call.tx.data.slice(-64)),spender='0x'+a.call.tx.data.slice(34,74);
    const allowanceSet=async(b:number)=>rpcUint(await input.rpc('eth_call',[{to:a.call.tx.to,data:supplyCall('allowance(address,address)',owner,spender)},supplyHex(b)]))===target;
    const effect=await nonceAfter(latest)?nonceAfter:approval&&await allowanceSet(latest)?allowanceSet:null;
    if(!effect||await effect(a.preparedAtBlock))return null;
    let lo=a.preparedAtBlock,hi=latest;while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(await effect(mid))hi=mid;else lo=mid;}
    const block=rpcRecord(await input.rpc('eth_getBlockByNumber',[supplyHex(hi),true]));if(!Array.isArray(block.transactions))return null;
    for(const value of block.transactions){const tx=rpcRecord(value);
      if(typeof tx.from==='string'&&tx.from.toLowerCase()===owner&&rpcUint(tx.nonce)===BigInt(a.nonce))
        return {hash:rpcHash(tx.hash),mismatch:tx.to!==SUPPLY_METAMASK.manager&&(String(tx.to).toLowerCase()!==a.call.tx.to||String(tx.input).toLowerCase()!==a.call.tx.data)};
      if(typeof tx.to==='string'&&tx.to.toLowerCase()===SUPPLY_METAMASK.manager&&String(tx.input).toLowerCase().includes(a.call.tx.data.slice(2).toLowerCase()))return {hash:rpcHash(tx.hash),mismatch:false};}
    return null;
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
      if((await log.read(path(id)))!.length+LENDING_HANDOFF_HEADROOM_LINES*(JSON.stringify(r).length+1)>maxRunBytes)throw Error('LENDING_JOURNAL_CAPACITY_INSUFFICIENT');
      const state=await publicGate(r,workflow,account),prepared=prepareLendingAttempt(r,workflow,account,state.aave.block,state.aave.nonce),attempt=prepared.attempts.at(-1)!;
      await locked(account+'-'+attempt.nonce,async()=>{
        const noncePath=account+'-'+attempt.nonce+'.intent';
        const stored=await log.read(noncePath),previous:string|null=stored===null?null:utf8(stored);
        if(previous){const prior=JSON.parse(previous.trimEnd().split('\n').at(-1)!);
          if(typeof prior.id==='string'&&/^supply-[a-f0-9]{32}$/.test(prior.id)){
            // A previously completed BUILD-012 owner delegation can leave this nonce unchanged.
            // Accept only fresh canonical proof, never an absent or ambiguous old transaction.
            const priorRun=await createSupplyService({rpc:input.rpc,storage,provenance:input.provenance}).load(prior.id),a=priorRun.attempts.find(a=>a.step===prior.step);
            if(priorRun.verdict!=='RECONCILED'||!a?.reconciled||a.nonce!==attempt.nonce||supplyHash(a.transaction)!==supplyHash(prior.transaction))throw Error('LENDING_NONCE_ALREADY_RESERVED');
            const proof=await reconcileSupplyAttempt(priorRun.review,a,input.rpc);
            if(proof.verdict!=='RECONCILED'||proof.walletEnvelope?.owner!==account||proof.walletEnvelope.ownerNonceAfter!==attempt.nonce)throw Error('LENDING_NONCE_ALREADY_RESERVED');
          }else {const priorRun=await load(prior.id),a=priorRun.attempts.find(a=>a.id===prior.attemptId);
          // EIP-7702 may keep the owner nonce unchanged; positive predecessor proof is mandatory.
          if(prior.id!==id||!a?.reconciled&&!(a?.notSubmitted&&(a.state==='CANCELLED'||a.state==='NOT_FOUND'&&a.nonSubmission)))throw Error('LENDING_NONCE_ALREADY_RESERVED');
          if(a.reconciled)await verifyPredecessors(priorRun);
          }
        }
        const nonceEntry=JSON.stringify({id,attemptId:attempt.id,step:attempt.step,transaction:attempt.call.tx})+'\n';
        if(previous)await log.extend(noncePath,new TextEncoder().encode(previous+nonceEntry),()=>undefined);
        else if(!await log.create(noncePath,new TextEncoder().encode(nonceEntry)))throw Error('LENDING_NONCE_ALREADY_RESERVED');
        // Reserve the whole remaining economic path BEFORE the first owner request.
        // An unrelated run cannot supply again and only later discover a borrowed-intent conflict.
        // Each creation and extension is durable when it resolves (the file store fsyncs files and the directory).
        for(const call of review.calls)await reserveEconomicIntentIn(log,call.tx,id);
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
        const late=!found.hash&&found.exhausted?await lateSubmission(r,a):null;
        if(late?.mismatch)return save({...r,status:'RECOVERY_REQUIRED',authorization:null,error:'LENDING_NONCE_PAYLOAD_MISMATCH'});
        if(late)found.hash=late.hash;
        if(!found.hash){
          const proof=found.exhausted?await nonSubmissionProof(r,a):null;
          if(!proof)return save({...r,status:'RECOVERY_REQUIRED',authorization:null,error:'LENDING_UNKNOWN_OBSERVE_ONLY'});
          // Durable, never resent: the attempt is closed as NOT_FOUND on chain; a fresh Review is required to continue.
          const next=lendingAttemptTransition(a.state==='SUBMITTING'?lendingAttemptTransition(r,a.id,'SUBMISSION_RESULT_UNKNOWN') as LendingRecord:r,a.id,'NOT_FOUND');
          return save({...r,...next,attempts:next.attempts.map(v=>v.id===a!.id?{...v,notSubmitted:true,nonSubmission:proof}:v),authorization:null,status:'PAUSED',error:'LENDING_WALLET_DID_NOT_SUBMIT'});
        }
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
        r.evidence=buildLendingEvidence({id, reviews:r.reviews,journal:r.journal,observations,provenance:r.provenance,completed:r.status==='COMPLETED',previous:r.evidence,
          resolvedNotSubmitted:r.attempts.filter(v=>v.nonSubmission).map(v=>({attemptId:v.id,step:v.step,nonSubmission:v.nonSubmission!}))});
      return save(r);
    });},
  };
}
export type LendingCompositionService=ReturnType<typeof createLendingCompositionService>;
