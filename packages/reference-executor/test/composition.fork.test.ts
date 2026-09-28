// SPDX-License-Identifier: AGPL-3.0-only
/** Real chain-31337 gate plus durable fail-closed worker restart; no send occurs. */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCompositionWorker, type CompositionWorkerDriver, type CompositionWorkerJob } from '../src/composition.js';
const profilePath = process.env.GRYLOO_COMPOSITION_SMOKE_PROFILE;
describe('composition worker on closed local fork', () => {
  it.skipIf(!profilePath)('persists four levels and refuses missing direct Roles authority across restart', async () => {
    const profile = JSON.parse(readFileSync(profilePath!, 'utf8')) as { rpcUrl: string; chainId: number };
    let sends = 0, id = 0;
    const chainId = async () => {
      const response = await fetch(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'eth_chainId', params: [] }),
        signal: AbortSignal.timeout(20_000) });
      const body = await response.json() as { result?: string };
      return Number(BigInt(body.result!));
    };
    expect(profile.chainId).toBe(31337);
    expect(await chainId()).toBe(31337);
    const driver = { chainId, now: async () => 1, permissionActive: async () => false,
      allowanceRemaining: async () => 0n, sendExact: async () => { sends++; throw new Error('SEND_FORBIDDEN'); },
      receipt: async () => null, reconcileSwap: async () => ({ outcome: 'INCONCLUSIVE' as const }),
      reconcileMint: async () => ({ outcome: 'INCONCLUSIVE' as const }) } satisfies CompositionWorkerDriver;
    const job = { executionId: 'exec-' + '1'.repeat(24), compiled: {
      permissionHash: '0x' + '2'.repeat(64), swapCall: { to: '0x' + '3'.repeat(40), data: '0x12345678', value: '0x0' },
    }, terms: {}, executor: '0x' + '4'.repeat(40), expiresAt: 2 } as unknown as CompositionWorkerJob;
    const path = join(mkdtempSync(join(tmpdir(), 'gryloo-composition-worker-fork-')), 'journal.jsonl');
    const first = await createCompositionWorker(path, job, driver).run();
    expect(first.state).toBe('INCONCLUSIVE');
    expect(first.reason).toBe('AUTHORITY_CHANGED');
    const rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line) as { level: string });
    expect(rows.map(row => row.level)).toEqual(['WORKFLOW', 'SEGMENT', 'STEP', 'ATTEMPT', 'ATTEMPT']);
    const restart = await createCompositionWorker(path, job, driver).run();
    expect(restart).toEqual(first);
    expect(sends).toBe(0);
  });
});
