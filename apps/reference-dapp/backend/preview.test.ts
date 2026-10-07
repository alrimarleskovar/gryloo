// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createLogger, HttpError, type Database } from '@defi-workflow-engine/cloud-runtime';
import { createBackend } from './app.ts';
import { PREVIEW_METHODS, previewStorage } from './preview.ts';

const quiet = createLogger({ service: 'test', sink: () => undefined });
const untouchable = { query: async () => { throw new Error('DB_TOUCHED'); }, close: async () => undefined } as unknown as Database;
const enc = (text: string) => new TextEncoder().encode(text);

describe('BUILD-MCP-001 read-only flow previews', () => {
  it('the per-call run log keeps the durable store contract and is never shared', async () => {
    const storage = previewStorage(), other = previewStorage();
    expect(await storage.log.read('run.jsonl')).toBeNull();
    await storage.log.extend('run.jsonl', enc('a\n'), () => undefined);
    await expect(storage.log.extend('run.jsonl', enc('b\n'), () => undefined)).rejects.toThrow('JOURNAL_CORRUPT');
    await expect(storage.log.extend('run.jsonl', enc('a\nb\n'), () => { throw new Error('ROUTER_STORE_CORRUPT'); })).rejects.toThrow('ROUTER_STORE_CORRUPT');
    await storage.log.extend('run.jsonl', enc('a\nb\n'), () => undefined);
    expect(await storage.log.create('run.jsonl', enc('x'))).toBe(false);
    expect(new TextDecoder().decode((await storage.log.read('run.jsonl'))!)).toBe('a\nb\n');
    expect(await other.log.read('run.jsonl')).toBeNull();
    await expect(storage.log.read('../escape')).rejects.toThrow('STORAGE_NAME_INVALID');
    expect(await storage.leases.hold('key', async () => storage.leases.hold('key', async () => 'nested'))).toBe('nested');
  });

  it('serves POST /v1/previews/:flow with strict validation; flows without a preview and disabled flows fail closed', async () => {
    const backend = createBackend({ db: untouchable, env: {}, logger: quiet, tenantId: 'default', holderId: 'test', evidenceStore: null });
    const route = backend.routes.find(r => r.name === 'preview')!;
    const call = async (flow: string, body: unknown) => {
      const path = `/v1/previews/${flow}`, match = route.pattern.exec(path);
      if (!match) return 'NO_ROUTE';
      try { return (await route.handler({ method: 'POST', path, query: new URLSearchParams(), headers: {}, body, requestId: 'r' }, match)).body; }
      catch (error) { if (error instanceof HttpError) return `HTTP_${error.status}_${error.message}`; throw error; }
    };
    expect(await call('crosschain-router-testnet', { args: [{ workflowId: 'w', nodes: [] }, '0x' + '1'.repeat(40)] })).toEqual({ ok: false, code: 'ROUTER_TESTNET_NOT_ENABLED' });
    expect(await call('crosschain-router-testnet', { args: [{ workflowId: 'w', nodes: [] }] })).toBe('HTTP_400_ARGUMENTS_INVALID');
    expect(await call('crosschain-router-testnet', { args: [], extra: 1 })).toBe('HTTP_400_ARGUMENTS_INVALID');
    expect(await call('crosschain-router-testnet', null)).toBe('HTTP_400_ARGUMENTS_INVALID');
    expect(await call('robinhood-transfer', { args: [] })).toEqual({ ok: false, code: 'PREVIEW_NOT_AVAILABLE' });
    expect(await call('orca-liquidity', { args: [] })).toEqual({ ok: false, code: 'PREVIEW_NOT_AVAILABLE' });
    expect(await call('no-such-flow', { args: [] })).toBe('HTTP_404_FLOW_NOT_FOUND');
    // Previews never use a mutating/authorizing method: only the flows' own simulate (or the swap's prepare).
    expect(new Set(Object.values(PREVIEW_METHODS))).toEqual(new Set(['simulate', 'prepare']));
  });
});
