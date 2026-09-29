// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { product } from '../config/product';
import { useModeB } from '../state/mode-b-store';
import { useModeA } from '../state/mode-a-store';
import { StatusBadge } from './status-badge';
import { useBuild009Wallet, chainName, BASE_HEX, ARBITRUM_HEX } from '../state/build009-wallet-store';
import { useBridgeSwap } from '../state/bridge-swap-store';
import { useAcross } from '../state/across-store';
import { useWorkflow } from '../state/workflow-store';

export type Tab = 'Build' | 'Simulate' | 'Execute';
export function TopBar({ tab, setTab }: { tab: Tab; setTab: (value: Tab) => void }) {
  const { info, wallet } = useModeA();
  const modeB = useModeB();
  const build009 = useBuild009Wallet();
  const bridgeSwap = useBridgeSwap();
  const across = useAcross();
  const workflow = useWorkflow().state.workflow;
  const build009Active = Boolean(bridgeSwap.run) || workflow.nodes[0]?.nodeId === 'build009-bridge';
  const destination = bridgeSwap.run && ['PARTIAL_COMPLETION','SWAP_QUOTED','SWAP_AUTHORIZED','SWAP_UNKNOWN','SWAP_SUBMITTED','SWAP_RECONCILED'].includes(bridgeSwap.run.state);
  const required = destination ? ARBITRUM_HEX : BASE_HEX;
  const fork = info?.available ? info : null;
  return <header className="top-bar">
    <div className="brand"><span className="brand-mark" aria-hidden="true">G</span><span>{product.name}</span></div>
    <nav aria-label="Workflow stages" className="tabs">{(['Build', 'Simulate', 'Execute'] as const).map((value) =>
      <button key={value} type="button" onClick={() => setTab(value)} aria-current={tab === value ? 'page' : undefined} className={tab === value ? 'selected' : ''}>{value}</button>)}</nav>
    <div className="top-meta"><StatusBadge label="Demo mode" tone="info"/>
      {fork && <span className="fork-badge"><StatusBadge label={`Local demo · ${fork.environment}`} tone="warning"/></span>}
      {modeB.info?.available && <span className="fork-badge"><StatusBadge label="Permission demo" tone="warning"/></span>}
      {(build009Active || across.run) && <span className="build009-required">Required: {chainName(required)}</span>}
      {build009.account ? <><span className="build009-wallet-info">Wallet: {build009.account.slice(0, 6)}…{build009.account.slice(-4)} · {chainName(build009.chainId)}</span>
        {build009Active && build009.chainId !== required && <button type="button" onClick={() => void build009.switchTo(required)} disabled={build009.busy}>Switch to {chainName(required)}</button>}
        <button type="button" onClick={build009.reset} disabled={build009.busy}>Disconnect/Reset (app only)</button></>
        : <button type="button" onClick={() => void build009.connect()} disabled={build009.busy}>Connect Wallet</button>}
      {(fork || modeB.info?.available) && <span>Wallet: {modeB.wallet ? `injected · ${modeB.wallet.account.slice(0, 6)}…${modeB.wallet.account.slice(-4)}` : wallet ? `injected · ${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : product.forkWallet}</span>}</div>
    {build009.error && <div role="alert" className="wallet-toast">Wallet: {build009.error}</div>}
  </header>;
}
