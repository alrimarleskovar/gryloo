// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: migration 0011 in the shipped sequence. A populated 0010 database (a confirm-each-time rule with an occurrence)
 * reaches the current schema with the normal runner; 0011 is additive — earlier tables keep every column, constraint, index and trigger
 * except the intended changes (the rule's execution-mode CHECK widens, a nullable `authorization_id` and its CHECK/index appear, the
 * occurrence state CHECK gains DELEGATED with its CHECK and a mode trigger); existing rows keep their meaning. The database enforces the
 * delegated invariants itself.
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
const DELEGATION_TABLES = ['credential_grants', 'delegated_authorization_revisions', 'delegated_authorizations', 'delegated_budget_entries', 'delegated_events',
  'delegated_execution_steps', 'delegated_executions', 'execution_credentials', 'passkey_challenges', 'passkey_credentials'];
const id = (prefix: string) => `${prefix}_${randomBytes(16).toString('hex').replace(/[^a-z2-7]/g, 'a').slice(0, 26)}`;
const OWNER = '0x' + 'c3'.repeat(20);

describe('BUILD-AUTOMATION-002 migration 0011', () => {
  it('follows 0010 in the gapless shipped sequence and is pinned', async () => {
    const all = await loadMigrations();
    expect(all.map(m => [m.version, m.name]).slice(-2)).toEqual([[10, 'automations'], [11, 'delegated_execution']]);
    expect(SHIPPED_MIGRATIONS.at(-1)).toEqual({ version: 11, name: 'delegated_execution', sha256: all.at(-1)!.sha256 });
  });

  it('upgrades a populated 0010 database additively; existing rules keep CONFIRM_EACH_TIME and cannot be upgraded in place', async () => {
    const t = await createTestDatabase({ migrated: false });
    try {
      const all = await loadMigrations();
      await migrate(t.db, all.slice(0, 10));
      const rule = id('aut');
      await t.db.query(`INSERT INTO automation_rules (tenant_id, rule_id, owner_namespace, owner_account, display_name, kind, state, definition, action_strategy,
        action_workflow_hash, engine_version, timezone, next_evaluation_at) VALUES ('default', $1, 'eip155', $2, 'DCA', 'SCHEDULED_DCA', 'ACTIVE', '{}', '{"action":"swap"}', $3,
        'flofi-engine-2', 'Europe/Lisbon', now())`, [rule, OWNER, '0x' + 'd'.repeat(64)]);
      await t.db.query(`INSERT INTO automation_occurrences (tenant_id, occurrence_id, rule_id, owner_namespace, owner_account, trigger_key, kind, state, due_at, expires_at)
        VALUES ('default', $1, $2, 'eip155', $3, 'slot:2026-10-12T09:00', 'SCHEDULE', 'PENDING_OWNER', now(), now() + interval '1 day')`, [id('occ'), rule, OWNER]);
      const before = await shape(t.db);
      expect(await migrate(t.db, all)).toEqual([11]);
      expect(await assertSchemaCurrent(t.db, SHIPPED_MIGRATIONS)).toBe(11);
      expect(await migrate(t.db, all)).toEqual([]);
      const after = await shape(t.db);
      expect(Object.keys(after).filter(name => !(name in before)).sort()).toEqual(DELEGATION_TABLES);
      for (const [table, items] of Object.entries(before)) {
        const changed = after[table]!.filter(item => !items.includes(item)), removed = items.filter(item => !after[table]!.includes(item));
        if (table === 'automation_rules') {
          expect(removed).toEqual([expect.stringMatching(/^constraint automation_rules_execution_mode_check CHECK \(\(execution_mode = 'CONFIRM_EACH_TIME'::text\)\)$/)]);
          expect(changed.sort()).toEqual([expect.stringMatching(/^column authorization_id text YES $/), expect.stringMatching(/^constraint automation_rules_authorization_id_check /),
            expect.stringMatching(/^constraint automation_rules_delegated_authorization CHECK /), expect.stringMatching(/^constraint automation_rules_execution_mode_check CHECK .*DELEGATED_WITH_LIMITS/),
            expect.stringMatching(/^index automation_rules_authorization /)].sort((a, b) => String(a).localeCompare(String(b))) as never);
        } else if (table === 'automation_occurrences') {
          expect(removed).toEqual([expect.stringMatching(/^constraint automation_occurrences_state_check /)]);
          expect(changed.sort()).toEqual([expect.stringMatching(/^constraint automation_occurrences_delegated CHECK /), expect.stringMatching(/^constraint automation_occurrences_state_check .*DELEGATED/),
            'trigger automation_occurrence_mode BEFORE INSERT']);
        } else expect([table, changed, removed]).toEqual([table, [], []]);
      }
      expect((await t.db.query(`SELECT execution_mode, authorization_id FROM automation_rules WHERE rule_id = $1`, [rule])).rows[0]).toEqual({ execution_mode: 'CONFIRM_EACH_TIME', authorization_id: null });
      await expect(t.db.query(`UPDATE automation_rules SET execution_mode = 'DELEGATED_WITH_LIMITS', authorization_id = $2 WHERE rule_id = $1`, [rule, id('dau')]))
        .rejects.toThrow(/AUTOMATION_RULE_IMMUTABLE/);
      // A confirm-each-time rule never gets a delegated occurrence (no silent upgrade); its own occurrences behave exactly as in 0010.
      await expect(t.db.query(`INSERT INTO automation_occurrences (tenant_id, occurrence_id, rule_id, owner_namespace, owner_account, trigger_key, kind, state, strategy, workflow_hash,
        due_at, expires_at, decided_at) VALUES ('default', $1, $2, 'eip155', $3, 'slot:x', 'SCHEDULE', 'DELEGATED', '{}', $4, now(), now() + interval '1 day', now())`,
      [id('occ'), rule, OWNER, '0x' + 'd'.repeat(64)])).rejects.toThrow(/AUTOMATION_OCCURRENCE_MODE_MISMATCH/);
    } finally { await t.drop(); }
  });

  it('enforces the delegated invariants in the database', async () => {
    const t = await createTestDatabase();
    try {
      const auth = id('dau'), rule = id('aut');
      // A delegated rule needs its authorization; a delegated rule never creates an owner proposal.
      const insertRule = (mode: string, authorization: string | null, ruleId = id('aut')) => t.db.query(`INSERT INTO automation_rules (tenant_id, rule_id, owner_namespace, owner_account,
        display_name, kind, state, definition, action_strategy, action_workflow_hash, engine_version, timezone, next_evaluation_at, execution_mode, authorization_id)
        VALUES ('default', $1, 'eip155', $2, 'D', 'SCHEDULED_DCA', 'PAUSED', '{}', '{"action":"swap"}', $3, 'flofi-engine-2', 'UTC', now(), $4, $5)`,
      [ruleId, OWNER, '0x' + 'd'.repeat(64), mode, authorization]);
      await expect(insertRule('DELEGATED_WITH_LIMITS', null)).rejects.toThrow(/automation_rules_delegated_authorization/);
      await expect(insertRule('CONFIRM_EACH_TIME', auth)).rejects.toThrow(/automation_rules_delegated_authorization/);
      await insertRule('DELEGATED_WITH_LIMITS', auth, rule);
      await expect(t.db.query(`UPDATE automation_rules SET authorization_id = $2 WHERE rule_id = $1`, [rule, id('dau')])).rejects.toThrow(/AUTOMATION_RULE_IMMUTABLE/);
      await expect(t.db.query(`INSERT INTO automation_occurrences (tenant_id, occurrence_id, rule_id, owner_namespace, owner_account, trigger_key, kind, state, due_at, expires_at)
        VALUES ('default', $1, $2, 'eip155', $3, 'slot:y', 'SCHEDULE', 'PENDING_OWNER', now(), now() + interval '1 day')`, [id('occ'), rule, OWNER]))
        .rejects.toThrow(/AUTOMATION_OCCURRENCE_MODE_MISMATCH/);
      const occurrence = id('occ');
      await t.db.query(`INSERT INTO automation_occurrences (tenant_id, occurrence_id, rule_id, owner_namespace, owner_account, trigger_key, kind, state, strategy, workflow_hash,
        due_at, expires_at, decided_at) VALUES ('default', $1, $2, 'eip155', $3, 'slot:z', 'SCHEDULE', 'DELEGATED', '{}', $4, now(), now() + interval '1 day', now())`,
      [occurrence, rule, OWNER, '0x' + 'd'.repeat(64)]);
      await expect(t.db.query(`UPDATE automation_occurrences SET state = 'COMPLETED' WHERE occurrence_id = $1`, [occurrence])).rejects.toThrow(/AUTOMATION_OCCURRENCE_TERMINAL/);
      // Authorization lineage, a signed revision, an execution and its ledger.
      await t.db.query(`INSERT INTO delegated_authorizations (tenant_id, authorization_id, owner_namespace, owner_account, rule_id, state) VALUES ('default', $1, 'eip155', $2, $3, 'PENDING_SIGNATURE')`,
        [auth, OWNER, rule]);
      await t.db.query(`INSERT INTO delegated_authorization_revisions (tenant_id, authorization_id, revision, owner_namespace, owner_account, state, strategy, workflow_hash, manifest, manifest_hash)
        VALUES ('default', $1, 1, 'eip155', $2, 'PENDING_SIGNATURE', '{}', $3, '{}', $3)`, [auth, OWNER, '0x' + 'd'.repeat(64)]);
      // ACTIVE needs a signature; a revoked lineage is terminal.
      await expect(t.db.query(`UPDATE delegated_authorization_revisions SET state = 'ACTIVE' WHERE authorization_id = $1`, [auth])).rejects.toThrow(/delegated_authorization_revisions_check/);
      const execution = id('dex');
      await t.db.query(`INSERT INTO delegated_executions (tenant_id, execution_id, authorization_id, revision, owner_namespace, owner_account, rule_id, occurrence_id, state, workflow_hash,
        manifest_hash, step_count) VALUES ('default', $1, $2, 1, 'eip155', $3, $4, $5, 'QUEUED', $6, $6, 1)`, [execution, auth, OWNER, rule, occurrence, '0x' + 'd'.repeat(64)]);
      await expect(t.db.query(`INSERT INTO delegated_executions (tenant_id, execution_id, authorization_id, revision, owner_namespace, owner_account, rule_id, occurrence_id, state, workflow_hash,
        manifest_hash, step_count) VALUES ('default', $1, $2, 1, 'eip155', $3, $4, $5, 'QUEUED', $6, $6, 1)`, [id('dex'), auth, OWNER, rule, occurrence, '0x' + 'd'.repeat(64)]))
        .rejects.toThrow(/duplicate key/);
      await expect(t.db.query(`UPDATE delegated_executions SET state = 'RESERVED', version = version + 1 WHERE execution_id = $1`, [execution])).rejects.toThrow(/DELEGATED_EXECUTION_TRANSITION_INVALID/);
      await expect(t.db.query(`UPDATE delegated_executions SET state = 'AUTHORITY_VERIFIED' WHERE execution_id = $1`, [execution])).rejects.toThrow(/DELEGATED_EXECUTION_IMMUTABLE/);
      await t.db.query(`UPDATE delegated_executions SET state = 'AUTHORITY_VERIFIED', version = version + 1 WHERE execution_id = $1`, [execution]);
      await t.db.query(`INSERT INTO delegated_budget_entries (tenant_id, authorization_id, execution_id, step_index, asset, reserved_amount, state, day_start, week_start, month_start)
        VALUES ('default', $1, $2, 0, $3, 50, 'RESERVED', now(), now(), now())`, [auth, execution, 'eip155:84532/erc20:0x' + 'a'.repeat(40)]);
      await expect(t.db.query(`UPDATE delegated_budget_entries SET reserved_amount = 1 WHERE execution_id = $1`, [execution])).rejects.toThrow(/DELEGATED_BUDGET_IMMUTABLE/);
      await t.db.query(`UPDATE delegated_budget_entries SET state = 'SPENT', spent_amount = 50 WHERE execution_id = $1`, [execution]);
      await expect(t.db.query(`UPDATE delegated_budget_entries SET state = 'RELEASED', spent_amount = NULL WHERE execution_id = $1`, [execution])).rejects.toThrow(/DELEGATED_BUDGET_TRANSITION_INVALID/);
      await expect(t.db.query(`DELETE FROM delegated_budget_entries WHERE execution_id = $1`, [execution])).rejects.toThrow(/DELEGATED_RECORD_APPEND_ONLY/);
      // A prepared submission never changes.
      await t.db.query(`INSERT INTO delegated_execution_steps (tenant_id, execution_id, step_index, state, credential_id, grant_id, mechanism, chain, grant_commitment, submission)
        VALUES ('default', $1, 0, 'POLICY_VERIFIED', $2, $3, 'EVM_ERC7710_METAMASK_V1_3', 'eip155:84532', $4, NULL)`, [execution, id('crd'), id('grt'), '0x' + 'e'.repeat(64)]);
      await t.db.query(`UPDATE delegated_execution_steps SET state = 'SUBMISSION_PREPARED', submission = '{"hashes":["0x01"]}' WHERE execution_id = $1`, [execution]);
      await expect(t.db.query(`UPDATE delegated_execution_steps SET submission = '{"hashes":["0x02"]}' WHERE execution_id = $1`, [execution])).rejects.toThrow(/DELEGATED_STEP_IMMUTABLE/);
      await expect(t.db.query(`UPDATE delegated_execution_steps SET state = 'BLOCKED' WHERE execution_id = $1`, [execution])).rejects.toThrow(/DELEGATED_STEP_TRANSITION_INVALID/);
      // The audit trail is append-only.
      await t.db.query(`INSERT INTO delegated_events (tenant_id, owner_namespace, owner_account, kind) VALUES ('default', 'eip155', $1, 'TEST_EVENT')`, [OWNER]);
      await expect(t.db.query(`UPDATE delegated_events SET kind = 'OTHER'`)).rejects.toThrow(/DELEGATED_RECORD_APPEND_ONLY/);
      await t.db.query(`UPDATE delegated_authorizations SET state = 'REVOKED', revoked_at = now(), version = version + 1 WHERE authorization_id = $1`, [auth]);
      await expect(t.db.query(`UPDATE delegated_authorizations SET state = 'ACTIVE', active_revision = 1, version = version + 1 WHERE authorization_id = $1`, [auth]))
        .rejects.toThrow(/DELEGATED_AUTHORIZATION_REVOKED/);
    } finally { await t.drop(); }
  });
});
