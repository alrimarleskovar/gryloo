// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ROUTER_PHASES, type RouteChange, type RouterPhase } from '@defi-workflow-engine/workflow-contracts';
import { createRouterNode, routerDetails, routerInputOf, ROUTER_DEFAULT_SLIPPAGE, ROUTER_NETWORK_OPTIONS, ROUTER_ROUTING_LABEL, type RouterBridgeInput,
  type RouterNetwork, type RouterRouting } from '../domain/router-authoring';
import { formatTokenAmount } from '../domain/jupiter-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useRouter } from '../state/router-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';

/** Network labels: mainnet keeps the BUILD-ROUTER-001 wording; the testnet journey names Base Sepolia / Arbitrum Sepolia. */
type Labels = { src: string; dst: string; dstShort: string; srcScan: string; dstScan: string };
const LABELS: Readonly<Record<RouterNetwork, Labels>> = {
  mainnet: { src: 'Base', dst: 'Arbitrum One', dstShort: 'Arbitrum', srcScan: 'Basescan', dstScan: 'Arbiscan' },
  testnet: { src: 'Base Sepolia', dst: 'Arbitrum Sepolia', dstShort: 'Arbitrum Sepolia', srcScan: 'Base Sepolia explorer', dstScan: 'Arbitrum Sepolia explorer' },
};
const explorerTx = (network: RouterNetwork, chain: 'source' | 'destination', hash: string) =>
  (chain === 'source' ? ROUTER_NETWORK_OPTIONS[network].profile.source.explorer : ROUTER_NETWORK_OPTIONS[network].profile.destination.explorer) + 'tx/' + hash;

