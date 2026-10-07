// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { TokenAmountInput } from './token-amount-input';
import { useState,type FormEvent } from 'react';
import { createAuthoredWithdraw,withdrawDetails,lendingCopy,lendingNetworkView,lendingView,LENDING_NETWORKS,type LendingNetwork,type WithdrawInput } from '../domain/supply-authoring';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useWorkflow } from '../state/workflow-store';
import { useSupply } from '../state/supply-store';
import type { WithdrawObservation } from '@defi-workflow-engine/reference-reconciler';
const human=(value:string,decimals:number)=>(Number(value)/10**decimals).toLocaleString('en-US',{maximumFractionDigits:decimals});
const hf=(value:string)=>BigInt(value)===(1n<<256n)-1n?'No debt (∞)':human(value,18);
export function WithdrawAuthoringForm({nodeId,onDone,direct=false,reviewFormId}:{nodeId?:string;onDone?:()=>void;direct?:boolean;reviewFormId?:string}){
  const {state,propose,dispatch,amountInputs={},editCanvasAmount}=useWorkflow(),node=state.workflow.nodes.find(n=>n.nodeId===nodeId),existing=node?withdrawDetails(node as Parameters<typeof withdrawDetails>[0]):null;
  const [localAmount,setAmount]=useState(existing?.amount??'0.1'),[error,setError]=useState('');
  const amount = reviewFormId && nodeId ? amountInputs[nodeId] ?? existing?.amount ?? localAmount : localAmount;
  const [network,setNetwork]=useState<LendingNetwork>(existing?.network??'Base Sepolia'),shown=lendingNetworkView(network),asset=shown.asset;
  function submit(event:FormEvent){event.preventDefault();try{
    const input:WithdrawInput={network,asset,amount,recipient:'CONNECTED_OWNER'};createAuthoredWithdraw(nodeId??'node-preview',input);
    const command=nodeId?{type:'SET_WITHDRAW' as const,nodeId,input,source:'CANVAS' as const,baseRevision:state.workflow.revision}:{type:'ADD_WITHDRAW' as const,input,source:'CANVAS' as const,baseRevision:state.workflow.revision};
    if(direct)dispatch(command);else propose(command);onDone?.();
  }catch{setError(`Enter an exact positive partial ${asset} amount with at most ${shown.decimals===6?'six':shown.decimals} decimal places.`);}}
  return <form id={reviewFormId} className="inspector-fields" aria-label={nodeId?'Edit Withdraw':'Create Withdraw'} onSubmit={submit}><strong>Withdraw from Aave V3</strong>
    <label>Withdraw network<select aria-label="Withdraw network" value={network} onChange={e=>setNetwork(e.target.value as LendingNetwork)}>{LENDING_NETWORKS.map(n=><option key={n}>{n}</option>)}</select></label>
    <label>Withdraw asset<select aria-label="Withdraw asset" value={asset} onChange={()=>undefined}><option>{asset}</option></select></label>
    <label>Withdraw amount ({asset})<TokenAmountInput aria-label={`Withdraw amount (${asset})`} value={amount} maxLength={80} onValueChange={value=>{setError('');if(reviewFormId&&nodeId)editCanvasAmount(nodeId,value);else setAmount(value);}}/></label>
    <p>Recipient: your connected owner wallet, bound at Review. Partial withdrawal only.</p>{error&&<p role="alert">{error}</p>}
    {!reviewFormId&&<button type="submit">{nodeId?'Review Withdraw change':direct?'Add Withdraw':'Review Withdraw proposal'}</button>}{onDone&&<button type="button" className="quiet" onClick={onDone}>Cancel</button>}
  </form>;
}
const messages:Record<string,string>={WITHDRAW_INSUFFICIENT_COLLATERAL:'Supplied collateral must exceed the exact partial withdrawal.',WITHDRAW_UNSAFE_HEALTH_FACTOR:'Withdrawal would leave an unsafe position. Choose a smaller partial amount.',WITHDRAW_AUTHORIZATION_STALE:'The reviewed collateral, debt or price changed. Simulate and review again.',SUPPLY_AUTHORIZATION_STALE:'Review expired or wallet state changed. Prepare a fresh review.',SUPPLY_WRONG_CHAIN:'Switch your wallet to Base Sepolia.',SUPPLY_WRONG_ACCOUNT:'Select the owner wallet shown in Review.',SUPPLY_INSUFFICIENT_ETH:'The owner wallet needs Base Sepolia ETH for gas.',SUPPLY_RPC_RATE_LIMITED:'The public provider is busy. Try the read again.',SUPPLY_REJECTED:'The Withdraw request was declined.',AWAITING_CONFIRMATIONS:'Waiting for network confirmations.'};
export function WithdrawPanel({view}:{view:'simulate'|'execute'}){
  const {state}=useWorkflow(),run=useSupply(),wallet=useBuild009Wallet(),record=run.record?.review.withdraw?run.record:null,review=record?.review,risk=review?.state.borrow;
  const node=state.workflow.nodes.find(n=>n.actionType==='withdraw'),fields=node?withdrawDetails(node as Parameters<typeof withdrawDetails>[0]):null,shown=lendingView(review?.chain??node?.chainId);
  const pending=record?.notSubmitted?undefined:record?.attempts.find(a=>!a.reconciled),info=run.error??record?.error,observation=record?.observations.at(-1) as WithdrawObservation|undefined;
  return <section className="panel" aria-label="Aave Withdraw"><h2>{view==='simulate'?'Simulate Withdraw':record?.evidence?'Withdraw result':'Review Withdraw'}</h2>
    <p>Withdraw {fields?.amount??(review?human(review.amount,shown.decimals):'')} {shown.asset} from Aave V3 on {shown.network}.</p>
    {run.retired&&record&&<p role="alert">The workflow changed. Authorization is invalid. Observe any existing transaction before starting again.</p>}
    {risk&&review&&<><p>Supplied collateral before: {human(review.state.position,shown.decimals)} {shown.asset}</p><p>Withdraw amount: {human(review.amount,shown.decimals)} {shown.asset} ({review.amount} raw)</p>
      <p>Estimated supplied collateral after: {human(review.withdraw!.collateralAfter,shown.decimals)} {shown.asset}</p><p>Outstanding variable debt: {human(risk.debt,shown.decimals)} {shown.asset}</p>
      <p>Health factor before: {hf(risk.healthFactor)}</p><p>Estimated health factor after: {hf(review.withdraw!.expectedPostHealthFactor)}</p>
      <p>Wallet {shown.asset} before: {human(review.state.balance,shown.decimals)} {shown.asset}</p><p>Estimated wallet {shown.asset} after: {human(review.withdraw!.walletAfter,shown.decimals)} {shown.asset}</p>
      <p>Estimated network cost: {human(review.gasLimits.reduce((total,gas)=>total+BigInt(gas)*BigInt(review.state.gasPrice),0n).toString(),18)} ETH.</p>
      <p>Maximum network budget: {human(review.manifest.gasBudgets[0]?.maximumAmount??'0',18)} ETH, including fee margin.</p>
      <p>Owner / recipient: {review.account}</p><p>Pool: {review.pool}</p><p>Asset: {review.asset}</p><p>Chain: {shown.network} ({Number(BigInt(shown.chainHex))})</p>
      <p>Exact Pool call: withdraw({review.asset}, {review.amount}, {review.beneficiary})</p><p>Exact calldata: <code>{review.transactions[0]?.data}</code></p>
      <p>State block: {review.state.block} · Review expires: {review.expiresAt}</p><p>Collateral estimates account for index rounding. Debt continues accruing normal interest.</p></>}
    {view==='simulate'?<button type="button" disabled={run.busy||Boolean(pending)} onClick={()=>void run.simulate()}>Simulate Withdraw</button>:<>
      {review&&wallet.account&&wallet.chainId!==shown.chainHex&&<button type="button" disabled={run.busy||wallet.busy} onClick={()=>void run.switchNetwork()}>Switch wallet to {shown.network}</button>}
      {record&&!record.authorization&&!record.attempts.length&&!run.retired&&<button type="button" disabled={run.busy} onClick={()=>void run.review()}>Accept Withdraw review</button>}
      {record?.authorization&&!run.retired&&!pending&&!record.notSubmitted&&record.verdict==='PENDING'&&<button type="button" className="primary" disabled={run.busy} onClick={()=>void run.execute()}>Execute</button>}
      {record?.attempts.map(a=><p key={a.step}>Withdraw: {a.reconciled?'Independently verified':record.notSubmitted?'not submitted':a.state.toLowerCase().replaceAll('_',' ')} {a.transactionHash&&<a href={`${shown.explorer}/tx/${a.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a>}</p>)}
      {pending&&record?.verdict==='PENDING'&&<button type="button" disabled={run.busy} onClick={()=>void run.observe()}>Observe existing transaction</button>}
      {record?.notSubmitted&&!run.retired&&<><p>The wallet request was not submitted. Prepare a fresh explicit owner Review.</p><button type="button" disabled={run.busy} onClick={()=>void run.recoverReview()}>Prepare fresh review</button></>}
      {record?.attempts.length&&!record.evidence?<a download="flofi-aave-withdraw-execution-record.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record,null,2))}>Download execution record</a>:null}
      {record?.evidence&&observation?.postPosition?.borrow&&<><p>Withdraw independently reconciled. Wallet received exactly {human(review!.amount,shown.decimals)} {shown.asset}; supplied collateral is {human(observation.postPosition.position,shown.decimals)} {shown.asset}; health factor is {hf(observation.postPosition.borrow.healthFactor)}.</p><a download="flofi-aave-withdraw-evidence.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record.evidence,null,2))}>Download Evidence Bundle</a></>}
    </>}{info&&<p role="status">{lendingCopy(messages[info]??'Withdraw needs attention. Inspect technical details and observe any existing transaction.',shown)}</p>}
    <details><summary>Show technical details</summary><pre>{JSON.stringify({error:info,review,attempts:record?.attempts,observations:record?.observations,walletDiagnostic:record?.walletDiagnostic,environment:record?.evidence?.bundle.environment},null,2)}</pre></details>
  </section>;
}
