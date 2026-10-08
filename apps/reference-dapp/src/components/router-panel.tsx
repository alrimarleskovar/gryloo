// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useEffect, useState, type FormEvent } from 'react';
import { ROUTER_PHASES, type RouteChange, type RouterPhase } from '@defi-workflow-engine/workflow-contracts';
import { createRouterNode, routerDetails, routerInputOf, ROUTER_DEFAULT_SLIPPAGE, ROUTER_NETWORK_OPTIONS, ROUTER_ROUTING_LABEL, type RouterBridgeInput,
  type RouterNetwork, type RouterRouting } from '../domain/router-authoring';
import { formatTokenAmount } from '../domain/jupiter-authoring';
import { useWorkflow } from '../state/workflow-store';
import { TokenAmountInput } from './token-amount-input';
import { useRouter } from '../state/router-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useExecutionEnvironment } from '../state/capability-store';

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
  const { t: tr } = useLocale();
  const { walletEnvironment } = useExecutionEnvironment();
  const { state, propose, amountInputs = {}, bridgeNetworkInputs = {}, editCanvasAmount, editBridgeNetworks } = useWorkflow();
  const node = state.workflow.nodes.find(n => n.nodeId === nodeId), existing = node ? routerDetails(node) : null;
  const start = ROUTER_NETWORK_OPTIONS[existing?.network ?? initialNetwork ?? 'mainnet'];
  const [input, setInput] = useState<RouterBridgeInput>(existing ? routerInputOf(existing)
    : { source: start.source, destination: start.destination, token: 'USDC', amount: '', recipient: '', slippage: ROUTER_DEFAULT_SLIPPAGE, routing: 'AUTO' });
  const [error, setError] = useState('');
  const set = (patch: Partial<RouterBridgeInput>) => {
    if (patch.amount !== undefined && nodeId) editCanvasAmount(nodeId, patch.amount);
    if (nodeId && (patch.source !== undefined || patch.destination !== undefined)) editBridgeNetworks(nodeId, {
      ...(patch.source !== undefined ? { source: patch.source } : {}), ...(patch.destination !== undefined ? { destination: patch.destination } : {}),
    });
    setInput(value => ({ ...value, ...patch, source: nodeId ? value.source : patch.source ?? value.source,
      destination: nodeId ? value.destination : patch.destination ?? value.destination, amount: nodeId ? value.amount : patch.amount ?? value.amount }));
  };
  const network = walletEnvironment === 'unknown' ? null : walletEnvironment;
  const option = network ? ROUTER_NETWORK_OPTIONS[network] : null;
  const fields = { ...input, ...(nodeId ? bridgeNetworkInputs[nodeId] : {}),
    ...(option ? { source: option.source, destination: option.destination } : {}), amount: nodeId ? amountInputs[nodeId] ?? input.amount : input.amount };
  const l = LABELS[network ?? existing?.network ?? initialNetwork ?? 'mainnet'];
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!network) return;
    try {
      createRouterNode(nodeId ?? 'node-preview', fields); setError('');
      propose(nodeId ? { type: 'SET_ROUTER_BRIDGE', nodeId, input: fields, source: 'CANVAS', baseRevision: state.workflow.revision }
        : { type: 'ADD_ROUTER_BRIDGE', input: fields, source: 'CANVAS', baseRevision: state.workflow.revision });
      onDone?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ROUTER_INPUT_INVALID'); }
  }
  return <form className="inspector-fields" aria-label={tr(nodeId ? 'Edit cross-chain bridge' : network === 'testnet' ? 'Create testnet cross-chain bridge' : 'Create cross-chain bridge')} onSubmit={submit}>
    <p className="muted">{tr(!network ? 'Connect a wallet on a supported network to configure Bridge.' : network === 'testnet' ? 'Cross-chain Router · Base Sepolia → Arbitrum Sepolia · test USDC → USDC. No real funds; any wallet can use it. A route is chosen and shown at Review.'
      : 'Cross-chain Router · Base → Arbitrum One · USDC → USDC. Real funds on mainnet; a route is chosen and shown at Review.')}</p>
    <label>{tr("Network")}<select aria-label={tr("Cross-chain network")} value={network ?? ''} disabled>
      <option value={network ?? ''}>{tr(network === 'mainnet' ? 'Mainnet (real funds)' : network === 'testnet' ? 'Testnet (test USDC)' : 'Network')}</option></select></label>
    <label>{tr("Source chain")}<select aria-label={tr("Cross-chain source chain")} value={option?.source ?? ''} disabled><option value={option?.source ?? ''}>{tr(option?.source ?? 'Network')}</option></select></label>
    <label>{tr("Destination chain")}<select aria-label={tr("Cross-chain destination chain")} value={option?.destination ?? ''} disabled><option value={option?.destination ?? ''}>{tr(option?.destination === 'Arbitrum' ? 'Arbitrum One' : option?.destination ?? 'Network')}</option></select></label>
    <label>{tr("Token")}<select aria-label={tr("Cross-chain token")} value={input.token} onChange={() => set({ token: 'USDC' })}><option value="USDC">{tr("USDC → USDC")}</option></select></label>
    <label>{tr("Amount (USDC)")}<TokenAmountInput aria-label={tr("Cross-chain amount (USDC)")} maxLength={40} value={fields.amount} onValueChange={amount => set({ amount })}/></label>
    <label>{tr("Recipient")}{tr(network ? ` on ${l.dstShort}` : '')}<input aria-label={tr("Cross-chain recipient")} autoComplete="off" spellCheck={false} maxLength={42} placeholder={tr("Your connected wallet")} value={input.recipient}
      onChange={e => set({ recipient: e.target.value })}/></label>
    <label>{tr("Routing")}<select aria-label={tr("Cross-chain routing policy")} value={input.routing} onChange={e => set({ routing: e.target.value as RouterRouting })}>
      {(Object.keys(ROUTER_ROUTING_LABEL) as RouterRouting[]).map(k => <option key={k} value={k}>{tr(ROUTER_ROUTING_LABEL[k])}</option>)}</select></label>
    <label>{tr("Slippage (bps)")}<input aria-label={tr("Cross-chain slippage (bps)")} inputMode="numeric" autoComplete="off" maxLength={4} value={input.slippage} onChange={e => set({ slippage: e.target.value })}/></label>
    {network && <small>{tr(network === 'testnet' ? 'Between 0.5 and 5 test USDC per bridge (the testnet relayer has little liquidity).' : 'Maximum 100 USDC per bridge in this release.')}{tr(" The minimum you receive is fixed in the reviewed deposit.")}</small>}
    {error && <p role="alert">{tr(error)}</p>}
    <button type="submit" disabled={!network}>{tr(nodeId ? 'Review bridge change' : 'Review bridge proposal')}</button>
    {onDone && <button type="button" className="quiet" onClick={onDone}>{tr("Cancel")}</button>}
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
 * Used by the Simulate/Execute bridge panel for the owner session and durable runs.
 */
