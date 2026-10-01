// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { useWorkflow } from './workflow-store';
import { injected, useBuild009Wallet } from './build009-wallet-store';
import { supplySimulate, supplyReview, supplyBegin, supplyReport, supplyObserve, supplyStatus, supplyInvalidate, supplyRecoverReview } from '../app/supply-action';
import type { SupplyRecord } from '../server/supply-service';
const key='gryloo:build012a:supply';
type RecoveryPointer={id?:string;step?:'APPROVAL'|'SUPPLY';hash?:string};
type Store={record:SupplyRecord|null;busy:boolean;error:string|null;retired:boolean;recovered:boolean;simulate():Promise<void>;review():Promise<void>;execute():Promise<void>;observe():Promise<void>;recoverReview():Promise<void>};
const Context=createContext<Store|null>(null);
export function SupplyProvider({children}:{children:ReactNode}){
  const {state}=useWorkflow(),wallet=useBuild009Wallet();
  const [record,setRecord]=useState<SupplyRecord|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[recovered,setRecovered]=useState(false),[signing,setSigning]=useState(false);
  useEffect(()=>{
    if(!signing)return;
    const preventEdit=(event:KeyboardEvent)=>{event.preventDefault();event.stopImmediatePropagation();};
    window.addEventListener('keydown',preventEdit,true);
    return()=>window.removeEventListener('keydown',preventEdit,true);
  },[signing]);
  const workflow=state.workflow as unknown as SemanticWorkflow;
  const latest=useRef(workflow);latest.current=workflow;
  const busyRef=useRef(false);
  const equal=record&&JSON.stringify(record.review.workflow)===JSON.stringify(workflow);
  const pristineRecovery=recovered&&workflow.revision===0&&workflow.nodes.length===1&&workflow.nodes[0]?.actionType==='mock-read';
  const retired=Boolean(record&&!equal&&!pristineRecovery);
  function accept(value:SupplyRecord){
    setRecord(value);
    let prior:RecoveryPointer|null=null;
    try{prior=JSON.parse(window.localStorage.getItem(key)??'null') as RecoveryPointer|null;}catch{ /* The server's durable attempt remains authoritative. */ }
    const attempt=value.attempts.at(-1);
    const hash=attempt?.transactionHash??(prior?.id===value.id?prior.hash:undefined);
    window.localStorage.setItem(key,JSON.stringify({id:value.id,...hash?{step:attempt?.step??prior?.step,hash}:{}}));
  }
  useEffect(()=>{
    let mounted=true;
    try{const pointer=JSON.parse(window.localStorage.getItem(key)??'null') as {id?:unknown;step?:unknown;hash?:unknown}|null;
      if(pointer&&typeof pointer.id==='string'&&/^supply-[a-f0-9]{32}$/.test(pointer.id))(async()=>{
        if(typeof pointer.hash==='string'&&/^0x[0-9a-f]{64}$/.test(pointer.hash)&&(pointer.step==='APPROVAL'||pointer.step==='SUPPLY'))
          await supplyReport(pointer.id as string,pointer.step,{kind:'HASH',hash:pointer.hash}).catch(()=>undefined);
        return supplyStatus(pointer.id as string);
      })().then(result=>{if(mounted&&result.ok){setRecord(result.value);setRecovered(true);}}).catch(()=>undefined);
    }catch{setError('SUPPLY_RECOVERY_POINTER_INVALID');}
    return()=>{mounted=false;};
  },[]);
  useEffect(()=>{if(record&&retired&&record.authorization)supplyInvalidate(record.id).then(result=>{if(result.ok)setRecord(result.value);}).catch(()=>setError('SUPPLY_AUTHORIZATION_INVALIDATION_FAILED'));},[record,retired]);
  async function operation(action:()=>Promise<void>){if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);try{await action();}catch(cause){setError(cause instanceof Error?cause.message:'SUPPLY_OPERATION_FAILED');}finally{busyRef.current=false;setBusy(false);}}
  async function observe(){await operation(async()=>{if(!record)throw new Error('SUPPLY_RUN_MISSING');const result=await supplyObserve(record.id);if(!result.ok)throw new Error(result.code);accept(result.value);});}
  async function recoverReview(){await operation(async()=>{
    if(!record)throw new Error('SUPPLY_RUN_MISSING');
    const result=await supplyRecoverReview(record.id);if(!result.ok)throw new Error(result.code);accept(result.value);setRecovered(true);
  });}
  async function simulate(){await operation(async()=>{
    if(record?.attempts.some(a=>!a.reconciled))throw new Error('SUPPLY_EXISTING_ATTEMPT_OBSERVE_ONLY');
    const authored=pristineRecovery?record!.review.workflow:workflow;
    const node=authored.nodes.find(n=>n.actionType==='supply'),beneficiary=node?.inputs.find(p=>p.name==='beneficiary');
    if(beneficiary?.kind!=='ACCOUNT')throw new Error('SUPPLY_BENEFICIARY_REQUIRED');
    const snapshot=latest.current;
    const result=record?.recoveryOf&&!retired&&!record.attempts.length?await supplyRecoverReview(record.recoveryOf):await supplySimulate(authored,wallet.account??beneficiary.value.address);if(!result.ok)throw new Error(result.code);
    if(latest.current!==snapshot)throw new Error('SUPPLY_SEMANTIC_REVISION_CHANGED');accept(result.value);setRecovered(pristineRecovery);
  });}
  async function review(){await operation(async()=>{if(!record||retired)throw new Error('SUPPLY_SIMULATION_REQUIRED');
    const snapshot=pristineRecovery?record.review.workflow:latest.current;
    const result=await supplyReview(record.id,record.review.commitment,snapshot);if(!result.ok)throw new Error(result.code);accept(result.value);
  });}
  async function execute(){await operation(async()=>{
    if(!record||retired||record.authorization!==record.review.commitment)throw new Error('SUPPLY_REVIEW_REQUIRED');
    let session=await wallet.session();if(!session)session=await wallet.connect();
    if(!session)throw new Error('SUPPLY_WALLET_REQUIRED');
    if(session.chainId!=='0x14a34')throw new Error('SUPPLY_WRONG_CHAIN');
    if(session.account!==record.review.account)throw new Error('SUPPLY_WRONG_ACCOUNT');
    const provider=injected();if(!provider)throw new Error('SUPPLY_WALLET_REQUIRED');
    const snapshot=latest.current,executionWorkflow=pristineRecovery?record.review.workflow:snapshot;
    if(!pristineRecovery&&JSON.stringify(executionWorkflow)!==JSON.stringify(record.review.workflow))throw new Error('SUPPLY_SEMANTIC_REVISION_CHANGED');
    const begin=await supplyBegin(record.id,session.account,executionWorkflow);if(!begin.ok)throw new Error(begin.code);
    accept(begin.value.record);
    const {step,transaction}=begin.value;
    let walletRequestStarted=false;
    try{
      const accounts=await provider.request({method:'eth_accounts'}),chain=await provider.request({method:'eth_chainId'});
      const nonce=await provider.request({method:'eth_getTransactionCount',params:[session.account,'pending']});
      if(latest.current!==snapshot||!Array.isArray(accounts)||accounts[0]?.toLowerCase()!==session.account||typeof chain!=='string'||chain.toLowerCase()!=='0x14a34'||typeof nonce!=='string'||BigInt(nonce)!==BigInt(transaction.nonce))throw new Error('SUPPLY_WALLET_OR_AUTHORIZATION_CHANGED');
      // This is the sole submission point, reachable only from the owner's Execute click.
      setSigning(true);
      walletRequestStarted=true;
      let hash:unknown;try{hash=await provider.request({method:'eth_sendTransaction',params:[transaction]});}finally{setSigning(false);}
      if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error('SUPPLY_SUBMISSION_UNKNOWN');
      window.localStorage.setItem(key,JSON.stringify({id:record.id,step,hash:hash.toLowerCase()}));
      const report=await supplyReport(record.id,step,{kind:'HASH',hash:hash.toLowerCase()});if(!report.ok)throw new Error(report.code);accept(report.value);
    }catch(cause){
      const rejected=!!cause&&typeof cause==='object'&&'code'in cause&&cause.code===4001;
      const code=!walletRequestStarted?(cause instanceof Error&&cause.message==='SUPPLY_WALLET_OR_AUTHORIZATION_CHANGED'?cause.message:'SUPPLY_RPC_ERROR_BEFORE_WALLET_SUBMISSION'):'SUPPLY_WALLET_SUBMISSION_RESULT_UNKNOWN';
      const report=await supplyReport(record.id,step,{kind:rejected?'REJECTED':'UNKNOWN',code});if(report.ok)accept(report.value);
      throw new Error(rejected?(step==='APPROVAL'?'SUPPLY_APPROVAL_REJECTED':'SUPPLY_REJECTED'):'SUPPLY_SUBMISSION_UNKNOWN_OBSERVE_EXISTING',{cause});
    }
    const observed=await supplyObserve(record.id);if(observed.ok)accept(observed.value);
  });}
  return <Context.Provider value={{record,busy,error,retired,recovered,simulate,review,execute,observe,recoverReview}}>{signing&&<p role="status">Confirm or reject the pending request in your wallet.</p>}<div inert={signing} data-supply-wallet-pending={signing?'true':undefined}>{children}</div></Context.Provider>;
}
export function useSupply(){const value=useContext(Context);if(!value)throw new Error('SUPPLY_PROVIDER_MISSING');return value;}
