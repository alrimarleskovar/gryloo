// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { initialEditor, editorReducer } from '../domain/editor';
import { canvasAddCommand } from '../domain/canvas-authoring';
import { SummaryBar } from './summary-bar';

const fixture = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof initialEditor>, supply: { record: null as unknown, retired: false } }));
vi.mock('../state/workflow-store', () => ({ useWorkflow: () => ({ state: fixture.state }) }));
vi.mock('../state/mode-a-store', () => ({ useModeA: () => ({ info: null, prepared: null, verified: {} }) }));
vi.mock('../state/mode-b-store', () => ({ useModeB: () => ({ info: null }) }));
vi.mock('../state/public-testnet-store', () => ({ usePublicTestnet: () => ({ run: null }) }));
vi.mock('../state/supply-store', () => ({ useSupply: () => fixture.supply }));
vi.mock('../state/lending-store', () => ({ useLending: () => ({ record: null }) }));
vi.mock('../state/robinhood-transfer-store', () => ({ useRobinhoodTransfer: () => ({ record: null }) }));
vi.mock('../state/jupiter-store', () => ({ useJupiter: () => ({ record: null }) }));
vi.mock('../state/solana-liquidity-store', () => ({ useSolanaLiquidity: () => ({ record: null }) }));

beforeEach(() => { fixture.state = initialEditor(); fixture.supply = { record: null, retired: false }; });
describe('footer after Build CTA relocation', () => {
  it('retains workflow revision/count without a duplicate Build button', () => {
    const setTab = vi.fn();
    const html = renderToStaticMarkup(createElement(SummaryBar, { tab: 'Build', setTab }));
    expect(html).toContain('data-workflow-revision="0"');
    expect(html).toContain('0 actions');
    expect(html).not.toMatch(/<button|Simular Fees|Continue to Simulate/);
    expect(setTab).not.toHaveBeenCalled();
  });

  it.each([false, true])('preserves the Supply review gate when a simulation record exists=%s', ready => {
    fixture.state = editorReducer(initialEditor(), canvasAddCommand('supply', 0, '0x1111111111111111111111111111111111111111'), createBaseSepoliaReviewContext());
    fixture.supply.record = ready ? { review: {} } : null;
    const setTab = vi.fn();
    const html = renderToStaticMarkup(createElement(SummaryBar, { tab: 'Simulate', setTab }));
    expect(html).toContain('Review Supply');
    expect(html.includes('disabled=""')).toBe(!ready);
    expect(setTab).not.toHaveBeenCalled();
  });
});
