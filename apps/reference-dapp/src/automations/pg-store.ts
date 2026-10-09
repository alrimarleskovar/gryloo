// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: `AutomationStore` on PostgreSQL (migration 0010). See `store.ts` for the contract. Concurrency comes from the
 * database, never process memory: the rule row lock serializes evaluators and owner changes of one rule (rule first, then its
 * occurrences — one lock order everywhere), the unique `(rule, trigger_key)` key makes an occurrence exactly-once, compare-and-set on
 * `version` protects owner edits, `SKIP LOCKED` keeps sweeps from blocking each other, and the triggers of 0010 refuse any backwards
 * state move. Every query names the tenant; every owner query names the owner too.
 */
import type { Database, Queryable, Row } from '@defi-workflow-engine/cloud-runtime';
import type { StrategySpec } from '../engine/strategy-spec';
import type { Binding, WorkflowSource } from './binding.ts';
import type { Definition } from './definition.ts';
import { formatScaled, parseScaled, AMOUNT_SCALE } from './decimal.ts';
import type { TriggerState } from './trigger.ts';
import { OPEN_OCCURRENCE, type AutomationStore, type EvaluationReads, type EvaluationRecord, type OccurrenceRecord, type Owner, type RuleRecord } from './store.ts';

const date = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const maybeDate = (value: unknown) => value === null || value === undefined ? null : date(value);
const refuse = (code: string): never => { throw new Error(code); };
/** A numeric(48,18) as the shortest exact decimal string. */
const decimalOf = (value: unknown) => {
  const text = String(value), trimmed = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  const units = parseScaled(trimmed, AMOUNT_SCALE);
  return units === null ? null : formatScaled(units, AMOUNT_SCALE);
};

function ruleOf(row: Row): RuleRecord {
  const binding: Binding | null = row.action_strategy ? { strategy: row.action_strategy as StrategySpec, workflowHash: String(row.action_workflow_hash),
    engineVersion: String(row.engine_version), source: row.source_workflow_id ? { workflowId: String(row.source_workflow_id), workflowHash: String(row.source_workflow_hash),
      version: Number(row.source_workflow_version) } : null } : null;
  return { ruleId: String(row.rule_id), owner: { namespace: row.owner_namespace as Owner['namespace'], address: String(row.owner_account) }, name: String(row.display_name),
    kind: row.kind as RuleRecord['kind'], state: row.state as RuleRecord['state'], executionMode: 'CONFIRM_EACH_TIME', definition: row.definition as Definition, binding,
    timezone: String(row.timezone), nextEvaluationAt: maybeDate(row.next_evaluation_at), scheduleCursor: maybeDate(row.schedule_cursor),
    lastEvaluationAt: maybeDate(row.last_evaluation_at), lastOutcome: row.last_outcome === null ? null : String(row.last_outcome),
    lastObservation: (row.last_observation ?? null) as RuleRecord['lastObservation'], triggerState: row.trigger_state as TriggerState,
    attention: (row.attention ?? null) as RuleRecord['attention'], expiresAt: maybeDate(row.expires_at), version: Number(row.version), createdAt: date(row.created_at),
    updatedAt: date(row.updated_at) };
}
function occurrenceOf(row: Row): OccurrenceRecord {
  return { occurrenceId: String(row.occurrence_id), ruleId: String(row.rule_id), owner: { namespace: row.owner_namespace as Owner['namespace'], address: String(row.owner_account) },
    triggerKey: String(row.trigger_key), kind: row.kind as OccurrenceRecord['kind'], state: row.state as OccurrenceRecord['state'],
    strategy: (row.strategy ?? null) as StrategySpec | null, workflowHash: row.workflow_hash === null ? null : String(row.workflow_hash),
    spend: row.spend_asset === null ? null : { asset: String(row.spend_asset), amount: decimalOf(row.spend_amount)! },
    observation: (row.observation ?? null) as OccurrenceRecord['observation'], dueAt: date(row.due_at), expiresAt: date(row.expires_at),
    handoffId: row.handoff_id === null ? null : String(row.handoff_id), outcome: row.outcome === null ? null : String(row.outcome), decidedAt: maybeDate(row.decided_at),
    createdAt: date(row.created_at), updatedAt: date(row.updated_at) };
}
const evaluationOf = (row: Row): EvaluationRecord => ({ evaluationId: String(row.evaluation_id), ruleId: String(row.rule_id), at: date(row.at), outcome: String(row.outcome),
  triggerKey: row.trigger_key === null ? null : String(row.trigger_key), occurrenceId: row.occurrence_id === null ? null : String(row.occurrence_id),
  observation: (row.observation ?? null) as EvaluationRecord['observation'], detail: (row.detail ?? null) as EvaluationRecord['detail'] });
