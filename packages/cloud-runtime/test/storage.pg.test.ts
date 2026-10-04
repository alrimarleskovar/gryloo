// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSchemaCurrent, createPostgresLeaseStore, createPostgresLogStore, loadMigrations, migrate, type Database, type Projector } from '../src/index.js';
import { bytes, createTestDatabase, text, type TestDatabase } from './pg-harness.js';

const lines = (validateLine: (line: string) => void = () => undefined) => (value: Uint8Array) => {
  const content = new TextDecoder('utf-8', { fatal: true }).decode(value);
  if (!content.endsWith('\n')) throw new Error('NOT_LINES');
  for (const line of content.trimEnd().split('\n')) validateLine(line);
};

describe('BUILD-CLOUD-001 migrations', () => {
  let t: TestDatabase;
  beforeAll(async () => { t = await createTestDatabase({ migrated: false }); });
  afterAll(async () => { await t.drop(); });
  it('apply on a clean database, are idempotent, serialize concurrent runners and detect tampering', async () => {
    await expect(assertSchemaCurrent(t.db)).rejects.toThrow('SCHEMA_NOT_MIGRATED');
    const runners = [t.open(2), t.open(2), t.open(2)];
    const applied = await Promise.all(runners.map(db => migrate(db)));
    const all = await loadMigrations();
    expect(applied.flat().sort()).toEqual(all.map(m => m.version));
    expect(await migrate(t.db)).toEqual([]);
    expect(await assertSchemaCurrent(t.db)).toBe(all.length);
    const { rows } = await t.db.query<{ tenant_id: string }>('SELECT tenant_id FROM tenants');
    expect(rows.map(r => r.tenant_id)).toEqual(['default']);
    await t.db.query(`UPDATE schema_migrations SET sha256 = repeat('0', 64) WHERE version = 1`);
    await expect(assertSchemaCurrent(t.db)).rejects.toThrow('MIGRATION_HISTORY_MISMATCH');
    await expect(migrate(t.db)).rejects.toThrow('MIGRATION_HISTORY_MISMATCH');
  });
});

