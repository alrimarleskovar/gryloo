// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionTimeline } from './execution-timeline';
import { projectExecutionLifecycle, type ExecutionLifecycleSource } from '../domain/execution-lifecycle';
import { projectExecutionResult } from '../domain/execution-result';
import { projectExecutionStepEvidence } from '../domain/execution-step-evidence';
import { projectExecutionEvidence } from '../domain/execution-evidence';
import { ExecutionEvidenceDetails } from './execution-evidence-details';
import { reviewFixture } from '../test-utils/review-fixture';

function render(state = 'CONFIRMED', outcome: unknown = null, restored = false) {
  const fixture = reviewFixture();
  const source = { ...fixture.source, state: { ...fixture.source.state, recoveryOnly: restored,
    run: { ...('run' in fixture.source.state ? fixture.source.state.run : {}), outcome, attempts: [{ step: 'swap', state, txHash: null }] },
  } } as unknown as ExecutionLifecycleSource;
  const progress = projectExecutionLifecycle(fixture.workflow, fixture.context, source);
  progress.stepEvidence = projectExecutionStepEvidence(source, progress);
  const backToBuild = vi.fn();
  const html = renderToStaticMarkup(createElement(ExecutionTimeline, { progress, result: projectExecutionResult(progress), workflowName: 'Approved swap', backToBuild }));
  return { html, backToBuild };
}
describe('per-step result presentation in the execution timeline', () => {
  it('shows the recorded step outcome read-only, without simulated actual values or new execution actions', () => {
    const { html, backToBuild } = render();
    expect(html).toContain('Swap result evidence'); expect(html).toContain('Step outcome'); expect(html).toContain('>Confirmed</strong>');
    expect(html).not.toMatch(/Planned and actual values|Reconciled|Recovered|Retry|<input|<select|Actual output/);
    expect(backToBuild).not.toHaveBeenCalled();
  });
  it('shows an actual comparison only when execution evidence supplies both sides', () => {
    const { html } = render('CONFIRMED', { evidence: { outcome: 'RECONCILED' }, inputSpent: '100000000', outputReceived: '24300000000000000' });
    for (const text of ['Reconciled', 'Planned and actual values', '>Planned</span>', '>Actual</span>', '0.025 WETH', '0.0243 WETH']) expect(html).toContain(text);
    expect(html).not.toMatch(/Actual network fee|View transaction/);
  });
  it('labels restored data without claiming uncertainty recovery occurred', () => {
    const { html } = render('CONFIRMED', null, true);
    expect(html).toContain('This step’s saved result was restored.'); expect(html).not.toContain('>Recovered<');
  });
  it('keeps unresolved per-step evidence separate from a confirmed result', () => {
    const { html } = render('UNKNOWN');
    expect(html).toContain('>Unresolved</strong>'); expect(html).toContain('FloFi has not yet confirmed the final state of this step.');
    expect(html).not.toMatch(/>Confirmed<|>Reconciled<|Planned and actual values|Retry/);
  });
  it('uses product language for a recorded request that was not submitted', () => {
    const fixture = reviewFixture();
    const source = { kind: 'supply', state: { record: { id: 'not-submitted', provenance: 'PUBLIC_TESTNET',
      review: { workflow: fixture.workflow, chain: fixture.wallet.chain }, notSubmitted: true,
      attempts: [{ step: 'SUPPLY', state: 'CANCELLED', transactionHash: null, reconciled: false }],
    } } } as unknown as ExecutionLifecycleSource;
    const progress = projectExecutionLifecycle(fixture.workflow, fixture.context, source);
    const html = renderToStaticMarkup(createElement(ExecutionTimeline, { progress, result: projectExecutionResult(progress), workflowName: 'Not submitted', backToBuild: vi.fn() }));
    expect(html).toContain('This request was recorded as not submitted.');
    expect(html).not.toMatch(/runtime|journal|Retry|View transaction/);
  });
  it('renders real identifiers and full technical records while retaining approval/action separation', () => {
    const fixture = reviewFixture(), a = '0x' + 'a'.repeat(64), b = '0x' + 'b'.repeat(64);
    const current = { ...fixture.source, state: { ...fixture.source.state, run: { ...('run' in fixture.source.state ? fixture.source.state.run : {}), attempts: [{ step: 'approval', state: 'CONFIRMED', txHash: a }, { step: 'swap', state: 'REVERTED', txHash: b }] } } } as unknown as ExecutionLifecycleSource;
    const progress = projectExecutionLifecycle(fixture.workflow, fixture.context, current);
    progress.evidence = projectExecutionEvidence(current, progress);
    const html = renderToStaticMarkup(createElement(ExecutionTimeline, { progress, result: projectExecutionResult(progress), workflowName: 'Run', backToBuild: vi.fn() }));
    expect(html).toContain('Approval transaction'); expect(html).toContain('Action transaction'); expect(html).toContain('Transaction reverted');
    expect(html).toContain(`title="${b}"`); expect(html).toContain('0xbbbbbb…bbbbbb'); expect(html).not.toMatch(/Retry|Known network cost|Actual received/);
    const technical = renderToStaticMarkup(createElement(ExecutionEvidenceDetails, { progress }));
    expect(technical).toContain(`>${b}</span>`); expect(technical).not.toContain('<pre');
  });
});
