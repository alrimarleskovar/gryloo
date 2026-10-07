// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { canvasAddCommand } from '../domain/canvas-authoring';
import { editorReducer, initialEditor } from '../domain/editor';
import { WorkflowEditReview, workflowProposalSummary } from './workflow-edit-review';
import { CopilotPanel } from './copilot-panel';
import { proposalReviewPosition } from './proposal-review-position';

const fixture = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof import('../state/workflow-store').useWorkflow> }));
vi.mock('../state/workflow-store', () => ({ useWorkflow: () => fixture.store }));
vi.mock('../state/build009-wallet-store', () => ({ useBuild009Wallet: () => ({ account: null }) }));
// This unit checks presentation; interpreter behavior is covered by its dedicated suites.
vi.mock('./copilot-ai', async importOriginal => ({ ...await importOriginal<typeof import('./copilot-ai')>(),
  useCopilotInterpreter: () => ({ mode: 'off', enabled: false, busy: false, mayInterpret: false, reset: vi.fn() }) }));
const context = createBaseSepoliaReviewContext();
const owner = '0x1111111111111111111111111111111111111111';
const command = canvasAddCommand('lending', 0, owner);

beforeEach(() => {
  fixture.store = { state: initialEditor(), context, pending: { valid: true, command, diff: ['Technical details stay out of this summary'], review: null },
    applyProposal: vi.fn(), dismissProposal: vi.fn(), propose: vi.fn() } as unknown as typeof fixture.store;
});

describe('contextual workflow proposals', () => {
  it('projects one real three-step proposal without changing workflow/revision or including technical payload', () => {
    const before = fixture.store.state;
    const presentation = workflowProposalSummary(before, command, context);
    expect(presentation).toMatchObject({ summary: 'Supply → Borrow → Swap', current: true });
    expect(presentation.detail).toContain('Supply 0.1 USDC');
    expect(presentation.detail).toContain('Borrow 0.01 USDC');
    expect(presentation.detail).not.toContain(owner);
    expect(before.workflow.revision).toBe(0);
    expect(before.workflow.nodes).toHaveLength(1);
  });
  it('renders a keyboard reachable artifact closed initially, with no approval controls or bottom panel', () => {
    const html = renderToStaticMarkup(createElement(WorkflowEditReview));
    expect(html).toContain('aria-label="Review proposed change: Supply → Borrow → Swap"');
    expect(html).toContain('aria-haspopup="dialog" aria-expanded="false"');
    expect(html).toContain('>Proposed</span>');
    expect(html).not.toMatch(/role="dialog"|Review proposed edit|Apply proposal|Dismiss proposal|workflow-edit-review|Technical details/);
    expect(fixture.store.applyProposal).not.toHaveBeenCalled();
    expect(fixture.store.dismissProposal).not.toHaveBeenCalled();
  });
  it('removes the artifact when there is no pending proposal', () => {
    fixture.store.pending = null;
    expect(renderToStaticMarkup(createElement(WorkflowEditReview))).toBe('');
  });
  it('keeps existing validated amount acceptance on its card, without a duplicate workflow acceptance', () => {
    fixture.store.pending = { ...fixture.store.pending!, authoringId: 'action-setup-1', authoringAmount: '0.1' };
    expect(renderToStaticMarkup(createElement(WorkflowEditReview))).toBe('');
    fixture.store.state = editorReducer(initialEditor(), command, context);
    const single = canvasAddCommand('lending', 1, owner);
    if (single.type !== 'AUTHOR_LENDING') throw new Error('Expected lending command');
    fixture.store.pending = { valid: true, command: { ...single, input: { ...single.input, supply: '0.2' } }, diff: [], review: null };
    expect(renderToStaticMarkup(createElement(WorkflowEditReview))).toBe('');
  });
  it('rejects a stale preview and leaves existing acceptance eligibility authoritative', () => {
    fixture.store.state = editorReducer(initialEditor(), command, context);
    const presentation = workflowProposalSummary(fixture.store.state, command, context);
    expect(presentation).toMatchObject({ summary: 'Workflow change', current: false });
    expect(fixture.store.state.workflow.revision).toBe(1);
  });
  it('summarizes a single real added Swap and its amount/direction', () => {
    const swap = { type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '2', slippage: '50', baseRevision: 0, source: 'CHAT' } as const;
    expect(workflowProposalSummary(initialEditor(), swap, context)).toMatchObject({ summary: 'Swap', current: true });
    expect(workflowProposalSummary(initialEditor(), swap, context).detail).toContain('2 USDC');
  });
  it('does not retain a second approval interface in Copilot', () => {
    const html = renderToStaticMarkup(createElement(CopilotPanel));
    expect(html).toContain('Copilot');
    expect(html).not.toMatch(/Review proposed edit|Apply proposal|Dismiss proposal|class="proposal"/);
    expect(fixture.store.applyProposal).not.toHaveBeenCalled();
  });
});

describe('collision-aware proposal positioning', () => {
  it('prefers above the actual artifact when space is available', () => {
    const result = proposalReviewPosition({ x: 400, y: 300, width: 180, height: 54 }, { width: 280, height: 150 }, { x: 20, y: 20, width: 900, height: 500 });
    expect(result).toMatchObject({ x: 350, y: 142, score: 0 });
  });
  it.each([320, 375, 768, 1024, 1440])('stays within a %ipx canvas and clear of navigator/CTA', width => {
    const bounds = { x: 16, y: 120, width: width - 32, height: 400 };
    const anchor = { x: width - 192, y: 136, width: 160, height: 56 };
    const size = { width: Math.min(280, bounds.width), height: 150 };
    const obstacles = [{ x: width / 2 - 74, y: 430, width: 148, height: 38 }, { x: width - 148, y: 470, width: 116, height: 44 }];
    const result = proposalReviewPosition(anchor, size, bounds, obstacles);
    expect(result.score).toBe(0);
    expect(result.x).toBeGreaterThanOrEqual(bounds.x);
    expect(result.y).toBeGreaterThanOrEqual(bounds.y);
    expect(result.x + result.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(result.y + result.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  });
});
