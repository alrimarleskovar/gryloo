// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useBridgeSwap } from '../state/bridge-swap-store';
import { quoteFresh } from '../domain/build009-run';
import { ARBITRUM_USDC, ARBITRUM_WETH } from '../domain/bridge-swap-authoring';
import { useBuild009Wallet, BASE_HEX, ARBITRUM_HEX } from '../state/build009-wallet-store';
export function BridgeSwapPanel({ view }: { view: 'simulate' | 'execute' }) {
  const flow = useBridgeSwap(), wallet = useBuild009Wallet(), run = flow.run, state = run?.state;
  const required = !run || ['BRIDGE_QUOTED','BRIDGE_AUTHORIZED','BRIDGE_SOURCE_UNKNOWN','BRIDGE_SOURCE_SUBMITTED',
    'BRIDGE_SOURCE_CONFIRMED','BRIDGE_IN_PROGRESS','BRIDGE_DESTINATION_CONFIRMED'].includes(run.state) ? BASE_HEX : ARBITRUM_HEX;
  const ready = Boolean(wallet.account && wallet.account === run?.owner && wallet.chainId === required);
  const sourceFresh = Boolean(run && quoteFresh(run.bridge));
  const swapFresh = Boolean(run?.swap && quoteFresh(run.swap));
  return <section className="panel bridge-panel" role="region" aria-label="BUILD-009 bridge to swap composition">
    <p className="eyebrow">BUILD-009 / {view.toUpperCase()} · MOCKED FINANCIAL EXECUTION</p>
    <h2>Base USDC → Arbitrum USDC → WETH</h2>
    <p>LI.FI quotes are live read-only provider data. Source, bridge, destination swap, recovery and reconciliation below are deterministic MOCKED steps. No wallet signature or public-chain transaction is requested.</p>
    <p role="status">Required wallet chain: {required === BASE_HEX ? 'Base (8453)' : 'Arbitrum (42161)'} · {ready ? 'ready' : 'connect or switch in the top bar'}</p>
    {!run && view === 'simulate' && <button type="button" onClick={flow.quoteBridge} disabled={!wallet.account || wallet.chainId !== BASE_HEX || flow.busy}>Get live Base → Arbitrum LI.FI bridge quote</button>}
    {run && <>
      <p data-build009-state="">State: <strong>{state}</strong>{flow.recovered ? ' · recovered MOCKED journal' : ''}</p>
      <p>Owner: <code>{run.owner}</code> · route: {run.bridge.provider} · expected Arbitrum USDC: {run.bridge.expectedOut} · minimum: {run.bridge.minimumOut}</p>
      <p>Bridge quote expiry: {run.bridge.expiresAt} · {sourceFresh ? 'current' : 'expired'} · review <code data-build009-bridge-manifest="">{run.bridgeManifestHash}</code></p>
      {run.received && <p data-build009-received="">Reconciled Arbitrum USDC: <strong>{run.received}</strong> · token <code>{ARBITRUM_USDC}</code>. The bridge is complete; the swap is separate.</p>}
      {run.swap && <p>Fresh Arbitrum USDC → WETH quote: input {run.swap.amountIn} USDC units · expected {run.swap.expectedOut} WETH units · minimum {run.swap.minimumOut} · provider {run.swap.provider} · expiry {run.swap.expiresAt} · {swapFresh ? 'current' : 'expired'} · token <code>{ARBITRUM_WETH}</code> · review <code data-build009-swap-manifest="">{run.swapManifestHash}</code></p>}
      {run.swapReceived && <p data-build009-weth="">MOCKED reconciled Arbitrum WETH: {run.swapReceived}</p>}
      {state === 'BRIDGE_QUOTED' && <button type="button" onClick={flow.authorizeBridge} disabled={!ready || !sourceFresh || flow.busy || flow.recovered}>Authorize MOCKED bridge Manifest</button>}
      {state === 'BRIDGE_AUTHORIZED' && <><label htmlFor="build009-uncertain"><input id="build009-uncertain" type="checkbox" checked={flow.uncertain} onChange={event => flow.setUncertain(event.target.checked)}/> Rehearse uncertain submission</label><button type="button" onClick={flow.submitSource} disabled={!ready || !sourceFresh || flow.busy || flow.recovered}>Rehearse MOCKED source submission</button></>}
      {state === 'BRIDGE_SOURCE_UNKNOWN' && <button type="button" onClick={flow.recheckSource} disabled={flow.busy}>Recheck existing source attempt</button>}
      {['BRIDGE_SOURCE_SUBMITTED','BRIDGE_SOURCE_CONFIRMED','BRIDGE_IN_PROGRESS'].includes(state ?? '') && <button type="button" onClick={flow.advanceBridge} disabled={flow.busy}>{state === 'BRIDGE_SOURCE_SUBMITTED' ? 'Check MOCKED source receipt' : state === 'BRIDGE_SOURCE_CONFIRMED' ? 'Check MOCKED bridge progress' : 'Check MOCKED destination receipt'}</button>}
      {state === 'BRIDGE_DESTINATION_CONFIRMED' && <button type="button" onClick={flow.reconcileBridge} disabled={flow.busy}>Reconcile MOCKED Arbitrum USDC balance</button>}
      {['PARTIAL_COMPLETION','SWAP_QUOTED','SWAP_AUTHORIZED'].includes(state ?? '') && <button type="button" onClick={flow.quoteSwap} disabled={!ready || flow.busy}>Get fresh LI.FI destination quote from reconciled amount</button>}
      {state === 'SWAP_QUOTED' && <button type="button" onClick={flow.authorizeSwap} disabled={!ready || !swapFresh || flow.busy}>Authorize fresh MOCKED swap Manifest</button>}
      {state === 'SWAP_AUTHORIZED' && <><label htmlFor="build009-swap-uncertain"><input id="build009-swap-uncertain" type="checkbox" checked={flow.uncertain} onChange={event => flow.setUncertain(event.target.checked)}/> Rehearse uncertain submission</label><button type="button" onClick={flow.submitSwap} disabled={!ready || !swapFresh || flow.busy}>Rehearse MOCKED destination swap</button></>}
      {state === 'SWAP_UNKNOWN' && <button type="button" onClick={flow.recheckSwap} disabled={flow.busy}>Recheck existing swap attempt</button>}
      {state === 'SWAP_SUBMITTED' && <button type="button" onClick={flow.reconcileSwap} disabled={flow.busy}>Reconcile MOCKED WETH balance</button>}
      <details><summary>MOCKED journal ({run.events.length} events)</summary><ol>{run.events.map(event => <li key={event.sequence}>{event.state}: {event.note}</li>)}</ol></details>
      <button type="button" className="quiet" onClick={flow.clear} disabled={flow.busy}>Clear MOCKED composition journal</button>
    </>}
    {flow.error && <p role="alert">{flow.error}</p>}
  </section>;
}
