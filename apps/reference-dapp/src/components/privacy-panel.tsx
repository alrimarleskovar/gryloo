// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState } from 'react';
import { digestArtifact, validateSolanaSwapWorkflow } from '@defi-workflow-engine/reference-linter';
import { requireCloakPrivacy, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { useWorkflow } from '../state/workflow-store';
import { solanaSwapDetails } from '../domain/jupiter-authoring';

/** Same Flofi tabs/IR/revision boundary. A capability check cannot impersonate a transaction simulation. */
export function PrivacyPanel({ view }: { view: 'build' | 'simulate' | 'execute' }) {
  const { state, review } = useWorkflow();
  const node = state.workflow.nodes.find(n => n.adapterConstraints.protocols.includes('cloak'));
  const fields = node && solanaSwapDetails(node);
  const [checked, setChecked] = useState<{ revision: number; workflowHash: string } | null>(null);
  const [error, setError] = useState('');
  const current = checked?.revision === state.workflow.revision ? checked : null;
  async function check() {
    try {
      const workflow = state.workflow;
      validateSolanaSwapWorkflow(workflow as SemanticWorkflow);
      requireCloakPrivacy(workflow.nodes[0]!);
      const workflowHash = await digestArtifact('semantic-workflow', workflow);
      setChecked({ revision: workflow.revision, workflowHash }); setError('');
    } catch { setError('Privacy policy is invalid. Execution remains blocked.'); }
  }
  function exportEvidence() {
    if (!current) return;
    const report = { format: 'flofi.cloak-feasibility.v1', execution: 'NOT_EXECUTED', financialSimulation: 'NOT_PERFORMED',
      semanticWorkflowHash: current.workflowHash, revision: current.revision,
      privacy: { mode: 'required', provider: 'cloak', output: 'public-with-private-change' },
      acceptance: 'BLOCKED', findings: review?.findings.map(f => f.code) ?? ['INVALID_WORKFLOW'],
      blockers: ['CLOAK_EXACT_PROOF_SIMULATION_UNAVAILABLE', 'CLOAK_BROWSER_NETWORK_POLICY_UNCONFIGURED', 'CLOAK_SETTLEMENT_VERIFIER_UNAVAILABLE'] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'BUILD-PRIVACY-001-feasibility.json'; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="panel" aria-label="Cloak privacy workflow">
    <p className="eyebrow">PRIVACY: REQUIRED / CLOAK</p><h2>{view === 'execute' ? 'Owner authorization blocked' : 'SOL → USDC with private SOL change'}</h2>
    {fields && <p>Swap {fields.amount} SOL to USDC on Solana mainnet. Slippage limit: {fields.slippage} bps.</p>}
    <p>The USDC proceeds arrive in a public token account. Remaining SOL change stays shielded. Deposits, swap settlement and the USDC recipient are observable; this does not make the whole trade invisible.</p>
    <p role="status">Execution unavailable: Cloak proof simulation, browser submission policy and authoritative settlement verification are not integrated yet. No executable Manifest or wallet authorization is issued.</p>
    {view === 'simulate' && <><button type="button" onClick={() => void check()}>Check privacy feasibility</button>
      {current && <p>Policy check complete for revision {current.revision}. Financial simulation not performed. Acceptance blocked.</p>}
      {current && <button type="button" className="quiet" onClick={exportEvidence}>Export non-executed feasibility report</button>}</>}
    {view === 'execute' && <button type="button" disabled>Review and authorize Cloak execution</button>}
    {error && <p role="alert">{error}</p>}
    <p>Public confirmation alone cannot establish success. Durable private change and refund recovery data, reload verification and reconciliation are required.</p>
  </section>;
}
