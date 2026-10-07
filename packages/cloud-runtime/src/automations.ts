// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AUTOMATION-001A durable schedule store.
 *
 * Automation is intentionally upstream of financial execution. These rows contain structured strategy intent and
 * owner-confirmation events only. No key, signature, calldata or transaction is stored here, and nothing in this module
 * can submit to a chain.
 */
import { randomBytes } from 'node:crypto';
import type { Database } from './db.js';

export type AutomationState = 'ACTIVE' | 'PAUSED';
export type AutomationEventState = 'PENDING_OWNER' | 'OPENED' | 'DISMISSED' | 'EXPIRED';
export type AutomationRule = {
  readonly automationId: string; readonly ownerAccount: string; readonly state: AutomationState; readonly spec: unknown;
  readonly workflowHash: string; readonly nextEvaluationAt: string; readonly lastEvaluatedAt: string | null;
  readonly createdAt: string; readonly updatedAt: string;
};
export type AutomationEvent = {
  readonly eventId: string; readonly automationId: string; readonly ownerAccount: string; readonly occurrenceAt: string;
  readonly status: AutomationEventState; readonly strategy: unknown; readonly workflowHash: string; readonly expiresAt: string;
  readonly openedAt: string | null; readonly dismissedAt: string | null; readonly createdAt: string; readonly updatedAt: string;
};
type RuleRow = { automation_id: string; owner_account: string; state: AutomationState; spec: unknown; workflow_hash: string;
  next_evaluation_at: Date; last_evaluated_at: Date | null; created_at: Date; updated_at: Date };
type EventRow = { event_id: string; automation_id: string; owner_account: string; occurrence_at: Date; status: AutomationEventState;
  strategy: unknown; workflow_hash: string; expires_at: Date; opened_at: Date | null; dismissed_at: Date | null; created_at: Date; updated_at: Date };
const ACCOUNT = /^0x[0-9a-f]{40}$/, HASH = /^0x[0-9a-f]{64}$/, AUTO = /^auto-[0-9a-f]{24}$/, EVENT = /^evt-[0-9a-f]{24}$/;
const id = (prefix: 'auto' | 'evt') => `${prefix}-${randomBytes(12).toString('hex')}`;
const iso = (value: Date | null) => value ? value.toISOString() : null;
const rule = (row: RuleRow): AutomationRule => ({ automationId: row.automation_id, ownerAccount: row.owner_account, state: row.state, spec: row.spec,
  workflowHash: row.workflow_hash, nextEvaluationAt: row.next_evaluation_at.toISOString(), lastEvaluatedAt: iso(row.last_evaluated_at),
  createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });
const event = (row: EventRow): AutomationEvent => ({ eventId: row.event_id, automationId: row.automation_id, ownerAccount: row.owner_account,
  occurrenceAt: row.occurrence_at.toISOString(), status: row.status, strategy: row.strategy, workflowHash: row.workflow_hash,
  expiresAt: row.expires_at.toISOString(), openedAt: iso(row.opened_at), dismissedAt: iso(row.dismissed_at),
  createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });

