// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HookHarness, deferred } from '../test-utils/hook-harness';
import { reviewFixture, reviewNow } from '../test-utils/review-fixture';
import { useExecutionControls, type ExecutionControlsState } from './execution-controls';

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await import('../test-utils/hook-harness')).hookMocks }));
let host: HookHarness, props: ExecutionControlsState;
const read = () => host.render(() => useExecutionControls(props));
beforeEach(() => {
  host = new HookHarness(); vi.useFakeTimers(); vi.setSystemTime(reviewNow);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  vi.stubGlobal('document', new EventTarget());
  props = { ...reviewFixture(), execution: { ready: true, started: false, start: vi.fn(), prompt: null, expiresAt: null, requiresMainnetAcknowledgement: false } };
  props.authorization.accepted = true;
});
afterEach(() => { host.unmount(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('shared Canvas execution controls', () => {
  it('retains the submission lock across clicks and stage rerenders until recorded state changes', () => {
    const pending = deferred<void>(); props.execution.start = vi.fn(() => pending.promise);
    read().request(false); read().request(false);
    props = { ...props }; read().request(false);
    expect(props.execution.start).toHaveBeenCalledTimes(1); expect(read().requesting).toBe(true);
    Object.assign(props.source.state, { busy: true }); read();
    Object.assign(props.source.state, { busy: false }); expect(read().requesting).toBe(false);
  });
  it('rechecks expiry at the click boundary without asking the wallet', () => {
    const controls = read(); vi.setSystemTime(reviewNow + 120001); controls.request(false);
    expect(props.execution.start).not.toHaveBeenCalled();
  });
  it('unlocks a rejected request without automatically retrying it', async () => {
    props.execution.start = vi.fn(async () => { throw Error('WALLET_REFUSED'); });
    read().request(false); await Promise.resolve(); await Promise.resolve();
    expect(read().requestFailed).toBe(true); expect(read().requesting).toBe(false);
    expect(props.execution.start).toHaveBeenCalledTimes(1);
  });
  it('finishes a synchronous observation check and never submits a financial request', async () => {
    props.progress = { started: true, restored: true, local: false, steps: [], active: null, completed: 0,
      label: 'Recovered', message: '', state: 'uncertain', runKey: 'recorded', fingerprint: 'recorded', busy: false };
    props.recovery = { action: 'observe', checking: false, recordOnly: false, operationId: null,
      label: 'Recovered', message: '', contextIssue: null, check: vi.fn() };
    read().checkStatus(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(read().verifying).toBe(false); expect(props.recovery.check).toHaveBeenCalledTimes(1);
    expect(props.execution.start).not.toHaveBeenCalled();
  });
});
