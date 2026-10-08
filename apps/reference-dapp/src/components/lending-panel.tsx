// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useState,type FormEvent } from 'react';
import { isLendingComposition,type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA as p,LENDING_BASE_SEPOLIA as u } from '@defi-workflow-engine/action-registry';
import { createAuthoredLending,lendingDetails,lendingHuman,type LendingInput } from '../domain/lending-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useLending } from '../state/lending-store';
const health=(s:string)=>BigInt(s)===(1n<<256n)-1n?'No debt (∞)':Number(lendingHuman(s,18)).toFixed(4);
export function LendingAuthoringForm(){
  const { t: tr } = useLocale();
  const {state,propose}=useWorkflow(),wallet=useBuild009Wallet(),existing=lendingDetails(state.workflow as SemanticWorkflow);
  const [input,setInput]=useState<LendingInput>(existing??{supply:'0.1',borrow:'0.01',slippage:'50',owner:''}),[error,setError]=useState('');
  const set=(field:keyof LendingInput,value:string)=>setInput(prior=>({...prior,[field]:value}));
  function submit(event:FormEvent){event.preventDefault();try{
    const fields={...input,owner:wallet.account??input.owner};createAuthoredLending(state.workflow.workflowId,state.workflow.revision+1,fields);
    propose({type:'AUTHOR_LENDING',input:fields,source:'CANVAS',baseRevision:state.workflow.revision});setError('');
  }catch{setError('Enter positive USDC amounts, slippage from 1 to 300 bps, and connect your owner wallet.');}}
  return <form className="inspector-fields" aria-label={tr("Compose lending")} onSubmit={submit}>
    <strong>{tr("Template: Aave Supply → Aave Borrow → Uniswap Swap")}</strong>
    <p>{tr("Expands into the same three editable Canvas nodes on Base Sepolia. Debt remains.")}</p>
    <label>{tr("Supply collateral (USDC)")}<input aria-label={tr("Composition supply USDC")} value={input.supply} inputMode="decimal" maxLength={80} onChange={e=>set('supply',e.target.value)}/></label>
    <label>{tr("Borrow (USDC)")}<input aria-label={tr("Composition borrow USDC")} value={input.borrow} inputMode="decimal" maxLength={80} onChange={e=>set('borrow',e.target.value)}/></label>
    <label>{tr("Swap slippage (bps)")}<input aria-label={tr("Composition slippage bps")} value={input.slippage} inputMode="numeric" maxLength={3} onChange={e=>set('slippage',e.target.value)}/></label>
    <p>{tr("Owner: ")}{wallet.account??(input.owner||'Connect a wallet')}</p>
    {!wallet.account&&<button type="button" onClick={()=>void wallet.connect()}>{tr("Connect composition owner")}</button>}
    {error&&<p role="alert">{tr(error)}</p>}<button type="submit" disabled={!wallet.account&&!input.owner}>{tr("Review lending proposal")}</button>
  </form>;
}
const messages:Record<string,string>={
  LENDING_COMPATIBLE_POOL_NOT_FOUND:'No compatible pool exists for the exact Aave USDC. Public execution is blocked before Supply.',
  LENDING_SEQUENTIAL_SIMULATION_UNAVAILABLE:'The provider cannot simulate the complete sequence. Public execution is blocked before Supply.',
  LENDING_SWAP_LIQUIDITY_UNAVAILABLE:'The downstream Swap has insufficient liquidity. No next transaction can be submitted.',
  LENDING_SWAP_MINIMUM_UNAVAILABLE:'The Swap cannot meet the reviewed minimum output. Prepare a fresh simulation and Review.',
  LENDING_UNSAFE_HEALTH_FACTOR:'Health factor would fall below the required 2.0. Review smaller borrowing or more collateral.',
  BORROW_UNSAFE_HEALTH_FACTOR:'Health factor would fall below 2.0. Review the amounts.',
  LENDING_REVIEW_STALE:'Review expired or the market changed. Prepare a fresh simulation and Review.',
  LENDING_OWNER_FUNDING_INSUFFICIENT:'The owner needs the exact Aave USDC collateral amount.',
  LENDING_GAS_FUNDING_INSUFFICIENT:'The owner needs enough Base Sepolia ETH for the whole fee budget.',
  LENDING_WRONG_CHAIN:'Switch your wallet to Base Sepolia.',LENDING_WRONG_ACCOUNT:'Select the owner address shown in Review.',
  LENDING_UNKNOWN_OBSERVE_ONLY:'The submission result is unknown. Observe the existing transaction; no new submission is permitted.',
  LENDING_WALLET_DID_NOT_SUBMIT:'The wallet never submitted the previous approval: its nonce, allowance and discovery window prove it is not on chain. Run a fresh Simulate and Review to continue.',
};
export function LendingPanel({view}:{view:'simulate'|'execute'}){
  const { t: tr } = useLocale();
  const {state}=useWorkflow(),run=useLending(),record=run.record,review=record?.reviews.at(-1),fields=review?.fields;
  const authored=isLendingComposition(state.workflow)?lendingDetails(state.workflow as SemanticWorkflow):null;
  const pending=record?.attempts.find(a=>!a.reconciled&&!a.notSubmitted),hasBorrow=record?.attempts.some(a=>a.step==='BORROW'&&a.reconciled);
  const historical=record?.attempts.filter(a=>(a.state==='CANCELLED'||a.state==='NOT_FOUND'&&a.nonSubmission)&&a.notSubmitted&&!a.reconciled)??[];
  const active=record?.attempts.filter(a=>!historical.includes(a))??[];
  const finished=record?.status==='COMPLETED',next=review?.calls.find(c=>!record?.attempts.some(a=>a.step===c.id&&a.reconciled));
  const info=run.error??record?.error,current=record?.currentPosition;
  const checkpoint=(step:'SUPPLY'|'BORROW'|'SWAP')=>record?.observations.filter(o=>o.step===step&&o.verdict==='RECONCILED').at(-1)?.post;
  return <section className="panel" aria-label={tr("Lending composition")}><h2>{tr(view==='simulate'?'Simulate lending composition':finished?'Lending composition result':'Review lending composition')}</h2>
    <p>{tr("Supply ")}{tr(authored?.supply??(fields?lendingHuman(fields.supplyAmount):''))}{tr(" Aave USDC → health checkpoint ≥ 2.0 → Borrow ")}{tr(authored?.borrow??(fields?lendingHuman(fields.borrowAmount):''))}{tr(" Aave USDC → Swap exactly borrowed USDC to WETH.")}</p>
    <p>{tr("Non-atomic: debt and variable interest remain after Swap. If Swap fails, the borrowed USDC remains in your wallet with the debt. Liquidation becomes possible below HF 1. No automatic repayment or compensation.")}</p>
    {review&&<>
      <p>{tr("Complete path checked at block ")}{tr(review.route.block)}{tr(". Review expires ")}{tr(review.expiresAt)}.</p><details><summary>{tr("Data provenance")}</summary><p>{tr(record?.provenance==='MOCKED'?'MOCKED: synthetic data and fixture transactions.':'Public Base Sepolia reads; owner execution has not been demonstrated by this Review.')}</p></details>
      <table><caption>{tr("Position and wallet balances · original, completed checkpoints and remaining projections")}</caption><thead><tr><th>{tr("Economic state")}</th><th>{tr("Before workflow")}</th><th>{tr("After Supply")}</th><th>{tr("After Borrow")}</th><th>{tr("After Swap")}</th></tr></thead><tbody>
        {(['Collateral USDC','Debt USDC','Health factor','Wallet USDC','Wallet WETH'] as const).map(label=><tr key={label}><th>{tr(label)}</th>{[review.rootState,checkpoint('SUPPLY')??review.projected.afterSupply,checkpoint('BORROW')??review.projected.afterBorrow,checkpoint('SWAP')??review.projected.afterSwap].map((s,i)=><td key={i}>{tr(label==='Health factor'?health(s.aave.borrow!.healthFactor):label==='Wallet WETH'?lendingHuman(s.wethBalance,18):lendingHuman(label==='Collateral USDC'?s.aave.position:label==='Debt USDC'?s.aave.borrow!.debt:s.aave.balance))}</td>)}</tr>)}
      </tbody></table>
      <p>{tr("Borrow / exact Swap input: ")}{tr(lendingHuman(review.fields.borrowAmount))}{tr(" USDC. Expected output: ")}{tr(lendingHuman(review.route.expectedOut,18))}{tr(" WETH. Minimum output: ")}{tr(lendingHuman(review.route.minimumOut,18))}{tr(" WETH. Slippage: ")}{tr(review.fields.slippageBps)}{tr(" bps. Pool fee: 0.05% (included in output).")}</p>
      <p>{tr("Current estimated L1 fee: ")}{tr(lendingHuman(review.l1FeeUpperBound,18))}{tr(" ETH (at simulation). Maximum owner-approved L1 fee: ")}{tr(lendingHuman(review.manifest.feeBudgets[0]!.maximumAmount,18))}{tr(" ETH. Maximum total network fee: ")}{tr(lendingHuman(review.manifest.gasBudgets[0]!.maximumAmount,18))}{tr(" ETH.")}</p>
      <p>{tr("These maximums stay fixed after Review acceptance. Higher fees require a new Simulate and Review. Variable borrowing rate: ")}{tr((Number(review.state.variableRateRay)/1e27*100).toFixed(3))}{tr("% estimated annual rate; future interest is not capped.")}</p>
      <p>{tr("Resulting exposure: USDC collateral, USDC variable debt and WETH in the owner wallet. Borrowed-funds linkage is accounting provenance for fungible tokens.")}</p>
      <p>{tr("Owner / all recipients: ")}{tr(review.fields.owner)}{tr(". Aave USDC: ")}{tr(p.asset)}{tr(". Output WETH: ")}{tr(u.weth)}{tr(". Compatible Uniswap pool: ")}{tr(review.route.pool)}.</p>
      <p>{tr("Exact authorizations: ")}{tr(review.calls.some(c=>c.id==='POOL_APPROVAL')?`${lendingHuman(review.fields.supplyAmount)} USDC to Aave Pool ${p.pool}; `:'existing Aave allowance; ')}{tr(review.calls.some(c=>c.id==='ROUTER_APPROVAL')?`${lendingHuman(review.fields.borrowAmount)} USDC to Uniswap router ${u.router}`:'existing router allowance')}{tr(". Each listed transaction requires your wallet signature.")}</p>
      <ol>{review.calls.map(c=>{const a=active.filter(a=>a.step===c.id).at(-1);return <li key={c.id}>{tr(c.id.replaceAll('_',' '))} · {tr(a?a.reconciled?'reconciled':a.state:next?.id===c.id?'NEXT EXECUTABLE STEP':'PLANNED')}{tr(c.id==='BORROW'?' · waits for reconciled Supply and fresh HF':c.id==='SWAP'?' · waits for reconciled Borrow and fresh route/HF':'')}</li>;})}</ol>
    </>}
    {historical.length>0&&<details aria-label={tr("Historical cancelled attempts")}><summary>{tr("Historical cancelled attempts (")}{tr(historical.length)}{tr(") · not submitted")}</summary><p>{tr("These preparations were cancelled before wallet handoff, or are approvals proven never submitted on chain. They remain in the durable journal and do not complete or block the current step. A fresh Review and your explicit execution click are required.")}</p><ul>{historical.map(a=><li key={a.id}>{tr(a.step.replaceAll('_',' '))}{tr(" · historical cancelled preparation · ")}{tr(a.id)}</li>)}</ul></details>}
    {run.retired&&<p role="alert">{tr("The workflow changed. Previous authority is invalid. Observe any existing transaction before preparing a new workflow.")}</p>}
    {view==='simulate'?<button type="button" disabled={run.busy||Boolean(pending)||Boolean(finished&&!run.retired)} onClick={()=>void run.simulate()}>{tr("Simulate lending composition")}</button>:<>
      {record&&!record.authorization&&!pending&&!finished&&!run.retired&&<button type="button" disabled={run.busy} onClick={()=>void run.review()}>{tr("Accept composed Review")}</button>}
      {record?.authorization&&!pending&&!finished&&!run.retired&&next&&<button type="button" className="primary" disabled={run.busy} onClick={()=>void run.execute()}>{tr("Execute ")}{tr(next.id.replaceAll('_',' ').toLowerCase())}</button>}
      {active.map(a=><p key={a.id}>{tr(a.step)}: {tr(a.reconciled?'reconciled':a.state)}{a.hash&&<> · <a href={`https://sepolia.basescan.org/tx/${a.hash}`} target="_blank" rel="noreferrer">{tr("Transaction")}</a></>}</p>)}
      {pending?.state==='PREPARED'&&<button type="button" disabled={run.busy} onClick={()=>void run.cancelPrepared()}>{tr("Cancel unsubmitted preparation")}</button>}
      {active.length?<button type="button" disabled={run.busy} onClick={()=>void run.observe()}>{tr("Observe existing execution")}</button>:null}
      {record&&!pending&&!finished&&!run.retired&&<button type="button" disabled={run.busy} onClick={()=>void run.refresh()}>{tr("Fresh Simulate and Review of remaining steps")}</button>}
      {hasBorrow&&!finished&&<p role="alert">{tr("Borrow has completed. Supply and Borrow will not repeat. Debt and remaining USDC stay explicit. Continuation needs fresh state and owner authority; no automatic second Swap attempt.")}</p>}
      {current&&<p>{tr("Observed at block ")}{tr(current.aave.block)}{tr(". Current observed collateral: ")}{tr(lendingHuman(current.aave.position))}{tr(" USDC · debt: ")}{tr(lendingHuman(current.aave.borrow!.debt))}{tr(" USDC · HF: ")}{tr(health(current.aave.borrow!.healthFactor))}{tr(" · wallet USDC: ")}{tr(lendingHuman(current.aave.balance))}{tr(" · wallet WETH: ")}{tr(lendingHuman(current.wethBalance,18))}{tr(" · residual allowances: Aave ")}{tr(lendingHuman(current.aave.allowance))}{tr(" / router ")}{tr(lendingHuman(current.routerAllowance))}{tr(" USDC.")}</p>}
      {record?.evidence&&<><details><summary>{tr("Evidence classification")}</summary><p>{tr(record.evidence.bundle.environment)} / {tr(record.evidence.bundle.outcome)}</p></details><p>{tr(finished?'Composed economic outcome reconciled. Independent public verification is a separate read-only step.':'Partial execution evidence; no completed composed outcome is claimed.')}</p><a download="flofi-build013-evidence.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record.evidence,null,2))}>{tr("Download composed Evidence Bundle")}</a></>}
      {record&&<a download="flofi-build013-run.json" href={'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(record,null,2))}>{tr("Download execution record")}</a>}
    </>}
    {info&&info!=='LENDING_CANCELLED_BEFORE_HANDOFF'&&<p role="status">{tr(messages[info]??'The composed path needs attention. No new transaction is authorized; inspect details and observe existing execution.')}</p>}
    <details><summary>{tr("Show composed technical details")}</summary><pre>{JSON.stringify({error:info,review,record},null,2)}</pre></details>
  </section>;
}