/** Canvas form for the canonical cross-chain bridge node (USDC → USDC through the Cross-chain Router, mainnet or testnet). */
export function RouterForm({ nodeId, onDone, network: initialNetwork }: { nodeId?: string; onDone?: () => void; network?: RouterNetwork }) {
  const { state, propose, amountInputs = {}, editCanvasAmount } = useWorkflow();
  const node = state.workflow.nodes.find(n => n.nodeId === nodeId), existing = node ? routerDetails(node) : null;
  const start = ROUTER_NETWORK_OPTIONS[existing?.network ?? initialNetwork ?? 'mainnet'];
  const [input, setInput] = useState<RouterBridgeInput>(existing ? routerInputOf(existing)
    : { source: start.source, destination: start.destination, token: 'USDC', amount: '', recipient: '', slippage: ROUTER_DEFAULT_SLIPPAGE, routing: 'AUTO' });
  const [error, setError] = useState('');
  const set = (patch: Partial<RouterBridgeInput>) => {
    if (patch.amount !== undefined && nodeId) editCanvasAmount(nodeId, patch.amount);
    setInput(value => ({ ...value, ...patch, amount: nodeId ? value.amount : patch.amount ?? value.amount }));
  };
  const fields = { ...input, amount: nodeId ? amountInputs[nodeId] ?? input.amount : input.amount };
  const network: RouterNetwork = input.source === 'Base Sepolia' ? 'testnet' : 'mainnet', option = ROUTER_NETWORK_OPTIONS[network], l = LABELS[network];
  const choose = (next: RouterNetwork) => set({ source: ROUTER_NETWORK_OPTIONS[next].source, destination: ROUTER_NETWORK_OPTIONS[next].destination });
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      createRouterNode(nodeId ?? 'node-preview', fields); setError('');
      propose(nodeId ? { type: 'SET_ROUTER_BRIDGE', nodeId, input: fields, source: 'CANVAS', baseRevision: state.workflow.revision }
        : { type: 'ADD_ROUTER_BRIDGE', input: fields, source: 'CANVAS', baseRevision: state.workflow.revision });
      onDone?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ROUTER_INPUT_INVALID'); }
  }
  return <form className="inspector-fields" aria-label={nodeId ? 'Edit cross-chain bridge' : network === 'testnet' ? 'Create testnet cross-chain bridge' : 'Create cross-chain bridge'} onSubmit={submit}>
    <p className="muted">{network === 'testnet' ? 'Cross-chain Router · Base Sepolia → Arbitrum Sepolia · test USDC → USDC. No real funds; any wallet can use it. A route is chosen and shown at Review.'
      : 'Cross-chain Router · Base → Arbitrum One · USDC → USDC. Real funds on mainnet; a route is chosen and shown at Review.'}</p>
    <label>Network<select aria-label="Cross-chain network" value={network} onChange={e => choose(e.target.value as RouterNetwork)}>
      <option value="mainnet">Mainnet (real funds)</option><option value="testnet">Testnet (test USDC)</option></select></label>
    <label>Source chain<select aria-label="Cross-chain source chain" value={input.source} onChange={() => set({ source: option.source })}><option value={option.source}>{l.src}</option></select></label>
    <label>Destination chain<select aria-label="Cross-chain destination chain" value={input.destination} onChange={() => set({ destination: option.destination })}><option value={option.destination}>{l.dst}</option></select></label>
    <label>Token<select aria-label="Cross-chain token" value={input.token} onChange={() => set({ token: 'USDC' })}><option value="USDC">USDC → USDC</option></select></label>
    <label>Amount (USDC)<input aria-label="Cross-chain amount (USDC)" inputMode="decimal" autoComplete="off" maxLength={40} value={fields.amount} onChange={e => set({ amount: e.target.value })}/></label>
    <label>Recipient on {l.dstShort}<input aria-label="Cross-chain recipient" autoComplete="off" spellCheck={false} maxLength={42} placeholder="Your connected wallet" value={input.recipient}
      onChange={e => set({ recipient: e.target.value })}/></label>
    <label>Routing<select aria-label="Cross-chain routing policy" value={input.routing} onChange={e => set({ routing: e.target.value as RouterRouting })}>
      {(Object.keys(ROUTER_ROUTING_LABEL) as RouterRouting[]).map(k => <option key={k} value={k}>{ROUTER_ROUTING_LABEL[k]}</option>)}</select></label>
    <label>Slippage (bps)<input aria-label="Cross-chain slippage (bps)" inputMode="numeric" autoComplete="off" maxLength={4} value={input.slippage} onChange={e => set({ slippage: e.target.value })}/></label>
    <small>{network === 'testnet' ? 'Between 0.5 and 5 test USDC per bridge (the testnet relayer has little liquidity).' : 'Maximum 100 USDC per bridge in this release.'} The minimum you receive is fixed in the reviewed deposit.</small>
    {error && <p role="alert">{error}</p>}
    <button type="submit">{nodeId ? 'Review bridge change' : 'Review bridge proposal'}</button>
    {onDone && <button type="button" className="quiet" onClick={onDone}>Cancel</button>}
  </form>;
}

