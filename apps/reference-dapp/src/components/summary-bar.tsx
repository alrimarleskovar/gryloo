// SPDX-License-Identifier: AGPL-3.0-only
import { product } from '../config/product';
import { SWAP_ACTION } from '../domain/swap-authoring';
import { useWorkflow } from '../state/workflow-store';
import { StatusBadge } from './status-badge';

export function SummaryBar() {
  const { state } = useWorkflow();
  return <footer className="summary-bar"><div><span className="eyebrow">WORKFLOW STATE</span><strong>Revision {state.workflow.revision}</strong><span>{state.workflow.nodes.filter(node => node.actionType === SWAP_ACTION).length} Base swap · {state.workflow.nodes.filter(node => node.actionType !== SWAP_ACTION).length} mock nodes</span></div><div className="summary-status"><StatusBadge label={product.environment} tone="info"/><StatusBadge label={product.authorization}/><StatusBadge label={product.enforcement} tone="warning"/><StatusBadge label={product.outcome}/></div><button type="button" disabled aria-label="Simulation unavailable in Build 003A">Simulate unavailable</button></footer>;
}
