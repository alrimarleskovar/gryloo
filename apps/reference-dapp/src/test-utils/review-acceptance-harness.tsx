// SPDX-License-Identifier: AGPL-3.0-only
// Browser-only test entry. No production route imports this module.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReviewWorkspace, ReviewTechnicalDetails } from '../components/review-workspace';
import { SimulationSummary } from '../components/simulation-summary';
import { reviewFixture, reviewOwner, reviewSpender } from './review-fixture';
import { classifyWalletEnvironment } from '../wallet/environment';

type Transition = 'valid' | 'pending' | 'loading' | 'failed' | 'workflow' | 'policy' | 'wallet' | 'wallet-return' | 'network' | 'unknown-network' | 'blocked';
declare global {
  interface Window {
    flofiReviewAcceptance: { transition(value: Transition): void; counts(): { approved: number; executed: number; refreshed: number; edited: number } };
  }
}
function ReviewAcceptanceHarness() {
  const [fixture, setFixture] = useState(reviewFixture);
  const counts = useRef({ approved: 0, executed: 0, refreshed: 0, edited: 0 });
  useEffect(() => {
    window.flofiReviewAcceptance = {
      counts: () => ({ ...counts.current }),
      transition: value => setFixture(current => {
        if (value === 'valid' || value === 'pending' || value === 'loading') {
          const next = reviewFixture();
          if (value !== 'valid') { next.authorization.key = null; next.authorization.ready = false; Object.assign(next.source.state, { run: null, busy: value === 'loading' }); }
          return next;
        }
        // Real props are replaced without unmounting Review or advancing to Execute.
        const next = { ...current, workflow: structuredClone(current.workflow), wallet: { ...current.wallet },
          source: { ...current.source, state: { ...current.source.state } } as typeof current.source,
          authorization: { ...current.authorization } };
        if (value === 'failed') Object.assign(next.source.state, { error: 'SIMULATION_FAILED' });
        if (value === 'blocked') next.authorization.ready = false;
        if (value === 'workflow') {
          const actionId = next.workflow.nodes.at(-1)!.nodeId;
          next.workflow = { ...next.workflow, nodes: next.workflow.nodes.map(node => node.nodeId === actionId ? {
            ...node, inputs: node.inputs.map(input => input.kind === 'QUANTITY' ? { ...input, value: { ...input.value, amount: '101000000' } } : input),
          } : node) };
        }
        if (value === 'policy') {
          const policy = structuredClone(current.policy); policy.maximumSlippageBps = 100;
          next.authorization.policy = policy;
        }
        if (value === 'wallet' || value === 'wallet-return') next.wallet = { ...next.wallet, account: value === 'wallet' ? reviewSpender : reviewOwner, changed: true };
        if (value === 'network' || value === 'unknown-network') {
          next.wallet.chain = value === 'network' ? 'eip155:42161' : null;
          next.wallet.environment = classifyWalletEnvironment(next.wallet.chain);
          next.wallet.changed = true;
        }
        return next;
      }),
    };
  }, []);
  const authorization = { ...fixture.authorization, approve: () => {
    counts.current.approved += 1;
    setFixture(current => ({ ...current, authorization: { ...current.authorization, accepted: true } }));
  } };
  // An execution sentinel on the source would detect an accidental call across the Review boundary.
  const source = { ...fixture.source, state: { ...fixture.source.state } } as typeof fixture.source;
  Object.assign(source.state, { execute: () => { counts.current.executed += 1; } });
  return <section className="simulate-workspace" aria-label="Workflow simulation workspace">
    <aside className="simulation-summary panel" aria-label="Simulation Summary"><SimulationSummary workflow={fixture.workflow} context={fixture.context} source={source}/></aside>
    <ReviewWorkspace {...fixture} source={source} authorization={authorization} workflowName="Acceptance strategy" showTechnicalDetails={false}
      backToBuild={() => { counts.current.edited += 1; }} simulateAgain={() => { counts.current.refreshed += 1; }}/>
    <details className="shell-details technical-workspace"><summary>View technical details</summary><ReviewTechnicalDetails authorization={authorization}/></details>
  </section>;
}
export function mount(element: HTMLElement) { createRoot(element).render(<ReviewAcceptanceHarness/>); }
