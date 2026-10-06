// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from '../domain/editor';
import { canvasAddCommand } from '../domain/canvas-authoring';
import type { SimulationSource } from '../domain/simulation-presentation';
import { ReviewWorkspace } from './review-workspace';
import { reviewFixture, reviewNow } from '../test-utils/review-fixture';
import { WORKFLOW_STAGES } from '../domain/product-shell';
import { SimulateWorkspace } from './simulate-workspace';

const fixture = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof import('../state/workflow-store').useWorkflow> }));
vi.mock('../state/workflow-store', () => ({ useWorkflow: () => fixture.store }));
vi.mock('./simulate-workflow-canvas', () => ({ SimulateWorkflowCanvas: ({ workflowName, primaryAction }: { workflowName: string; primaryAction?: ReactNode }) => createElement('div', { 'aria-label': 'Simulation workflow graph' }, workflowName, primaryAction) }));
beforeEach(() => {
  fixture.store = { state: initialEditor(), context: createBaseSepoliaReviewContext() } as unknown as typeof fixture.store;
});
const render = (simulationSource?: SimulationSource) => renderToStaticMarkup(createElement(SimulateWorkspace, { workflowName: 'My strategy', returnToBuild: vi.fn(), simulationSource }));
describe('Simulate product workspace', () => {
  it('shows unavailable values without generating estimates or Review readiness', () => {
    const html = render();
    expect(html).toContain('My strategy');
    expect(html).toContain('aria-label="Simulation Summary"');
    for (const row of ['Slippage', 'Price impact', 'Workflow network']) expect(html).toContain(`<dt>${row}</dt><dd>—</dd>`);
    expect(html).toContain('Back to Build');
    expect(html).not.toMatch(/mock|synthetic|debug|artifact|canonical|<button[^>]*>Review/i);
  });

  it('reads the configured slippage and actual workflow network without inferring financial results', () => {
    fixture.store.state = editorReducer(initialEditor(), { type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '2', slippage: '75', source: 'CHAT', baseRevision: 0 }, fixture.store.context);
    const workflow = fixture.store.state.workflow;
    const html = render();
    expect(html).toContain('0.75%');
    expect(html).toContain('Configured limit');
    expect(html).toContain('Base');
    for (const row of ['Price impact']) expect(html).toContain(`<dt>${row}</dt><dd>—</dd>`);
    expect(fixture.store.state.workflow).toBe(workflow);
  });

  it('keeps per-step slippage limits identifiable in a composition', () => {
    fixture.store.state = editorReducer(initialEditor(), canvasAddCommand('lending', 0, '0x1111111111111111111111111111111111111111', '1'), fixture.store.context);
    const html = render();
    expect(html).toContain('Base Sepolia');
    expect(html).toContain('Configured limit');
    expect(html).toContain('Step 3 · Swap');
    expect(html).not.toContain('US$');
  });
});


describe('UX-004B result sections', () => {
  it('renders real outputs, fees and actual price impact in product sections with original brand assets', () => {
    fixture.store.state = editorReducer(initialEditor(), { type: 'ADD_SOLANA_SWAP', input: { network: 'Solana', from: 'USDC', to: 'SOL', amount: '100', slippage: '50' }, source: 'CHAT', baseRevision: 0 }, fixture.store.context);
    const source = { kind: 'solana-swap', state: { busy: false, error: null, retired: false, record: {
      provenance: 'PUBLIC_MAINNET', verdict: 'PENDING', error: null, review: {
        format: 'gryloo.jupiter-review.v1', workflow: fixture.store.state.workflow, expiresAt: '2099-01-01T00:00:00.000Z', cluster: 'mainnet-beta', input: { symbol: 'USDC', decimals: 6 }, output: { symbol: 'SOL', decimals: 9 }, slippageBps: 50,
        quote: { otherAmountThreshold: '99500000', priceImpactPct: '0.0008', routePlan: [] }, estimatedFeeLamports: '5000',
        simulationResult: { inputSpent: '100000000', outputReceived: '100000000', accountCreationLamports: '0' },
      },
    } } } as unknown as SimulationSource;
    const html = render(source);
    for (const section of ['Expected result', 'Route', 'Fees', 'Market impact']) expect(html).toContain(`aria-label="${section}"`);
    for (const value of ['100 USDC', '0.1 SOL', '0.0995 SOL', 'Jupiter', '0.000005 SOL', '0.50%', '0.08%', 'Ready', 'Valid until']) expect(html).toContain(value);
    expect(html).toContain('/brand/crypto/usdc.png'); expect(html).toContain('/brand/crypto/solana.svg');
    expect(html).not.toMatch(/N\/A|undefined|null|0.00 USD|mock|synthetic|debug|artifact|canonical|PUBLIC_MAINNET/);
  });
  it('turns errors into blocking attention without exposing raw enums or response paths', () => {
    const html = render({ kind: 'unavailable', state: { error: 'SUPPLY_INSUFFICIENT_USDC', busy: false } });
    expect(html).toContain('Insufficient balance'); expect(html).toContain('Risk / attention');
    expect(html).toContain('Your available balance is too low'); expect(html).toContain('Blocking');
    expect(html).not.toContain('SUPPLY_INSUFFICIENT');
  });
  it('keeps an invalid workflow blocking even if the source is absent', () => {
    fixture.store = { ...fixture.store, reviewError: 'raw.validation.path' };
    const html = render(); expect(html).toContain('Check workflow'); expect(html).toContain('Check the workflow configuration in Build');
    expect(html).not.toContain('raw.validation.path');
  });
});

