// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from '../domain/editor';
import { deferred, HookHarness } from '../test-utils/hook-harness';
import { listWorkflows, openWorkflow, saveWorkflow } from '../app/workflow-action';
import { useSavedWorkflows } from './saved-workflows';
import { validateSavedWorkflow, type SavedWorkflow, type WorkflowOwner } from '../domain/saved-workflow';
import type { FlowResult } from '../server/cloud-api-client';
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await import('../test-utils/hook-harness')).hookMocks }));
vi.mock('../app/workflow-action', () => ({ listWorkflows: vi.fn(), openWorkflow: vi.fn(), saveWorkflow: vi.fn() }));
const owner: WorkflowOwner = { namespace: 'eip155', address: '0x' + 'a'.repeat(40) }, other: WorkflowOwner = { namespace: 'eip155', address: '0x' + 'b'.repeat(40) };
const workflow = validateSavedWorkflow(editorReducer(initialEditor(), { type: 'ADD_TESTNET_SWAP', direction: 'USDC_TO_WETH', amount: '2', slippage: '50', source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext()).workflow);
const saved = (version = 1): SavedWorkflow => ({ workflowId: workflow.workflowId, name: 'My workflow', workflow, revision: workflow.revision, version, createdAt: '2026-10-08T12:00:00Z', updatedAt: '2026-10-08T12:00:00Z' });
let host: HookHarness, who: WorkflowOwner | null;
const read = () => host.render(() => useSavedWorkflows(who));
beforeEach(() => {
  host = new HookHarness(); who = owner;
  vi.mocked(listWorkflows).mockResolvedValue({ ok: true, value: { items: [], hasMore: false } });
  vi.mocked(saveWorkflow).mockResolvedValue({ ok: true, value: saved() });
  vi.mocked(openWorkflow).mockResolvedValue({ ok: true, value: saved(3) });
});
afterEach(() => { host.unmount(); vi.resetAllMocks(); });
describe('saved-workflow client owner/version binding', () => {
  it('creates with version zero and uses the returned version for later saves', async () => {
    read(); await Promise.resolve(); let view = read(); expect(await view.save(workflow, 'My workflow')).toBe(true);
    expect(saveWorkflow).toHaveBeenLastCalledWith(owner, workflow, 'My workflow', 0);
    view = read(); vi.mocked(saveWorkflow).mockResolvedValue({ ok: true, value: saved(2) });
    expect(await view.save(workflow, 'Renamed')).toBe(true); expect(saveWorkflow).toHaveBeenLastCalledWith(owner, workflow, 'Renamed', 1);
  });
  it('reopens the exact document and uses its persisted version', async () => {
    expect(await read().open(workflow.workflowId)).toEqual(saved(3));
    expect(await read().save(workflow, 'Updated')).toBe(true); expect(saveWorkflow).toHaveBeenLastCalledWith(owner, workflow, 'Updated', 3);
  });
  it('reports a stale version conflict without claiming the save succeeded', async () => {
    vi.mocked(saveWorkflow).mockResolvedValue({ ok: false, code: 'WORKFLOW_VERSION_CONFLICT' });
    expect(await read().save(workflow, 'Stale')).toBe(false); expect(read().error).toBe('WORKFLOW_VERSION_CONFLICT');
  });
  it('blocks duplicate in-flight saves and ignores completion after an owner change', async () => {
    const pending = deferred<FlowResult<SavedWorkflow>>(); vi.mocked(saveWorkflow).mockReturnValue(pending.promise);
    const view = read(), first = view.save(workflow, 'First'); expect(await view.save(workflow, 'Duplicate')).toBe(false);
    who = other; read(); pending.resolve({ ok: true, value: saved() }); expect(await first).toBe(false);
    expect(saveWorkflow).toHaveBeenCalledOnce(); expect(read().error).toBeNull();
  });
  it('hides previous-owner lists and discards late list/open results', async () => {
    const pending = deferred<Awaited<ReturnType<typeof listWorkflows>>>(); vi.mocked(listWorkflows).mockReturnValueOnce(pending.promise);
    read(); who = other; read(); await Promise.resolve();
    pending.resolve({ ok: true, value: { items: [{ workflowId: 'secret', name: 'Other owner', saved: true, version: 1, updatedAt: '', runCount: 0, lastRunId: null, lastStatus: null, hasEvidence: false }], hasMore: false } });
    await Promise.resolve(); expect(read().list?.items).toEqual([]);
    const opening = deferred<Awaited<ReturnType<typeof openWorkflow>>>(); vi.mocked(openWorkflow).mockReturnValueOnce(opening.promise);
    const result = read().open(workflow.workflowId); who = owner; read(); opening.resolve({ ok: true, value: saved() }); expect(await result).toBeNull();
  });
  it('refuses saves without an owner and rejects a mismatched opened workflow', async () => {
    who = null; expect(await read().save(workflow, 'Anonymous')).toBe(false); expect(saveWorkflow).not.toHaveBeenCalled();
    who = owner; vi.mocked(openWorkflow).mockResolvedValue({ ok: true, value: { ...saved(), workflowId: 'wrong-id' } });
    expect(await read().open(workflow.workflowId)).toBeNull(); expect(read().error).toBe('WORKFLOW_UNAVAILABLE');
  });
});
