// SPDX-License-Identifier: AGPL-3.0-only
import { product } from '../config/product';
import { StatusBadge } from './status-badge';

export type Tab = 'Build' | 'Simulate' | 'Execute';
export function TopBar({ tab, setTab }: { tab: Tab; setTab: (value: Tab) => void }) {
  return <header className="top-bar">
    <div className="brand"><span className="brand-mark" aria-hidden="true">G</span><span>{product.name}</span><small>{product.build} REFERENCE</small></div>
    <nav aria-label="Workflow stages" className="tabs">{(['Build', 'Simulate', 'Execute'] as const).map((value) =>
      <button key={value} type="button" onClick={() => setTab(value)} aria-current={tab === value ? 'page' : undefined} className={tab === value ? 'selected' : ''}>{value}</button>)}</nav>
    <div className="top-meta"><StatusBadge label="MOCKED" tone="info"/><span>{product.chain}</span><span>Wallet: {product.wallet}</span></div>
  </header>;
}
