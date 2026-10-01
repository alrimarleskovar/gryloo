// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type FormEvent } from 'react';
import { createAuthoredSupply, supplyDetails, type SupplyInput } from '../domain/supply-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useSupply } from '../state/supply-store';
export function SupplyAuthoringForm({nodeId,onDone,direct=false}:{nodeId?:string;onDone?:()=>void;direct?:boolean}){
  const {state,propose,dispatch}=useWorkflow(),wallet=useBuild009Wallet();
  const node=state.workflow.nodes.find(n=>n.nodeId===nodeId);
  const existing=node?supplyDetails(node as Parameters<typeof supplyDetails>[0]):null;
  const [amount,setAmount]=useState(existing?.amount??'1'),[beneficiary,setBeneficiary]=useState(existing?.beneficiary??wallet.account??''),[error,setError]=useState('');
  function submit(event:FormEvent){event.preventDefault();try{
    const input:SupplyInput={network:'Base Sepolia',asset:'USDC',amount,beneficiary:beneficiary||wallet.account||''};createAuthoredSupply(nodeId??'node-preview',input);
    const command=nodeId?{type:'SET_SUPPLY' as const,nodeId,input,source:'CANVAS' as const,baseRevision:state.workflow.revision}:{type:'ADD_SUPPLY' as const,input,source:'CANVAS' as const,baseRevision:state.workflow.revision};
    if(direct)dispatch(command);else propose(command);onDone?.();
  }catch(cause){setError(cause instanceof Error?cause.message:'SUPPLY_INPUT_INVALID');}}
  return <form className="inspector-fields" aria-label={nodeId?'Edit Supply':'Create Supply'} onSubmit={submit}>
    <strong>Supply to Aave V3</strong>
    <label>Supply network<select aria-label="Supply network" value="Base Sepolia" onChange={()=>undefined}><option>Base Sepolia</option></select></label>
    <label>Supply asset<select aria-label="Supply asset" value="USDC" onChange={()=>undefined}><option>USDC</option></select></label>
    <label>Supply amount (USDC)<input aria-label="Supply amount (USDC)" inputMode="decimal" value={amount} maxLength={80} onChange={e=>setAmount(e.target.value)}/></label>
    <label>Supply beneficiary<input aria-label="Supply beneficiary" autoComplete="off" value={beneficiary||wallet.account||''} maxLength={42} onChange={e=>setBeneficiary(e.target.value)}/></label>
    {error&&<p role="alert">{error}</p>}<button type="submit">{nodeId?'Review Supply change':direct?'Add Supply':'Review Supply proposal'}</button>
    {onDone&&<button type="button" className="quiet" onClick={onDone}>Cancel</button>}
  </form>;
}
function formatUnits(value:string,decimals:number){const units=BigInt(value),scale=10n**BigInt(decimals);const fraction=(units%scale).toString().padStart(decimals,'0').replace(/0+$/,'');return (units/scale).toString()+(fraction?'.'+fraction:'');}
const messages:Record<string,string>={SUPPLY_WALLET_REQUEST_REFUSED:'The wallet provider refused the transaction request before submission. No transaction was sent. Inspect the provider error under technical details before reviewing again.',SUPPLY_WALLET_NOT_SUBMITTED:'No transaction was requested from your wallet. Prepare a fresh review to retry safely.',SUPPLY_WALLET_NONCE_MISMATCH:'The wallet provider reports a different pending nonce than Base Sepolia. No transaction was requested. Refresh the wallet connection before reviewing again.',SUPPLY_WALLET_NONCE_RESPONSE_INVALID:'The wallet provider returned an invalid nonce. No transaction was requested.',SUPPLY_RPC_ERROR_BEFORE_WALLET_SUBMISSION:'The wallet provider read failed before any transaction request. No transaction was submitted; review again after restoring the connection.',SUPPLY_WALLET_PROVIDER_CHANGED:'The injected wallet provider changed. No transaction was requested. Review again using the current wallet.',SUPPLY_SEMANTIC_REVISION_CHANGED:'The workflow changed before the wallet request. Review the current Supply again.',SUPPLY_INSUFFICIENT_USDC:'Your wallet needs more Aave test USDC for this Supply.',SUPPLY_INSUFFICIENT_ETH:'Your wallet needs more Base Sepolia ETH for gas.',
  SUPPLY_WRONG_CHAIN:'Switch your wallet to Base Sepolia before executing.',SUPPLY_WRONG_ACCOUNT:'Select the wallet account shown in Review.',SUPPLY_APPROVAL_REJECTED:'Approval was declined. No Supply was sent.',
  SUPPLY_REJECTED:'Supply was declined. Any completed approval is preserved.',SUPPLY_RPC_RATE_LIMITED:'The network provider is busy. Try the read again.',
  SUPPLY_TRANSACTION_NOT_OBSERVED:'The existing transaction is not visible yet. Observe it again; Gryloo will not send another.',AWAITING_CONFIRMATIONS:'Waiting for network confirmations.',
  SUPPLY_AUTHORIZATION_STALE:'The reviewed state changed or expired. Simulate and review again.',SUPPLY_OBSERVATION_BOUND_REACHED:'The bounded transaction search ended. Keep this execution record for manual observation; do not repeat the transaction.',
  SUPPLY_TRANSACTION_NOT_FOUND:'The original approval was not found. Prepare a fresh review for the same approval and nonce.',SUPPLY_RECOVERY_STATE_CHANGED_OBSERVE_EXISTING:'The wallet state changed. Observe the existing approval before proceeding.'};
