// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the PostgreSQL implementation of `DeveloperStore` (migration 0007). Every statement is scoped by tenant, and every
 * API-facing one by the principal's project and environment. Only digests of credentials are written; webhook secrets are derived and
 * never stored. Timestamps come from the caller's clock so tests can move time.
 */
import { randomBytes } from 'node:crypto';
import type { Database, Queryable, Row } from '@defi-workflow-engine/cloud-runtime';
import type { ExecutionPlan } from '../platform/index.ts';
import { typedId } from '../platform/ids.ts';
import { DEVELOPER_SCOPES, type DeveloperEnvironment, type DeveloperScope } from './config.ts';
import { DEVELOPER_EVENT_TYPES, type DeliveryClaim, type DeveloperEventType, type DeveloperPlan, type DeveloperStore, type EndpointRecord, type EventRecord,
  type ProjectScope, type StrategyRecord } from './store.ts';

const DAY = 86_400_000;
const date = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const maybeDate = (value: unknown) => value === null || value === undefined ? null : date(value);
const scopesOf = (value: unknown): DeveloperScope[] => Array.isArray(value) ? value.filter((s): s is DeveloperScope => (DEVELOPER_SCOPES as readonly string[]).includes(s)) : [];
const typesOf = (value: unknown): DeveloperEventType[] => Array.isArray(value) ? value.filter((t): t is DeveloperEventType => (DEVELOPER_EVENT_TYPES as readonly string[]).includes(t)) : [];
const dayOf = (now: Date) => now.toISOString().slice(0, 10);

function strategyOf(row: Row): StrategyRecord {
  return { strategyId: String(row.strategy_id), projectId: String(row.project_id), environment: row.environment as DeveloperEnvironment, strategy: row.strategy,
    workflowHash: String(row.workflow_hash), engineVersion: String(row.engine_version), fundsClass: row.funds_class as StrategyRecord['fundsClass'],
    networkEnvironment: String(row.network_environment), plan: row.plan as ExecutionPlan, createdAt: date(row.created_at) };
}
function eventOf(row: Row): EventRecord {
  return { eventId: String(row.event_id), projectId: String(row.project_id), environment: row.environment as DeveloperEnvironment, type: row.type as DeveloperEventType,
    approvalId: String(row.approval_id), data: row.data as Record<string, unknown>, createdAt: date(row.created_at) };
}
function endpointOf(row: Row): EndpointRecord {
  return { endpointId: String(row.endpoint_id), projectId: String(row.project_id), environment: row.environment as DeveloperEnvironment, url: String(row.url),
    eventTypes: typesOf(row.event_types), status: row.status as EndpointRecord['status'], createdAt: date(row.created_at) };
}
/** Serializes one project-environment's writes that must count first (endpoint cap). */
const lockScope = (tx: Queryable, tenantId: string, scope: ProjectScope, purpose: string) =>
  tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`flofi.developer/${purpose}/${tenantId}/${scope.projectId}/${scope.environment}`]);