const messagesFor = (l: Labels): Record<string, string> => ({
  ROUTER_NOT_ENABLED: 'The Cross-chain Router is not enabled on this server.', ROUTER_TESTNET_NOT_ENABLED: 'The testnet Cross-chain Router is not enabled on this server.',
  ROUTER_STORAGE_NOT_CONFIGURED: 'Execution storage is not configured on this server.',
  ROUTER_WALLET_REQUIRED: 'Connect a wallet first.', ROUTER_WRONG_CHAIN: `Switch your wallet to ${l.src}.`, ROUTER_WRONG_OWNER: 'Select the wallet account shown in Review.',
  ROUTER_REVIEW_REQUIRED: 'Accept the current Review first.', ROUTER_REVIEW_EXPIRED: 'This Review expired. Get a fresh route and review again.',
  ROUTE_CHANGED: 'The provider no longer offers the reviewed route. Your authorization was cleared and nothing was sent. Get a fresh route, then review it.',
  ROUTER_REQUOTE_REQUIRED: 'A fresh route and Review are required before you can authorize again.',
  ROUTER_STATE_CHANGED_REVIEW_REQUIRED: 'Chain state changed materially since Review. Your authorization was cleared and nothing was sent.',
  ROUTER_ROUTE_REVALIDATION_UNAVAILABLE: 'The routing provider could not confirm the reviewed route right now. Nothing was sent; try again shortly.',
  ROUTER_SEMANTIC_REVISION_CHANGED: 'The workflow changed. Simulate the current bridge again.', ROUTER_NO_EXECUTABLE_ROUTE: 'No allowed provider returned a route Flofi can reconcile.',
  ROUTER_INSUFFICIENT_USDC: `Your wallet needs more USDC on ${l.src} for this bridge.`, ROUTER_INSUFFICIENT_GAS_ETH: `Your wallet needs more ETH on ${l.src} for network fees.`,
  ROUTER_SIMULATION_UNAVAILABLE: 'The network provider cannot simulate these transactions. Nothing was signed.',
  ROUTER_SIMULATION_DEPOSIT_REVERTED: 'The simulation of the bridge deposit failed. Nothing was signed.', ROUTER_UNEXPECTED_CONTRACT: 'A contract does not match its verified deployment.',
  ROUTER_PENDING_TRANSACTION: `Your wallet has a queued transaction on ${l.src}. Let it confirm first.`,
  ROUTER_WALLET_NONCE_MISMATCH: 'Your wallet would use a different transaction number. Let pending transactions confirm first.',
  ROUTER_ATTEMPT_ACTIVE_OBSERVE_EXISTING: 'A transaction is still being observed. Check it before continuing.',
  ROUTER_OWNER_DEPOSIT_IN_FLIGHT: 'Another bridge deposit from this wallet is still unresolved. Flofi will not prepare a second one.',
  ROUTER_SUBMISSION_UNKNOWN_OBSERVE_EXISTING: 'The wallet result is unknown. Flofi is observing the network and will not send another request.',
  ROUTER_REJECTED: 'You declined the request in your wallet. Nothing was sent.', ROUTER_TRANSACTION_PENDING: `The transaction is pending on ${l.src}.`,
  ROUTER_TRANSACTION_NOT_OBSERVED: 'No transaction is visible yet. Observe again; nothing will be resent.',
  ROUTER_DESTINATION_PENDING: `The deposit is confirmed on ${l.src}. Waiting for the Across fill on ${l.dstShort}.`,
  ROUTER_AWAITING_FINALITY: `The fill is observed on ${l.dstShort}. Waiting for both chains to reach their safe head before success.`,
  ROUTER_FILL_DEADLINE_PASSED_REFUND_EXPECTED: `No fill arrived before the fill deadline. Across refunds the deposit to you on ${l.src}; Flofi is watching for it.`,
  ROUTER_REFUND_NOT_OBSERVED: `Waiting for the refund on ${l.src}.`, ROUTER_DEPOSIT_REVERTED: `The deposit reverted on ${l.src}; no USDC left your wallet.`,
  ROUTER_SUBMISSION_EXPIRED_NOT_EXECUTED: 'The deposit was not executed and can no longer execute. No USDC left your wallet.',
  ROUTER_NONCE_CONSUMED_BY_DIFFERENT_TRANSACTION: 'Your wallet sent a different transaction instead (for example a cancellation). No USDC was bridged.',
  ROUTER_FILL_RECIPIENT_MISMATCH: 'The destination fill does not match the reviewed recipient. The run needs your attention.',
  ROUTER_FILL_BELOW_MINIMUM: 'The destination fill is below the reviewed minimum. The run needs your attention.',
  ROUTER_TRANSACTION_MISMATCH: 'The reported transaction is not the reviewed call. The run needs your attention; nothing will be resent.',
  ROUTER_EXECUTION_NOT_ENABLED: 'Owner execution is not enabled on this server. Quotes, simulation and Review remain read-only.',
  // BUILD-JOURNEY-001: wallet session and ownership.
  WALLET_SESSION_REQUIRED: 'Sign in with your wallet first. Signing in moves no funds and authorizes no transaction.',
  RUN_OWNER_MISMATCH: 'This run belongs to another wallet. Only the wallet that created it can open or continue it.',
  WALLET_SIGNATURE_INVALID: 'The sign-in signature does not match the connected account. Nothing was changed.',
  WALLET_SIGN_IN_CHALLENGE_INVALID: 'The sign-in request expired. Sign in again.',
  ROUTER_WALLET_CHANGED_REVIEW_REQUIRED: 'The wallet account changed after Review. That authorization was cleared; review the route again before signing.',
  ROUTER_WALLET_ACCOUNT_CHANGED: 'Your wallet switched accounts. The previous account was signed out and any unused authorization it had was cleared. Sign in with the connected account.',
  ROUTER_SEMANTIC_EDIT_REQUIRES_REVIEW: 'The workflow changed after Review. That authorization was cleared; simulate and review again.',
});
const changeLabel: Record<RouteChange, string> = { CHAIN_CHANGED: 'chain', TOKEN_CHANGED: 'token', AMOUNT_CHANGED: 'amount', RECIPIENT_CHANGED: 'recipient',
  DEPOSITOR_CHANGED: 'depositor', REFUND_ADDRESS_CHANGED: 'refund address', PROVIDER_CHANGED: 'routing provider', PROTOCOL_CHANGED: 'bridge protocol',
  STEPS_CHANGED: 'route steps', FEES_OUT_OF_BOUNDS: 'fees above the reviewed amount', FEE_RECIPIENT_CHANGED: 'fee recipient', MINIMUM_OUTPUT_DECREASED: 'lower minimum received',
  SLIPPAGE_CHANGED: 'slippage', APPROVAL_CHANGED: 'approval', TRANSACTION_TARGET_CHANGED: 'transaction target', TRANSACTION_FUNCTION_CHANGED: 'transaction function',
  VALUE_CHANGED: 'transaction value', BRIDGE_CONTRACT_CHANGED: 'bridge contracts', BRIDGE_MESSAGE_CHANGED: 'destination message', CALLDATA_CHANGED: 'calldata',
  QUOTE_CHANGED: 'quote', DEADLINE_CHANGED: 'deadlines' };
