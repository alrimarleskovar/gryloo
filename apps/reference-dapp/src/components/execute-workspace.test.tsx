// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExecuteWorkspace, type ExecuteWorkspaceProps } from './execute-workspace';
import { reviewFixture, reviewNow, reviewSpender } from '../test-utils/review-fixture';
import { projectExecutionLifecycle, type ExecutionLifecycleSource } from '../domain/execution-lifecycle';
import { canvasAddCommand } from '../domain/canvas-authoring';
import { editorReducer, initialEditor } from '../domain/editor';
vi.mock('./simulate-workflow-canvas', () => ({ SimulateWorkflowCanvas: ({ workflowName, stage, primaryAction }: { workflowName: string; stage: string; primaryAction: ReactNode }) => createElement('section', { 'aria-label': stage === 'execute' ? 'Execution plan' : 'Workflow simulation' }, workflowName, primaryAction) }));
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(reviewNow); });
afterEach(() => vi.useRealTimers());
function fixture(): ExecuteWorkspaceProps {
  const data = reviewFixture(); data.authorization.accepted = true;
  return { ...data, workflowName: 'Approved strategy', execution: { ready: true, started: false, start: vi.fn(), prompt: 'Confirm the next transaction in your wallet.', expiresAt: null, requiresMainnetAcknowledgement: false }, backToBuild: vi.fn(), backToSimulate: vi.fn() };
}
const render = (data = fixture()) => renderToStaticMarkup(createElement(ExecuteWorkspace, data));
describe('Execute product workspace', () => {
  it('renders a read-only plan, compact shared wallet summary and one explicit primary action', () => {
    const data = fixture(), html = render(data);
    for (const value of ['Approved strategy', 'Execution plan', 'Execution Summary', '0x1111…1111', 'Base Sepolia', 'Testnet', 'Reviewed and approved', 'What happens next']) expect(html).toContain(value);
    expect(html).not.toMatch(/disabled="">Execute workflow/); expect(data.execution.start).not.toHaveBeenCalled();
    expect(html.match(/>Execute workflow</g)).toHaveLength(1);
    expect(html).not.toMatch(/Advanced Settings|Undo|Redo|Token selector|Execution limits|Strategy Manifest|schemaVersion|digest|canonical|mock|payload/);
    expect(html).toContain('Back to Build'); expect(html).toContain('Back to Simulate');
    expect(html).not.toContain('execution-authorization-attention');
    expect(html).not.toMatch(/execute-heading|>EXECUTE<|Run your workflow|Check the plan and connected wallet before starting/);
  });
  it.each(['pending', 'blocked', 'expired', 'wallet', 'network', 'unknown', 'started', 'loading'] as const)('shows %s in-place with a genuinely disabled CTA', state => {
    const data = fixture();
    if (state === 'pending') data.authorization.accepted = false;
    if (state === 'blocked') data.execution.ready = false;
    if (state === 'expired') vi.setSystemTime(reviewNow + 120_001);
    if (state === 'wallet') { data.wallet.account = reviewSpender; data.wallet.changed = true; }
    if (state === 'network') { data.wallet.chain = 'eip155:42161'; data.wallet.environment = 'mainnet'; }
    if (state === 'unknown') { data.wallet.chain = null; data.wallet.environment = 'unknown'; }
    if (state === 'started') data.execution.started = true;
    if (state === 'loading') Object.assign(data.source.state, { busy: 'journal_request_id' });
    const html = render(data); expect(html).not.toMatch(/(?<!disabled="")>Execute workflow<\/button>/); expect(data.execution.start).not.toHaveBeenCalled();
    const expected = state === 'pending' ? 'Approve &amp; Continue' : state === 'loading' ? 'Simulating workflow…' : ['expired', 'wallet', 'network', 'unknown'].includes(state) ? 'Simulate again' : 'Execute workflow';
    expect(html).toContain(expected);
    if (state === 'blocked' || state === 'started') expect(html).toMatch(/disabled="">Execute workflow/);
    if (['pending', 'expired', 'wallet', 'network'].includes(state)) expect(html).toContain('execution-authorization-attention');
    if (state === 'expired') expect(html).toContain('Simulate again');
    if (state === 'wallet') expect(html).toContain('0x2222…2222');
    if (state === 'network') { expect(html).toContain('Arbitrum'); expect(html).toContain('Mainnet'); }
    if (state === 'unknown') { expect(html).toContain('Unknown network'); expect(html).not.toContain('Mainnet'); }
    if (state === 'loading') { expect(html).toContain('Preparing execution…'); expect(html).not.toContain('journal_request_id'); }
  });
  it('keeps existing technical execution panels secondary and collapsed', () => {
    const html = render({ ...fixture(), technicalDetails: createElement('pre', null, 'journal sequence') });
    expect(html).toContain('<summary>View technical details</summary>'); expect(html).not.toMatch(/<details[^>]* open/);
    expect(html.indexOf('Execute workflow')).toBeLessThan(html.indexOf('journal sequence'));
  });
  it('counts composed actions from the shared workflow without adding transaction steps', () => {
    const data = fixture(); data.workflow = editorReducer(initialEditor(), canvasAddCommand('lending', 0, data.wallet.account!, '1'), data.context).workflow;
    const html = render(data); expect(html).toContain('<dt>Actions</dt><dd>3</dd>'); expect(html).not.toMatch(/class="primary">Execute workflow/);
  });
});

