// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workflowOperation } from './workflow-persistence';
import { embeddedRuntime } from './flow-runtime';
import type { WorkflowOwner } from '../domain/saved-workflow';
vi.mock('./flow-runtime', async original => ({ ...await original<typeof import('./flow-runtime')>(), embeddedRuntime: vi.fn() }));
const evm: WorkflowOwner = { namespace: 'eip155', address: '0x' + 'a'.repeat(40) };
const solana: WorkflowOwner = { namespace: 'solana', address: 'So11111111111111111111111111111111111111112' };
afterEach(() => vi.resetAllMocks());
describe('saved-workflow signed-session boundary', () => {
  it.each([evm, solana])('refuses an unproven owner %j before any runtime/transport', async owner => {
    const transport = vi.fn();
    expect(await workflowOperation('list', [], owner, { principals: async () => [], env: { API_BASE_URL: 'https://cloud.example/' }, transport })).toEqual({ ok: false, code: 'WALLET_SESSION_REQUIRED' });
    expect(transport).not.toHaveBeenCalled(); expect(embeddedRuntime).not.toHaveBeenCalled();
  });
  it.each([evm, solana])('forwards the verified namespace to embedded persistence %j', async owner => {
    const callWorkflows = vi.fn().mockResolvedValue({ ok: true, value: { items: [], hasMore: false } });
    vi.mocked(embeddedRuntime).mockResolvedValue({ backend: { callWorkflows } } as unknown as Awaited<ReturnType<typeof embeddedRuntime>>);
    const env = { FLOFI_RUNTIME: 'embedded', DATABASE_URL: 'postgres://test-only' };
    expect((await workflowOperation('list', [], owner, { principals: async () => [owner], env })).ok).toBe(true);
    expect(callWorkflows).toHaveBeenCalledExactlyOnceWith('list', [], owner); expect(embeddedRuntime).toHaveBeenCalledExactlyOnceWith(env);
  });
  it.each([evm, solana])('uses cloud persistence, owner headers and idempotency for %j', async owner => {
    const transport = vi.fn().mockResolvedValue(Response.json({ ok: true, value: { version: 1 } }));
    await workflowOperation('save', [{ expectedVersion: 0 }], owner, { principals: async () => [owner], env: { API_BASE_URL: 'https://cloud.example/api/', API_AUTH_TOKEN: 'test-token' }, transport });
    expect(transport.mock.calls[0]![0].href).toBe('https://cloud.example/api/v1/workflows/save');
    expect(transport.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer test-token', 'x-flofi-workflow-owner': `${owner.namespace}:${owner.address}`, 'idempotency-key': expect.any(String) } });
    expect(embeddedRuntime).not.toHaveBeenCalled();
  });
  it('fails closed when durable persistence is unconfigured', async () => {
    expect(await workflowOperation('list', [], evm, { principals: async () => [evm], env: {} })).toEqual({ ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' });
  });
  it('reports failed transport without fabricating saved documents', async () => {
    expect(await workflowOperation('get', ['wf'], evm, { principals: async () => [evm], env: { API_BASE_URL: 'https://cloud.example/' }, transport: vi.fn().mockRejectedValue(Error('offline')) })).toEqual({ ok: false, code: 'WORKFLOW_UNAVAILABLE' });
  });
});
