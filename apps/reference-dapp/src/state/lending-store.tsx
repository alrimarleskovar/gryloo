// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext,useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { isLendingComposition,type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { readLendingComposition } from '@defi-workflow-engine/workflow-contracts';
import { lendingSimulate,lendingReview,lendingBegin,lendingHandoff,lendingReport,lendingObserve,lendingStatus,lendingRefresh,lendingInvalidate,lendingCancelPrepared } from '../app/lending-action';
import { useWorkflow } from './workflow-store';
import { injected,useBuild009Wallet } from './build009-wallet-store';
import { supplyWalletNonce,supplyWalletTransaction } from '../domain/supply-authoring';
import type { LendingRecord } from '../server/lending-composition-service';
type State={record:LendingRecord|null;busy:boolean;signing:boolean;error:string|null;retired:boolean;recovered:boolean;
  simulate():Promise<void>;review():Promise<void>;execute():Promise<void>;observe():Promise<void>;refresh():Promise<void>;cancelPrepared():Promise<void>};
const Context=createContext<State|null>(null),key='gryloo.lending-composition.v1';
export function LendingProvider({children}:{children:ReactNode}){
  const {state,restoreLendingCanvas}=useWorkflow(),wallet=useBuild009Wallet(),workflow=state.workflow as SemanticWorkflow;
  const [record,setRecord]=useState<LendingRecord|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[recovered,setRecovered]=useState(false),[signing,setSigning]=useState(false);
  const latest=useRef(workflow);latest.current=workflow;const walletRef=useRef(wallet);walletRef.current=wallet;const busyRef=useRef(false);
  const pristine=recovered&&workflow.revision===0&&workflow.nodes.every(n=>n.actionType.startsWith('mock-'));
  const retired=Boolean(record&&JSON.stringify(workflow)!==JSON.stringify(record.reviews[0]!.workflow)&&!pristine);
  const accept=(r:LendingRecord)=>{setRecord(r);let prior:{id?:string;attempt?:string;hash?:string}|null=null;try{prior=JSON.parse(window.localStorage.getItem(key)??'null');}catch{ /* Durable server history remains authoritative. */ }
    const pending=r.attempts.find(a=>!a.reconciled&&!a.notSubmitted);
    window.localStorage.setItem(key,JSON.stringify({id:r.id,...pending&&prior?.id===r.id&&prior.attempt===pending.id&&prior.hash?{attempt:pending.id,hash:pending.hash??prior.hash}:{}}));};
  useEffect(()=>{
    let live=true;
    try {const pointer=JSON.parse(window.localStorage.getItem(key)??'null');
      if(typeof pointer?.id==='string'&&/^lending-[a-f0-9]{32}$/.test(pointer.id))(async()=>{
        if(typeof pointer.attempt==='string'&&typeof pointer.hash==='string'&&/^0x[0-9a-f]{64}$/.test(pointer.hash))await lendingReport(pointer.id,pointer.attempt,{kind:'HASH',hash:pointer.hash}).catch(()=>undefined);
        return lendingStatus(pointer.id);
      })().then(result=>{if(live&&result.ok){setRecord(result.value);setRecovered(true);restoreLendingCanvas(result.value.reviews[0]!.workflow);}}).catch(()=>undefined);
    }catch{setError('LENDING_RECOVERY_POINTER_INVALID');}
    return()=>{live=false;};
  },[restoreLendingCanvas]);
  useEffect(()=>{if(record&&retired&&record.authorization)lendingInvalidate(record.id).then(r=>{if(r.ok)setRecord(r.value);}).catch(()=>setError('LENDING_INVALIDATION_FAILED'));},[record,retired]);
  async function operation(action:()=>Promise<void>){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);try{await action();}catch(cause){setError(cause instanceof Error?cause.message:'LENDING_OPERATION_FAILED');}finally{busyRef.current=false;setBusy(false);}}
  async function simulate(){return operation(async()=>{
    if(record?.attempts.some(a=>!a.reconciled&&!a.notSubmitted))throw Error('LENDING_EXISTING_ATTEMPT_OBSERVE_ONLY');
    const snapshot=latest.current,authored=pristine?record!.reviews[0]!.workflow:snapshot;
    if(!isLendingComposition(authored))throw Error('LENDING_WORKFLOW_REQUIRED');
    // Preserve durable nonce/economic reservations after a proved cancellation or completed checkpoint.
    // The existing refresh path creates a fresh simulation/Review in the same run, with no retry or owner request.
    const result=record?.attempts.length&&!retired?await lendingRefresh(record.id):await lendingSimulate(authored,wallet.account??readLendingComposition(authored).owner);if(!result.ok)throw Error(result.code);
    if(latest.current!==snapshot)throw Error('LENDING_SEMANTIC_EDIT_REQUIRES_REVIEW');accept(result.value);
  });}
  async function review(){return operation(async()=>{if(!record||retired)throw Error('LENDING_SIMULATION_REQUIRED');const r=record.reviews.at(-1)!;
    const result=await lendingReview(record.id,r.commitment,pristine?r.workflow:latest.current);if(!result.ok)throw Error(result.code);accept(result.value);
  });}
  async function observe(){return operation(async()=>{if(!record)throw Error('LENDING_RUN_MISSING');const result=await lendingObserve(record.id);if(!result.ok)throw Error(result.code);accept(result.value);});}
  async function refresh(){return operation(async()=>{if(!record||retired)throw Error('LENDING_RUN_MISSING');const result=await lendingRefresh(record.id);if(!result.ok)throw Error(result.code);accept(result.value);});}
  async function cancelPrepared(){return operation(async()=>{const pending=record?.attempts.find(a=>a.state==='PREPARED'&&!a.reconciled&&!a.notSubmitted);if(!record||!pending)throw Error('LENDING_CANCELLATION_OBSERVE_ONLY');
    const result=await lendingCancelPrepared(record.id,pending.id);if(!result.ok)throw Error(result.code);accept(result.value);
  });}
  async function execute(){return operation(async()=>{
    if(!record||retired)throw Error('LENDING_REVIEW_REQUIRED');const review=record.reviews.at(-1)!;
    if(record.authorization!==review.commitment)throw Error('LENDING_REVIEW_REQUIRED');
    let session=await wallet.session();if(!session)session=await wallet.connect();if(!session)throw Error('LENDING_WALLET_REQUIRED');
    const provider=injected();if(!provider)throw Error('LENDING_WALLET_REQUIRED');
    const snapshot=latest.current,authored=pristine?review.workflow:snapshot;
    const validate=async(nonce?:string)=>{
      const accounts=await provider.request({method:'eth_accounts'}),chain=await provider.request({method:'eth_chainId'});
      if(!Array.isArray(accounts)||String(accounts[0]).toLowerCase()!==review.fields.owner||session.account!==review.fields.owner)throw Error('LENDING_WRONG_ACCOUNT');
      if(chain!=='0x14a34'||session.chainId!=='0x14a34')throw Error('LENDING_WRONG_CHAIN');
      if(injected()!==provider||JSON.stringify(latest.current)!==JSON.stringify(snapshot))throw Error('LENDING_SESSION_CHANGED');
      if(nonce!==undefined&&supplyWalletNonce(await provider.request({method:'eth_getTransactionCount',params:[session.account,'pending']}))!==BigInt(nonce))throw Error('LENDING_NONCE_CHANGED');
    };
    let attempt:string|null=null,handoff=false;
    try{
      await validate();const begin=await lendingBegin(record.id,session.account,authored);if(!begin.ok)throw Error(begin.code);
      accept(begin.value.record);attempt=begin.value.attemptId;
      await validate(begin.value.record.attempts.at(-1)!.nonce);
      const ready=await lendingHandoff(record.id,attempt);if(!ready.ok)throw Error(ready.code);handoff=true;accept(ready.value);
      if(walletRef.current.account!==session.account||walletRef.current.chainId!==session.chainId)throw Error('LENDING_SESSION_CHANGED');
      await validate(begin.value.record.attempts.at(-1)!.nonce);
      setSigning(true);
      // Only this explicit owner click reaches the provider submission method. Recovery never does.
      let hash:unknown;try{hash=await provider.request({method:'eth_sendTransaction',params:[supplyWalletTransaction(begin.value.transaction)]});}finally{setSigning(false);}
      if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('LENDING_SUBMISSION_UNKNOWN');
      window.localStorage.setItem(key,JSON.stringify({id:record.id,attempt,hash:hash.toLowerCase()}));
      const report=await lendingReport(record.id,attempt,{kind:'HASH',hash:hash.toLowerCase()});if(!report.ok)throw Error(report.code);accept(report.value);
    }catch(cause){
      if(attempt){const result=handoff?await lendingReport(record.id,attempt,{kind:'UNKNOWN'}):await lendingCancelPrepared(record.id,attempt);if(result.ok)accept(result.value);}
      throw cause;
    }
    const result=await lendingObserve(record.id);if(result.ok)accept(result.value);
  });}
  return <Context.Provider value={{record,busy,signing,error,retired,recovered,simulate,review,execute,observe,refresh,cancelPrepared}}>{signing&&<p role="status">Confirm the exact transaction in your wallet.</p>}<div inert={signing}>{children}</div></Context.Provider>;
}
export function useLending(){const value=useContext(Context);if(!value)throw Error('LENDING_PROVIDER_MISSING');return value;}
