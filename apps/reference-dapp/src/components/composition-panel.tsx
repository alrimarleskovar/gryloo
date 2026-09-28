// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useComposition } from '../state/composition-store';
import { useWorkflow } from '../state/workflow-store';
export function CompositionPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { state } = useWorkflow();
  const flow = useComposition();
  if (!flow.info?.available) return null;
  const graph = state.workflow.nodes.length === 2 && state.workflow.resourceEdges.length === 1 &&
    state.workflow.nodes.some(node => node.actionType === 'asset.swap.exact-input' && node.requiredAuthorizationClass === 'MODE_B') &&
    state.workflow.nodes.some(node => node.actionType === 'asset.liquidity.uniswap-v3' && node.requiredAuthorizationClass === 'MODE_B');
  const prepared = flow.status?.prepared;
  const installed = Boolean(prepared && prepared.installation.length === prepared.compiled.installation.length);
  const events = flow.status?.events ?? [];
  const latest = events.filter(event => event.level === 'ATTEMPT').at(-1);
  const swap = events.filter(event => event.level === 'ATTEMPT' && event.step === 'SWAP').at(-1);
  const mint = events.filter(event => event.level === 'ATTEMPT' && event.step === 'MINT').at(-1);
  const completed = mint?.state === 'RECONCILED';
  const partial = swap?.state === 'RECONCILED' && mint?.state === 'REVERTED';
  return <section className="panel" aria-label="Mode B swap to liquidity composition">
    <p className="eyebrow">BUILD-007 / {flow.info.environment ?? 'UNKNOWN'} / LOCAL CHAIN 31337</p>
    <h2>Swap → position</h2>
    <p>Base USDC → WETH, then one Uniswap v3 WETH/USDC 0.05% position owned by the Safe.</p>
    <p className="muted">{flow.info.environment === 'FORK_REPRODUCED' ? 'Recorded Base state is replayed locally.' :
      'Synthetic Base-like source state is used for this mocked test.'} Wallet setup and executor calls have no public-chain effect.</p>
    {view === 'simulate' && <>
      {!graph && <p role="status">Author the two-node Mode B composition in Build to prepare a review.</p>}
      <button type="button" onClick={flow.prepare} disabled={!graph || Boolean(flow.busy)} aria-busy={flow.busy === 'Preparing composition'}>Prepare chained review</button>
    </>}
    {prepared && <>
      <dl className="review-facts">
        <div><dt>Safe and NFT owner</dt><dd>{flow.info.safe}</dd></div>
        <div><dt>Executor</dt><dd>{flow.info.executor}</dd></div>
        <div><dt>Swap input</dt><dd>{prepared.terms.swap.amountIn} USDC units</dd></div>
        <div><dt>Minimum WETH output</dt><dd>{prepared.minimumOut} wei</dd></div>
        <div><dt>Mint caps</dt><dd>{prepared.terms.maxWETH} WETH wei; {prepared.terms.maxUSDC} USDC units</dd></div>
        <div><dt>Total USDC budget</dt><dd>{prepared.terms.totalUSDCBudget} units</dd></div>
        <div><dt>Ticks</dt><dd>{prepared.terms.tickLower} to {prepared.terms.tickUpper}</dd></div>
        <div><dt>Owner setup</dt><dd>{prepared.installation.length} / {prepared.compiled.installation.length} confirmed</dd></div>
        <div><dt>Permission hash</dt><dd>{prepared.compiled.permissionHash}</dd></div>
        <div><dt>Manifest hash</dt><dd>{prepared.artifacts.hashes.manifestHash}</dd></div>
      </dl>
      <p className="muted">Roles limits target, selector, pair, recipient, ticks, desired amounts and one call per step. Uniswap checks output minimums and deadlines. The Safe owner keeps broader authority. Gas and step order are application checks.</p>
      {flow.retired && <p role="alert">The workflow changed. This review is retired; prepare a new one. You may still inspect or revoke its authority.</p>}
      {flow.recoveryOnly && <p role="status">A prior execution was loaded after browser restart. Inspect chain status and revoke if needed.</p>}
      {flow.unknownSubmission && <p role="alert">Wallet submission is uncertain. Do not repeat the owner step until the transaction is independently found or ruled out.</p>}
      {!flow.wallet && <button type="button" onClick={flow.connect} disabled={Boolean(flow.busy)}>Connect disposable owner wallet</button>}
      <button type="button" onClick={flow.acceptReview} disabled={flow.reviewed || Boolean(flow.busy)}>{flow.reviewed ? 'Review acknowledged' : 'I reviewed this finite authority'}</button>
      {flow.wallet && flow.reviewed && !installed && <button type="button" onClick={flow.installNext}
        disabled={Boolean(flow.busy) || flow.retired || flow.recoveryOnly || flow.unknownSubmission}>Request next exact owner signature</button>}
      {view === 'execute' && <>
        <p role="status">Swap: {swap?.state ?? 'WAITING'} · Mint: {mint?.state ?? 'WAITING'}</p>
        {partial && <p role="alert">Partial completion: swap reconciled, mint reverted. WETH and USDC remain in the Safe. Review residuals and revoke; no automatic swap back.</p>}
        {completed && <p role="status">Reconciled Safe-owned position NFT #{mint.tokenId}. Principal deposits are not earned fees.</p>}
        {flow.status && <p className="muted">One-use calls remaining: swap {flow.status.swapCalls}, mint {flow.status.mintCalls}. Safe token approvals: router USDC {flow.status.routerUSDC}, manager USDC {flow.status.managerUSDC}, manager WETH {flow.status.managerWETH}.</p>}
        <button type="button" onClick={flow.runWorker} disabled={!installed || !flow.reviewed || flow.retired || flow.recoveryOnly ||
          Boolean(flow.busy) || completed || partial || latest?.state === 'INCONCLUSIVE'}>Run or observe fixed worker</button>
        <button type="button" onClick={flow.recoverKnown} disabled={Boolean(flow.busy) || latest?.state !== 'INCONCLUSIVE' || !latest.transactionHash}>Recheck known transaction receipt</button>
        <button type="button" onClick={flow.refresh} disabled={Boolean(flow.busy)}>Refresh fork status</button>
        {flow.wallet && flow.reviewed && prepared.revocation.length < prepared.compiled.revocation.length &&
          <button type="button" onClick={flow.revokeNext} disabled={Boolean(flow.busy) || flow.unknownSubmission}>Request next revocation signature</button>}
      </>}
    </>}
    {flow.busy && <p role="status">{flow.busy}…</p>}
    {flow.error && <p role="alert">{flow.error}. Review the fork status before another action.</p>}
  </section>;
}
