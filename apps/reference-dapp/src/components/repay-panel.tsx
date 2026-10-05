// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type FormEvent } from 'react';
import { createAuthoredRepay, repayDetails, lendingCopy, lendingNetworkView, lendingView, LENDING_NETWORKS, type LendingNetwork, type SupplyInput } from '../domain/supply-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useSupply } from '../state/supply-store';
import type { RepayObservation } from '@defi-workflow-engine/reference-reconciler';
const human=(value:string,decimals:number)=>(Number(value)/10**decimals).toLocaleString('en-US',{maximumFractionDigits:decimals});
const hf=(value:string)=>BigInt(value)===(1n<<256n)-1n?'No debt (∞)':human(value,18);
export function RepayAuthoringForm({nodeId,onDone,direct=false}:{nodeId?:string;onDone?:()=>void;direct?:boolean}){
  const {state,propose,dispatch}=useWorkflow(),wallet=useBuild009Wallet();
  const node=state.workflow.nodes.find(n=>n.nodeId===nodeId),existing=node?repayDetails(node as Parameters<typeof repayDetails>[0]):null;
  const [amount,setAmount]=useState(existing?.amount??'0.005'),[error,setError]=useState('');
  const [network,setNetwork]=useState<LendingNetwork>(existing?.network??'Base Sepolia'),shown=lendingNetworkView(network),asset=shown.asset;
  function submit(event:FormEvent){event.preventDefault();try{
    const input:SupplyInput={network,asset,amount,beneficiary:wallet.account??existing?.beneficiary??''};
    createAuthoredRepay(nodeId??'node-preview',input);
    const command=nodeId?{type:'SET_REPAY' as const,nodeId,input,source:'CANVAS' as const,baseRevision:state.workflow.revision}:{type:'ADD_REPAY' as const,input,source:'CANVAS' as const,baseRevision:state.workflow.revision};
    if(direct)dispatch(command);else propose(command);onDone?.();
  }catch{setError(`Connect your owner wallet and enter a positive ${asset} amount with at most ${shown.decimals===6?'six':shown.decimals} decimal places.`);}}
  return <form className="inspector-fields" aria-label={nodeId?'Edit Repay':'Create Repay'} onSubmit={submit}>
    <strong>Repay to Aave V3</strong>
    <label>Repay network<select aria-label="Repay network" value={network} onChange={e=>setNetwork(e.target.value as LendingNetwork)}>{LENDING_NETWORKS.map(n=><option key={n}>{n}</option>)}</select></label>
    <label>Repay asset<select aria-label="Repay asset" value={asset} onChange={()=>undefined}><option>{asset}</option></select></label>
    <label>Repay amount ({asset})<input aria-label={`Repay amount (${asset})`} inputMode="decimal" value={amount} maxLength={80} onChange={e=>setAmount(e.target.value)}/></label>
    <label>Debt mode<select aria-label="Debt mode" value="Variable (2)" onChange={()=>undefined}><option>Variable (2)</option></select></label>
    {!wallet.account&&!existing&&<button type="button" onClick={()=>void wallet.connect()}>Connect owner wallet</button>}
    <p>Your connected wallet pays {asset} to reduce its own variable debt.</p>
    {error&&<p role="alert">{error}</p>}<button type="submit" disabled={!wallet.account&&!existing}>{nodeId?'Review Repay change':direct?'Add Repay':'Review Repay proposal'}</button>
    {onDone&&<button type="button" className="quiet" onClick={onDone}>Cancel</button>}
  </form>;
}
const messages:Record<string,string>={REPAY_PARTIAL_DEBT_REQUIRED:'Current variable debt must exceed the partial repayment amount.',SUPPLY_INSUFFICIENT_USDC:'Your wallet does not have enough USDC for this repayment.',REPAY_AUTHORIZATION_STALE:'The reviewed debt, collateral or price changed. Simulate and review again.',SUPPLY_AUTHORIZATION_STALE:'Review expired or the wallet state changed. Prepare a fresh review.',SUPPLY_WRONG_CHAIN:'Switch your wallet to Base Sepolia.',SUPPLY_WRONG_ACCOUNT:'Select the owner wallet shown in Review.',SUPPLY_INSUFFICIENT_ETH:'The owner wallet needs Base Sepolia ETH for gas.',SUPPLY_RPC_RATE_LIMITED:'The public provider is busy. Try the read again.',SUPPLY_TRANSACTION_NOT_OBSERVED:'The existing transaction is not visible yet. Observe it again.',SUPPLY_OBSERVATION_BOUND_REACHED:'The bounded search ended. Preserve this record and observe the existing transaction.',SUPPLY_APPROVAL_REJECTED:'The approval request was declined.',SUPPLY_REJECTED:'The Repay request was declined.',AWAITING_CONFIRMATIONS:'Waiting for network confirmations.'};
export function RepayPanel({view}:{view:'simulate'|'execute'}){
  const {state}=useWorkflow(),run=useSupply(),wallet=useBuild009Wallet(),record=run.record?.review.repay?run.record:null,review=record?.review,risk=review?.state.borrow;
  const node=state.workflow.nodes.find(n=>n.actionType==='repay'),fields=node?repayDetails(node as Parameters<typeof repayDetails>[0]):null,shown=lendingView(review?.chain??node?.chainId);
  const pending=record?.notSubmitted?undefined:record?.attempts.find(a=>!a.reconciled),approval=record?.attempts.find(a=>a.step==='APPROVAL'&&a.reconciled);
  const info=run.error??record?.error,observation=record?.observations.at(-1) as RepayObservation|undefined;
  const reobserveApproval=record?.verdict==='DIVERGENT'&&record.error==='SUPPLY_RPC_INVALID'&&record.attempts.length===1&&pending?.step==='APPROVAL'&&pending.state==='RECONCILIATION_REQUIRED'&&observation?.transaction?.blockHash===null;
  return <section className="panel" aria-label="Aave Repay"><h2>{view==='simulate'?'Simulate Repay':record?.evidence?'Repay result':'Review Repay'}</h2>
    <p>Repay {fields?.amount??(review?human(review.amount,shown.decimals):'')} {shown.asset} to Aave V3 on {shown.network}.</p>
    <p>Variable debt mode: 2. onBehalfOf is your owner wallet.</p>
    {run.retired&&record&&<p role="alert">The workflow changed. Authorization is invalid. Observe any existing transaction before starting again.</p>}
    {risk&&review&&<><p>Wallet {shown.asset} balance: {human(review.state.balance,shown.decimals)} {shown.asset}</p>
      <p>Variable debt before: {human(risk.debt,shown.decimals)} {shown.asset}</p><p>Repay amount: {human(review.amount,shown.decimals)} {shown.asset} ({review.amount} raw)</p>
      <p>Allowance before: {human(review.allowance,shown.decimals)} {shown.asset}</p><p>Approval required: {review.approvalRequired?'Yes — exactly '+review.amount+' raw '+shown.asset+' to the Aave Pool':'No'}</p>
      <p>Estimated variable debt after: {human(review.repay!.debtAfter,shown.decimals)} {shown.asset}</p><p>Health factor before: {hf(risk.healthFactor)}</p><p>Estimated health factor after: {hf(review.repay!.expectedPostHealthFactor)}</p>
      <p>Collateral: {human(review.state.position,shown.decimals)} {shown.asset} supplied · {(BigInt(risk.userConfiguration)&shown.collateralBit)!==0n?'enabled':'disabled'} · value ${human(risk.collateralBase,8)}. Repay preserves collateral.</p>
      <p>Estimated network cost: {human(review.gasLimits.reduce((total,gas)=>total+BigInt(gas)*BigInt(review.state.gasPrice),0n).toString(),18)} ETH.</p>
      <p>Maximum network budget: {human(review.manifest.gasBudgets[0]?.maximumAmount??'0',18)} ETH, including fee margin.</p>
      <p>Owner / onBehalfOf: {review.account}</p><p>Pool / approval spender: {review.pool}</p><p>Asset: {review.asset}</p><p>State block: {review.state.block} · Review expires: {review.expiresAt}</p>
      <p>Debt estimates use the current index. Interest accrues until execution; final repayment is independently reconciled.</p></>}
    {view==='simulate'?<button type="button" disabled={run.busy||Boolean(pending)} onClick={()=>void run.simulate()}>Simulate Repay</button>:<>
      {review&&wallet.account&&wallet.chainId!==shown.chainHex&&<button type="button" disabled={run.busy||wallet.busy} onClick={()=>void run.switchNetwork()}>Switch wallet to {shown.network}</button>}
      {record&&!record.authorization&&!record.attempts.length&&!run.retired&&<button type="button" disabled={run.busy} onClick={()=>void run.review()}>Accept Repay review</button>}
      {record?.authorization&&!run.retired&&!pending&&!record.notSubmitted&&record.verdict==='PENDING'&&<button type="button" className="primary" disabled={run.busy} onClick={()=>void run.execute()}>{review?.approvalRequired&&!approval?'Approve exactly '+review.amount+' raw '+shown.asset:'Execute'}</button>}
      {record?.attempts.map(a=><p key={a.step}>{a.step==='APPROVAL'?'Approval':'Repay'}: {a.reconciled||a.step==='APPROVAL'&&record.approvalProof?'Independently verified':record.notSubmitted?'not submitted':a.state.toLowerCase().replaceAll('_',' ')} {a.transactionHash&&<a href={`${shown.explorer}/tx/${a.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a>}</p>)}
      {pending&&(record?.verdict==='PENDING'||reobserveApproval)&&<button type="button" disabled={run.busy} onClick={()=>void run.observe()}>Observe existing transaction</button>}
      {record?.notSubmitted&&<p>The wallet request was not submitted. Prepare a fresh explicit owner review for the same intent.</p>}
      {(record?.notSubmitted||approval&&record?.attempts.length===1||record?.approvalProof)&&!run.retired&&<button type="button" disabled={run.busy} onClick={()=>void run.recoverReview()}>Prepare fresh review</button>}
      {record?.attempts.length&&!record.evidence?<a download="flofi-aave-repay-execution-record.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record,null,2))}>Download execution record</a>:null}
      {record?.evidence&&observation?.postPosition?.borrow&&<><p>Repay independently reconciled. Wallet paid exactly {human(review!.amount,shown.decimals)} {shown.asset}; variable debt is {human(observation.postPosition.borrow.debt,shown.decimals)} {shown.asset}; health factor is {hf(observation.postPosition.borrow.healthFactor)}. Collateral is unchanged.</p><a download="flofi-aave-repay-evidence.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record.evidence,null,2))}>Download Evidence Bundle</a></>}
    </>}
    {info&&<p role="status">{lendingCopy(messages[info]??'Repay needs attention. Inspect technical details and observe any existing transaction.',shown)}</p>}
    <details><summary>Show technical details</summary><pre>{JSON.stringify({error:info,review,attempts:record?.attempts,observations:record?.observations,walletDiagnostic:record?.walletDiagnostic,environment:record?.evidence?.bundle.environment},null,2)}</pre></details>
  </section>;
}
