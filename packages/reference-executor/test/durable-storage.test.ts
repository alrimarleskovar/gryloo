// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileExecutionStorage, createFileLogStore, logMissing, reentrantLeases, reserveEconomicIntentIn, type LeaseStore } from '../src/index.js';
import type { SupplyTransaction } from '@defi-workflow-engine/reference-compiler';

const encode = (text: string) => new TextEncoder().encode(text);
const lines = (bytes: Uint8Array) => { if (!new TextDecoder().decode(bytes).endsWith('\n')) throw new Error('bad'); };

describe('BUILD-CLOUD-001 file implementations of the storage ports keep the original layout', () => {
  it('log store: original paths and modes, null for missing, strict extension, exclusive create', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flofi-port-')), log = createFileLogStore(join(dir, 'journal'));
    try {
      expect(await log.read('run.jsonl')).toBeNull();
      await log.extend('run.jsonl', encode('a\n'), lines);
      await log.extend('run.jsonl', encode('a\nb\n'), lines);
      expect(await readFile(join(dir, 'journal', 'run.jsonl'), 'utf8')).toBe('a\nb\n');
      await expect(log.extend('run.jsonl', encode('a\nc\n'), lines)).rejects.toThrow('JOURNAL_CORRUPT');
      expect(await Promise.all([log.create('owner-7.intent', encode('x\n')), log.create('owner-7.intent', encode('y\n'))])).toEqual([true, false]);
      expect(await readFile(join(dir, 'journal', 'owner-7.intent'), 'utf8')).toBe('x\n');
      expect((await stat(join(dir, 'journal', 'owner-7.intent'))).mode & 0o777).toBe(0o600);
      expect((await stat(join(dir, 'journal'))).mode & 0o777).toBe(0o700);
      await expect(log.read('../escape')).rejects.toThrow('STORAGE_NAME_INVALID');
      expect(() => createFileLogStore('relative/dir')).toThrow('STORAGE_DIRECTORY_INVALID');
      expect(logMissing('x.jsonl')).toMatchObject({ code: 'ENOENT' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('lease store: PID lock directory, BUSY for a live owner, re-entrant in one context, released afterwards', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flofi-lease-')), { leases } = createFileExecutionStorage(dir, 'TEST_BUSY');
    try {
      let seen: string[] = [];
      await leases.hold('run-1', async () => {
        seen = await readdir(dir);
        expect(await readFile(join(dir, 'run-1.lock', 'pid'), 'utf8')).toBe(String(process.pid));
        await leases.hold('run-1', async () => undefined);                     // nested same key: no self-deadlock
        await expect(createFileExecutionStorage(dir, 'TEST_BUSY').leases.hold('run-1', async () => undefined)).rejects.toThrow('TEST_BUSY');
      });
      expect(seen).toContain('run-1.lock');
      expect(await readdir(dir)).not.toContain('run-1.lock');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('reentrantLeases only bypasses the inner store for a key already held in the same async context', async () => {
    const calls: string[] = [];
    const inner: LeaseStore = { hold: async (key, action) => { calls.push(key); return action(); } };
    const outer = reentrantLeases(inner);
    await outer.hold('a', () => outer.hold('a', () => outer.hold('b', async () => undefined)));
    await outer.hold('a', async () => undefined);
    expect(calls).toEqual(['a', 'b', 'a']);
  });
  it('economic intent reservation through the port: same id idempotent, different id observation-only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'flofi-intent-')), log = createFileLogStore(dir);
    const tx = { chainId: 84532, from: '0x' + '1'.repeat(40), to: '0x' + '2'.repeat(40), data: '0x', value: '0' } as unknown as SupplyTransaction;
    try {
      await reserveEconomicIntentIn(log, tx, 'supply-a');
      await reserveEconomicIntentIn(log, tx, 'supply-a');
      await expect(reserveEconomicIntentIn(log, tx, 'supply-b')).rejects.toThrow('ECONOMIC_EXISTING_INTENT_OBSERVE_ONLY');
      await reserveEconomicIntentIn(log, tx, 'supply-c', 'supply-a');
      const [file] = (await readdir(dir)).filter(name => name.startsWith('economic-'));
      expect((await readFile(join(dir, file!), 'utf8')).trim().split('\n').map(line => (JSON.parse(line) as { id: string }).id)).toEqual(['supply-a', 'supply-c']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
