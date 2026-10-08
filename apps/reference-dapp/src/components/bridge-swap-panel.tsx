// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { useBridgeSwap } from '../state/bridge-swap-store';
import { quoteFresh } from '../domain/build009-run';
import { ARBITRUM_USDC, ARBITRUM_WETH } from '../domain/bridge-swap-authoring';
import { useBuild009Wallet, BASE_HEX, ARBITRUM_HEX } from '../state/build009-wallet-store';
export function BridgeSwapPanel({ view }: { view: 'simulate' | 'execute' }) {
  const { t: tr } = useLocale();
  const flow = useBridgeSwap(), wallet = useBuild009Wallet(), run = flow.run, state = run?.state;
  const required = !run || ['BRIDGE_QUOTED','BRIDGE_AUTHORIZED','BRIDGE_SOURCE_UNKNOWN','BRIDGE_SOURCE_SUBMITTED',
    'BRIDGE_SOURCE_CONFIRMED','BRIDGE_IN_PROGRESS','BRIDGE_DESTINATION_CONFIRMED'].includes(run.state) ? BASE_HEX : ARBITRUM_HEX;
  const ready = Boolean(wallet.account && wallet.account === run?.owner && wallet.chainId === required);
  const sourceFresh = Boolean(run && quoteFresh(run.bridge));
  const swapFresh = Boolean(run?.swap && quoteFresh(run.swap));
  return <section className="panel bridge-panel" role="region" aria-label={tr("Base to Arbitrum bridge and swap")}>
    <p className="eyebrow">{tr("BRIDGE TO SWAP · DEMO MODE")}</p>
    <h2>{tr("Base USDC → Arbitrum USDC → WETH")}</h2>
    <p>{tr("LI.FI quotes are live read-only provider data. Source, bridge, destination swap, recovery and reconciliation below are deterministic MOCKED steps. No wallet signature or public-chain transaction is requested.")}</p>
    <p role="status">{tr("Required wallet chain: ")}{tr(required === BASE_HEX ? 'Base (8453)' : 'Arbitrum (42161)')} · {tr(ready ? 'ready' : 'connect or switch in the top bar')}</p>
    {!run && view === 'simulate' && <button type="button" onClick={flow.quoteBridge} disabled={!wallet.account || wallet.chainId !== BASE_HEX || flow.busy}>{tr("Get live Base → Arbitrum LI.FI bridge quote")}</button>}
    {run && <>
      <p data-build009-state="">{tr("State: ")}<strong>{tr(state)}</strong>{tr(flow.recovered ? ' · recovered MOCKED journal' : '')}</p>
      <p>{tr("Owner: ")}<code>{tr(run.owner)}</code>{tr(" · route: ")}{tr(run.bridge.provider)}{tr(" · expected Arbitrum USDC: ")}{tr(run.bridge.expectedOut)}{tr(" · minimum: ")}{tr(run.bridge.minimumOut)}</p>
      <p>{tr("Bridge quote expiry: ")}{tr(run.bridge.expiresAt)} · {tr(sourceFresh ? 'current' : 'expired')}{tr(" · review ")}<code data-build009-bridge-manifest="">{tr(run.bridgeManifestHash)}</code></p>
      {run.received && <p data-build009-received="">{tr("Reconciled Arbitrum USDC: ")}<strong>{tr(run.received)}</strong>{tr(" · token ")}<code>{tr(ARBITRUM_USDC)}</code>{tr(". The bridge is complete; the swap is separate.")}</p>}
      {run.swap && <p>{tr("Fresh Arbitrum USDC → WETH quote: input ")}{tr(run.swap.amountIn)}{tr(" USDC units · expected ")}{tr(run.swap.expectedOut)}{tr(" WETH units · minimum ")}{tr(run.swap.minimumOut)}{tr(" · provider ")}{tr(run.swap.provider)}{tr(" · expiry ")}{tr(run.swap.expiresAt)} · {tr(swapFresh ? 'current' : 'expired')}{tr(" · token ")}<code>{tr(ARBITRUM_WETH)}</code>{tr(" · review ")}<code data-build009-swap-manifest="">{tr(run.swapManifestHash)}</code></p>}
      {run.swapReceived && <p data-build009-weth="">{tr("MOCKED reconciled Arbitrum WETH: ")}{tr(run.swapReceived)}</p>}
      {state === 'BRIDGE_QUOTED' && <button type="button" onClick={flow.authorizeBridge} disabled={!ready || !sourceFresh || flow.busy || flow.recovered}>{tr("Authorize MOCKED bridge Manifest")}</button>}
      {state === 'BRIDGE_AUTHORIZED' && <><label htmlFor="build009-uncertain"><input id="build009-uncertain" type="checkbox" checked={flow.uncertain} onChange={event => flow.setUncertain(event.target.checked)}/>{tr(" Rehearse uncertain submission")}</label><button type="button" onClick={flow.submitSource} disabled={!ready || !sourceFresh || flow.busy || flow.recovered}>{tr("Rehearse MOCKED source submission")}</button></>}
      {state === 'BRIDGE_SOURCE_UNKNOWN' && <button type="button" onClick={flow.recheckSource} disabled={flow.busy}>{tr("Recheck existing source attempt")}</button>}
      {['BRIDGE_SOURCE_SUBMITTED','BRIDGE_SOURCE_CONFIRMED','BRIDGE_IN_PROGRESS'].includes(state ?? '') && <button type="button" onClick={flow.advanceBridge} disabled={flow.busy}>{tr(state === 'BRIDGE_SOURCE_SUBMITTED' ? 'Check MOCKED source receipt' : state === 'BRIDGE_SOURCE_CONFIRMED' ? 'Check MOCKED bridge progress' : 'Check MOCKED destination receipt')}</button>}
      {state === 'BRIDGE_DESTINATION_CONFIRMED' && <button type="button" onClick={flow.reconcileBridge} disabled={flow.busy}>{tr("Reconcile MOCKED Arbitrum USDC balance")}</button>}
      {['PARTIAL_COMPLETION','SWAP_QUOTED','SWAP_AUTHORIZED'].includes(state ?? '') && <button type="button" onClick={flow.quoteSwap} disabled={!ready || flow.busy}>{tr("Get fresh LI.FI destination quote from reconciled amount")}</button>}
      {state === 'SWAP_QUOTED' && <button type="button" onClick={flow.authorizeSwap} disabled={!ready || !swapFresh || flow.busy}>{tr("Authorize fresh MOCKED swap Manifest")}</button>}
      {state === 'SWAP_AUTHORIZED' && <><label htmlFor="build009-swap-uncertain"><input id="build009-swap-uncertain" type="checkbox" checked={flow.uncertain} onChange={event => flow.setUncertain(event.target.checked)}/>{tr(" Rehearse uncertain submission")}</label><button type="button" onClick={flow.submitSwap} disabled={!ready || !swapFresh || flow.busy}>{tr("Rehearse MOCKED destination swap")}</button></>}
      {state === 'SWAP_UNKNOWN' && <button type="button" onClick={flow.recheckSwap} disabled={flow.busy}>{tr("Recheck existing swap attempt")}</button>}
      {state === 'SWAP_SUBMITTED' && <button type="button" onClick={flow.reconcileSwap} disabled={flow.busy}>{tr("Reconcile MOCKED WETH balance")}</button>}
      <details><summary>{tr("MOCKED journal (")}{tr(run.events.length)}{tr(" events)")}</summary><ol>{run.events.map(event => <li key={event.sequence}>{tr(event.state)}: {tr(event.note)}</li>)}</ol></details>
      <button type="button" className="quiet" onClick={flow.clear} disabled={flow.busy}>{tr("Clear MOCKED composition journal")}</button>
    </>}
    {flow.error && <p role="alert">{tr(flow.error)}</p>}
  </section>;
}