describe('BUILD-CLOUD-001 PostgreSQL execution log store', () => {
  let t: TestDatabase, db: Database;
  beforeAll(async () => { t = await createTestDatabase(); db = t.db; await db.query(`INSERT INTO tenants (tenant_id) VALUES ('tenant-b')`); });
  afterAll(async () => { await t.drop(); });
  const store = (namespace = 'ns', tenantId = 'default', projector?: Projector) => createPostgresLogStore({ db, tenantId, namespace, ...projector ? { projector } : {} });

  it('round-trips exact bytes, enforces strict extension and rejects a stale writer', async () => {
    const log = store();
    expect(await log.read('run-1.jsonl')).toBeNull();
    await log.extend('run-1.jsonl', bytes('a\n'), lines());
    await log.extend('run-1.jsonl', bytes('a\nb\n'), lines());
    expect(text(await log.read('run-1.jsonl'))).toBe('a\nb\n');
    expect((await log.readVersioned('run-1.jsonl'))?.version).toBe(2);
    // A writer that read version 1 computes 'a\nc\n': not an extension of the current bytes.
    await expect(log.extend('run-1.jsonl', bytes('a\nc\n'), lines())).rejects.toThrow('JOURNAL_CORRUPT');
    await expect(log.extend('run-1.jsonl', bytes('a\n'), lines())).rejects.toThrow('JOURNAL_CORRUPT');
    await expect(log.extend('run-1.jsonl', bytes('a\nb\n'), lines())).rejects.toThrow('JOURNAL_CORRUPT');
    expect(text(await log.read('run-1.jsonl'))).toBe('a\nb\n');
  });
  it('explicit CAS: a stale expected version fails even with valid bytes', async () => {
    const log = store();
    expect(await log.extendAt('cas.jsonl', 0, bytes('x\n'), lines())).toBe(1);
    expect(await log.extendAt('cas.jsonl', 1, bytes('x\ny\n'), lines())).toBe(2);
    await expect(log.extendAt('cas.jsonl', 1, bytes('x\ny\nz\n'), lines())).rejects.toThrow('EXECUTION_VERSION_CONFLICT');
    expect(text(await log.read('cas.jsonl'))).toBe('x\ny\n');
  });
  it('concurrent writers from separate pools: exactly one extension wins', async () => {
    const log = store(), other = createPostgresLogStore({ db: t.open(4), tenantId: 'default', namespace: 'ns' });
    await log.extend('race.jsonl', bytes('a\n'), lines());
    const outcomes = await Promise.allSettled([
      log.extend('race.jsonl', bytes('a\nb\n'), lines()), other.extend('race.jsonl', bytes('a\nc\n'), lines()),
      log.extend('race.jsonl', bytes('a\nd\n'), lines()), other.extend('race.jsonl', bytes('a\ne\n'), lines())]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(text(await log.read('race.jsonl'))!.split('\n').filter(Boolean)).toHaveLength(2);
  });
  it('exclusive creation holds across connections (economic intent identity)', async () => {
    const pools = [store(), createPostgresLogStore({ db: t.open(8), tenantId: 'default', namespace: 'ns' })];
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => pools[i % 2]!.create('0xabc-7.intent', bytes(`{"id":"run-${i}"}\n`))));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(text(await store().read('0xabc-7.intent'))).toMatch(/^\{"id":"run-\d+"\}\n$/);
  });
  it('rolls back the whole write when validation or projection fails', async () => {
    const log = store('ns', 'default', (name, value) => { if (text(value)!.includes('poison')) throw new Error('boom'); return null; });
    await log.extend('rollback.jsonl', bytes('ok\n'), lines());
    await expect(log.extend('rollback.jsonl', bytes('ok\nbad\n'), lines(line => { if (line === 'bad') throw new Error('invalid'); }))).rejects.toThrow('JOURNAL_CORRUPT');
    await expect(log.extend('rollback.jsonl', bytes('ok\npoison\n'), lines())).rejects.toThrow('JOURNAL_WRITE_FAILED');
    const version = await log.readVersioned('rollback.jsonl');
    expect(version?.version).toBe(1);
    const segments = await db.query(`SELECT count(*)::int AS n FROM execution_log_segments WHERE name = 'rollback.jsonl'`);
    expect(segments.rows[0]).toEqual({ n: 1 });
  });
  it('detects stored corruption and refuses history mutation (append-only trigger)', async () => {
    const log = store();
    await log.extend('tamper.jsonl', bytes('a\n'), lines());
    await expect(db.query(`UPDATE execution_log_segments SET bytes = '\\x780a' WHERE name = 'tamper.jsonl'`)).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
    await expect(db.query(`DELETE FROM execution_log_segments WHERE name = 'tamper.jsonl'`)).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
    // Simulate storage-level corruption by an owner bypassing the trigger: reads fail closed.
    await db.transaction(async tx => {
      await tx.query('ALTER TABLE execution_log_segments DISABLE TRIGGER execution_log_segments_append_only');
      await tx.query(`UPDATE execution_log_segments SET bytes = '\\x780a' WHERE name = 'tamper.jsonl'`);
      await tx.query('ALTER TABLE execution_log_segments ENABLE TRIGGER execution_log_segments_append_only');
    });
    await expect(log.read('tamper.jsonl')).rejects.toThrow('JOURNAL_CORRUPT');
    await expect(log.extend('tamper.jsonl', bytes('x\ny\n'), lines())).rejects.toThrow('JOURNAL_CORRUPT');
  });
  it('isolates tenants and namespaces completely', async () => {
    const a = store('ns', 'default'), b = store('ns', 'tenant-b'), otherNamespace = store('other', 'default');
    await a.extend('shared-name.jsonl', bytes('tenant a\n'), lines());
    expect(await b.read('shared-name.jsonl')).toBeNull();
    expect(await otherNamespace.read('shared-name.jsonl')).toBeNull();
    await b.extend('shared-name.jsonl', bytes('tenant b\n'), lines());
    expect(text(await a.read('shared-name.jsonl'))).toBe('tenant a\n');
    expect(text(await b.read('shared-name.jsonl'))).toBe('tenant b\n');
    // Tenant B cannot extend A's log by name: it only ever sees its own bytes.
    await expect(b.extend('shared-name.jsonl', bytes('tenant a\nb\n'), lines())).rejects.toThrow('JOURNAL_CORRUPT');
    await expect(createPostgresLogStore({ db, tenantId: 'unknown', namespace: 'ns' }).extend('x.jsonl', bytes('x\n'), lines())).rejects.toThrow('JOURNAL_WRITE_FAILED');
  });
  it('rejects invalid names and oversized logs before touching storage', async () => {
    await expect(store().extend('../escape', bytes('a\n'), lines())).rejects.toThrow('STORAGE_NAME_INVALID');
    await expect(store().extend('big.jsonl', new Uint8Array(16_777_217), () => undefined)).rejects.toThrow('JOURNAL_CORRUPT');
  });
});

