// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import {useState,type FormEvent} from 'react';
import {AAVE_V3_BASE_SEPOLIA as p,LENDING_BASE_SEPOLIA as u} from '@defi-workflow-engine/action-registry';
import {lendingDetails,lendingNodeInput} from '../domain/lending-authoring';
import {useWorkflow} from '../state/workflow-store';
import {TokenAmountInput} from './token-amount-input';

/** Three inspectors, one canonical IR and the existing AUTHOR_LENDING command. */
export function LendingNodeEditor({nodeId,reviewFormId}:{nodeId:string;reviewFormId?:string}) {
  const {state,propose,amountInputs={},editCanvasAmount,reviewCanvasAmount}=useWorkflow(),input=lendingDetails(state.workflow)!;
  const supply=nodeId==='lending-supply',borrow=nodeId==='lending-borrow';
  const title=supply?'Aave Supply':borrow?'Aave Borrow':'Uniswap Swap';
  const initial=supply?input.supply:borrow?input.borrow:input.slippage;
  const [localValue,setValue]=useState(initial),[error,setError]=useState('');
  const value = reviewFormId && (supply || borrow) ? amountInputs[nodeId] ?? initial : localValue;
  function submit(event:FormEvent) {
    event.preventDefault();
    if (reviewFormId && amountInputs[nodeId] !== undefined) { setError(reviewCanvasAmount(nodeId) ?? ''); return; }
    // The external card button retains the editor's unchanged-value submit guard.
    if (reviewFormId && value === initial && amountInputs[nodeId] === undefined) return;
    try {propose({type:'AUTHOR_LENDING',input:lendingNodeInput(state.workflow,nodeId,value),source:'CANVAS',baseRevision:state.workflow.revision});setError('');}
    catch {setError(supply||borrow?'Enter a positive USDC amount with at most six decimal places.':'Enter slippage from 1 to 300 bps.');}
  }
  return <form id={reviewFormId} className="inspector-fields" aria-label={`Edit ${title}`} onSubmit={submit}>
    <strong>{title} · Base Sepolia</strong>
    {supply?<p>Aave USDC collateral. Supply must reconcile before the HF ≥ 2 policy checkpoint permits Borrow.</p>:borrow?<p>Variable-rate USDC debt. The exact Borrow output feeds Swap; changing this amount updates its linked input.</p>:<>
      <p>Input: exactly {input.borrow} borrowed USDC, linked to Aave Borrow. Edit the Borrow node to change this amount.</p>
      <label>Output asset<select aria-label="Swap output asset" value="WETH" disabled><option value="WETH">WETH · Base Sepolia</option></select></label>
      <p>The fresh quote and this slippage bound determine the reviewed minimum WETH output.</p>
    </>}
    <label>{supply?'Supply amount (USDC)':borrow?'Borrow amount (USDC)':'Swap slippage (bps)'}
      {supply||borrow ? <TokenAmountInput aria-label={supply?'Supply amount USDC':'Borrow amount USDC'} value={value} maxLength={80} onValueChange={value=>{setError('');if(reviewFormId&&(supply||borrow))editCanvasAmount(nodeId,value);else setValue(value);}}/>
        : <input aria-label="Swap slippage bps" value={value} inputMode="numeric" maxLength={3} onChange={e=>{setError('');setValue(e.target.value);}}/>}
    </label>
    <p>USDC: {p.asset}{!supply&&!borrow&&<> · WETH: {u.weth}</>} · Owner: {input.owner}</p>
    {error&&<p role="alert">{error}</p>}
    {!reviewFormId&&<button type="submit" disabled={value===initial}>Review {title} change</button>}
    <p>Accepted changes invalidate prior simulation and Review. Approvals are generated execution-plan steps.</p>
  </form>;
}