const usdc = (units: string | null | undefined) => units ? `${formatTokenAmount(units, 6)} USDC` : '--';
const eth = (wei: string | null | undefined) => wei ? `${formatTokenAmount(wei, 18)} ETH` : 'not available';
const providerLabel = (p: string) => p === 'lifi' ? 'LI.FI' : p === 'across' ? 'Across (direct)' : p;
const LIFECYCLE: readonly RouterPhase[] = ['PREPARED', 'AUTHORIZED', 'SOURCE_SUBMITTED', 'SOURCE_CONFIRMED', 'IN_FLIGHT', 'DESTINATION_OBSERVED', 'RECONCILED'];
const phaseLabel = (p: RouterPhase) => p.toLowerCase().replaceAll('_', ' ');
const short = (account: string) => `${account.slice(0, 6)}…${account.slice(-4)}`;

/**
 * BUILD-JOURNEY-001: the wallet session block — connect, sign in (one message, no transaction), the signed-in account and its runs.
 * Shared by the Build-stage journey card and the Simulate/Execute bridge panel.
 */
function WalletSessionBlock({ showRuns }: { showRuns: boolean }) {
  const wallet = useBuild009Wallet(), router = useRouter(), l = LABELS[router.network], source = ROUTER_NETWORK_OPTIONS[router.network].profile.source.chainHex;
  const signedIn = Boolean(router.session && wallet.account === router.session.account);
  return <div aria-label="Wallet session">
    {!wallet.account ? <button type="button" disabled={wallet.busy} onClick={() => void wallet.connect()}>Connect wallet</button>
      : <p>Wallet connected: <span>{wallet.account}</span>{wallet.chainId !== source && <> · <button type="button" disabled={router.busy} onClick={() => void router.switchNetwork()}>Switch to {l.src}</button></>}</p>}
    {wallet.account && (signedIn ? <p role="status" aria-label="Signed-in wallet">Signed in as {short(router.session!.account)} until {router.session!.expiresAt}.{' '}
      <button type="button" className="quiet" disabled={router.busy} onClick={() => void router.signOut()}>Sign out</button></p>
      : <p><button type="button" disabled={router.busy || !router.sessionReady} onClick={() => void router.signIn()}>Sign in with wallet</button>{' '}
        <small>One signature proves this wallet is yours. It moves no funds and authorizes no transaction.</small></p>)}
    {showRuns && signedIn && <section aria-label="Your runs"><h3>Your runs · {l.src} → {l.dst}</h3>
      {router.runs.length === 0 ? <p>No runs yet for this wallet.</p> : <ul>{router.runs.map(run => <li key={run.runId}>
        <button type="button" className="quiet" disabled={router.busy} onClick={() => void router.open(run.runId)}>Open {run.runId}</button> · {run.status.toLowerCase().replaceAll('_', ' ')}
        {run.hasEvidence ? ' · evidence available' : ''} · updated {run.updatedAt}</li>)}</ul>}
      <button type="button" className="quiet" disabled={router.busy} onClick={() => void router.loadRuns()}>Refresh runs</button></section>}
  </div>;
}