export function createPgDeveloperStore(db: Database, tenantId: string): DeveloperStore {
  return {
    async createProject(displayName, now) {
      const projectId = typedId('prj');
      await db.query('INSERT INTO developer_projects (tenant_id, project_id, display_name, created_at) VALUES ($1, $2, $3, $4)', [tenantId, projectId, displayName, now]);
      return projectId;
    },
    async disableProject(projectId, now) {
      return (await db.query(`UPDATE developer_projects SET status = 'DISABLED', disabled_at = $3 WHERE tenant_id = $1 AND project_id = $2 AND status = 'ACTIVE'`,
        [tenantId, projectId, now])).rowCount === 1;
    },
    async createKey(projectId, environment, scopes, digest, hint, now) {
      const keyId = typedId('key');
      const inserted = await db.query(`INSERT INTO developer_api_keys (tenant_id, key_id, project_id, environment, key_digest, hint, scopes, created_at)
        SELECT $1, $2, $3, $4, $5, $6, $7, $8 WHERE EXISTS (SELECT 1 FROM developer_projects WHERE tenant_id = $1 AND project_id = $3 AND status = 'ACTIVE')`,
      [tenantId, keyId, projectId, environment, digest, hint, [...scopes], now]);
      return inserted.rowCount === 1 ? keyId : null;
    },
    async revokeKey(keyId, now) {
      return (await db.query(`UPDATE developer_api_keys SET status = 'REVOKED', revoked_at = $3 WHERE tenant_id = $1 AND key_id = $2 AND status = 'ACTIVE'`,
        [tenantId, keyId, now])).rowCount === 1;
    },
    async listKeys(projectId) {
      return (await db.query(`SELECT key_id, environment, hint, scopes, status, created_at, revoked_at, last_used_at FROM developer_api_keys
        WHERE tenant_id = $1 AND project_id = $2 ORDER BY created_at DESC`, [tenantId, projectId])).rows.map(row => ({ keyId: String(row.key_id),
        environment: row.environment as DeveloperEnvironment, hint: String(row.hint), scopes: scopesOf(row.scopes), status: row.status as 'ACTIVE' | 'REVOKED',
        createdAt: date(row.created_at), revokedAt: maybeDate(row.revoked_at), lastUsedAt: maybeDate(row.last_used_at) }));
    },
    async listDeliveries(projectId, limit) {
      return (await db.query(`SELECT d.delivery_id, d.endpoint_id, d.event_id, e.type, d.status, d.attempts, d.next_attempt_at, d.last_status, d.last_error, d.created_at
        FROM developer_webhook_deliveries d JOIN developer_events e ON e.tenant_id = d.tenant_id AND e.event_id = d.event_id
        WHERE d.tenant_id = $1 AND d.project_id = $2 ORDER BY d.created_at DESC LIMIT $3`, [tenantId, projectId, limit])).rows.map(row => ({
        deliveryId: String(row.delivery_id), endpointId: String(row.endpoint_id), eventId: String(row.event_id), eventType: row.type as DeveloperEventType,
        status: row.status as 'PENDING' | 'SUCCEEDED' | 'DEAD', attempts: Number(row.attempts), nextAttemptAt: date(row.next_attempt_at),
        lastStatus: row.last_status === null ? null : Number(row.last_status), lastError: row.last_error === null ? null : String(row.last_error), createdAt: date(row.created_at) }));
    },

    async authenticate(digest, now) {
      const row = (await db.query(`SELECT k.key_id, k.environment, k.scopes, k.last_used_at, p.project_id, p.display_name, p.plan
        FROM developer_api_keys k JOIN developer_projects p ON p.tenant_id = k.tenant_id AND p.project_id = k.project_id
        WHERE k.tenant_id = $1 AND k.key_digest = $2 AND k.status = 'ACTIVE' AND p.status = 'ACTIVE'`, [tenantId, digest])).rows[0];
      if (!row) return null;
      // Last use is recorded at most once a minute (an operator signal, never an access rule).
      const last = maybeDate(row.last_used_at);
      if (!last || now.getTime() - last.getTime() > 60_000)
        await db.query('UPDATE developer_api_keys SET last_used_at = $3 WHERE tenant_id = $1 AND key_id = $2', [tenantId, row.key_id, now]);
      return { projectId: String(row.project_id), projectName: String(row.display_name), environment: row.environment as DeveloperEnvironment, keyId: String(row.key_id),
        scopes: scopesOf(row.scopes), plan: row.plan as DeveloperPlan };
    },
    async createStrategy(record, now) {
      await db.query(`INSERT INTO developer_strategies (tenant_id, strategy_id, project_id, environment, strategy, workflow_hash, engine_version, funds_class,
        network_environment, plan, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [tenantId, record.strategyId, record.projectId, record.environment,
        JSON.stringify(record.strategy), record.workflowHash, record.engineVersion, record.fundsClass, record.networkEnvironment, JSON.stringify(record.plan), now]);
      return { ...record, createdAt: now };
    },
    async strategy(scope, strategyId) {
      const row = (await db.query(`SELECT * FROM developer_strategies WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND strategy_id = $4`,
        [tenantId, scope.projectId, scope.environment, strategyId])).rows[0];
      return row ? strategyOf(row) : null;
    },
    async approvalForRun(scope, runId) {
      const row = (await db.query(`SELECT a.handoff_id FROM developer_approvals a JOIN mcp_handoffs h ON h.tenant_id = a.tenant_id AND h.handoff_id = a.handoff_id
        WHERE a.tenant_id = $1 AND a.project_id = $2 AND a.environment = $3 AND h.status = 'APPLIED' AND h.share_status AND h.run_ids @> ARRAY[$4]::text[]
        ORDER BY a.created_at DESC LIMIT 1`, [tenantId, scope.projectId, scope.environment, runId])).rows[0];
      return row ? String(row.handoff_id) : null;
    },
    createEndpoint: (scope, url, eventTypes, maxActive, now) => db.transaction(async tx => {
      await lockScope(tx, tenantId, scope, 'endpoints');
      const active = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM developer_webhook_endpoints WHERE tenant_id = $1 AND project_id = $2
        AND environment = $3 AND status = 'ACTIVE'`, [tenantId, scope.projectId, scope.environment])).rows[0]!.n;
      if (active >= maxActive) return null;
      const endpointId = typedId('whe');
      const row = (await tx.query(`INSERT INTO developer_webhook_endpoints (tenant_id, endpoint_id, project_id, environment, url, event_types, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [tenantId, endpointId, scope.projectId, scope.environment, url, [...eventTypes], now])).rows[0]!;
      return endpointOf(row);
    }),
    deleteEndpoint: (scope, endpointId, now) => db.transaction(async tx => {
      const deleted = await tx.query(`UPDATE developer_webhook_endpoints SET status = 'DELETED', deleted_at = $5 WHERE tenant_id = $1 AND project_id = $2
        AND environment = $3 AND endpoint_id = $4 AND status = 'ACTIVE'`, [tenantId, scope.projectId, scope.environment, endpointId, now]);
      if (deleted.rowCount !== 1) return false;
      // A deleted endpoint receives nothing more: its pending deliveries end now (its secret is never used again).
      await tx.query(`UPDATE developer_webhook_deliveries SET status = 'DEAD', last_error = 'ENDPOINT_DELETED', lease_token = NULL, leased_until = NULL, updated_at = $3
        WHERE tenant_id = $1 AND endpoint_id = $2 AND status = 'PENDING'`, [tenantId, endpointId, now]);
      return true;
    }),

    recordEvents: (scope, events, now) => db.transaction(async tx => {
      const recorded: EventRecord[] = [];
      for (const event of events) {
        const row = (await tx.query(`INSERT INTO developer_events (tenant_id, event_id, project_id, environment, type, dedupe_key, approval_id, data, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (tenant_id, project_id, environment, dedupe_key) DO NOTHING RETURNING *`,
        [tenantId, typedId('evt'), scope.projectId, scope.environment, event.type, event.dedupeKey, event.approvalId, JSON.stringify(event.data), now])).rows[0];
        if (!row) continue;
        const endpoints = (await tx.query(`SELECT endpoint_id FROM developer_webhook_endpoints WHERE tenant_id = $1 AND project_id = $2 AND environment = $3
          AND status = 'ACTIVE' AND (cardinality(event_types) = 0 OR $4 = ANY(event_types)) ORDER BY created_at`, [tenantId, scope.projectId, scope.environment, event.type])).rows;
        for (const endpoint of endpoints)
          await tx.query(`INSERT INTO developer_webhook_deliveries (tenant_id, delivery_id, project_id, environment, endpoint_id, event_id, next_attempt_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)`, [tenantId, typedId('whd'), scope.projectId, scope.environment, endpoint.endpoint_id, row.event_id, now]);
        recorded.push(eventOf(row));
      }
      return recorded;
    }),
    async approvalsToSync(filter, limit, now) {
      return (await db.query(`WITH picked AS (SELECT tenant_id, handoff_id FROM developer_approvals WHERE tenant_id = $1 AND sync_state = 'OPEN'
          AND ($2::text IS NULL OR handoff_id = $2) AND ($3::text IS NULL OR (project_id = $3 AND environment = $4))
          ORDER BY synced_at NULLS FIRST, created_at LIMIT $5 FOR UPDATE SKIP LOCKED)
        UPDATE developer_approvals a SET synced_at = $6 FROM picked WHERE a.tenant_id = picked.tenant_id AND a.handoff_id = picked.handoff_id
        RETURNING a.handoff_id, a.project_id, a.environment, a.strategy_id, a.workflow_hash, a.sync_state, a.created_at`,
      [tenantId, filter.handoffId ?? null, filter.scope?.projectId ?? null, filter.scope?.environment ?? null, limit, now])).rows.map(row => ({
        handoffId: String(row.handoff_id), projectId: String(row.project_id), environment: row.environment as DeveloperEnvironment, strategyId: String(row.strategy_id),
        workflowHash: String(row.workflow_hash), syncState: row.sync_state as 'OPEN' | 'DONE', createdAt: date(row.created_at) }));
    },
    async markSynced(handoffId, done, now) {
      await db.query(`UPDATE developer_approvals SET sync_state = CASE WHEN $3 THEN 'DONE' ELSE sync_state END, synced_at = $4 WHERE tenant_id = $1 AND handoff_id = $2`,
        [tenantId, handoffId, done, now]);
    },
    async claimDeliveries(filter, limit, now, leaseMs) {
      const leaseToken = randomBytes(16).toString('hex'), leasedUntil = new Date(now.getTime() + leaseMs);
      const claimed = (await db.query(`WITH due AS (SELECT tenant_id, delivery_id FROM developer_webhook_deliveries WHERE tenant_id = $1 AND status = 'PENDING'
          AND next_attempt_at <= $2 AND (leased_until IS NULL OR leased_until < $2) AND ($3::text IS NULL OR (project_id = $3 AND environment = $4))
          ORDER BY next_attempt_at, delivery_id LIMIT $5 FOR UPDATE SKIP LOCKED)
        UPDATE developer_webhook_deliveries d SET attempts = d.attempts + 1, lease_token = $6, leased_until = $7, last_attempt_at = $2, updated_at = $2
        FROM due WHERE d.tenant_id = due.tenant_id AND d.delivery_id = due.delivery_id RETURNING d.delivery_id`,
      [tenantId, now, filter.scope?.projectId ?? null, filter.scope?.environment ?? null, limit, leaseToken, leasedUntil])).rows.map(r => String(r.delivery_id));
      if (claimed.length === 0) return [];
      const rows = (await db.query(`SELECT d.delivery_id, d.project_id, d.environment, d.endpoint_id, d.attempts, w.url, w.status AS endpoint_status, e.*
        FROM developer_webhook_deliveries d JOIN developer_webhook_endpoints w ON w.tenant_id = d.tenant_id AND w.endpoint_id = d.endpoint_id
        JOIN developer_events e ON e.tenant_id = d.tenant_id AND e.event_id = d.event_id
        WHERE d.tenant_id = $1 AND d.delivery_id = ANY($2::text[]) AND d.lease_token = $3 ORDER BY d.next_attempt_at, d.delivery_id`, [tenantId, claimed, leaseToken])).rows;
      return rows.map((row): DeliveryClaim => ({ deliveryId: String(row.delivery_id), projectId: String(row.project_id), environment: row.environment as DeveloperEnvironment,
        endpointId: String(row.endpoint_id), url: String(row.url), endpointActive: row.endpoint_status === 'ACTIVE', attempts: Number(row.attempts), leaseToken,
        event: eventOf(row) }));
    },
    async settleDelivery(deliveryId, leaseToken, settlement, now) {
      return (await db.query(`UPDATE developer_webhook_deliveries SET status = $4, last_status = $5, last_error = $6, next_attempt_at = coalesce($7, next_attempt_at),
        lease_token = NULL, leased_until = NULL, updated_at = $8 WHERE tenant_id = $1 AND delivery_id = $2 AND lease_token = $3 AND status = 'PENDING'`,
      [tenantId, deliveryId, leaseToken, settlement.status, settlement.lastStatus, settlement.lastError, settlement.nextAttemptAt, now])).rowCount === 1;
    },
    async incrementUsage(scope, metric, dimension, now, by = 1) {
      await db.query(`INSERT INTO developer_usage (tenant_id, project_id, environment, day, metric, dimension, count) VALUES ($1, $2, $3, $4::date, $5, $6, $7)
        ON CONFLICT (tenant_id, project_id, environment, day, metric, dimension) DO UPDATE SET count = developer_usage.count + EXCLUDED.count`,
      [tenantId, scope.projectId, scope.environment, dayOf(now), metric, dimension.slice(0, 128), by]);
    },
    async usage(scope, fromDay, toDay) {
      return (await db.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, metric, dimension, count FROM developer_usage WHERE tenant_id = $1 AND project_id = $2
        AND environment = $3 AND day BETWEEN $4::date AND $5::date ORDER BY day, metric, dimension`, [tenantId, scope.projectId, scope.environment, fromDay, toDay])).rows
        .map(row => ({ day: String(row.day), metric: String(row.metric), dimension: String(row.dimension), count: Number(row.count) }));
    },
    async purge(now) {
      await db.query('DELETE FROM developer_events WHERE tenant_id = $1 AND created_at < $2', [tenantId, new Date(now.getTime() - 30 * DAY)]);
      await db.query(`DELETE FROM developer_strategies s WHERE s.tenant_id = $1 AND s.created_at < $2 AND NOT EXISTS (SELECT 1 FROM developer_approvals a
        WHERE a.tenant_id = s.tenant_id AND a.strategy_id = s.strategy_id)`, [tenantId, new Date(now.getTime() - 90 * DAY)]);
    },
  };
}
