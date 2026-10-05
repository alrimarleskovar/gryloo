// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-PARITY-001 tenant isolation of shared infrastructure: deployment-scoped tenants, tenant-scoped work claims and
 * sweeps, and the filesystem-free schema check used by serverless functions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSchemaCurrent, createPostgresWorkQueue, ensureTenant, SHIPPED_MIGRATIONS, sweep } from '../src/index.js';
import { createTestDatabase, type TestDatabase } from './pg-harness.js';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });

describe('BUILD-CLOUD-PARITY-001 deployment tenants', () => {
  it('ensureTenant is idempotent, concurrency-safe and validates the identifier', async () => {
    await Promise.all(Array.from({ length: 6 }, () => ensureTenant(t.db, 'pv-feature-a-0123abcd')));
    const { rows } = await t.db.query(`SELECT count(*)::int AS n FROM tenants WHERE tenant_id = 'pv-feature-a-0123abcd'`);
    expect(rows[0]).toEqual({ n: 1 });
    for (const bad of ['', 'UPPER', '-leading', 'x'.repeat(64), "a'; DROP TABLE tenants; --"]) await expect(ensureTenant(t.db, bad)).rejects.toThrow('TENANT_ID_INVALID');
  });
  it('the shipped manifest verifies a migrated schema without reading migration files', async () => {
    expect(await assertSchemaCurrent(t.db, SHIPPED_MIGRATIONS)).toBe(SHIPPED_MIGRATIONS.length);
    await expect(assertSchemaCurrent(t.db, SHIPPED_MIGRATIONS.slice(0, -1))).rejects.toThrow('MIGRATION_HISTORY_MISMATCH');
    await expect(assertSchemaCurrent(t.db, [...SHIPPED_MIGRATIONS, { version: 99, name: 'future', sha256: '0'.repeat(64) }])).rejects.toThrow('SCHEMA_NOT_MIGRATED');
  });
});

describe('BUILD-CLOUD-PARITY-001 tenant-scoped work', () => {
  it('a tenant-scoped queue claims only its tenant; an unscoped queue (tests, one-tenant hosts) still claims every tenant', async () => {
    await ensureTenant(t.db, 'pv-a'); await ensureTenant(t.db, 'pv-b');
    const scopedA = createPostgresWorkQueue({ db: t.db, ownerId: 'worker-a', tenantId: 'pv-a' });
    const scopedB = createPostgresWorkQueue({ db: t.db, ownerId: 'worker-b', tenantId: 'pv-b' });
    for (const tenant of ['pv-a', 'pv-b', 'pv-b']) await scopedA.enqueue(tenant, 'reconcile', `flow:${tenant}:${Math.random()}`, null);
    const a = await scopedA.claim(10);
    expect(a.map(item => item.tenantId)).toEqual(['pv-a']);
    expect(await scopedA.claim(10)).toEqual([]);
    const b = await scopedB.claim(10);
    expect(b.map(item => item.tenantId)).toEqual(['pv-b', 'pv-b']);
    await scopedA.enqueue('pv-b', 'reconcile', 'flow:late', null);
    const unscoped = createPostgresWorkQueue({ db: t.db, ownerId: 'worker-any' });
    expect((await unscoped.claim(10)).map(item => item.tenantId)).toEqual(['pv-b']);
  });
  it('a tenant-scoped sweep re-arms only its own runs', async () => {
    await ensureTenant(t.db, 'pv-sweep-a'); await ensureTenant(t.db, 'pv-sweep-b');
    for (const tenant of ['pv-sweep-a', 'pv-sweep-b']) {
      await t.db.query(`INSERT INTO execution_logs (tenant_id, namespace, name, kind, version, segment_count, byte_length, content_sha256)
        VALUES ($1, 'aave-supply', 'run-1.jsonl', 'RUN', 1, 1, 1, repeat('0', 64))`, [tenant]);
      await t.db.query(`INSERT INTO workflows (tenant_id, workflow_id) VALUES ($1, 'wf')`, [tenant]);
      await t.db.query(`INSERT INTO execution_runs (tenant_id, run_id, namespace, log_name, workflow_id, flow, status, provenance, needs_observation, has_evidence, log_version)
        VALUES ($1, 'run-1', 'aave-supply', 'run-1.jsonl', 'wf', 'aave-supply', 'PENDING', 'MOCKED', true, false, 1)`, [tenant]);
    }
    expect(await sweep(t.db, { tenantId: 'pv-sweep-a' })).toEqual({ reconcile: 1, evidence: 0 });
    const { rows } = await t.db.query<{ tenant_id: string }>(`SELECT tenant_id FROM work_items WHERE kind = 'reconcile' AND tenant_id LIKE 'pv-sweep-%'`);
    expect(rows.map(row => row.tenant_id)).toEqual(['pv-sweep-a']);
  });
});