/** BUILD-JOURNEY-001: where the external user is in the canonical lifecycle (derived only from the server run). */
function JourneySteps() {
  const { state } = useWorkflow(), wallet = useBuild009Wallet(), router = useRouter(), record = router.record;
  const authored = state.workflow.nodes.some(n => routerDetails(n)?.network === router.network) || Boolean(router.recovered && record);
  const reached = (phases: readonly RouterPhase[]) => Boolean(record && phases.includes(record.phase));
  const steps: [string, boolean][] = [
    ['Connect your wallet', Boolean(wallet.account)],
    ['Sign in (proves the wallet is yours; no transaction)', Boolean(router.session && router.session.account === wallet.account)],
    ['Create the bridge workflow', authored],
    ['Simulate (live route + transaction simulation)', Boolean(record)],
    ['Review the exact action and accept the Strategy Manifest', reached(['AUTHORIZED', 'SOURCE_SUBMITTED', 'SOURCE_CONFIRMED', 'IN_FLIGHT', 'DESTINATION_OBSERVED', 'RECOVERY_REQUIRED', 'RECONCILED', 'REFUNDED']) ||
      Boolean(record?.attempts.length)],
    ['Sign and execute with your wallet', Boolean(record?.attempts.some(a => a.step === 'DEPOSIT' && a.transactionHash))],
    ['Recover / reconcile on both chains', reached(['RECONCILED', 'REFUNDED'])],
    ['Inspect the final evidence', Boolean(record?.evidence || record?.refund)],
  ];
  return <ol className="lifecycle" aria-label="Journey steps">{steps.map(([label, done]) => <li key={label} data-done={done ? 'true' : 'false'}>{done ? '✓ ' : ''}{label}</li>)}</ol>;
}

/** BUILD-JOURNEY-001: the Build-stage entry point of the permissionless testnet journey (only when the testnet router is enabled). */
export function JourneyCard() {
  const router = useRouter();
  if (!router.availability.testnet) return null;
  return <section className="panel" aria-label="Testnet journey"><p className="eyebrow">PERMISSIONLESS TESTNET JOURNEY</p>
    <h2>Bridge test USDC from Base Sepolia to Arbitrum Sepolia with your own wallet</h2>
    <p>Any injected wallet works. You need a little Base Sepolia ETH for gas and 0.5–5 test USDC on Base Sepolia. Flofi never holds a key, never signs and never sends:
      every transaction is requested from your wallet after you review it.</p>
    <JourneySteps/>
    <WalletSessionBlock showRuns={router.network === 'testnet'}/>
    <p>Create the workflow below with “Cross-chain bridge · Base Sepolia → Arbitrum Sepolia”, or in chat: <code>Bridge 1 USDC from Base Sepolia to Arbitrum Sepolia</code>.</p>
  </section>;
}

