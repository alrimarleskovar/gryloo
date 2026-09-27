// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { product } from '../config/product';
import { useModeB } from '../state/mode-b-store';
import { useModeA } from '../state/mode-a-store';
import { StatusBadge } from './status-badge';

export type Tab = 'Build' | 'Simulate' | 'Execute';
export function TopBar({ tab, setTab }: { tab: Tab; setTab: (value: Tab) => void }) {
  const { info, wallet } = useModeA();
  const modeB = useModeB();
  const fork = info?.available ? info : null;
  return <header className="top-bar">
    <div className="brand"><span className="brand-mark" aria-hidden="true">G</span><span>{product.name}</span><small>{product.build} REFERENCE</small></div>
    <nav aria-label="Workflow stages" className="tabs">{(['Build', 'Simulate', 'Execute'] as const).map((value) =>
      <button key={value} type="button" onClick={() => setTab(value)} aria-current={tab === value ? 'page' : undefined} className={tab === value ? 'selected' : ''}>{value}</button>)}</nav>
    <div className="top-meta"><StatusBadge label="MOCKED" tone="info"/>
      {fork && <span className="fork-badge"><StatusBadge label={`LOCAL FORK · ${fork.environment}`} tone="warning"/></span>}
      {modeB.info?.available && <span className="fork-badge"><StatusBadge label="MODE B · LOCAL FORK" tone="warning"/></span>}
      <span>{fork || modeB.info?.available ? product.forkChain : product.chain}</span>
      <span>Wallet: {modeB.wallet ? `injected · ${modeB.wallet.account.slice(0, 6)}…${modeB.wallet.account.slice(-4)}` : fork ? (wallet ? `injected · ${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : product.forkWallet) : modeB.info?.available ? product.forkWallet : product.wallet}</span></div>
  </header>;
}
