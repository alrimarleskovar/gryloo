// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from '../domain/editor';
import { savedWorkflowHash, validateSavedWorkflow } from '../domain/saved-workflow';
import type { BuildEstimate, BuildEstimateResult } from '../domain/build-estimate';
import { deferred, HookHarness } from '../test-utils/hook-harness';
import { useBuildEstimate } from './build-estimate';
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await import('../test-utils/hook-harness')).hookMocks }));
const now = new Date('2026-10-08T12:00:00Z');
const authored = (amount = '2') => validateSavedWorkflow(editorReducer(initialEditor(), { type: 'ADD_TESTNET_SWAP', direction: 'USDC_TO_WETH', amount, slippage: '50', source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext()).workflow);
const estimate = (workflow = authored(), extra: Partial<BuildEstimate> = {}): BuildEstimate => ({ workflowHash: savedWorkflowHash(workflow), nodeId: 'node-002', chain: 'eip155:84532', provider: 'Uniswap V3', expected: '0.001', minimum: '0.000995', symbol: 'WETH', slippageBps: 50, expiresAt: new Date(now.getTime() + 1000).toISOString(), ...extra });
let host: HookHarness, transport: ReturnType<typeof vi.fn>;
beforeEach(() => { host = new HookHarness(); vi.useFakeTimers(); vi.setSystemTime(now); transport = vi.fn(); vi.stubGlobal('fetch', transport); });
afterEach(() => { host.unmount(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const response = (value: BuildEstimateResult) => ({ json: async () => value });
describe('Build estimate snapshot, freshness and provider binding', () => {
  it('publishes a matching success, sends an AbortSignal and clears at exact expiry', async () => {
    const workflow = authored(), value = estimate(workflow); transport.mockResolvedValue(response({ ok: true, estimate: value }));
    const read = () => host.render(() => useBuildEstimate(workflow, 'node-002', 'owner'));
    expect(read()).toBeNull(); await vi.advanceTimersByTimeAsync(350); expect(read()).toEqual(value);
    expect(transport.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(transport.mock.calls[0]![1].body)).toEqual({ workflow, nodeId: 'node-002', owner: 'owner' });
    await vi.advanceTimersByTimeAsync(650); expect(read()).toBeNull();
  });
  it.each([{ workflowHash: 'wrong' }, { nodeId: 'another' }, { chain: 'eip155:11155111' }, { provider: 'Jupiter' }, { expiresAt: now.toISOString() }])('rejects a mismatched or expired response %j', async extra => {
    const workflow = authored(); transport.mockResolvedValue(response({ ok: true, estimate: estimate(workflow, extra) }));
    const read = () => host.render(() => useBuildEstimate(workflow, 'node-002'));
    read(); await vi.advanceTimersByTimeAsync(350); expect(read()).toBeNull();
  });
  it('aborts an older snapshot and prevents its late completion overwriting the newer estimate', async () => {
    const old = deferred<ReturnType<typeof response>>(), first = authored(), second = authored('3'); let workflow = first;
    transport.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response({ ok: true, estimate: estimate(second) }));
    const read = () => host.render(() => useBuildEstimate(workflow, 'node-002'));
    read(); await vi.advanceTimersByTimeAsync(350); workflow = second; expect(read()).toBeNull();
    expect(transport.mock.calls[0]![1].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(350); expect(read()?.workflowHash).toBe(savedWorkflowHash(second));
    old.resolve(response({ ok: true, estimate: estimate(first) })); await vi.advanceTimersByTimeAsync(0);
    expect(read()?.workflowHash).toBe(savedWorkflowHash(second));
  });
  it.each(['owner', 'node'] as const)('hides the prior estimate immediately when its %s binding changes', async change => {
    const workflow = authored(); let owner = 'owner-one', nodeId = 'node-002';
    transport.mockResolvedValue(response({ ok: true, estimate: estimate(workflow) }));
    const read = () => host.render(() => useBuildEstimate(workflow, nodeId, owner));
    read(); await vi.advanceTimersByTimeAsync(350); expect(read()).not.toBeNull();
    if (change === 'owner') owner = 'owner-two'; else nodeId = 'another-node';
    expect(read()).toBeNull();
  });
  it('returns no value after failure or timeout and aborts on unmount', async () => {
    const workflow = authored(); transport.mockRejectedValueOnce(Error('offline')).mockReturnValue(new Promise(() => {}));
    const read = () => host.render(() => useBuildEstimate(workflow, 'node-002'));
    read(); await vi.advanceTimersByTimeAsync(350); expect(read()).toBeNull();
    host.unmount(); host = new HookHarness(); read(); await vi.advanceTimersByTimeAsync(15_350);
    expect(read()).toBeNull(); expect(transport.mock.calls.at(-1)![1].signal.aborted).toBe(true);
    host.unmount();
  });
});
