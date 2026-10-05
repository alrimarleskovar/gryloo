// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type FormEvent } from 'react';
import { createAuthoredBorrow, borrowDetails, lendingCopy, lendingNetworkView, lendingView, LENDING_NETWORKS, type LendingNetwork, type SupplyInput } from '../domain/supply-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useSupply } from '../state/supply-store';
import type { BorrowObservation } from '@defi-workflow-engine/reference-reconciler';
function human(value:string,decimals:number):string {return (Number(value)/10**decimals).toLocaleString('en-US',{maximumFractionDigits:decimals});}
function hf(value:string):string {return BigInt(value)===(1n<<256n)-1n?'No debt (∞)':human(value,18);}
export function BorrowAuthoringForm({nodeId,onDone,direct=false}:{nodeId?:string;onDone?:()=>void;direct?:boolean}){
  const {state,propose,dispatch}=useWorkflow(),wallet=useBuild009Wallet();
  const node=state.workflow.nodes.find(n=>n.nodeId===nodeId),existing=node?borrowDetails(node as Parameters<typeof borrowDetails>[0]):null;
  const [amount,setAmount]=useState(existing?.amount??'0.01'),[error,setError]=useState('');
  const [network,setNetwork]=useState<LendingNetwork>(existing?.network??'Base Sepolia'),shown=lendingNetworkView(network),asset=shown.asset;
  function submit(event:FormEvent){event.preventDefault();try{
    const input:SupplyInput={network,asset,amount,beneficiary:wallet.account??existing?.beneficiary??''};
    createAuthoredBorrow(nodeId??'node-preview',input);
    const command=nodeId?{type:'SET_BORROW' as const,nodeId,input,source:'CANVAS' as const,baseRevision:state.workflow.revision}:{type:'ADD_BORROW' as const,input,source:'CANVAS' as const,baseRevision:state.workflow.revision};
    if(direct)dispatch(command);else propose(command);onDone?.();
  }catch(cause){setError(cause instanceof Error&&/AMOUNT|FIELDS/.test(cause.message)?`Enter a positive ${asset} amount with at most ${shown.decimals===6?'six':shown.decimals} decimal places.`:'Connect your borrower wallet and check the amount.');}}
  return <form className="inspector-fields" aria-label={nodeId?'Edit Borrow':'Create Borrow'} onSubmit={submit}>
    <strong>Borrow from Aave V3</strong>
    <label>Borrow network<select aria-label="Borrow network" value={network} onChange={e=>setNetwork(e.target.value as LendingNetwork)}>{LENDING_NETWORKS.map(n=><option key={n}>{n}</option>)}</select></label>
    <label>Borrow asset<select aria-label="Borrow asset" value={asset} onChange={()=>undefined}><option>{asset}</option></select></label>
    <label>Borrow amount ({asset})<input aria-label={`Borrow amount (${asset})`} inputMode="decimal" value={amount} maxLength={80} onChange={e=>setAmount(e.target.value)}/></label>
    {!wallet.account&&!existing&&<button type="button" onClick={()=>void wallet.connect()}>Connect borrower wallet</button>}
    <p>Variable rate. Your connected wallet receives {asset} and takes on the debt.</p>
    {error&&<p role="alert">{error}</p>}<button type="submit" disabled={!wallet.account&&!existing}>{nodeId?'Review Borrow change':direct?'Add Borrow':'Review Borrow proposal'}</button>
    {onDone&&<button type="button" className="quiet" onClick={onDone}>Cancel</button>}
  </form>;
}
const messages:Record<string,string>={
  BORROW_INSUFFICIENT_COLLATERAL:'No sufficient collateral was found.',BORROW_COLLATERAL_NOT_ENABLED:'Your supplied USDC must be enabled as collateral in Aave before Borrow. Flofi will not enable it automatically.',
  BORROW_ABOVE_CAPACITY:'The amount exceeds your available borrow capacity.',BORROW_UNSAFE_HEALTH_FACTOR:'This borrow would leave health factor below Flofi’s minimum of 2.0. Reduce the amount.',
  SUPPLY_RESERVE_UNAVAILABLE:'This Aave reserve is currently unavailable.',
  BORROW_RESERVE_UNAVAILABLE:'Borrowing is currently unavailable for this reserve.',BORROW_INSUFFICIENT_LIQUIDITY:'Aave does not have enough available USDC.',BORROW_AUTHORIZATION_STALE:'The reviewed collateral, debt or price changed. Simulate and review again.',
  SUPPLY_AUTHORIZATION_STALE:'Review expired or the wallet state changed. Simulate and review again.',SUPPLY_WRONG_CHAIN:'Switch your wallet to Base Sepolia.',SUPPLY_WRONG_ACCOUNT:'Select the borrower wallet shown in Review.',SUPPLY_REJECTED:'The Borrow request was declined.',
  SUPPLY_INSUFFICIENT_ETH:'The borrower wallet needs Base Sepolia ETH for gas.',SUPPLY_RPC_RATE_LIMITED:'The public provider is busy. Try the read again.',AWAITING_CONFIRMATIONS:'Waiting for network confirmations.',
  SUPPLY_TRANSACTION_NOT_OBSERVED:'The existing Borrow is not visible yet. Observe it again.',SUPPLY_OBSERVATION_BOUND_REACHED:'The bounded search ended. Preserve this record and observe the existing transaction; do not repeat Borrow.',
  BORROW_REVERTED:'Aave reverted the Borrow. No successful debt creation is claimed.',
};
export function BorrowPanel({view}:{view:'simulate'|'execute'}){
  const {state}=useWorkflow(),run=useSupply(),wallet=useBuild009Wallet();
  const node=state.workflow.nodes.find(n=>n.actionType==='borrow'),fields=node?borrowDetails(node as Parameters<typeof borrowDetails>[0]):null;
  const record=run.record?.review.borrow?run.record:null,review=record?.review,risk=review?.state.borrow,shown=lendingView(review?.chain??node?.chainId);
  const pending=record?.notSubmitted?undefined:record?.attempts.find(a=>!a.reconciled),info=run.error??record?.error;
  const observation=record?.observations.at(-1) as BorrowObservation|undefined;
  return <section className="panel" aria-label="Aave Borrow"><h2>{view==='simulate'?'Simulate Borrow':record?.evidence?'Borrow result':'Review Borrow'}</h2>
    <p>Borrow {fields?.amount??(review?human(review.amount,shown.decimals):'')} {shown.asset} from Aave V3 on {shown.network}.</p>
    <p>Interest-rate mode: Variable (2). No ERC-20 approval required.</p>
    {run.retired&&record&&<p role="alert">The workflow changed. Authorization is invalid. Observe any existing Borrow before starting again.</p>}
    {risk&&<><p>Collateral value: ${human(risk.collateralBase,8)} · Current debt: ${human(risk.debtBase,8)}</p>
      <p>Available borrow capacity: ${human(risk.availableBorrowBase,8)}</p>
      <p>Health factor before: {hf(risk.healthFactor)}</p><p>Estimated health factor after: {hf(review!.borrow!.expectedPostHealthFactor)}</p>
      <p>Estimated debt after transaction: ${human(review!.borrow!.debtAfterBase,8)}</p>
      <p>Liquidation threshold: {human(risk.liquidationThresholdBps,2)}%. Liquidation becomes possible below health factor 1. Flofi requires at least 2.0; prices and interest can change.</p>
      <p>Estimated maximum network cost: {human(review!.manifest.gasBudgets[0]?.maximumAmount??'0',18)} ETH.</p></>}
    {view==='simulate'?<button type="button" disabled={run.busy||Boolean(pending)} onClick={()=>void run.simulate()}>Simulate Borrow</button>:<>
      {review&&wallet.account&&wallet.chainId!==shown.chainHex&&<button type="button" disabled={run.busy||wallet.busy} onClick={()=>void run.switchNetwork()}>Switch wallet to {shown.network}</button>}
      {review&&<p>Borrower / beneficiary: {review.account}</p>}
      {record&&!record.authorization&&!record.attempts.length&&!run.retired&&<button type="button" disabled={run.busy} onClick={()=>void run.review()}>Accept Borrow review</button>}
      {record?.authorization&&!run.retired&&!record.attempts.length&&record.verdict==='PENDING'&&<button type="button" className="primary" disabled={run.busy} onClick={()=>void run.execute()}>Execute</button>}
      {record?.attempts.map(a=><p key={a.step}>Borrow: {a.reconciled?'Independently verified':record.notSubmitted?'not submitted':a.state.toLowerCase().replaceAll('_',' ')} {a.transactionHash&&<a href={`${shown.explorer}/tx/${a.transactionHash}`} target="_blank" rel="noreferrer">View transaction</a>}</p>)}
      {pending&&record?.verdict==='PENDING'&&<button type="button" disabled={run.busy} onClick={()=>void run.observe()}>Observe existing transaction</button>}
      {record?.notSubmitted&&<p>The wallet request was not submitted. This attempt is retained. Prepare a fresh owner review for the same intent.</p>}
      {record?.notSubmitted&&<button type="button" disabled={run.busy} onClick={()=>void run.recoverReview()}>Prepare fresh review</button>}
      {record?.attempts.length&&!record.evidence?<a download="flofi-aave-borrow-execution-record.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record,null,2))}>Download execution record</a>:null}
      {record?.evidence&&observation?.postPosition?.borrow&&<><p>Borrow independently reconciled. Wallet increased by {human(observation.walletDelta!,shown.decimals)} {shown.asset}; debt is {human(observation.postPosition.borrow.debt,shown.decimals)} {shown.asset}; health factor is {hf(observation.postPosition.borrow.healthFactor)}.</p>
        <a download="flofi-aave-borrow-evidence.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record.evidence,null,2))}>Download Evidence Bundle</a></>}
    </>}
    {info&&<p role="status">{lendingCopy(messages[info]??'Borrow needs attention. Inspect technical details and observe any existing transaction.',shown)}</p>}
    <details><summary>Show technical details</summary><pre>{JSON.stringify({error:info,review,attempts:record?.attempts,observations:record?.observations,walletDiagnostic:record?.walletDiagnostic,environment:record?.evidence?.bundle.environment},null,2)}</pre></details>
  </section>;
}