export function createAutomationStore(db: Database, tenantId: string) {
  const getInternal = async (automationId: string): Promise<AutomationRule | null> => {
    if (!AUTO.test(automationId)) return null;
    const { rows } = await db.query<RuleRow>(`SELECT automation_id, owner_account, state, spec, workflow_hash, next_evaluation_at, last_evaluated_at,
        created_at, updated_at FROM automation_rules WHERE tenant_id = $1 AND automation_id = $2`, [tenantId, automationId]);
    return rows[0] ? rule(rows[0]) : null;
  };
  return {
    async create(input: { readonly ownerAccount: string; readonly spec: unknown; readonly workflowHash: string; readonly nextEvaluationAt: Date }): Promise<AutomationRule> {
      if (!ACCOUNT.test(input.ownerAccount) || !HASH.test(input.workflowHash) || !Number.isFinite(input.nextEvaluationAt.getTime()))
        throw new Error('AUTOMATION_INPUT_INVALID');
      const automationId = id('auto');
      const { rows } = await db.query<RuleRow>(`INSERT INTO automation_rules
        (tenant_id, automation_id, owner_account, state, spec, workflow_hash, next_evaluation_at)
        VALUES ($1, $2, $3, 'ACTIVE', $4::jsonb, $5, $6)
        RETURNING automation_id, owner_account, state, spec, workflow_hash, next_evaluation_at, last_evaluated_at, created_at, updated_at`,
      [tenantId, automationId, input.ownerAccount, JSON.stringify(input.spec), input.workflowHash, input.nextEvaluationAt]);
      if (!rows[0]) throw new Error('AUTOMATION_CREATE_FAILED');
      return rule(rows[0]);
    },
    async list(ownerAccount: string): Promise<readonly AutomationRule[]> {
      if (!ACCOUNT.test(ownerAccount)) throw new Error('AUTOMATION_OWNER_INVALID');
      const { rows } = await db.query<RuleRow>(`SELECT automation_id, owner_account, state, spec, workflow_hash, next_evaluation_at, last_evaluated_at,
        created_at, updated_at FROM automation_rules WHERE tenant_id = $1 AND owner_account = $2 ORDER BY created_at DESC LIMIT 100`, [tenantId, ownerAccount]);
      return rows.map(rule);
    },
    getInternal,
    async setState(ownerAccount: string, automationId: string, state: AutomationState): Promise<AutomationRule | null> {
      if (!ACCOUNT.test(ownerAccount) || !AUTO.test(automationId) || !['ACTIVE','PAUSED'].includes(state)) throw new Error('AUTOMATION_INPUT_INVALID');
      const { rows } = await db.query<RuleRow>(`UPDATE automation_rules SET state = $4, updated_at = now()
        WHERE tenant_id = $1 AND automation_id = $2 AND owner_account = $3
        RETURNING automation_id, owner_account, state, spec, workflow_hash, next_evaluation_at, last_evaluated_at, created_at, updated_at`,
      [tenantId, automationId, ownerAccount, state]);
      return rows[0] ? rule(rows[0]) : null;
    },
    async events(ownerAccount: string): Promise<readonly AutomationEvent[]> {
      if (!ACCOUNT.test(ownerAccount)) throw new Error('AUTOMATION_OWNER_INVALID');
      const { rows } = await db.query<EventRow>(`SELECT event_id, automation_id, owner_account, occurrence_at, status, strategy, workflow_hash, expires_at,
        opened_at, dismissed_at, created_at, updated_at FROM automation_events
        WHERE tenant_id = $1 AND owner_account = $2 ORDER BY created_at DESC LIMIT 100`, [tenantId, ownerAccount]);
      return rows.map(event);
    },
    async event(ownerAccount: string, eventId: string): Promise<AutomationEvent | null> {
      if (!ACCOUNT.test(ownerAccount) || !EVENT.test(eventId)) return null;
      const { rows } = await db.query<EventRow>(`SELECT event_id, automation_id, owner_account, occurrence_at, status, strategy, workflow_hash, expires_at,
        opened_at, dismissed_at, created_at, updated_at FROM automation_events WHERE tenant_id = $1 AND event_id = $2 AND owner_account = $3`,
      [tenantId, eventId, ownerAccount]);
      return rows[0] ? event(rows[0]) : null;
    },
    async open(ownerAccount: string, eventId: string): Promise<AutomationEvent | null> {
      if (!ACCOUNT.test(ownerAccount) || !EVENT.test(eventId)) return null;
      const { rows } = await db.query<EventRow>(`UPDATE automation_events SET status = 'OPENED', opened_at = COALESCE(opened_at, now()), updated_at = now()
        WHERE tenant_id = $1 AND event_id = $2 AND owner_account = $3 AND status IN ('PENDING_OWNER','OPENED') AND expires_at > now()
        RETURNING event_id, automation_id, owner_account, occurrence_at, status, strategy, workflow_hash, expires_at, opened_at, dismissed_at, created_at, updated_at`,
      [tenantId, eventId, ownerAccount]);
      return rows[0] ? event(rows[0]) : null;
    },
    async dismiss(ownerAccount: string, eventId: string): Promise<boolean> {
      if (!ACCOUNT.test(ownerAccount) || !EVENT.test(eventId)) return false;
      const result = await db.query(`UPDATE automation_events SET status = 'DISMISSED', dismissed_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND event_id = $2 AND owner_account = $3 AND status IN ('PENDING_OWNER','OPENED')`, [tenantId, eventId, ownerAccount]);
      return result.rowCount === 1;
    },
    /**
     * Atomically consumes one exact due instant. A duplicate/replayed worker sees that next_evaluation_at moved and creates no
     * second event. The event is only a prompt; it contains the reviewed strategy intent, never executable material.
     */
    async fire(input: { readonly automationId: string; readonly expectedDueAt: string; readonly nextDueAt: Date; readonly expiresAt: Date;
      readonly strategy: unknown; readonly workflowHash: string }): Promise<{ readonly fired: boolean; readonly event: AutomationEvent | null }> {
      if (!AUTO.test(input.automationId) || !HASH.test(input.workflowHash) || !Number.isFinite(Date.parse(input.expectedDueAt)) ||
          !Number.isFinite(input.nextDueAt.getTime()) || !Number.isFinite(input.expiresAt.getTime())) throw new Error('AUTOMATION_INPUT_INVALID');
      return db.transaction(async tx => {
        const locked = await tx.query<RuleRow>(`SELECT automation_id, owner_account, state, spec, workflow_hash, next_evaluation_at, last_evaluated_at,
          created_at, updated_at FROM automation_rules WHERE tenant_id = $1 AND automation_id = $2 FOR UPDATE`, [tenantId, input.automationId]);
        const current = locked.rows[0];
        if (!current || current.state !== 'ACTIVE' || current.next_evaluation_at.getTime() !== Date.parse(input.expectedDueAt)) return { fired: false, event: null };
        const eventId = id('evt');
        const inserted = await tx.query<EventRow>(`INSERT INTO automation_events
          (tenant_id, event_id, automation_id, owner_account, occurrence_at, status, strategy, workflow_hash, expires_at)
          VALUES ($1, $2, $3, $4, $5::timestamptz, 'PENDING_OWNER', $6::jsonb, $7, $8)
          ON CONFLICT (tenant_id, automation_id, occurrence_at) DO NOTHING
          RETURNING event_id, automation_id, owner_account, occurrence_at, status, strategy, workflow_hash, expires_at, opened_at, dismissed_at, created_at, updated_at`,
        [tenantId, eventId, input.automationId, current.owner_account, input.expectedDueAt, JSON.stringify(input.strategy), input.workflowHash, input.expiresAt]);
        await tx.query(`UPDATE automation_rules SET last_evaluated_at = $3::timestamptz, next_evaluation_at = $4, updated_at = now()
          WHERE tenant_id = $1 AND automation_id = $2`, [tenantId, input.automationId, input.expectedDueAt, input.nextDueAt]);
        return { fired: inserted.rows.length === 1, event: inserted.rows[0] ? event(inserted.rows[0]) : null };
      });
    },
  };
}
export type AutomationStore = ReturnType<typeof createAutomationStore>;

