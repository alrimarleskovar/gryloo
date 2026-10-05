// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { initialEditor, editorReducer } from '../domain/editor';
import { initialChainState, chainReducer } from '../domain/artifact-chain';
import { generationEligibility } from '../domain/mock-artifacts';
import { SimulatePanel } from './simulate-panel';

const fixture = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof import('../state/workflow-store').useWorkflow> }));
vi.mock('../state/workflow-store', () => ({ useWorkflow: () => fixture.store }));
vi.mock('./workflow-canvas', () => ({ WorkflowCanvas: ({ primaryAction }: { primaryAction?: ReactNode }) =>
  createElement('div', { 'aria-label': 'simulation graph fixture' }, primaryAction) }));

beforeEach(() => {
  const state = initialEditor(), context = createBaseSepoliaReviewContext();
  fixture.store = { state, context, chain: initialChainState(), eligibility: generationEligibility(state.workflow, context),
    generateArtifacts: vi.fn(), refreshArtifacts: vi.fn(), accessCheck: vi.fn() } as unknown as typeof fixture.store;
});
function render() {
  const returnToBuild = vi.fn();
  const html = renderToStaticMarkup(createElement(SimulatePanel, { returnToBuild }, createElement('div', {}, 'Existing diagnostic panels')));
  expect(returnToBuild).not.toHaveBeenCalled();
  expect(fixture.store.generateArtifacts).not.toHaveBeenCalled();
  expect(fixture.store.refreshArtifacts).not.toHaveBeenCalled();
  return html;
}
describe('Simulate control presentation', () => {
  it('removes the upper informational strip/toggle and retains technical access below the graph', () => {
    const html = render();
    expect(html).not.toMatch(/simulate-details-toggle|Show technical details|Hide technical details/);
    expect(html).not.toMatch(/>SIMULATE<|<h2>Simulation<\/h2>/);
    expect(html).toMatch(/aria-label="simulation graph fixture"><button type="button">Return to Build<\/button>/);
    expect(html.indexOf('Add a Base swap')).toBeGreaterThan(html.indexOf('simulation-technical'));
    expect(html.indexOf('simulation-technical')).toBeGreaterThan(html.indexOf('simulate-grid'));
    expect(html).toContain('Existing diagnostic panels');
    expect(html).toMatch(/disabled="">Generate mocked artifacts for revision 0/);
    expect(html).toContain('USD values: not modeled.');
  });

  it('retains generation eligibility, current revision and the pending-generation gate', () => {
    fixture.store.state = editorReducer(initialEditor(), { type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '2', slippage: '50', source: 'CHAT', baseRevision: 0 }, fixture.store.context);
    fixture.store.eligibility = generationEligibility(fixture.store.state.workflow, fixture.store.context);
    expect(fixture.store.eligibility.eligible).toBe(true);
    expect(render()).toMatch(/<button type="button">Generate mocked artifacts for revision 1/);
    fixture.store.chain = chainReducer(initialChainState(), { type: 'GENERATE_STARTED', workflow: fixture.store.state.workflow, generation: 1 });
    expect(render()).toMatch(/disabled="">Generate mocked artifacts for revision 1/);
  });

  it('preserves hashing rejection feedback without generating or exposing values', () => {
    fixture.store.chain = { ...initialChainState(), rejected: 'DIGEST_UNAVAILABLE' };
    const html = render();
    expect(html).toContain('Artifact hashing self-check failed (DIGEST_UNAVAILABLE). No mocked artifacts were generated.');
    expect(html).not.toContain('data-mocked-value');
  });
});