export function RouterPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { state } = useWorkflow(), router = useRouter();
  const node = state.workflow.nodes.find(n => routerDetails(n)), fields = node ? routerDetails(node) : null;
  const network = router.network, l = LABELS[network], messages = messagesFor(l), message = (code: string | null | undefined) => !code ? null : messages[code] ?? null;
  const record = router.record, r = record?.review, route = r?.route, last = record?.attempts.at(-1);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const fresh = r ? Math.max(0, Math.round((Date.parse(r.expiresAt) - clock) / 1000)) : 0;
  const pending = Boolean(last && record?.verdict === 'PENDING' && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(last.state));
  const settling = Boolean(record && ['SOURCE_CONFIRMED', 'IN_FLIGHT', 'DESTINATION_OBSERVED', 'RECOVERY_REQUIRED'].includes(record.phase) && record.verdict === 'PENDING');
  const confirmed = new Set(record?.attempts.filter(a => a.state === 'CONFIRMED').map(a => a.step));
  const nextStep = r?.calls.find(c => !confirmed.has(c.purpose === 'APPROVAL' ? 'APPROVAL' : 'DEPOSIT'))?.purpose ?? null;
  const authorized = record?.phase === 'AUTHORIZED' && record.authorization === r?.commitment;
  const canExecute = Boolean(authorized && !router.retired && !pending && fresh > 0 && router.executionEnabled && nextStep);
  const canRefresh = Boolean(record && record.verdict === 'PENDING' && !pending && ['PREPARED', 'AUTHORIZED'].includes(record.phase) &&
    !record.attempts.some(a => a.step === 'DEPOSIT' && a.state !== 'CANCELLED') && (record.requote || fresh === 0 || record.phase === 'PREPARED' && record.attempts.length > 0));
  const info = router.error ?? record?.error ?? router.notice;
  const evidenceName = network === 'testnet' ? 'flofi-crosschain-router-testnet' : 'flofi-crosschain-router';
  const stepLabel = (purpose: 'APPROVAL' | 'BRIDGE_DEPOSIT') => purpose === 'APPROVAL' ? `Approve exactly ${usdc(route?.approval.amount)} to ${route?.routingProvider === 'lifi' ? 'the LI.FI Diamond' : 'the Across SpokePool'}`
    : `Deposit into the bridge (${providerLabel(route?.routingProvider ?? '')} → Across)`;
  return <section className="panel" aria-label="Cross-chain bridge"><h2>{view === 'simulate' ? 'Simulate cross-chain bridge' : 'Review cross-chain bridge'}</h2>
    {fields && <p>Bridge {fields.amount} USDC from {l.src} to {l.dst} for {fields.recipientLabel}, routing: {ROUTER_ROUTING_LABEL[fields.routing]}.</p>}
    <p role="note">{network === 'testnet' ? 'Test USDC on public testnets: Base Sepolia and Arbitrum Sepolia. No real funds.' : 'Real funds: Base mainnet and Arbitrum One.'} Flofi never signs or sends; every transaction is your wallet&apos;s, after your Review.</p>
    {!router.available && <p role="status">{message(network === 'testnet' ? 'ROUTER_TESTNET_NOT_ENABLED' : 'ROUTER_NOT_ENABLED')}</p>}
    {network === 'testnet' && <JourneySteps/>}
    {router.retired && <p role="alert">The workflow changed. Prior authorization is invalid. Simulate the current bridge again.</p>}
    {router.recovered && record && <p role="status">Recovered run {record.id}. Its state comes from the server; nothing is resent automatically.</p>}
    <WalletSessionBlock showRuns={true}/>
    {view === 'simulate' && <button type="button" disabled={router.busy || pending || settling || !router.available || !fields} onClick={() => void router.simulate()}>Get route and simulate</button>}
    {record?.error === 'ROUTE_CHANGED' && record.routeChanges.length > 0 && <p role="alert">Route changed: {record.routeChanges.map(c => changeLabel[c]).join(', ')}.</p>}
    {r && route && !router.retired && <>
      <dl className="swap-summary" aria-label="Route review">
        <dt>Routing provider</dt><dd>{providerLabel(route.routingProvider)} · underlying protocol {route.underlyingProtocol}</dd>
        <dt>Route</dt><dd><ol aria-label="Route steps">{route.steps.map((s, i) => <li key={i}>{s.kind === 'FEE_COLLECTION' ? `LI.FI fee collection on ${l.src}: ${usdc(s.amountIn)} → ${usdc(s.amountOut)}`
          : `Across bridge ${l.src} → ${l.dst}: ${usdc(s.amountIn)} → ${usdc(s.amountOut)}`}</li>)}</ol></dd>
        <dt>Amount in</dt><dd>{usdc(route.inputAmount)} on {l.src}</dd>
        <dt>Expected out</dt><dd>{usdc(route.expectedOutput)} on {l.dst}</dd>
        <dt>Minimum received</dt><dd>{usdc(route.minimumOutput)} — fixed in the reviewed deposit; a smaller fill is a mismatch</dd>
        <dt>Fees</dt><dd>{route.fees.map((f, i) => <span key={i}>{f.label}: {usdc(f.amount)}{f.recipient ? ` (to ${f.recipient})` : ''}. </span>)}Total {usdc(route.feeTotal)}</dd>
        <dt>Network fees ({l.src})</dt><dd>at most {eth(r.fees.totalUpperBoundWei ?? r.fees.executionFeeUpperBoundWei)} for {r.calls.length} transaction{r.calls.length > 1 ? 's' : ''}{r.fees.l1FeeUpperBoundWei === null ? ' (L1 data fee not estimated)' : ''}</dd>
        <dt>Estimated duration</dt><dd>about {route.quote.estimatedDurationSeconds} s after the deposit confirms (provider estimate)</dd>
        <dt>Approvals</dt><dd>{r.approvals.map((a, i) => <span key={i}>{a.required ? `Exactly ${usdc(a.amount)} to ${a.spender} (never unlimited)` : `Existing allowance ${usdc(a.currentAllowance)} is sufficient`}. </span>)}</dd>
        <dt>Recipient</dt><dd>{r.recipient} on {l.dst}{r.recipientKind === 'CONNECTED_OWNER' ? ' (your wallet)' : ''}{r.observation.destination.recipientHasCode ? ' · this address is a contract' : ''}</dd>
        <dt>Refund</dt><dd>If no relayer fills by {new Date(r.deadlines.fillDeadline * 1000).toISOString()}, Across refunds to {route.refundAddress} on {l.src}</dd>
        <dt>Quote expiry</dt><dd>{route.quote.expiresAt} · Review valid {fresh > 0 ? `for ${fresh}s` : 'no longer — get a fresh route'}</dd>
        <dt>Wallet requests</dt><dd>{r.calls.map(c => stepLabel(c.purpose)).join(' → ')} — each needs its own Execute click and wallet signature</dd>
        <dt>Strategy Manifest</dt><dd>Owner {r.owner} · spends at most {usdc(route.inputAmount)} · fixed provider {r.artifacts.manifest.providers.kind === 'FIXED' ? r.artifacts.manifest.providers.providerId : 'none'} ·
          hash <code>{r.artifacts.hashes.manifest}</code></dd>
      </dl>
      <details><summary>Sources: provider quote, transaction simulation, chain observation</summary>
        <dl aria-label="Evidence sources">
          <dt>Provider quote (not a simulation)</dt><dd>{providerLabel(r.quote.provider)} quote {r.quote.quoteId} · raw response {r.quote.rawHash}</dd>
          <dt>Alternatives considered</dt><dd>{r.selection.considered.map(c => `${providerLabel(c.provider)}: ${c.outcome.toLowerCase()}${c.code ? ` (${c.code})` : ''}${c.minimumOutput ? `, minimum ${usdc(c.minimumOutput)}` : ''}`).join('; ')}</dd>
          <dt>Transaction simulation</dt><dd>{r.simulation.method} of the exact {l.src} transactions at block {r.simulation.block}: deposit to {r.simulation.deposit.recipient}, output {usdc(r.simulation.deposit.outputAmount)}.
            Not simulated: the destination fill, relayer behaviour and refunds.</dd>
          <dt>Chain observation</dt><dd>{l.src} block {r.observation.source.block.number}, {l.dstShort} block {r.observation.destination.block.number}; balance {usdc(r.observation.source.usdcBalance)}; contracts match their pinned code.</dd>
          <dt>Route commitment</dt><dd><code>{r.routeCommitment}</code></dd>
          <dt>Manifest</dt><dd><code>{r.artifacts.hashes.manifest}</code> (binds the route commitment and the fixed provider {r.artifacts.manifest.providers.kind === 'FIXED' ? r.artifacts.manifest.providers.providerId : ''})</dd>
        </dl></details>
    </>}
    {view === 'execute' && record && <>
      <ol className="lifecycle" aria-label="Bridge lifecycle">{(ROUTER_PHASES.includes(record.phase) && !LIFECYCLE.includes(record.phase) ? [...LIFECYCLE.slice(0, LIFECYCLE.indexOf('SOURCE_CONFIRMED')), record.phase] : LIFECYCLE)
        .map(p => <li key={p} aria-current={record.phase === p ? 'step' : undefined}>{phaseLabel(p)}</li>)}</ol>
      {record.phase === 'PREPARED' && !record.requote && record.verdict === 'PENDING' && !router.retired && fresh > 0 && !pending && <>
        <p>Accepting authorizes only the wallet requests listed in this Review and binds the Strategy Manifest <code>{r?.artifacts.hashes.manifest}</code>. Each request still needs your signature.</p>
        <button type="button" disabled={router.busy} onClick={() => void router.review()}>Accept route review</button></>}
      {authorized && !router.executionEnabled && <p role="status">{message('ROUTER_EXECUTION_NOT_ENABLED')}</p>}
      {canExecute && nextStep && <button type="button" className="primary" disabled={router.busy} onClick={() => void router.execute()}>Execute: {stepLabel(nextStep)}</button>}
      {canRefresh && <button type="button" disabled={router.busy} onClick={() => void router.refresh()}>Get a fresh route and review</button>}
      {(pending || settling) && <button type="button" disabled={router.busy} onClick={() => void router.observe()}>Observe bridge</button>}
      {record.attempts.length > 0 && <ol aria-label={`${l.src} transactions`}>{record.attempts.map(a => <li key={a.attemptId}>{a.step === 'APPROVAL' ? 'Approval' : 'Bridge deposit'}: {a.state.toLowerCase().replaceAll('_', ' ')}
        {a.transactionHash && <> · <a href={explorerTx(network, 'source', a.replacementHash ?? a.transactionHash)} target="_blank" rel="noreferrer">view on {l.srcScan}</a></>}{a.note ? ` · ${message(a.note) ?? a.note}` : ''}</li>)}</ol>}
      {record.source && <p>Deposit {record.source.depositId} confirmed on {l.src}{record.source.safe ? ' (safe head)' : ''}: {usdc(record.source.inputAmount)} in, {usdc(record.source.outputAmount)} owed on {l.dstShort}.</p>}
      {record.destination && <p>Fill observed on {l.dstShort}{record.destination.safe ? ' (safe head)' : ''}: {usdc(record.destination.outputAmount)} to {record.destination.recipient} · <a
        href={explorerTx(network, 'destination', record.destination.transactionHash)} target="_blank" rel="noreferrer">view on {l.dstScan}</a></p>}
      {record.evidence && <section aria-label="Bridge result" className="swap-result"><h3>Bridge reconciled</h3>
        <p>{usdc(record.evidence.destination.outputAmount)} arrived at {record.evidence.recipient} on {l.dst} (minimum {usdc(record.evidence.minimumOutput)}). Independently reconciled on both chains.</p>
        <p>Evidence: {record.evidence.evidenceClass} · bundle {record.evidence.bundleHash}</p>
        <ul aria-label="Evidence transactions">{record.evidence.transactions.map(t => <li key={t.transactionHash}>{t.step.toLowerCase()} · <a href={t.explorer} target="_blank" rel="noreferrer">{t.transactionHash}</a></li>)}</ul>
        <a download={`${evidenceName}-evidence.json`} href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record.evidence, null, 2))}>Download Evidence Bundle</a></section>}
      {record.refund && <p role="status">Refunded {usdc(record.refund.amount)} to {record.refund.recipient} on {l.src}. No USDC was delivered on {l.dstShort}.</p>}
      {record.attempts.length > 0 && !record.evidence && <a download={`${evidenceName}-run.json`} href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record, null, 2))}>Download execution record</a>}
    </>}
    {info && <p role="status">{message(info) ?? 'Execution needs attention. Inspect technical details and observe any existing transaction.'}</p>}
    {router.busy && <p role="status">Working…</p>}
    <details><summary>Show technical details</summary><pre>{JSON.stringify({ error: info, network, run: record?.id, owner: record?.owner, phase: record?.phase, commitment: r?.commitment, routeCommitment: r?.routeCommitment,
      calls: r?.calls, attempts: record?.attempts, source: record?.source, destination: record?.destination, verdict: record?.verdict }, null, 2)}</pre></details>
  </section>;
}