function WalletSessionBlock({ showRuns }: { showRuns: boolean }) {
  const { t: tr } = useLocale();
  const wallet = useBuild009Wallet(), router = useRouter(), l = LABELS[router.network], source = ROUTER_NETWORK_OPTIONS[router.network].profile.source.chainHex;
  const signedIn = Boolean(router.session && wallet.account === router.session.account);
  return <div aria-label={tr("Wallet session")}>
    {!wallet.account ? <button type="button" disabled={wallet.busy} onClick={() => void wallet.connect()}>{tr("Connect wallet")}</button>
      : <p>{tr("Wallet connected: ")}<span>{wallet.account}</span>{wallet.chainId !== source && <> · <button type="button" disabled={router.busy} onClick={() => void router.switchNetwork()}>{tr("Switch to ")}{tr(l.src)}</button></>}</p>}
    {wallet.account && (signedIn ? <p role="status" aria-label={tr("Signed-in wallet")}>{tr("Signed in as ")}{short(router.session!.account)}{tr(" until ")}{tr(router.session!.expiresAt)}.{tr(' ')}
      <button type="button" className="quiet" disabled={router.busy} onClick={() => void router.signOut()}>{tr("Sign out")}</button></p>
      : <p><button type="button" disabled={router.busy || !router.sessionReady} onClick={() => void router.signIn()}>{tr("Sign in with wallet")}</button>{tr(' ')}
        <small>{tr("One signature proves this wallet is yours. It moves no funds and authorizes no transaction.")}</small></p>)}
    {showRuns && signedIn && <section aria-label={tr("Your runs")}><h3>{tr("Your runs · ")}{tr(l.src)} → {tr(l.dst)}</h3>
      {router.runs.length === 0 ? <p>{tr("No runs yet for this wallet.")}</p> : <ul>{router.runs.map(run => <li key={run.runId}>
        <button type="button" className="quiet" disabled={router.busy} onClick={() => void router.open(run.runId)}>{tr("Open ")}{run.runId}</button> · {tr(run.status.toLowerCase().replaceAll('_', ' '))}
        {tr(run.hasEvidence ? ' · evidence available' : '')}{tr(" · updated ")}{tr(run.updatedAt)}</li>)}</ul>}
      <button type="button" className="quiet" disabled={router.busy} onClick={() => void router.loadRuns()}>{tr("Refresh runs")}</button></section>}
  </div>;
}