// The same Simulate composition is re-rendered with current runtime data; Review never needs a navigation state.
describe('embedded authorization in Simulate', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(reviewNow); });
  afterEach(() => { vi.useRealTimers(); });
  function embedded(data = reviewFixture()) {
    fixture.store = { ...fixture.store, state: { ...fixture.store.state, workflow: data.workflow }, context: data.context };
    return renderToStaticMarkup(createElement(SimulateWorkspace, {
      workflowName: 'My strategy', simulationSource: data.source, returnToBuild: vi.fn(),
      review: createElement(ReviewWorkspace, { ...data, workflowName: 'My strategy', backToBuild: vi.fn() }),
    }));
  }
  it('reveals valid Review below Simulation Summary within the same workspace without duplicating simulation cards', () => {
    const html = embedded(), primary = html.split('<details')[0]!;
    expect(primary.indexOf('aria-label="Simulation Summary"')).toBeLessThan(primary.indexOf('id="simulation-review"'));
    expect(primary).toContain('Ready to approve'); expect(primary).toContain('Approve &amp; Continue');
    expect(primary).not.toMatch(/disabled="">Approve/);
    for (const section of ['Expected result', 'Route', 'Fees', 'Market impact'])
      expect(primary.match(new RegExp(`aria-label="${section}"`, 'g'))).toHaveLength(1);
    expect(primary.match(/aria-label="Authorization preview"/g)).toHaveLength(1);
    expect(primary).not.toContain('review-workflow-steps'); expect(primary).not.toContain('Back to Simulate');
    expect(WORKFLOW_STAGES).toEqual(['Build', 'Simulate', 'Execute']);
  });
  it('locks the embedded section before valid simulation', () => {
    const data = reviewFixture(); data.authorization.key = null; data.authorization.ready = false;
    const html = embedded(data); expect(html).toContain('review-locked'); expect(html).not.toContain('Approve &amp; Continue');
    expect(html).not.toContain('aria-label="Execution limits"');
  });
  it('blocks invalid simulation without leaving Simulate', () => {
    const data = reviewFixture(); Object.assign(data.source.state, { error: 'SUPPLY_INSUFFICIENT_USDC' });
    const html = embedded(data); expect(html).toContain('Review blocked'); expect(html).toMatch(/disabled="">Approve &amp; Continue/);
    expect(html).toContain('aria-label="Workflow simulation workspace"');
  });
  it('expires both simulation and embedded Review in the same workspace', () => {
    vi.setSystemTime(reviewNow + 120_000); const html = embedded();
    expect(html).toContain('Simulation expired'); expect(html).toContain('Review unavailable until simulation is refreshed');
    expect(html).toMatch(/disabled="">Approve &amp; Continue/);
  });
  it.each(['workflow', 'wallet', 'network'] as const)('updates %s invalidation inside the existing Simulate section', change => {
    const data = reviewFixture(); expect(embedded(data)).toContain('Ready to approve');
    if (change === 'workflow') Object.assign(data.source.state, { retired: true });
    if (change === 'wallet') { data.wallet.account = '0x2222222222222222222222222222222222222222'; data.wallet.changed = true; }
    if (change === 'network') { data.wallet.chain = 'eip155:42161'; data.wallet.environment = 'mainnet'; }
    const html = embedded(data); expect(html).toContain('Review required again'); expect(html).toContain('id="simulation-review"');
    expect(html).toMatch(/disabled="">Approve &amp; Continue/);
    if (change === 'wallet') expect(html).toContain('0x2222…2222');
    if (change === 'network') expect(html).toContain('Arbitrum');
  });
});

describe('UX-004D compact simulation states', () => {
  it('renders empty and loading copy without developer state labels', () => {
    expect(render()).toContain('No workflow'); expect(render()).toContain('Create a workflow in Build first');
    fixture.store.state = editorReducer(initialEditor(), { type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '1', slippage: '50', source: 'CHAT', baseRevision: 0 }, fixture.store.context);
    expect(render()).toContain('No simulation yet');
    const loading = render({ kind: 'unavailable', state: { busy: 'Generating mocked artifacts raw payload', error: null } });
    expect(loading).toContain('Simulating workflow…'); expect(loading).toContain('simulation-tone-neutral');
    expect(loading).not.toMatch(/mock|artifact|raw payload|Generating|undefined|null/);
  });
  it('keeps the supplied simulation and navigation actions inside the canvas, with Review still in the summary', () => {
    const simulate = vi.fn();
    const html = renderToStaticMarkup(createElement(SimulateWorkspace, { workflowName: 'My strategy', returnToBuild: vi.fn(), reviewActionHost: vi.fn(), simulateAction: createElement('button', { onClick: simulate }, 'Simulate workflow') }));
    expect(html.indexOf('Simulate workflow')).toBeGreaterThan(html.indexOf('simulation-workspace-actions'));
    expect(html.indexOf('Simulate workflow')).toBeLessThan(html.indexOf('aria-label="Simulation Summary"'));
    expect(html.indexOf('Back to Build')).toBeLessThan(html.indexOf('aria-label="Simulation Summary"'));
    expect(html.indexOf('Back to Build')).toBeLessThan(html.indexOf('Simulate workflow'));
    expect(html.indexOf('simulation-review-action')).toBeGreaterThan(html.indexOf('aria-label="Simulation Summary"'));
    expect(simulate).not.toHaveBeenCalled();
  });
});