describe('live execution workspace', () => {
  function live(state: string, approval = false): ExecuteWorkspaceProps {
    const data = fixture(), hash = '0x' + 'a'.repeat(64);
    const source = { ...data.source, state: { ...data.source.state, run: { ...('run' in data.source.state ? data.source.state.run : {}), attempts: [{ step: approval ? 'approval' : 'swap', state, txHash: ['HASH', 'PENDING', 'CONFIRMED'].includes(state) ? hash : null }] } } } as unknown as ExecutionLifecycleSource;
    return { ...data, progress: projectExecutionLifecycle(data.workflow, data.context, source), execution: { ...data.execution, started: true, check: vi.fn() } };
  }
  it.each(['PENDING', 'CONFIRMED', 'REVERTED', 'UNKNOWN'] as const)('shows %s from recorded state without offering another initial Execute', state => {
    const data = live(state), html = render(data);
    expect(html).toContain('Workflow step progression'); expect(html).not.toContain('>Execute workflow<'); expect(data.execution.start).not.toHaveBeenCalled();
    if (state === 'PENDING') { expect(html).toContain('Pending confirmation'); expect(html).toContain('Check confirmation'); expect(html).toContain('0xaaaaaa…aaaaaa'); }
    if (state === 'CONFIRMED') {
      expect(html).toContain('Execution completed'); expect(html).toContain('Result Summary');
      expect(html).toContain('<dt>Steps confirmed</dt><dd>1 of 1</dd>');
      expect(html).toContain('CURRENT RUN RESULT'); expect(html).toContain('Current run · Read-only');
      expect(html).toContain('>Planned</span>'); expect(html).not.toContain('Actual output');
    }
    if (state === 'REVERTED') expect(html).toContain('Execution failed');
    if (state === 'UNKNOWN') { expect(html).toContain('Execution status uncertain'); expect(html).toContain('Execution status unresolved'); expect(html).not.toContain('Execution completed'); expect(html).not.toContain('Check confirmation'); }
    expect(html).not.toMatch(/journal|canonical|artifact|nonce record|raw receipt/);
  });
  it('shows real approval as a separate request with the swap still waiting', () => {
    const html = render(live('PENDING', true)); expect(html).toContain('Wallet setup · Approve USDC'); expect(html).toContain('>Swap</span><strong>Waiting');
    expect(html).toContain('0 of 1 completed');
  });
  it('retains navigation without implying cancellation and exposes an explicit next action', () => {
    const data = live('CONFIRMED', true); data.authorization.ready = false; data.execution.next = vi.fn(); data.execution.nextLabel = 'Continue to swap';
    const html = render(data); expect(html).toContain('>Continue to swap</button>'); expect(html).not.toMatch(/disabled="">Continue to swap/);
    expect(html).toContain('Back to Build'); expect(html).toContain('Back to Simulate'); expect(data.execution.next).not.toHaveBeenCalled();
    data.wallet.changed = true; expect(render(data)).not.toContain('>Continue to swap</button>');
  });
  it('gives the available status check primary emphasis without a disabled progress action', () => {
    const data = live('PENDING'), html = render(data);
    expect(html).toContain('class="primary">Check confirmation</button>');
    expect(html).not.toContain('>Execution in progress</button>');
    expect(html).toContain('Leaving this view does not cancel submitted requests.');
    expect(data.execution.check).not.toHaveBeenCalled(); expect(data.execution.start).not.toHaveBeenCalled();
  });
  it('retains explicit local controls with recorded progress when the shared wallet start is unavailable', () => {
    const data = live('PENDING');
    data.source = { kind: 'unavailable', state: { busy: false, error: null } };
    data.technicalDetails = createElement('button', { onClick: data.execution.start }, 'Check local order status');
    const html = render(data);
    expect(html).toContain('Check local order status');
    expect(html).toContain('<summary>View technical details</summary>');
    expect(html).not.toMatch(/<details[^>]* open|>Execute workflow</);
    expect(data.execution.start).not.toHaveBeenCalled();
    expect(data.execution.check).not.toHaveBeenCalled();
  });
  it('does not advertise fresh authorization or stale review requirements during checking', () => {
    const data = live('PENDING'); data.authorization.key = null; data.authorization.accepted = false;
    data.recovery = { action: 'observe', checking: true, recordOnly: false, operationId: 'swap', label: 'Checking execution status…', message: 'Checking the saved request.', contextIssue: null, check: vi.fn() };
    const html = render(data);
    expect(html).toContain('Checking execution status…');
    expect(html).not.toContain('<dt>Authorization</dt>'); expect(html).not.toContain('Run a valid simulation before approving');
    expect(html).toContain('data-lifecycle-action="status">Reconciling…</span>');
    expect(html).not.toMatch(/>Execute workflow<|>Continue to|>Retry<|Ready to execute/);
    expect(data.recovery.check).not.toHaveBeenCalled();
  });
  it('preserves the execution wallet alongside a changed connected wallet and existing evidence', () => {
    const data = live('PENDING'); data.wallet.account = reviewSpender; data.wallet.changed = true;
    data.progress!.evidence = { operations: {}, wallet: reviewFixture().wallet.account, knownCosts: [], details: [], limitations: [], attention: [] };
    const html = render(data);
    expect(html).toContain('<dt>Connected wallet</dt>'); expect(html).toContain('<dt>Execution wallet</dt>');
    expect(html).toContain('0x1111…1111'); expect(html).toContain('0x2222…2222'); expect(html).toContain('0xaaaaaa…aaaaaa');
    expect(html).not.toMatch(/>Execute workflow<|>Continue to|>Retry</);
  });
  it('retains a wallet-specific instruction from an actual signing state', () => {
    const data = fixture(), fixtureData = reviewFixture();
    const source = { kind: 'supply', state: { signing: true, busy: true, recovered: false, record: {
      id: 'supply-wallet-request', provenance: 'PUBLIC_TESTNET', review: { workflow: fixtureData.workflow, chain: fixtureData.wallet.chain, account: fixtureData.wallet.account },
      attempts: [{ step: 'SUPPLY', state: 'SUBMITTING', transactionHash: null, reconciled: false }],
    } } } as unknown as ExecutionLifecycleSource;
    data.progress = projectExecutionLifecycle(data.workflow, data.context, source); data.execution.started = true;
    const html = render(data);
    expect(html).toContain('Waiting for wallet…'); expect(html).toContain('Confirm or decline the reviewed request in your wallet.');
    expect(html).toContain('Confirm in wallet'); expect(html).not.toMatch(/>Continue to|>Execute workflow<|>Execution in progress<|>Retry</);
  });
});