export function RouterPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
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
  return <section className="panel" aria-label={tr("Cross-chain bridge")}><h2>{tr(view === 'simulate' ? 'Simulate cross-chain bridge' : 'Review cross-chain bridge')}</h2>
    {fields && <p>{tr("Bridge ")}{tr(fields.amount)}{tr(" USDC from ")}{tr(l.src)}{tr(" to ")}{tr(l.dst)}{tr(" for ")}{tr(fields.recipientLabel)}{tr(", routing: ")}{tr(ROUTER_ROUTING_LABEL[fields.routing])}.</p>}
    <p role="note">{tr(network === 'testnet' ? 'Test USDC on public testnets: Base Sepolia and Arbitrum Sepolia. No real funds.' : 'Real funds: Base mainnet and Arbitrum One.')}{tr(" Flofi never signs or sends; every transaction is your wallet's, after your Review.")}</p>
    {!router.available && <p role="status">{tr(message(network === 'testnet' ? 'ROUTER_TESTNET_NOT_ENABLED' : 'ROUTER_NOT_ENABLED'))}</p>}
    {router.retired && <p role="alert">{tr("The workflow changed. Prior authorization is invalid. Simulate the current bridge again.")}</p>}
    {router.recovered && record && <p role="status">{tr("Recovered run ")}{record.id}{tr(". Its state comes from the server; nothing is resent automatically.")}</p>}
    <WalletSessionBlock showRuns={true}/>
    {view === 'simulate' && <button type="button" disabled={router.busy || pending || settling || !router.available || !fields} onClick={() => void router.simulate()}>{tr("Get route and simulate")}</button>}
    {record?.error === 'ROUTE_CHANGED' && record.routeChanges.length > 0 && <p role="alert">{tr("Route changed: ")}{tr(record.routeChanges.map(c => changeLabel[c]).join(', '))}.</p>}
    {r && route && !router.retired && <>
      <dl className="swap-summary" aria-label={tr("Route review")}>
        <dt>{tr("Routing provider")}</dt><dd>{tr(providerLabel(route.routingProvider))}{tr(" · underlying protocol ")}{tr(route.underlyingProtocol)}</dd>
        <dt>{tr("Route")}</dt><dd><ol aria-label={tr("Route steps")}>{route.steps.map((s, i) => <li key={i}>{tr(s.kind === 'FEE_COLLECTION' ? `LI.FI fee collection on ${l.src}: ${usdc(s.amountIn)} → ${usdc(s.amountOut)}`
          : `Across bridge ${l.src} → ${l.dst}: ${usdc(s.amountIn)} → ${usdc(s.amountOut)}`)}</li>)}</ol></dd>
        <dt>{tr("Amount in")}</dt><dd>{tr(usdc(route.inputAmount))}{tr(" on ")}{tr(l.src)}</dd>
        <dt>{tr("Expected out")}</dt><dd>{tr(usdc(route.expectedOutput))}{tr(" on ")}{tr(l.dst)}</dd>
        <dt>{tr("Minimum received")}</dt><dd>{tr(usdc(route.minimumOutput))}{tr(" — fixed in the reviewed deposit; a smaller fill is a mismatch")}</dd>
        <dt>{tr("Fees")}</dt><dd>{route.fees.map((f, i) => <span key={i}>{tr(f.label)}: {tr(usdc(f.amount))}{tr(f.recipient ? ` (to ${f.recipient})` : '')}. </span>)}{tr("Total ")}{tr(usdc(route.feeTotal))}</dd>
        <dt>{tr("Network fees (")}{tr(l.src)})</dt><dd>{tr("at most ")}{tr(eth(r.fees.totalUpperBoundWei ?? r.fees.executionFeeUpperBoundWei))}{tr(" for ")}{tr(r.calls.length)}{tr(" transaction")}{tr(r.calls.length > 1 ? 's' : '')}{tr(r.fees.l1FeeUpperBoundWei === null ? ' (L1 data fee not estimated)' : '')}</dd>
        <dt>{tr("Estimated duration")}</dt><dd>{tr("about ")}{tr(route.quote.estimatedDurationSeconds)}{tr(" s after the deposit confirms (provider estimate)")}</dd>
        <dt>{tr("Approvals")}</dt><dd>{r.approvals.map((a, i) => <span key={i}>{tr(a.required ? `Exactly ${usdc(a.amount)} to ${a.spender} (never unlimited)` : `Existing allowance ${usdc(a.currentAllowance)} is sufficient`)}. </span>)}</dd>
        <dt>{tr("Recipient")}</dt><dd>{tr(r.recipient)}{tr(" on ")}{tr(l.dst)}{tr(r.recipientKind === 'CONNECTED_OWNER' ? ' (your wallet)' : '')}{tr(r.observation.destination.recipientHasCode ? ' · this address is a contract' : '')}</dd>
        <dt>{tr("Refund")}</dt><dd>{tr("If no relayer fills by ")}{tr(new Date(r.deadlines.fillDeadline * 1000).toISOString())}{tr(", Across refunds to ")}{tr(route.refundAddress)}{tr(" on ")}{tr(l.src)}</dd>
        <dt>{tr("Quote expiry")}</dt><dd>{tr(route.quote.expiresAt)}{tr(" · Review valid ")}{tr(fresh > 0 ? `for ${fresh}s` : 'no longer — get a fresh route')}</dd>
        <dt>{tr("Wallet requests")}</dt><dd>{tr(r.calls.map(c => stepLabel(c.purpose)).join(' → '))}{tr(" — each needs its own Execute click and wallet signature")}</dd>
        <dt>{tr("Strategy Manifest")}</dt><dd>{tr("Owner ")}{tr(r.owner)}{tr(" · spends at most ")}{tr(usdc(route.inputAmount))}{tr(" · fixed provider ")}{tr(r.artifacts.manifest.providers.kind === 'FIXED' ? r.artifacts.manifest.providers.providerId : 'none')}{tr(" · hash ")}<code>{tr(r.artifacts.hashes.manifest)}</code></dd>
      </dl>
      <details><summary>{tr("Sources: provider quote, transaction simulation, chain observation")}</summary>
        <dl aria-label={tr("Evidence sources")}>
          <dt>{tr("Provider quote (not a simulation)")}</dt><dd>{tr(providerLabel(r.quote.provider))}{tr(" quote ")}{tr(r.quote.quoteId)}{tr(" · raw response ")}{tr(r.quote.rawHash)}</dd>
          <dt>{tr("Alternatives considered")}</dt><dd>{tr(r.selection.considered.map(c => `${providerLabel(c.provider)}: ${c.outcome.toLowerCase()}${c.code ? ` (${c.code})` : ''}${c.minimumOutput ? `, minimum ${usdc(c.minimumOutput)}` : ''}`).join('; '))}</dd>
          <dt>{tr("Transaction simulation")}</dt><dd>{tr(r.simulation.method)}{tr(" of the exact ")}{tr(l.src)}{tr(" transactions at block ")}{tr(r.simulation.block)}{tr(": deposit to ")}{tr(r.simulation.deposit.recipient)}{tr(", output ")}{tr(usdc(r.simulation.deposit.outputAmount))}{tr(". Not simulated: the destination fill, relayer behaviour and refunds.")}</dd>
          <dt>{tr("Chain observation")}</dt><dd>{tr(l.src)}{tr(" block ")}{tr(r.observation.source.block.number)}, {tr(l.dstShort)}{tr(" block ")}{tr(r.observation.destination.block.number)}{tr("; balance ")}{tr(usdc(r.observation.source.usdcBalance))}{tr("; contracts match their pinned code.")}</dd>
          <dt>{tr("Route commitment")}</dt><dd><code>{tr(r.routeCommitment)}</code></dd>
          <dt>{tr("Manifest")}</dt><dd><code>{tr(r.artifacts.hashes.manifest)}</code>{tr(" (binds the route commitment and the fixed provider ")}{tr(r.artifacts.manifest.providers.kind === 'FIXED' ? r.artifacts.manifest.providers.providerId : '')})</dd>
        </dl></details>
    </>}
    {view === 'execute' && record && <>
      <ol className="lifecycle" aria-label={tr("Bridge lifecycle")}>{(ROUTER_PHASES.includes(record.phase) && !LIFECYCLE.includes(record.phase) ? [...LIFECYCLE.slice(0, LIFECYCLE.indexOf('SOURCE_CONFIRMED')), record.phase] : LIFECYCLE)
        .map(p => <li key={p} aria-current={record.phase === p ? 'step' : undefined}>{tr(phaseLabel(p))}</li>)}</ol>
      {record.phase === 'PREPARED' && !record.requote && record.verdict === 'PENDING' && !router.retired && fresh > 0 && !pending && <>
        <p>{tr("Accepting authorizes only the wallet requests listed in this Review and binds the Strategy Manifest ")}<code>{tr(r?.artifacts.hashes.manifest)}</code>{tr(". Each request still needs your signature.")}</p>
        <button type="button" disabled={router.busy} onClick={() => void router.review()}>{tr("Accept route review")}</button></>}
      {authorized && !router.executionEnabled && <p role="status">{tr(message('ROUTER_EXECUTION_NOT_ENABLED'))}</p>}
      {canExecute && nextStep && <button type="button" className="primary" disabled={router.busy} onClick={() => void router.execute()}>{tr("Execute: ")}{tr(stepLabel(nextStep))}</button>}
      {canRefresh && <button type="button" disabled={router.busy} onClick={() => void router.refresh()}>{tr("Get a fresh route and review")}</button>}
      {(pending || settling) && <button type="button" disabled={router.busy} onClick={() => void router.observe()}>{tr("Observe bridge")}</button>}
      {record.attempts.length > 0 && <ol aria-label={tr(`${l.src} transactions`)}>{record.attempts.map(a => <li key={a.attemptId}>{tr(a.step === 'APPROVAL' ? 'Approval' : 'Bridge deposit')}: {tr(a.state.toLowerCase().replaceAll('_', ' '))}
        {a.transactionHash && <> · <a href={explorerTx(network, 'source', a.replacementHash ?? a.transactionHash)} target="_blank" rel="noreferrer">{tr("view on ")}{tr(l.srcScan)}</a></>}{tr(a.note ? ` · ${message(a.note) ?? a.note}` : '')}</li>)}</ol>}
      {record.source && <p>{tr("Deposit ")}{tr(record.source.depositId)}{tr(" confirmed on ")}{tr(l.src)}{tr(record.source.safe ? ' (safe head)' : '')}: {tr(usdc(record.source.inputAmount))}{tr(" in, ")}{tr(usdc(record.source.outputAmount))}{tr(" owed on ")}{tr(l.dstShort)}.</p>}
      {record.destination && <p>{tr("Fill observed on ")}{tr(l.dstShort)}{tr(record.destination.safe ? ' (safe head)' : '')}: {tr(usdc(record.destination.outputAmount))}{tr(" to ")}{tr(record.destination.recipient)} · <a
        href={explorerTx(network, 'destination', record.destination.transactionHash)} target="_blank" rel="noreferrer">{tr("view on ")}{tr(l.dstScan)}</a></p>}
      {record.evidence && <section aria-label={tr("Bridge result")} className="swap-result"><h3>{tr("Bridge reconciled")}</h3>
        <p>{tr(usdc(record.evidence.destination.outputAmount))}{tr(" arrived at ")}{tr(record.evidence.recipient)}{tr(" on ")}{tr(l.dst)}{tr(" (minimum ")}{tr(usdc(record.evidence.minimumOutput))}{tr("). Independently reconciled on both chains.")}</p>
        <p>{tr("Evidence: ")}{tr(record.evidence.evidenceClass)}{tr(" · bundle ")}{record.evidence.bundleHash}</p>
        <ul aria-label={tr("Evidence transactions")}>{record.evidence.transactions.map(t => <li key={t.transactionHash}>{tr(t.step.toLowerCase())} · <a href={t.explorer} target="_blank" rel="noreferrer">{t.transactionHash}</a></li>)}</ul>
        <a download={`${evidenceName}-evidence.json`} href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record.evidence, null, 2))}>{tr("Download Evidence Bundle")}</a></section>}
      {record.refund && <p role="status">{tr("Refunded ")}{tr(usdc(record.refund.amount))}{tr(" to ")}{tr(record.refund.recipient)}{tr(" on ")}{tr(l.src)}{tr(". No USDC was delivered on ")}{tr(l.dstShort)}.</p>}
      {record.attempts.length > 0 && !record.evidence && <a download={`${evidenceName}-run.json`} href={'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(record, null, 2))}>{tr("Download execution record")}</a>}
    </>}
    {info && <p role="status">{tr(message(info) ?? 'Execution needs attention. Inspect technical details and observe any existing transaction.')}</p>}
    {router.busy && <p role="status">{tr("Working…")}</p>}
    <details><summary>{tr("Show technical details")}</summary><pre>{JSON.stringify({ error: info, network, run: record?.id, owner: record?.owner, phase: record?.phase, commitment: r?.commitment, routeCommitment: r?.routeCommitment,
      calls: r?.calls, attempts: record?.attempts, source: record?.source, destination: record?.destination, verdict: record?.verdict }, null, 2)}</pre></details>
  </section>;
}
