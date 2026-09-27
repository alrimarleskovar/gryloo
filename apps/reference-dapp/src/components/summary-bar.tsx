// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { product } from '../config/product';
import { chainStatus, checkChainAccess } from '../domain/artifact-chain';
import { SWAP_ACTION } from '../domain/swap-authoring';
import { useModeA } from '../state/mode-a-store';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';
import type { Tab } from './top-bar';

export function SummaryBar({ tab, setTab }: { tab: Tab; setTab: (value: Tab) => void }) {
  const { state, chain } = useWorkflow();
  const { info, prepared, retired, verifyError, verified, execution } = useModeA();
  const status = chainStatus(chain);
  // The chip is an access too: it shows CURRENT only while the guard passes now.
  const access = checkChainAccess(chain, state.workflow, Date.now(), performance.now());
  const shown = status === 'CURRENT' && !access.ok ? (access.code === 'ARTIFACTS_STALE' ? 'INVALIDATED' : 'EXPIRED') : status;
  // Only a current, browser-verified local-fork Manifest opens review; mocked and observed artifacts never do.
  const reviewable = Boolean(info?.available && prepared && !retired && !verifyError && verified['step-approve'] && verified['step-swap']);
  const evidence = execution?.evidence.at(-1);
  const forkState = !prepared ? 'NOT PREPARED' : evidence ? (evidence.revocationConfirmed ? 'REVOCATION_CONFIRMED' : evidence.outcome) : retired ? 'INVALIDATED' : 'REVIEW';
  return <footer className="summary-bar"><div><span className="eyebrow">WORKFLOW STATE</span><strong>Revision {state.workflow.revision}</strong><span>{state.workflow.nodes.filter(node => node.actionType === SWAP_ACTION).length} Base swap · {state.workflow.nodes.filter(node => node.actionType !== SWAP_ACTION).length} mock nodes</span></div>
    <div className="summary-status"><StatusBadge label={product.environment} tone="info"/><StatusBadge label={product.authorization}/><StatusBadge label={product.enforcement} tone="warning"/><StatusBadge label={product.outcome}/><StatusBadge label={`MOCKED ARTIFACTS: ${shown}`}/>
      {info?.available && <StatusBadge label={`MODE A · ${info.environment}: ${forkState}`} tone="warning"/>}</div>
    {tab === 'Build' ? <button type="button" onClick={() => setTab('Simulate')}>Open mocked simulation</button>
      : tab === 'Simulate' ? (reviewable
        ? <button type="button" className="primary" onClick={() => setTab('Execute')}>Review Mode A Manifest</button>
        : <button type="button" disabled aria-label="Manifest review unavailable">Manifest review unavailable</button>)
      : prepared && info?.available ? <button type="button" onClick={() => setTab('Simulate')}>Back to local-fork simulation</button>
        : <button type="button" disabled aria-label="Execution unavailable">Execution unavailable</button>}
  </footer>;
}