it('places the ordered Execute action pair inside the canvas and keeps the summary informational', () => {
  const data = fixture(), html = render(data), summary = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
  const canvas = html.slice(html.indexOf('aria-label="Execution plan"'), html.indexOf('<aside'));
  expect(canvas).toContain('>Back to Build</button>'); expect(canvas).toContain('>Execute workflow</button>');
  expect(canvas.indexOf('Back to Build')).toBeLessThan(canvas.indexOf('Execute workflow'));
  expect(summary).not.toContain('>Execute workflow</button>'); expect(data.execution.start).not.toHaveBeenCalled();
});

it('shows restored recovery in-place, with an explicit read-only check and no initial execution', () => {
  const data = fixture(), f = reviewFixture();
  const progressSource = { ...f.source, state: { ...f.source.state, recoveryOnly: true, run: { ...('run' in f.source.state ? f.source.state.run : {}), attempts: [{ step: 'approval', state: 'CONFIRMED', txHash: '0x' + 'a'.repeat(64) }, { step: 'swap', state: 'PENDING', txHash: '0x' + 'b'.repeat(64) }] } } } as unknown as ExecutionLifecycleSource;
  data.progress = projectExecutionLifecycle(f.workflow, f.context, progressSource);
  data.execution.started = true;
  data.recovery = { action: 'observe', checking: false, recordOnly: false, operationId: 'swap', label: 'Current execution restored', message: 'The recorded execution is preserved.', contextIssue: 'Wallet changed. Connect the wallet used for this execution before continuing.', check: vi.fn() };
  const html = render(data);
  expect(html).toContain('Current execution restored'); expect(html).toContain('Wallet changed'); expect(html).toContain('>Recover execution</button>');
  expect(html).not.toMatch(/>Execute workflow<|>Retry<|>Try again<|Ready to execute/);
  expect(data.recovery.check).not.toHaveBeenCalled(); expect(data.execution.start).not.toHaveBeenCalled();
  data.progress.planUnavailable = true;
  expect(render(data)).toContain('The original workflow details are unavailable in this saved run.');
  data.recovery.checking = true;
  expect(render(data)).toContain('data-lifecycle-action="status">Reconciling…'); expect(render(data)).toContain('Checking execution status…');
});