/** An open occurrence past its expiry reads as EXPIRED (the scheduler writes it; reads never wait for it). */
const lapsed = (o: OccurrenceRecord, now: Date): OccurrenceRecord => OPEN_OCCURRENCE.includes(o.state) && o.expiresAt <= now
  ? { ...o, state: 'EXPIRED', outcome: 'OCCURRENCE_EXPIRED', decidedAt: o.expiresAt } : o;
const OPEN = `state IN ('PENDING_OWNER', 'APPROVAL_CREATED')`;
/** Occurrences a limit counts: open, taken up, or opened by the owner before they expired (their approval may still have been used). */
const COUNTED = `(state IN ('PENDING_OWNER', 'APPROVAL_CREATED', 'COMPLETED') OR (state = 'EXPIRED' AND handoff_id IS NOT NULL))`;
const NOTIFY_KIND = 'automation.notify', EVALUATE_KIND = 'automation.evaluate';
const json = (value: unknown) => value === null || value === undefined ? null : JSON.stringify(value);

export function createPgAutomationStore(db: Database, tenantId: string): AutomationStore {
  const reads = (tx: Queryable, rule: RuleRecord): EvaluationReads => ({
    async usage(starts, except) {
      const counted = (await tx.query<{ n: number; total: string; assets: string[] | null }>(`SELECT
          count(*) FILTER (WHERE $3::timestamptz IS NOT NULL AND due_at >= $3)::int AS n,
          coalesce(sum(spend_amount) FILTER (WHERE $4::timestamptz IS NOT NULL AND due_at >= $4), 0)::text AS total,
          array_agg(DISTINCT spend_asset) FILTER (WHERE $4::timestamptz IS NOT NULL AND due_at >= $4 AND spend_asset IS NOT NULL) AS assets
        FROM automation_occurrences WHERE tenant_id = $1 AND rule_id = $2 AND ${COUNTED} AND occurrence_id <> $5`,
      [tenantId, rule.ruleId, starts.count, starts.amount, except ?? ''])).rows[0]!;
      const last = (await tx.query<{ at: Date | null }>(`SELECT max(due_at) AS at FROM automation_occurrences WHERE tenant_id = $1 AND rule_id = $2 AND occurrence_id <> $3`,
        [tenantId, rule.ruleId, except ?? ''])).rows[0]!.at;
      const assets = counted.assets ?? [];
      return { countPeriod: starts.count ? counted.n : null, lastOccurrenceAt: last ? date(last).getTime() : null,
        amountPeriod: starts.amount ? { sum: decimalOf(counted.total) ?? '0', asset: assets.length === 1 ? assets[0]! : assets.length ? 'MIXED' : null } : null };
    },
    async source(owner: Owner, source: WorkflowSource) {
      const row = (await tx.query<{ workflow_hash: string; version: string }>(`SELECT workflow_hash, version::text FROM saved_workflows
        WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND workflow_id = $4`, [tenantId, owner.namespace, owner.address, source.workflowId])).rows[0];
      return row ? { workflowHash: row.workflow_hash, version: Number(row.version) } : null;
    },
  });
  const ownerRule = async (tx: Queryable, owner: Owner, ruleId: string, lock: boolean) => {
    const row = (await tx.query(`SELECT * FROM automation_rules WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND rule_id = $4${lock ? ' FOR UPDATE' : ''}`,
      [tenantId, owner.namespace, owner.address, ruleId])).rows[0];
    return row ? ruleOf(row) : null;
  };
  const ownerOccurrence = async (tx: Queryable, owner: Owner, occurrenceId: string, lock: boolean) => {
    const row = (await tx.query(`SELECT * FROM automation_occurrences WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND occurrence_id = $4${lock ? ' FOR UPDATE' : ''}`,
      [tenantId, owner.namespace, owner.address, occurrenceId])).rows[0];
    return row ? occurrenceOf(row) : null;
  };
  /** Lazy rule expiry under the rule lock: a rule past its `expires_at` becomes EXPIRED before anything else happens to it. */
  const expireRuleIfLapsed = async (tx: Queryable, rule: RuleRecord, now: Date) => {
    if ((rule.state !== 'ACTIVE' && rule.state !== 'PAUSED') || !rule.expiresAt || rule.expiresAt > now) return rule;
    const row = (await tx.query(`UPDATE automation_rules SET state = 'EXPIRED', last_outcome = 'AUTOMATION_EXPIRED' WHERE tenant_id = $1 AND rule_id = $2 RETURNING *`,
      [tenantId, rule.ruleId])).rows[0]!;
    await tx.query(`INSERT INTO automation_evaluations (tenant_id, rule_id, at, outcome) VALUES ($1, $2, $3, 'AUTOMATION_EXPIRED')`, [tenantId, rule.ruleId, now]);
    return ruleOf(row);
  };
  const endOpen = (tx: Queryable, ruleId: string, outcome: string, now: Date) => tx.query(`UPDATE automation_occurrences SET state = 'EXPIRED', decided_at = $3, outcome = $4
    WHERE tenant_id = $1 AND rule_id = $2 AND ${OPEN}`, [tenantId, ruleId, now, outcome]);

  return {
    async schemaInstalled() {
      return (await db.query<{ ok: boolean }>(`SELECT to_regclass('automation_rules') IS NOT NULL AND to_regclass('automation_occurrences') IS NOT NULL AS ok`)).rows[0]?.ok === true;
    },
    createRule: (rule, now, maxRules) => db.transaction(async tx => {
      // One owner's creations serialize, so the cap is exact.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`flofi.automation/${tenantId}/${rule.owner.namespace}/${rule.owner.address}`]);
      const live = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM automation_rules WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3
        AND state <> 'ARCHIVED'`, [tenantId, rule.owner.namespace, rule.owner.address])).rows[0]!.n;
      if (live >= maxRules) refuse('AUTOMATION_RULE_LIMIT');
      const b = rule.binding;
      const row = (await tx.query(`INSERT INTO automation_rules (tenant_id, rule_id, owner_namespace, owner_account, display_name, kind, state, definition, action_strategy,
          action_workflow_hash, engine_version, source_workflow_id, source_workflow_hash, source_workflow_version, timezone, next_evaluation_at, schedule_cursor, expires_at,
          created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18) RETURNING *`,
      [tenantId, rule.ruleId, rule.owner.namespace, rule.owner.address, rule.name, rule.kind, JSON.stringify(rule.definition), json(b?.strategy), b?.workflowHash ?? null,
        b?.engineVersion ?? null, b?.source?.workflowId ?? null, b?.source?.workflowHash ?? null, b?.source?.version ?? null, rule.timezone, rule.nextEvaluationAt,
        rule.scheduleCursor, rule.expiresAt, now])).rows[0]!;
      await tx.query(`INSERT INTO automation_evaluations (tenant_id, rule_id, at, outcome) VALUES ($1, $2, $3, 'AUTOMATION_CREATED')`, [tenantId, rule.ruleId, now]);
      return ruleOf(row);
    }),
    async listRules(owner) {
      return (await db.query(`SELECT * FROM automation_rules WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 ORDER BY created_at DESC, rule_id LIMIT 200`,
        [tenantId, owner.namespace, owner.address])).rows.map(ruleOf);
    },
    getRule: (owner, ruleId) => ownerRule(db, owner, ruleId, false),
    setState: (owner, ruleId, expectedVersion, next, now, resume) => db.transaction(async tx => {
      let rule = await ownerRule(tx, owner, ruleId, true) ?? refuse('AUTOMATION_NOT_FOUND');
      if (rule.version !== expectedVersion) refuse('AUTOMATION_VERSION_CONFLICT');
      rule = await expireRuleIfLapsed(tx, rule, now);
      if (rule.state === 'EXPIRED' && next !== 'ARCHIVED') refuse('AUTOMATION_EXPIRED');
      if (rule.state === next) return rule;
      if (next === 'ACTIVE' && !resume) refuse('AUTOMATION_RESUME_INVALID');
      // Resuming re-arms a price condition from the next observation: a condition met while paused waits for a fresh crossing.
      const row = (await tx.query(`UPDATE automation_rules SET state = $3, version = version + 1,
          next_evaluation_at = CASE WHEN $3 = 'ACTIVE' THEN $4 ELSE next_evaluation_at END,
          schedule_cursor = CASE WHEN $3 = 'ACTIVE' THEN $5 ELSE schedule_cursor END,
          trigger_state = CASE WHEN $3 = 'ACTIVE' THEN jsonb_set(trigger_state, '{armed}', 'null'::jsonb) ELSE trigger_state END
        WHERE tenant_id = $1 AND rule_id = $2 RETURNING *`, [tenantId, ruleId, next, resume?.nextEvaluationAt ?? null, resume?.scheduleCursor ?? null])).rows[0]!;
      if (next === 'ARCHIVED') await endOpen(tx, ruleId, 'AUTOMATION_ARCHIVED', now);
      await tx.query(`INSERT INTO automation_evaluations (tenant_id, rule_id, at, outcome) VALUES ($1, $2, $3, $4)`,
        [tenantId, ruleId, now, next === 'ACTIVE' ? 'AUTOMATION_RESUMED' : next === 'PAUSED' ? 'AUTOMATION_PAUSED' : 'AUTOMATION_ARCHIVED']);
      return ruleOf(row);
    }),
    rebind: (owner, ruleId, expectedVersion, binding, now) => db.transaction(async tx => {
      const rule = await ownerRule(tx, owner, ruleId, true) ?? refuse('AUTOMATION_NOT_FOUND');
      if (rule.version !== expectedVersion) refuse('AUTOMATION_VERSION_CONFLICT');
      if (rule.state === 'ARCHIVED' || rule.state === 'EXPIRED') refuse(`AUTOMATION_${rule.state}`);
      if (!rule.binding) refuse('AUTOMATION_ACTION_UNSUPPORTED');
      const row = (await tx.query(`UPDATE automation_rules SET action_strategy = $3::jsonb, action_workflow_hash = $4, engine_version = $5, source_workflow_id = $6,
          source_workflow_hash = $7, source_workflow_version = $8, attention = NULL, version = version + 1 WHERE tenant_id = $1 AND rule_id = $2 RETURNING *`,
      [tenantId, ruleId, JSON.stringify(binding.strategy), binding.workflowHash, binding.engineVersion, binding.source?.workflowId ?? null,
        binding.source?.workflowHash ?? null, binding.source?.version ?? null])).rows[0]!;
      // Proposals made under the previous binding are withdrawn: nothing old is proposed after an explicit rebind.
      await endOpen(tx, ruleId, 'AUTOMATION_REBOUND', now);
      await tx.query(`INSERT INTO automation_evaluations (tenant_id, rule_id, at, outcome) VALUES ($1, $2, $3, 'AUTOMATION_REBOUND')`, [tenantId, ruleId, now]);
      return ruleOf(row);
    }),
    async listOccurrences(owner, filter, now) {
      const rows = (await db.query(`SELECT * FROM automation_occurrences WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3
          AND ($4::text IS NULL OR rule_id = $4) AND (NOT $5 OR (${OPEN} AND expires_at > $6)) ORDER BY created_at DESC, occurrence_id LIMIT $7`,
      [tenantId, owner.namespace, owner.address, filter.ruleId ?? null, filter.open === true, now, Math.min(Math.max(1, filter.limit), 200)])).rows;
      return rows.map(occurrenceOf).map(o => lapsed(o, now));
    },
    async getOccurrence(owner, occurrenceId, now) {
      const o = await ownerOccurrence(db, owner, occurrenceId, false);
      return o ? lapsed(o, now) : null;
    },
    async history(owner, ruleId, limit) {
      return (await db.query(`SELECT e.* FROM automation_evaluations e JOIN automation_rules r ON r.tenant_id = e.tenant_id AND r.rule_id = e.rule_id
          WHERE e.tenant_id = $1 AND r.owner_namespace = $2 AND r.owner_account = $3 AND e.rule_id = $4 ORDER BY e.at DESC, e.evaluation_id DESC LIMIT $5`,
      [tenantId, owner.namespace, owner.address, ruleId, Math.min(Math.max(1, limit), 200)])).rows.map(evaluationOf);
    },
    async notifications(owner, occurrenceIds) {
      if (!occurrenceIds.length) return [];
      return (await db.query(`SELECT n.* FROM automation_notifications n JOIN automation_occurrences o ON o.tenant_id = n.tenant_id AND o.occurrence_id = n.occurrence_id
          WHERE n.tenant_id = $1 AND o.owner_namespace = $2 AND o.owner_account = $3 AND n.occurrence_id = ANY($4::text[])`,
      [tenantId, owner.namespace, owner.address, [...occurrenceIds]])).rows.map(row => ({ occurrenceId: String(row.occurrence_id), channel: String(row.channel),
        status: row.status as 'QUEUED', code: row.code === null ? null : String(row.code), updatedAt: date(row.updated_at) }));
    },
    decide: (owner, occurrenceId, state, outcome, now, expectedHandoffId) => db.transaction(async tx => {
      const found = await ownerOccurrence(tx, owner, occurrenceId, false) ?? refuse('AUTOMATION_OCCURRENCE_NOT_FOUND');
      await tx.query(`SELECT 1 FROM automation_rules WHERE tenant_id = $1 AND rule_id = $2 FOR UPDATE`, [tenantId, found.ruleId]);
      const o = await ownerOccurrence(tx, owner, occurrenceId, true) ?? refuse('AUTOMATION_OCCURRENCE_NOT_FOUND');
      if (!OPEN_OCCURRENCE.includes(o.state)) refuse(`AUTOMATION_OCCURRENCE_${o.state}`);
      if (expectedHandoffId !== undefined && o.handoffId !== expectedHandoffId) refuse('AUTOMATION_OCCURRENCE_CHANGED');
      if (o.expiresAt <= now) {
        await tx.query(`UPDATE automation_occurrences SET state = 'EXPIRED', decided_at = $3, outcome = 'OCCURRENCE_EXPIRED' WHERE tenant_id = $1 AND occurrence_id = $2`,
          [tenantId, occurrenceId, now]);
        refuse('AUTOMATION_OCCURRENCE_EXPIRED');
      }
      const row = (await tx.query(`UPDATE automation_occurrences SET state = $3, decided_at = $4, outcome = $5 WHERE tenant_id = $1 AND occurrence_id = $2 RETURNING *`,
        [tenantId, occurrenceId, state, now, outcome])).rows[0]!;
      await tx.query(`INSERT INTO automation_evaluations (tenant_id, rule_id, at, outcome, trigger_key, occurrence_id) VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, o.ruleId, now, outcome, o.triggerKey, o.occurrenceId]);
      return occurrenceOf(row);
    }),
    attachHandoff: (owner, occurrenceId, expected, handoffId, now, check) => db.transaction(async tx => {
      const found = await ownerOccurrence(tx, owner, occurrenceId, false);
      if (!found) return { ok: false, code: 'AUTOMATION_OCCURRENCE_NOT_FOUND' } as const;
      let rule = await ownerRule(tx, owner, found.ruleId, true);
      if (!rule) return { ok: false, code: 'AUTOMATION_NOT_FOUND' } as const;
      rule = await expireRuleIfLapsed(tx, rule, now);
      const o = (await ownerOccurrence(tx, owner, occurrenceId, true))!;
      if (!OPEN_OCCURRENCE.includes(o.state)) return { ok: false, code: `AUTOMATION_OCCURRENCE_${o.state}` } as const;
      if (o.expiresAt <= now) return { ok: false, code: 'AUTOMATION_OCCURRENCE_EXPIRED' } as const;
      if (o.handoffId !== expected.handoffId) return { ok: false, code: 'AUTOMATION_OCCURRENCE_CHANGED' } as const;
      if (rule.state !== 'ACTIVE') return { ok: false, code: `AUTOMATION_${rule.state}` } as const;
      if (rule.version !== expected.ruleVersion) return { ok: false, code: 'AUTOMATION_VERSION_CONFLICT' } as const;
      if (rule.attention) return { ok: false, code: `AUTOMATION_${rule.attention}` } as const;
      const refused = await check(rule, o, reads(tx, rule));
      if (refused) return { ok: false, code: refused } as const;
      const row = (await tx.query(`UPDATE automation_occurrences SET state = 'APPROVAL_CREATED', handoff_id = $3 WHERE tenant_id = $1 AND occurrence_id = $2 RETURNING *`,
        [tenantId, occurrenceId, handoffId])).rows[0]!;
      await tx.query(`INSERT INTO automation_evaluations (tenant_id, rule_id, at, outcome, trigger_key, occurrence_id) VALUES ($1, $2, $3, 'APPROVAL_REQUESTED', $4, $5)`,
        [tenantId, o.ruleId, now, o.triggerKey, o.occurrenceId]);
      return { ok: true, occurrence: occurrenceOf(row) } as const;
    }),

    async ruleById(ruleId) {
      const row = (await db.query('SELECT * FROM automation_rules WHERE tenant_id = $1 AND rule_id = $2', [tenantId, ruleId])).rows[0];
      return row ? ruleOf(row) : null;
    },
    async occurrenceById(occurrenceId) {
      const row = (await db.query('SELECT * FROM automation_occurrences WHERE tenant_id = $1 AND occurrence_id = $2', [tenantId, occurrenceId])).rows[0];
      return row ? occurrenceOf(row) : null;
    },
    async enqueueDue(now, limit) {
      // Concurrent schedulers insert the same dedupe key; the open-item unique index keeps one.
      const { rowCount } = await db.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state, available_at)
        SELECT r.tenant_id, $4, r.rule_id || ':' || (extract(epoch FROM r.next_evaluation_at) * 1000)::bigint, NULL,
          jsonb_build_object('ruleId', r.rule_id), 'READY', now()
        FROM automation_rules r WHERE r.tenant_id = $1 AND r.state = 'ACTIVE' AND r.next_evaluation_at <= $2
        ORDER BY r.next_evaluation_at, r.rule_id LIMIT $3
        ON CONFLICT (tenant_id, kind, dedupe_key) WHERE state IN ('READY', 'LEASED') DO NOTHING`, [tenantId, now, limit, EVALUATE_KIND]);
      return rowCount;
    },
    evaluate: (ruleId, now, decide) => db.transaction(async tx => {
      const row = (await tx.query('SELECT * FROM automation_rules WHERE tenant_id = $1 AND rule_id = $2 FOR UPDATE', [tenantId, ruleId])).rows[0];
      if (!row) return { kind: 'SKIPPED', reason: 'NOT_FOUND' } as const;
      const rule = await expireRuleIfLapsed(tx, ruleOf(row), now);
      if (rule.state !== 'ACTIVE') return { kind: 'SKIPPED', reason: 'NOT_ACTIVE' } as const;
      if (!rule.nextEvaluationAt || rule.nextEvaluationAt > now) return { kind: 'SKIPPED', reason: 'NOT_DUE' } as const;
      // The rule's lapsed proposals end first (a DCA proposal lapses at the next slot, so a new slot never stacks on an old one).
      await tx.query(`UPDATE automation_occurrences SET state = 'EXPIRED', decided_at = $3, outcome = 'OCCURRENCE_EXPIRED'
        WHERE tenant_id = $1 AND rule_id = $2 AND ${OPEN} AND expires_at <= $3`, [tenantId, ruleId, now]);
      const commit = await decide(rule, reads(tx, rule));
      let occurrence: OccurrenceRecord | null = null, duplicate = false;
      if (commit.occurrence) {
        const o = commit.occurrence;
        const inserted = (await tx.query(`INSERT INTO automation_occurrences (tenant_id, occurrence_id, rule_id, owner_namespace, owner_account, trigger_key, kind, state, strategy,
            workflow_hash, spend_asset, spend_amount, observation, due_at, expires_at, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_OWNER', $8::jsonb, $9, $10, $11::numeric, $12::jsonb, $13, $14, $15, $15)
          ON CONFLICT (tenant_id, rule_id, trigger_key) DO NOTHING RETURNING *`,
        [tenantId, o.occurrenceId, ruleId, rule.owner.namespace, rule.owner.address, o.triggerKey, o.kind, json(o.strategy), o.workflowHash, o.spend?.asset ?? null,
          o.spend?.amount ?? null, json(o.observation), o.dueAt, o.expiresAt, now])).rows[0];
        if (inserted) {
          occurrence = occurrenceOf(inserted);
          // A chat notification item only for an owner with a live linked chat: the in-app proposal needs none, and an item nobody can
          // deliver is never left in the queue.
          await tx.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state, available_at)
            SELECT $1, $2, $3, NULL, $4::jsonb, 'READY', now() WHERE EXISTS (SELECT 1 FROM automation_notification_targets t
              JOIN channel_conversations c ON c.tenant_id = t.tenant_id AND c.conversation_id = t.conversation_id
              WHERE t.tenant_id = $1 AND t.owner_namespace = $5 AND t.owner_account = $6 AND t.expires_at > $7 AND c.status = 'ACTIVE')
            ON CONFLICT (tenant_id, kind, dedupe_key) WHERE state IN ('READY', 'LEASED') DO NOTHING`,
          [tenantId, NOTIFY_KIND, occurrence.occurrenceId, JSON.stringify({ occurrenceId: occurrence.occurrenceId }), rule.owner.namespace, rule.owner.address, now]);
        } else duplicate = true;
      }
      for (const e of commit.evaluations) await tx.query(`INSERT INTO automation_evaluations (tenant_id, rule_id, at, outcome, trigger_key, occurrence_id, observation, detail)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`, [tenantId, ruleId, e.at, duplicate && e.occurrenceId ? 'DUPLICATE_TRIGGER' : e.outcome, e.triggerKey,
        e.occurrenceId && occurrence ? occurrence.occurrenceId : null, json(e.observation), json(e.detail)]);
      const updated = (await tx.query(`UPDATE automation_rules SET next_evaluation_at = $3, schedule_cursor = coalesce($4, schedule_cursor),
          trigger_state = coalesce($5::jsonb, trigger_state), last_evaluation_at = $6, last_outcome = $7,
          last_observation = CASE WHEN $8 THEN $9::jsonb ELSE last_observation END,
          attention = CASE WHEN $10 THEN $11 ELSE attention END, state = CASE WHEN $12 THEN 'EXPIRED' ELSE state END
        WHERE tenant_id = $1 AND rule_id = $2 RETURNING *`,
      [tenantId, ruleId, commit.nextEvaluationAt, commit.scheduleCursor ?? null, json(commit.triggerState), now, duplicate ? 'DUPLICATE_TRIGGER' : commit.lastOutcome,
        commit.lastObservation !== undefined, json(commit.lastObservation), commit.attention !== undefined, commit.attention ?? null, commit.expire === true])).rows[0]!;
      return { kind: 'COMMITTED', rule: ruleOf(updated), occurrence, duplicate } as const;
    }),
    async expireLapsed(now, limit) {
      const occurrences = (await db.query(`UPDATE automation_occurrences SET state = 'EXPIRED', decided_at = $2, outcome = 'OCCURRENCE_EXPIRED'
        WHERE (tenant_id, occurrence_id) IN (SELECT tenant_id, occurrence_id FROM automation_occurrences WHERE tenant_id = $1 AND ${OPEN} AND expires_at <= $2
          ORDER BY expires_at LIMIT $3 FOR UPDATE SKIP LOCKED)`, [tenantId, now, limit])).rowCount;
      const rules = (await db.query(`WITH ended AS (UPDATE automation_rules SET state = 'EXPIRED', last_outcome = 'AUTOMATION_EXPIRED'
          WHERE (tenant_id, rule_id) IN (SELECT tenant_id, rule_id FROM automation_rules WHERE tenant_id = $1 AND state IN ('ACTIVE', 'PAUSED') AND expires_at <= $2
            ORDER BY expires_at LIMIT $3 FOR UPDATE SKIP LOCKED) RETURNING rule_id)
        INSERT INTO automation_evaluations (tenant_id, rule_id, at, outcome) SELECT $1, rule_id, $2, 'AUTOMATION_EXPIRED' FROM ended`, [tenantId, now, limit])).rowCount;
      return { occurrences, rules };
    },
    async awaitingApproval(limit) {
      return (await db.query(`SELECT * FROM automation_occurrences WHERE tenant_id = $1 AND state = 'APPROVAL_CREATED' ORDER BY updated_at, occurrence_id LIMIT $2`,
        [tenantId, limit])).rows.map(occurrenceOf);
    },
    completeApproval: (occurrenceId, handoffId, now) => db.transaction(async tx => {
      const row = (await tx.query(`UPDATE automation_occurrences SET state = 'COMPLETED', decided_at = $4, outcome = 'APPROVAL_APPLIED'
        WHERE tenant_id = $1 AND occurrence_id = $2 AND handoff_id = $3 AND state = 'APPROVAL_CREATED' RETURNING rule_id, trigger_key`, [tenantId, occurrenceId, handoffId, now])).rows[0];
      if (!row) return false;
      await tx.query(`INSERT INTO automation_evaluations (tenant_id, rule_id, at, outcome, trigger_key, occurrence_id) VALUES ($1, $2, $3, 'APPROVAL_APPLIED', $4, $5)`,
        [tenantId, row.rule_id, now, row.trigger_key, occurrenceId]);
      return true;
    }),
    async recordNotification(occurrenceId, channel, status, code, now) {
      await db.query(`INSERT INTO automation_notifications (tenant_id, occurrence_id, channel, status, code, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (tenant_id, occurrence_id, channel) DO UPDATE SET status = EXCLUDED.status, code = EXCLUDED.code, updated_at = EXCLUDED.updated_at`,
      [tenantId, occurrenceId, channel, status, code, now]);
    },
    async purge(now) {
      const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
      await db.query('DELETE FROM automation_evaluations WHERE tenant_id = $1 AND at < $2', [tenantId, ago(90)]);
      await db.query(`DELETE FROM automation_occurrences WHERE tenant_id = $1 AND state IN ('COMPLETED', 'DISMISSED', 'EXPIRED') AND updated_at < $2`, [tenantId, ago(400)]);
      await db.query('DELETE FROM automation_link_codes WHERE tenant_id = $1 AND (expires_at < $2 OR consumed_at IS NOT NULL)', [tenantId, ago(1)]);
    },
  };
}
