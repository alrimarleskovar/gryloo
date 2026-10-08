// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: migration 0008 in the shipped sequence. A database at 0005, 0006 or 0007 reaches the current schema with the
 * normal runner (0008 after BUILD-DEVELOPER-001's 0007, gapless); 0008 creates only channel tables and leaves every earlier table —
 * columns, constraints, indexes — exactly as it was; a second run applies nothing; and an edited 0008 is refused.
 */
import { describe, expect, it } from 'vitest';
import { assertSchemaCurrent, loadMigrations, migrate, SHIPPED_MIGRATIONS, type Database } from '@defi-workflow-engine/cloud-runtime';
import { createTestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';

const CHANNEL_TABLES = ['channel_audit', 'channel_conversations', 'channel_events', 'channel_outbox'];
/** Every column, constraint and index of the public schema, per table: what a migration may or may not have changed. */
async function shape(db: Database): Promise<Record<string, string[]>> {
  const rows = (await db.query<{ table_name: string; item: string }>(`
    SELECT table_name::text, 'column ' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS item
      FROM information_schema.columns WHERE table_schema = 'public'
    UNION ALL SELECT conrelid::regclass::text, 'constraint ' || conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace AND conrelid <> 0
    UNION ALL SELECT tablename::text, 'index ' || indexname || ' ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
    UNION ALL SELECT event_object_table::text, 'trigger ' || trigger_name || ' ' || action_timing || ' ' || event_manipulation
      FROM information_schema.triggers WHERE trigger_schema = 'public'`)).rows;
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.table_name] ??= []).push(r.item);
  for (const items of Object.values(out)) items.sort();
  return out;
}

describe('BUILD-CHANNELS-001 migration 0008 (shipped)', () => {
  it('follows 0007 in the gapless shipped sequence and is pinned', async () => {
    const all = await loadMigrations();
    expect(all.map(m => [m.version, m.name]).slice(-2)).toEqual([[8, 'saved_workflows'], [9, 'channel_conversations']]);
    expect(SHIPPED_MIGRATIONS.at(-1)).toEqual({ version: 9, name: 'channel_conversations', sha256: all.at(-1)!.sha256 });
  });

  for (const from of [5, 6, 7, 8]) {
    it(`upgrades a database at ${String(from).padStart(4, '0')} to the current schema`, async () => {
      const t = await createTestDatabase({ migrated: false });
      try {
        const all = await loadMigrations();
        await migrate(t.db, all.slice(0, from));
        await expect(assertSchemaCurrent(t.db, SHIPPED_MIGRATIONS)).rejects.toThrow('SCHEMA_NOT_MIGRATED');
        const before = await shape(t.db);
        expect(Object.keys(before).filter(name => name.startsWith('channel_'))).toEqual([]);
        expect(await migrate(t.db, all)).toEqual(all.slice(from).map(m => m.version));
        expect(await assertSchemaCurrent(t.db, SHIPPED_MIGRATIONS)).toBe(9);
        expect(await migrate(t.db, all)).toEqual([]);
        const after = await shape(t.db);
        expect(Object.keys(after).filter(name => name.startsWith('channel_')).sort()).toEqual(CHANNEL_TABLES);
        if (from === 8) {
          // 0008 is additive: every table that existed at 0007 is unchanged.
          for (const [table, items] of Object.entries(before)) expect(after[table], table).toEqual(items);
          expect(Object.keys(after).filter(name => !(name in before)).sort()).toEqual(CHANNEL_TABLES);
        }
      } finally { await t.drop(); }
    });
  }

  it('refuses a database whose recorded 0008 differs from the shipped file', async () => {
    const t = await createTestDatabase();
    try {
      await t.db.query(`UPDATE schema_migrations SET sha256 = $1 WHERE version = 9`, ['0'.repeat(64)]);
      await expect(migrate(t.db)).rejects.toThrow('MIGRATION_HISTORY_MISMATCH');
      await expect(assertSchemaCurrent(t.db, SHIPPED_MIGRATIONS)).rejects.toThrow();
    } finally { await t.drop(); }
  });
});