export function SupplyPanel({view}:{view:'simulate'|'execute'}){
  const {state}=useWorkflow(),supply=useSupply();
  const node=state.workflow.nodes.find(n=>n.actionType==='supply'),fields=node?supplyDetails(node as Parameters<typeof supplyDetails>[0]):null;
  const record=supply.record,review=record?.review;
  const pending=record?.notSubmitted?undefined:record?.attempts.find(a=>!a.reconciled),approval=record?.attempts.find(a=>a.step==='APPROVAL');
  const canExecute=Boolean(record?.authorization&&!supply.retired&&!pending&&record.verdict==='PENDING');
  const info=supply.error??record?.error;
  return <section className="panel" aria-label="Aave Supply"><h2>{view==='simulate'?'Simulate Supply':'Review Supply'}</h2>
    <p>Supply {fields?.amount??(review?formatUnits(review.amount,6):'')} USDC to Aave V3 on Base Sepolia.</p>
    <p>Beneficiary: <span>{fields?.beneficiary??review?.beneficiary}</span></p>
    {supply.retired&&<p role="alert">The workflow changed. Prior authorization is invalid. Observe any existing transaction before starting a new execution.</p>}
    {view==='simulate'?<>
      <p>Your injected wallet must hold Aave test USDC and Base Sepolia ETH for gas.</p>
      <button type="button" disabled={supply.busy||Boolean(pending)} onClick={()=>void supply.simulate()}>Simulate Supply</button>
      {review&&!supply.retired&&<><p>Approval required: {review.approvalRequired?'Yes — approve exactly this Supply amount.':'No — existing allowance is sufficient.'}</p>
        <p>Estimated maximum network cost: {formatUnits(review.manifest.gasBudgets[0]?.maximumAmount??'0',18)} ETH.</p></>}
    </>:<>
      {review&&<><p>Wallet account: {review.account}</p><p>Aave V3 Pool / spender: {review.pool}</p>
        <p>Approval required: {review.approvalRequired?'Yes, exact amount':'No'}</p></>}
      {record&&!record.authorization&&!record.attempts.length&&!supply.retired&&<button type="button" disabled={supply.busy} onClick={()=>void supply.review()}>Accept Supply review</button>}
      {canExecute&&<button type="button" className="primary" disabled={supply.busy} onClick={()=>void supply.execute()}>{approval?.reconciled?'Execute Supply':'Execute'}</button>}
      {record?.attempts.map(a=><p key={a.step}>{a.step==='APPROVAL'?'Approval':'Supply'}: {a.reconciled?'Independently verified':record.notSubmitted?(record.walletDiagnostic?.invoked?'not submitted (wallet request refused)':'not submitted (wallet was never requested)'):a.state.toLowerCase().replaceAll('_',' ')} {a.transactionHash&&<a href={`https://sepolia.basescan.org/tx/${a.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a>}</p>)}
      {record&&record.attempts.length>0&&!record.evidence&&<a download="gryloo-aave-supply-execution-record.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record,null,2))}>Download execution record</a>}
      {pending&&<button type="button" disabled={supply.busy} onClick={()=>void supply.observe()}>Observe existing transaction</button>}
      {(record?.notSubmitted||record?.error==='SUPPLY_TRANSACTION_NOT_FOUND'||record?.walletDiagnostic?.invoked===false&&!record.attempts.length&&Boolean(record.recoveryOf))&&<><p>{record?.notSubmitted||record?.walletDiagnostic?.invoked===false?(record.walletDiagnostic?.invoked?'The wallet refused the request before submission.':'The wallet request was never invoked.'):'No approval was found after bounded observation.'} A fresh review will verify the current allowance and nonce, and retain the exact approval intent; the wallet will choose the transaction nonce; it will not submit a transaction.</p>
        <button type="button" disabled={supply.busy} onClick={()=>void supply.recoverReview()}>Prepare fresh review</button></>}
      {record?.evidence&&<><p>Supply independently reconciled. Position increased by {formatUnits(record.observations.at(-1)?.delta??'0',6)} USDC.</p><a download="gryloo-aave-supply-evidence.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record.evidence,null,2))}>Download Evidence Bundle</a></>}
    </>}
    {info&&<p role="status">{messages[info]??'Execution needs attention. Inspect technical details and observe any existing transaction.'}</p>}
    <details><summary>Show technical details</summary><pre>{JSON.stringify({error:info,submissionError:record?.submissionError,walletDiagnostic:record?.walletDiagnostic,notSubmitted:record?.notSubmitted,absence:record?.absence,recoveryOf:record?.recoveryOf,review,attempts:record?.attempts,observations:record?.observations,verdict:record?.verdict,environment:record?.evidence?.bundle.environment},null,2)}</pre></details>
  </section>;
}
