// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { TokenAmountInput } from './token-amount-input';
import { useState, type FormEvent } from 'react';
import { createAuthoredRepay, repayDetails, lendingCopy, lendingNetworkView, lendingView, LENDING_NETWORKS, type LendingNetwork, type SupplyInput } from '../domain/supply-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useSupply } from '../state/supply-store';
import type { RepayObservation } from '@defi-workflow-engine/reference-reconciler';
const human=(value:string,decimals:number)=>(Number(value)/10**decimals).toLocaleString('en-US',{maximumFractionDigits:decimals});
const hf=(value:string)=>BigInt(value)===(1n<<256n)-1n?'No debt (∞)':human(value,18);
export function RepayAuthoringForm({nodeId,onDone,direct=false,reviewFormId}:{nodeId?:string;onDone?:()=>void;direct?:boolean;reviewFormId?:string}){
  const { t: tr } = useLocale();
  const {state,propose,dispatch,amountInputs={},editCanvasAmount}=useWorkflow(),wallet=useBuild009Wallet();
  const node=state.workflow.nodes.find(n=>n.nodeId===nodeId),existing=node?repayDetails(node as Parameters<typeof repayDetails>[0]):null;
  const [localAmount,setAmount]=useState(existing?.amount??'0.005'),[error,setError]=useState('');
  const amount = reviewFormId && nodeId ? amountInputs[nodeId] ?? existing?.amount ?? localAmount : localAmount;
  const [network,setNetwork]=useState<LendingNetwork>(existing?.network??'Base Sepolia'),shown=lendingNetworkView(network),asset=shown.asset;
  function submit(event:FormEvent){event.preventDefault();try{
    const input:SupplyInput={network,asset,amount,beneficiary:wallet.account??existing?.beneficiary??''};
    createAuthoredRepay(nodeId??'node-preview',input);
    const command=nodeId?{type:'SET_REPAY' as const,nodeId,input,source:'CANVAS' as const,baseRevision:state.workflow.revision}:{type:'ADD_REPAY' as const,input,source:'CANVAS' as const,baseRevision:state.workflow.revision};
    if(direct)dispatch(command);else propose(command);onDone?.();
  }catch{setError(`Connect your owner wallet and enter a positive ${asset} amount with at most ${shown.decimals===6?'six':shown.decimals} decimal places.`);}}
  return <form id={reviewFormId} className="inspector-fields" aria-label={tr(nodeId?'Edit Repay':'Create Repay')} onSubmit={submit}>
    <strong>{tr("Repay to Aave V3")}</strong>
    <label>{tr("Repay network")}<select aria-label={tr("Repay network")} value={network} onChange={e=>setNetwork(e.target.value as LendingNetwork)}>{LENDING_NETWORKS.map(n=><option key={n}>{tr(n)}</option>)}</select></label>
    <label>{tr("Repay asset")}<select aria-label={tr("Repay asset")} value={asset} onChange={()=>undefined}><option>{tr(asset)}</option></select></label>
    <label>{tr("Repay amount (")}{tr(asset)})<TokenAmountInput aria-label={tr(`Repay amount (${asset})`)} value={amount} maxLength={80} onValueChange={value=>{setError('');if(reviewFormId&&nodeId)editCanvasAmount(nodeId,value);else setAmount(value);}}/></label>
    <label>{tr("Debt mode")}<select aria-label={tr("Debt mode")} value="Variable (2)" onChange={()=>undefined}><option>{tr("Variable (2)")}</option></select></label>
    {!wallet.account&&!existing&&<button type="button" onClick={()=>void wallet.connect()}>{tr("Connect owner wallet")}</button>}
    <p>{tr("Your connected wallet pays ")}{tr(asset)}{tr(" to reduce its own variable debt.")}</p>
    {error&&<p role="alert">{tr(error)}</p>} { !reviewFormId && <button type="submit" disabled={!wallet.account&&!existing}>{tr(nodeId?'Review Repay change':direct?'Add Repay':'Review Repay proposal')}</button>}
    {onDone&&<button type="button" className="quiet" onClick={onDone}>{tr("Cancel")}</button>}
  </form>;
}
const messages:Record<string,string>={REPAY_PARTIAL_DEBT_REQUIRED:'Current variable debt must exceed the partial repayment amount.',SUPPLY_INSUFFICIENT_USDC:'Your wallet does not have enough USDC for this repayment.',REPAY_AUTHORIZATION_STALE:'The reviewed debt, collateral or price changed. Simulate and review again.',SUPPLY_AUTHORIZATION_STALE:'Review expired or the wallet state changed. Prepare a fresh review.',SUPPLY_WRONG_CHAIN:'Switch your wallet to Base Sepolia.',SUPPLY_WRONG_ACCOUNT:'Select the owner wallet shown in Review.',SUPPLY_INSUFFICIENT_ETH:'The owner wallet needs Base Sepolia ETH for gas.',SUPPLY_RPC_RATE_LIMITED:'The public provider is busy. Try the read again.',SUPPLY_TRANSACTION_NOT_OBSERVED:'The existing transaction is not visible yet. Observe it again.',SUPPLY_OBSERVATION_BOUND_REACHED:'The bounded search ended. Preserve this record and observe the existing transaction.',SUPPLY_APPROVAL_REJECTED:'The approval request was declined.',SUPPLY_REJECTED:'The Repay request was declined.',AWAITING_CONFIRMATIONS:'Waiting for network confirmations.'};
export function RepayPanel({view}:{view:'simulate'|'execute'}){
  const { t: tr } = useLocale();
  const {state}=useWorkflow(),run=useSupply(),wallet=useBuild009Wallet(),record=run.record?.review.repay?run.record:null,review=record?.review,risk=review?.state.borrow;
  const node=state.workflow.nodes.find(n=>n.actionType==='repay'),fields=node?repayDetails(node as Parameters<typeof repayDetails>[0]):null,shown=lendingView(review?.chain??node?.chainId);
  const pending=record?.notSubmitted?undefined:record?.attempts.find(a=>!a.reconciled),approval=record?.attempts.find(a=>a.step==='APPROVAL'&&a.reconciled);
  const info=run.error??record?.error,observation=record?.observations.at(-1) as RepayObservation|undefined;
  const reobserveApproval=record?.verdict==='DIVERGENT'&&record.error==='SUPPLY_RPC_INVALID'&&record.attempts.length===1&&pending?.step==='APPROVAL'&&pending.state==='RECONCILIATION_REQUIRED'&&observation?.transaction?.blockHash===null;
  return <section className="panel" aria-label={tr("Aave Repay")}><h2>{tr(view==='simulate'?'Simulate Repay':record?.evidence?'Repay result':'Review Repay')}</h2>
    <p>{tr("Repay ")}{tr(fields?.amount??(review?human(review.amount,shown.decimals):''))} {tr(shown.asset)}{tr(" to Aave V3 on ")}{tr(shown.network)}.</p>
    <p>{tr("Variable debt mode: 2. onBehalfOf is your owner wallet.")}</p>
    {run.retired&&record&&<p role="alert">{tr("The workflow changed. Authorization is invalid. Observe any existing transaction before starting again.")}</p>}
    {risk&&review&&<><p>{tr("Wallet ")}{tr(shown.asset)}{tr(" balance: ")}{tr(human(review.state.balance,shown.decimals))} {tr(shown.asset)}</p>
      <p>{tr("Variable debt before: ")}{tr(human(risk.debt,shown.decimals))} {tr(shown.asset)}</p><p>{tr("Repay amount: ")}{tr(human(review.amount,shown.decimals))} {tr(shown.asset)} ({tr(review.amount)}{tr(" raw)")}</p>
      <p>{tr("Allowance before: ")}{tr(human(review.allowance,shown.decimals))} {tr(shown.asset)}</p><p>{tr("Approval required: ")}{tr(review.approvalRequired?'Yes — exactly '+review.amount+' raw '+shown.asset+' to the Aave Pool':'No')}</p>
      <p>{tr("Estimated variable debt after: ")}{tr(human(review.repay!.debtAfter,shown.decimals))} {tr(shown.asset)}</p><p>{tr("Health factor before: ")}{tr(hf(risk.healthFactor))}</p><p>{tr("Estimated health factor after: ")}{tr(hf(review.repay!.expectedPostHealthFactor))}</p>
      <p>{tr("Collateral: ")}{tr(human(review.state.position,shown.decimals))} {tr(shown.asset)}{tr(" supplied · ")}{tr((BigInt(risk.userConfiguration)&shown.collateralBit)!==0n?'enabled':'disabled')}{tr(" · value $")}{tr(human(risk.collateralBase,8))}{tr(". Repay preserves collateral.")}</p>
      <p>{tr("Estimated network cost: ")}{tr(human(review.gasLimits.reduce((total,gas)=>total+BigInt(gas)*BigInt(review.state.gasPrice),0n).toString(),18))}{tr(" ETH.")}</p>
      <p>{tr("Maximum network budget: ")}{tr(human(review.manifest.gasBudgets[0]?.maximumAmount??'0',18))}{tr(" ETH, including fee margin.")}</p>
      <p>{tr("Owner / onBehalfOf: ")}{review.account}</p><p>{tr("Pool / approval spender: ")}{tr(review.pool)}</p><p>{tr("Asset: ")}{tr(review.asset)}</p><p>{tr("State block: ")}{tr(review.state.block)}{tr(" · Review expires: ")}{tr(review.expiresAt)}</p>
      <p>{tr("Debt estimates use the current index. Interest accrues until execution; final repayment is independently reconciled.")}</p></>}
    {view==='simulate'?<button type="button" disabled={run.busy||Boolean(pending)} onClick={()=>void run.simulate()}>{tr("Simulate Repay")}</button>:<>
      {review&&wallet.account&&wallet.chainId!==shown.chainHex&&<button type="button" disabled={run.busy||wallet.busy} onClick={()=>void run.switchNetwork()}>{tr("Switch wallet to ")}{tr(shown.network)}</button>}
      {record&&!record.authorization&&!record.attempts.length&&!run.retired&&<button type="button" disabled={run.busy} onClick={()=>void run.review()}>{tr("Accept Repay review")}</button>}
      {record?.authorization&&!run.retired&&!pending&&!record.notSubmitted&&record.verdict==='PENDING'&&<button type="button" className="primary" disabled={run.busy} onClick={()=>void run.execute()}>{tr(review?.approvalRequired&&!approval?'Approve exactly '+review.amount+' raw '+shown.asset:'Execute')}</button>}
      {record?.attempts.map(a=><p key={a.step}>{tr(a.step==='APPROVAL'?'Approval':'Repay')}: {tr(a.reconciled||a.step==='APPROVAL'&&record.approvalProof?'Independently verified':record.notSubmitted?'not submitted':a.state.toLowerCase().replaceAll('_',' '))} {a.transactionHash&&<a href={`${shown.explorer}/tx/${a.transactionHash}`} target="_blank" rel="noreferrer">{tr("View transaction")}</a>}</p>)}
      {pending&&(record?.verdict==='PENDING'||reobserveApproval)&&<button type="button" disabled={run.busy} onClick={()=>void run.observe()}>{tr("Observe existing transaction")}</button>}
      {record?.notSubmitted&&<p>{tr("The wallet request was not submitted. Prepare a fresh explicit owner review for the same intent.")}</p>}
      {(record?.notSubmitted||approval&&record?.attempts.length===1||record?.approvalProof)&&!run.retired&&<button type="button" disabled={run.busy} onClick={()=>void run.recoverReview()}>{tr("Prepare fresh review")}</button>}
      {record?.attempts.length&&!record.evidence?<a download="flofi-aave-repay-execution-record.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record,null,2))}>{tr("Download execution record")}</a>:null}
      {record?.evidence&&observation?.postPosition?.borrow&&<><p>{tr("Repay independently reconciled. Wallet paid exactly ")}{tr(human(review!.amount,shown.decimals))} {tr(shown.asset)}{tr("; variable debt is ")}{tr(human(observation.postPosition.borrow.debt,shown.decimals))} {tr(shown.asset)}{tr("; health factor is ")}{tr(hf(observation.postPosition.borrow.healthFactor))}{tr(". Collateral is unchanged.")}</p><a download="flofi-aave-repay-evidence.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record.evidence,null,2))}>{tr("Download Evidence Bundle")}</a></>}
    </>}
    {info&&<p role="status">{tr(lendingCopy(messages[info]??'Repay needs attention. Inspect technical details and observe any existing transaction.',shown))}</p>}
    <details><summary>{tr("Show technical details")}</summary><pre>{JSON.stringify({error:info,review,attempts:record?.attempts,observations:record?.observations,walletDiagnostic:record?.walletDiagnostic,environment:record?.evidence?.bundle.environment},null,2)}</pre></details>
  </section>;
}
