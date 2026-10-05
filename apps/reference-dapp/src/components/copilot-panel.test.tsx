// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialEditor } from '../domain/editor';
import { CopilotPanel } from './copilot-panel';

const proposal = vi.hoisted(() => ({ propose: vi.fn(), applyProposal: vi.fn(), dismissProposal: vi.fn() }));
vi.mock('../state/workflow-store', () => ({ useWorkflow: () => ({ state: initialEditor(), pending: null, ...proposal }) }));
vi.mock('../state/build009-wallet-store', () => ({ useBuild009Wallet: () => ({ account: null }) }));

describe('Copilot product presentation', () => {
  it('keeps Assistant and Copilot, with a product prompt and no internal guidance', () => {
    const html = renderToStaticMarkup(createElement(CopilotPanel, { showProposal: false }));
    expect(html).toContain('ASSISTANT');
    expect(html).toContain('<h2>Copilot</h2>');
    expect(html).toContain('>Describe your flow</label>');
    expect(html).toContain('Review each proposed change before applying it.');
    // Exclude the legacy input id: it is not visible copy and stays compatible with integrations.
    const visibleCopy = html.replace(/<[^>]*>/g, '');
    expect(visibleCopy).not.toMatch(/GRYLOO|mock|demo|local command|no model|slippage 50 bps|ticks/i);
    expect(proposal.propose).not.toHaveBeenCalled();
    expect(proposal.applyProposal).not.toHaveBeenCalled();
    expect(proposal.dismissProposal).not.toHaveBeenCalled();
  });
});
