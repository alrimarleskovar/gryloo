// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: migration 0010 in the shipped sequence. A database at 0009 (with live handoffs and a channel conversation)
 * reaches the current schema with the normal runner; 0010 is additive — every earlier table keeps its columns, constraints, indexes and
 * triggers except the two intended changes (the handoff requester-kind CHECK gains AUTOMATION_RULE; channel conversations gain
 * `retain_until`); existing rows survive; a second run applies nothing; an edited 0010 is refused. The database itself enforces the
 * automation invariants: CONFIRM_EACH_TIME only, immutable rule definitions, versioned rebinds, forward-only states, immutable occurrences, one
 * occurrence per trigger key.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertSchemaCurrent, loadMigrations, migrate, SHIPPED_MIGRATIONS, type Database } from '@defi-workflow-engine/cloud-runtime';
import { createTestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';

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
const AUTOMATION_TABLES = ['automation_evaluations', 'automation_link_codes', 'automation_notification_targets', 'automation_notifications', 'automation_occurrences',
  'automation_rules'];
const id = (prefix: string) => `${prefix}_${randomBytes(16).toString('hex').replace(/[^a-z2-7]/g, 'a').slice(0, 26)}`;
const OWNER = '0x' + 'c3'.repeat(20);

describe('BUILD-AUTOMATION-001 migration 0010 (shipped)', () => {
  it('follows 0009 in the gapless shipped sequence and is pinned', async () => {
    const all = await loadMigrations();
    expect(all.map(m => [m.version, m.name]).slice(-2)).toEqual([[9, 'channel_conversations'], [10, 'automations']]);
    expect(SHIPPED_MIGRATIONS.at(-1)).toEqual({ version: 10, name: 'automations', sha256: all.at(-1)!.sha256 });
  });

  it('upgrades a populated 0009 database additively and keeps its rows', async () => {
    const t = await createTestDatabase({ migrated: false });
    try {
      const all = await loadMigrations();
      await migrate(t.db, all.slice(0, 9));
      await t.db.query(`INSERT INTO channel_conversations (tenant_id, conversation_id, channel, business_id, subject_digest) VALUES ('default', $1, 'TELEGRAM', '7000000001', $2)`,
        ['chc_' + 'a'.repeat(26), randomBytes(32)]);
      const before = await shape(t.db);
      expect(await migrate(t.db, all)).toEqual([10]);
      expect(await assertSchemaCurrent(t.db, SHIPPED_MIGRATIONS)).toBe(10);
      expect(await migrate(t.db, all)).toEqual([]);
      const after = await shape(t.db);
      expect(Object.keys(after).filter(name => !(name in before)).sort()).toEqual(AUTOMATION_TABLES);
      for (const [table, items] of Object.entries(before)) {
        const changed = after[table]!.filter(item => !items.includes(item)), removed = items.filter(item => !after[table]!.includes(item));
        if (table === 'mcp_handoffs') {
          expect(removed).toEqual([expect.stringMatching(/^constraint mcp_handoffs_requester_kind_check CHECK .*CHANNEL_CONVERSATION'::text\]\)\)\)$/)]);
          expect(changed).toEqual([expect.stringMatching(/^constraint mcp_handoffs_requester_kind_check CHECK .*'AUTOMATION_RULE'::text\]\)\)\)$/)]);
        } else if (table === 'channel_conversations') {
          expect(removed).toEqual([]);
          expect(changed).toEqual(['column retain_until timestamp with time zone YES ']);
        } else expect([table, changed, removed]).toEqual([table, [], []]);
      }
      expect((await t.db.query('SELECT count(*)::int AS n, bool_and(retain_until IS NULL) AS none FROM channel_conversations')).rows[0]).toEqual({ n: 1, none: true });
    } finally { await t.drop(); }
  });

  it('refuses a database whose recorded 0010 differs from the shipped file', async () => {
    const t = await createTestDatabase();
    try {
      await t.db.query(`UPDATE schema_migrations SET sha256 = $1 WHERE version = 10`, ['0'.repeat(64)]);
      await expect(migrate(t.db)).rejects.toThrow('MIGRATION_HISTORY_MISMATCH');
      await expect(assertSchemaCurrent(t.db, SHIPPED_MIGRATIONS)).rejects.toThrow();
    } finally { await t.drop(); }
  });

  it('enforces the automation invariants in the database', async () => {
    const t = await createTestDatabase();
    try {
      const rule = id('aut'), insertRule = (patch = '', values: unknown[] = []) => t.db.query(`INSERT INTO automation_rules (tenant_id, rule_id, owner_namespace, owner_account,
        display_name, kind, state, definition, action_strategy, action_workflow_hash, engine_version, timezone, next_evaluation_at${patch ? ', ' + patch : ''})
        VALUES ('default', $1, 'eip155', $2, 'DCA', 'SCHEDULED_DCA', 'ACTIVE', '{}', '{"action":"swap"}', $3, 'flofi-engine-2', 'Europe/Lisbon', now()${values.length ? ', $4' : ''})`,
      [values[0] ?? rule, OWNER, '0x' + 'd'.repeat(64), ...values.slice(1)]);
      await insertRule();
      // Only CONFIRM_EACH_TIME exists; a DCA must have an action; identity is immutable.
      await expect(insertRule('execution_mode', [id('aut'), 'AUTOMATIC'])).rejects.toThrow();
      await expect(t.db.query(`INSERT INTO automation_rules (tenant_id, rule_id, owner_namespace, owner_account, display_name, kind, state, definition, timezone, next_evaluation_at)
        VALUES ('default', $1, 'eip155', $2, 'x', 'SCHEDULED_DCA', 'ACTIVE', '{}', 'UTC', now())`, [id('aut'), OWNER])).rejects.toThrow();
      await expect(t.db.query(`UPDATE automation_rules SET owner_account = $2 WHERE rule_id = $1`, [rule, '0x' + 'e'.repeat(40)])).rejects.toThrow(/AUTOMATION_RULE_IMMUTABLE/);
      await expect(t.db.query(`UPDATE automation_rules SET version = 0 WHERE rule_id = $1`, [rule])).rejects.toThrow();
      // The definition (schedule, condition, limits) and the expiry never change; the bound action changes only with a new version.
      await expect(t.db.query(`UPDATE automation_rules SET definition = '{"limits":{"maxAmountPerExecution":"5000"}}' WHERE rule_id = $1`, [rule])).rejects.toThrow(/AUTOMATION_RULE_IMMUTABLE/);
      await expect(t.db.query(`UPDATE automation_rules SET expires_at = now() + interval '9 years' WHERE rule_id = $1`, [rule])).rejects.toThrow(/AUTOMATION_RULE_IMMUTABLE/);
      await expect(t.db.query(`UPDATE automation_rules SET action_strategy = '{"action":"swap","amount":"5000"}' WHERE rule_id = $1`, [rule])).rejects.toThrow(/AUTOMATION_RULE_VERSION_INVALID/);
      await t.db.query(`UPDATE automation_rules SET action_strategy = '{"action":"swap","amount":"40"}', version = version + 1 WHERE rule_id = $1`, [rule]);
      // One occurrence per trigger key; the owner must be the rule's owner.
      const occurrence = (key: string, owner = OWNER) => t.db.query(`INSERT INTO automation_occurrences (tenant_id, occurrence_id, rule_id, owner_namespace, owner_account, trigger_key,
        kind, state, due_at, expires_at) VALUES ('default', $1, $2, 'eip155', $3, $4, 'SCHEDULE', 'PENDING_OWNER', now(), now() + interval '1 day')`, [id('occ'), rule, owner, key]);
      await occurrence('slot:2026-10-12T09:00');
      await expect(occurrence('slot:2026-10-12T09:00')).rejects.toThrow(/duplicate key/);
      await expect(occurrence('slot:2026-10-19T09:00', '0x' + 'e'.repeat(40))).rejects.toThrow(/foreign key/);
      // Forward-only states; terminal states and the proposal's facts never change.
      await t.db.query(`UPDATE automation_occurrences SET state = 'DISMISSED', decided_at = now() WHERE rule_id = $1`, [rule]);
      await expect(t.db.query(`UPDATE automation_occurrences SET state = 'PENDING_OWNER' WHERE rule_id = $1`, [rule])).rejects.toThrow(/AUTOMATION_OCCURRENCE_TERMINAL/);
      await occurrence('slot:2026-10-26T09:00');
      await expect(t.db.query(`UPDATE automation_occurrences SET strategy = '{"amount":"500"}', workflow_hash = $2 WHERE rule_id = $1 AND state = 'PENDING_OWNER'`,
        [rule, '0x' + 'f'.repeat(64)])).rejects.toThrow(/AUTOMATION_OCCURRENCE_IMMUTABLE/);
      await expect(t.db.query(`UPDATE automation_occurrences SET state = 'APPROVAL_CREATED' WHERE rule_id = $1 AND state = 'PENDING_OWNER'`, [rule])).rejects.toThrow();
      // ARCHIVED is terminal.
      await t.db.query(`UPDATE automation_rules SET state = 'ARCHIVED' WHERE rule_id = $1`, [rule]);
      await expect(t.db.query(`UPDATE automation_rules SET state = 'ACTIVE' WHERE rule_id = $1`, [rule])).rejects.toThrow(/AUTOMATION_RULE_ARCHIVED/);
      // The shared handoff table accepts the new requester kind with the generic identity rules (no MCP account or grant).
      expect((await t.db.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'mcp_handoffs_requester_kind_check'`)).rows[0]!.d).toContain('AUTOMATION_RULE');
    } finally { await t.drop(); }
  });
});