describe('BUILD-CLOUD-001 fenced PostgreSQL leases', () => {
  let t: TestDatabase, db: Database;
  beforeAll(async () => { t = await createTestDatabase(); db = t.db; });
  afterAll(async () => { await t.drop(); });
  const leases = (holderId: string, d = db, ttlMs = 30_000) => createPostgresLeaseStore({ db: d, tenantId: 'default', namespace: 'ns', busyCode: 'TEST_BUSY', holderId, ttlMs });

  it('two workers on separate pools cannot both hold the same key; re-entrant within one context', async () => {
    const one = leases('worker-1'), two = leases('worker-2', t.open(2));
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void; const inside = new Promise<void>(resolve => { entered = resolve; });
    const first = one.hold('run-x', async () => { entered(); await one.hold('run-x', async () => undefined); await gate; return 'first'; });
    await inside;
    await expect(two.hold('run-x', async () => 'second')).rejects.toThrow('TEST_BUSY');
    release();
    expect(await first).toBe('first');
    expect(await two.hold('run-x', async () => 'second')).toBe('second');
    const { rows } = await db.query<{ fence: string }>(`SELECT fence::text AS fence FROM execution_leases WHERE lease_key = 'run-x'`);
    expect(rows[0]?.fence).toBe('2');
  });
  it('an expired holder is fenced out: its writes fail after takeover', async () => {
    const log = createPostgresLogStore({ db, tenantId: 'default', namespace: 'ns' });
    await log.extend('fenced.jsonl', bytes('a\n'), lines());
    const stale = leases('stale-worker'), fresh = leases('fresh-worker', t.open(2));
    let paused!: () => void; const isPaused = new Promise<void>(resolve => { paused = resolve; });
    let resume!: () => void; const resumed = new Promise<void>(resolve => { resume = resolve; });
    const outcome = stale.hold('fenced', async () => {
      // The process pauses past its lease (simulated by expiring it with the database clock) ...
      await db.query(`UPDATE execution_leases SET expires_at = now() - interval '1 second' WHERE lease_key = 'fenced'`);
      paused(); await resumed;
      // ... and later resumes and tries to write: rejected before any byte is stored.
      return log.extend('fenced.jsonl', bytes('a\nfresh\nstale\n'), lines());
    });
    await isPaused;
    // Meanwhile another worker (a separate execution context) legitimately takes over and writes.
    await fresh.hold('fenced', () => log.extend('fenced.jsonl', bytes('a\nfresh\n'), lines()));
    resume();
    await expect(outcome).rejects.toThrow('EXECUTION_LEASE_LOST');
    expect(text(await log.read('fenced.jsonl'))).toBe('a\nfresh\n');
    const { rows } = await db.query<{ fence: string }>(`SELECT fence::text AS fence FROM execution_leases WHERE lease_key = 'fenced'`);
    expect(Number(rows[0]?.fence)).toBe(2);
  });
  it('heartbeats keep a long section alive beyond its TTL', async () => {
    const store = createPostgresLeaseStore({ db, tenantId: 'default', namespace: 'ns', busyCode: 'TEST_BUSY', holderId: 'slow', ttlMs: 1_000, heartbeatMs: 200 });
    const log = createPostgresLogStore({ db, tenantId: 'default', namespace: 'ns' });
    await store.hold('slow', async () => {
      await new Promise(resolve => setTimeout(resolve, 2_500));
      await log.extend('slow.jsonl', bytes('done\n'), lines());
    });
    expect(text(await log.read('slow.jsonl'))).toBe('done\n');
  });
});