/** Queue every currently due active rule once, and expire old unanswered prompts. No network or execution call happens here. */
export async function sweepAutomationWork(db: Database, tenantId: string): Promise<{ queued: number; expired: number }> {
  const expired = await db.query(`UPDATE automation_events SET status = 'EXPIRED', updated_at = now()
    WHERE tenant_id = $1 AND status IN ('PENDING_OWNER','OPENED') AND expires_at <= now()`, [tenantId]);
  const queued = await db.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state, available_at)
    SELECT tenant_id, 'automation.fire', automation_id || ':' || extract(epoch FROM next_evaluation_at)::text, NULL,
      jsonb_build_object('automationId', automation_id, 'expectedDueAt', next_evaluation_at::text), 'READY', now()
    FROM automation_rules r
    WHERE tenant_id = $1 AND state = 'ACTIVE' AND next_evaluation_at <= now()
      AND NOT EXISTS (SELECT 1 FROM work_items w WHERE w.tenant_id = r.tenant_id AND w.kind = 'automation.fire'
        AND w.dedupe_key = r.automation_id || ':' || extract(epoch FROM r.next_evaluation_at)::text AND w.state IN ('READY','LEASED'))
    ORDER BY next_evaluation_at, automation_id LIMIT 500
    ON CONFLICT (tenant_id, kind, dedupe_key) WHERE state IN ('READY','LEASED') DO NOTHING`, [tenantId]);
  return { queued: queued.rowCount, expired: expired.rowCount };
}
