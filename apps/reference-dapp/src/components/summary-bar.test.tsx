// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { initialEditor, editorReducer } from '../domain/editor';
import { canvasAddCommand } from '../domain/canvas-authoring';
import { SummaryBar } from './summary-bar';

const fixture = vi.hoisted(() => ({ state: null as unknown as ReturnType<typeof initialEditor>, supply: { record: null as unknown, retired: false },
  modeA: { info: null as { available: boolean } | null, prepared: null as unknown, retired: false, verifyError: null as string | null, verified: {} as Record<string, boolean> } }));
vi.mock('react-dom', () => ({ createPortal: vi.fn(() => null) }));
vi.mock('../state/workflow-store', () => ({ useWorkflow: () => ({ state: fixture.state }) }));
vi.mock('../state/mode-a-store', () => ({ useModeA: () => fixture.modeA }));
vi.mock('../state/mode-b-store', () => ({ useModeB: () => ({ info: null }) }));
vi.mock('../state/public-testnet-store', () => ({ usePublicTestnet: () => ({ run: null }) }));
vi.mock('../state/supply-store', () => ({ useSupply: () => fixture.supply }));
vi.mock('../state/lending-store', () => ({ useLending: () => ({ record: null }) }));
vi.mock('../state/robinhood-transfer-store', () => ({ useRobinhoodTransfer: () => ({ record: null }) }));
vi.mock('../state/jupiter-store', () => ({ useJupiter: () => ({ record: null }) }));
vi.mock('../state/solana-liquidity-store', () => ({ useSolanaLiquidity: () => ({ record: null }) }));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.state = initialEditor(); fixture.supply = { record: null, retired: false };
  fixture.modeA = { info: null, prepared: null, retired: false, verifyError: null, verified: {} };
});
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
    fixture.state = editorReducer(initialEditor(), canvasAddCommand('supply', 0, '0x1111111111111111111111111111111111111111', '1'), createBaseSepoliaReviewContext());
    fixture.supply.record = ready ? { review: {} } : null;
    const setTab = vi.fn();
    const html = renderToStaticMarkup(createElement(SummaryBar, { tab: 'Simulate', setTab }));
    expect(html).toContain('Review Supply');
    expect(html.includes('disabled=""')).toBe(!ready);
    expect(setTab).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'unprepared', 'retired', 'verification error', 'unverified approval', 'unverified swap', 'ready'])('preserves swap review eligibility in the canvas: %s', condition => {
    fixture.modeA = { info: { available: true }, prepared: {}, retired: false, verifyError: null, verified: { 'step-approve': true, 'step-swap': true } };
    if (condition === 'unavailable') fixture.modeA.info = null;
    if (condition === 'unprepared') fixture.modeA.prepared = null;
    if (condition === 'retired') fixture.modeA.retired = true;
    if (condition === 'verification error') fixture.modeA.verifyError = 'Payload verification failed';
    if (condition === 'unverified approval') fixture.modeA.verified['step-approve'] = false;
    if (condition === 'unverified swap') fixture.modeA.verified['step-swap'] = false;
    const simulationActionHost = {} as HTMLDivElement, setTab = vi.fn();
    const html = renderToStaticMarkup(createElement(SummaryBar, { tab: 'Simulate', setTab, simulationActionHost }));
    expect(html).not.toContain('Review swap');
    expect(createPortal).toHaveBeenCalledTimes(1);
    const [action, host] = vi.mocked(createPortal).mock.calls[0]!;
    expect(host).toBe(simulationActionHost);
    const button = action as ReactElement<{ children: string; disabled: boolean; onClick: () => void }>;
    expect(button.props.children).toBe('Review swap');
    expect(button.props.disabled).toBe(condition !== 'ready');
    expect(setTab).not.toHaveBeenCalled();
    if (condition === 'ready') {
      button.props.onClick();
      expect(setTab).toHaveBeenCalledExactlyOnceWith('Execute');
    }
  });

  it('retains footer actions when no simulation canvas is mounted and on Execute', () => {
    const setTab = vi.fn();
    expect(renderToStaticMarkup(createElement(SummaryBar, { tab: 'Simulate', setTab }))).toMatch(/disabled="">Review swap/);
    expect(renderToStaticMarkup(createElement(SummaryBar, { tab: 'Execute', setTab, simulationActionHost: {} as HTMLDivElement }))).toContain('Back to Build');
    expect(createPortal).not.toHaveBeenCalled();
    expect(setTab).not.toHaveBeenCalled();
  });
});
