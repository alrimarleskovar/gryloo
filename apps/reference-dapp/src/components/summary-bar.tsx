// SPDX-License-Identifier: AGPL-3.0-only
import { product } from '../config/product';
import { chainStatus, checkChainAccess } from '../domain/artifact-chain';
import { SWAP_ACTION } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';
import type { Tab } from './top-bar';

export function SummaryBar({ tab, setTab }: { tab: Tab; setTab: (value: Tab) => void }) {
  const { state, chain } = useWorkflow();
  const status = chainStatus(chain);
  // The chip is an access too: it shows CURRENT only while the guard passes now.
  const access = checkChainAccess(chain, state.workflow, Date.now(), performance.now());
  const shown = status === 'CURRENT' && !access.ok ? (access.code === 'ARTIFACTS_STALE' ? 'INVALIDATED' : 'EXPIRED') : status;
  return <footer className="summary-bar"><div><span className="eyebrow">WORKFLOW STATE</span><strong>Revision {state.workflow.revision}</strong><span>{state.workflow.nodes.filter(node => node.actionType === SWAP_ACTION).length} Base swap · {state.workflow.nodes.filter(node => node.actionType !== SWAP_ACTION).length} mock nodes</span></div>
    <div className="summary-status"><StatusBadge label={product.environment} tone="info"/><StatusBadge label={product.authorization}/><StatusBadge label={product.enforcement} tone="warning"/><StatusBadge label={product.outcome}/><StatusBadge label={`MOCKED ARTIFACTS: ${shown}`}/></div>
    {tab === 'Build' ? <button type="button" onClick={() => setTab('Simulate')}>Open mocked simulation</button>
      : tab === 'Simulate' ? <button type="button" disabled aria-label="Manifest review unavailable">Manifest review unavailable</button>
      : <button type="button" disabled aria-label="Execution unavailable">Execution unavailable</button>}
  </footer>;
}
