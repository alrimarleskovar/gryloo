// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the PostgreSQL implementation of Channel Core's store (migration 0008, tenant-scoped). Every write that
 * moves a conversation forward checks the lease's fencing token inside one short transaction; content columns are erased in the
 * same statement that ends their use, and the schema's CHECK constraints refuse any row that would keep them longer. Outbound state
 * changes append their audit row in the same statement (a data-modifying CTE), so the trail never disagrees with the outbox.
 */
import type { Database, Queryable, Row } from '@defi-workflow-engine/cloud-runtime';
import { RETENTION, type AuditEntry, type ChannelStore, type ConversationRecord, type ConversationRef, type DeliveryRank, type NewOutbox,
  type OutboxRecord } from './store.ts';

const date = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const maybeDate = (value: unknown) => value === null || value === undefined ? null : date(value);
const buffer = (value: unknown) => value === null || value === undefined ? null : Buffer.from(value as Uint8Array);
function conversationOf(row: Row): ConversationRecord {
  return { conversationId: String(row.conversation_id), channel: String(row.channel), businessId: String(row.business_id),
    status: row.status as ConversationRecord['status'], addressSealed: buffer(row.address_ciphertext), stateSealed: buffer(row.state_ciphertext),
    lastInboundAt: maybeDate(row.last_inbound_at), lastActivityAt: date(row.last_activity_at), createdAt: date(row.created_at) };
}
function outboxOf(row: Row): OutboxRecord {
  return { outboxId: String(row.outbox_id), conversationId: String(row.conversation_id), dedupeKey: String(row.dedupe_key), kind: row.kind as OutboxRecord['kind'],
    sequence: Number(row.sequence), bodySealed: buffer(row.body_ciphertext) ?? Buffer.alloc(0), handoffId: row.handoff_id === null ? null : String(row.handoff_id),
    status: row.status as OutboxRecord['status'], attempts: Number(row.attempts), createdAt: date(row.created_at), delivery: row.delivery === null ? null : String(row.delivery),
    errorCode: row.error_code === null ? null : String(row.error_code) };
}
const RANK: Readonly<Record<string, number>> = { SENT: 1, DELIVERED: 2, READ: 3 };
const CORRELATION = /^cho_[a-z2-7]{26}$/;
const refOf = (row: Row): ConversationRef => ({ conversationId: String(row.conversation_id), channel: String(row.channel) });
/** An outbox UPDATE (which must set updated_at) plus one audit row per updated row, at the row's own update time, in one statement. */
const auditedOutbox = (update: string, kind: string, codeSql = 'u.error_code') => `WITH u AS (${update}
    RETURNING tenant_id, conversation_id, handoff_id, outbox_id, error_code, status, updated_at)
  INSERT INTO channel_audit (tenant_id, at, channel, conversation_id, kind, code, handoff_id, outbox_id)
  SELECT u.tenant_id, u.updated_at, c.channel, u.conversation_id, ${kind}, ${codeSql}, u.handoff_id, u.outbox_id
    FROM u JOIN channel_conversations c ON c.tenant_id = u.tenant_id AND c.conversation_id = u.conversation_id
  RETURNING outbox_id`;

export function createPgChannelStore(db: Database, tenantId: string): ChannelStore {
  const audit = async (q: Queryable, entries: readonly AuditEntry[], now: Date) => {
    for (const e of entries) await q.query(`INSERT INTO channel_audit (tenant_id, at, channel, conversation_id, kind, code, handoff_id, outbox_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [tenantId, now, e.channel, e.conversationId, e.kind, e.code ?? null, e.handoffId ?? null, e.outboxId ?? null]);
  };
  const insertOutbox = async (tx: Queryable, conversationId: string, outbox: readonly NewOutbox[], now: Date) => {
    const inserted: string[] = [];
    for (const o of outbox) {
      const row = (await tx.query(`INSERT INTO channel_outbox (tenant_id, outbox_id, conversation_id, dedupe_key, kind, sequence, body_ciphertext, handoff_id, next_attempt_at,
        created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9) ON CONFLICT (tenant_id, dedupe_key) DO NOTHING RETURNING outbox_id`,
      [tenantId, o.outboxId, conversationId, o.dedupeKey, o.kind, o.sequence, o.bodySealed, o.handoffId, now])).rows[0];
      if (row) inserted.push(String(row.outbox_id));
    }
    if (inserted.length) await tx.query(`INSERT INTO channel_audit (tenant_id, at, channel, conversation_id, kind, handoff_id, outbox_id)
      SELECT o.tenant_id, $3, c.channel, o.conversation_id, 'OUTBOUND_QUEUED_' || o.kind, o.handoff_id, o.outbox_id FROM channel_outbox o
      JOIN channel_conversations c ON c.tenant_id = o.tenant_id AND c.conversation_id = o.conversation_id WHERE o.tenant_id = $1 AND o.outbox_id = ANY($2::text[])`,
    [tenantId, inserted, now]);
    return inserted;
  };
  return {
    async schemaInstalled() {
      const row = (await db.query<{ ok: boolean }>(`SELECT to_regclass('channel_conversations') IS NOT NULL AND to_regclass('channel_events') IS NOT NULL
        AND to_regclass('channel_outbox') IS NOT NULL AS ok`)).rows[0];
      return row?.ok === true;
    },
    async ensureConversation(channel, businessId, subjectDigest, sentAt, now, newId) {
      const row = (await db.query(`INSERT INTO channel_conversations (tenant_id, conversation_id, channel, business_id, subject_digest, last_inbound_at, last_activity_at,
        created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)
        ON CONFLICT (tenant_id, channel, business_id, subject_digest) DO UPDATE SET
          last_inbound_at = GREATEST(coalesce(channel_conversations.last_inbound_at, EXCLUDED.last_inbound_at), EXCLUDED.last_inbound_at), updated_at = EXCLUDED.updated_at
        RETURNING *`, [tenantId, newId, channel, businessId, subjectDigest, sentAt, now])).rows[0]!;
      return conversationOf(row);
    },
    async conversation(conversationId) {
      const row = (await db.query('SELECT * FROM channel_conversations WHERE tenant_id = $1 AND conversation_id = $2', [tenantId, conversationId])).rows[0];
      return row ? conversationOf(row) : null;
    },
    async storeAddress(conversationId, sealed) {
      await db.query(`UPDATE channel_conversations SET address_ciphertext = $3, updated_at = now() WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'ACTIVE'`,
        [tenantId, conversationId, sealed]);
    },
    recordEvents: (events, now) => db.transaction(async tx => {
      const fresh: Buffer[] = [];
      for (const e of events) {
        const row = (await tx.query(`INSERT INTO channel_events (tenant_id, channel, event_digest, conversation_id, provider_sent_at, received_at, status, payload_ciphertext,
          outcome, processed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $7 = 'PENDING' THEN NULL ELSE $6::timestamptz END)
          ON CONFLICT (tenant_id, channel, event_digest) DO NOTHING RETURNING event_digest`,
        [tenantId, e.channel, e.eventDigest, e.conversationId, e.sentAt, now, e.status, e.status === 'PENDING' ? e.payloadSealed : null, e.outcome])).rows[0];
        if (row) {
          fresh.push(e.eventDigest);
          await audit(tx, [{ channel: e.channel, conversationId: e.conversationId, kind: e.status === 'PENDING' ? 'INBOUND_RECORDED' : 'INBOUND_IGNORED', code: e.outcome }], now);
        }
      }
      return fresh;
    }),
    async acquire(conversationId, token, now, seconds) {
      const row = (await db.query(`UPDATE channel_conversations SET lease_token = $3, lease_until = $4 WHERE tenant_id = $1 AND conversation_id = $2
        AND (lease_until IS NULL OR lease_until <= $5) RETURNING conversation_id`, [tenantId, conversationId, token, new Date(now.getTime() + seconds * 1000), now])).rows[0];
      return Boolean(row);
    },
    nextEvent: (conversationId, token, now) => db.transaction(async tx => {
      const held = (await tx.query(`SELECT 1 FROM channel_conversations WHERE tenant_id = $1 AND conversation_id = $2 AND lease_token = $3 AND lease_until > $4 FOR UPDATE`,
        [tenantId, conversationId, token, now])).rows[0];
      if (!held) throw new Error('CHANNEL_LEASE_LOST');
      const row = (await tx.query(`UPDATE channel_events SET attempts = attempts + 1 WHERE (tenant_id, channel, event_digest) IN (SELECT tenant_id, channel, event_digest
        FROM channel_events WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'PENDING' ORDER BY provider_sent_at, received_at, event_digest LIMIT 1)
        RETURNING channel, event_digest, provider_sent_at, received_at, attempts, payload_ciphertext`, [tenantId, conversationId])).rows[0];
      return row ? { channel: String(row.channel), eventDigest: buffer(row.event_digest)!, sentAt: date(row.provider_sent_at), receivedAt: date(row.received_at),
        attempts: Number(row.attempts), payloadSealed: buffer(row.payload_ciphertext) } : null;
    }),
    completeTurn: (conversationId, token, commit, now) => db.transaction(async tx => {
      const held = (await tx.query(`SELECT 1 FROM channel_conversations WHERE tenant_id = $1 AND conversation_id = $2 AND lease_token = $3 AND lease_until > $4 FOR UPDATE`,
        [tenantId, conversationId, token, now])).rows[0];
      if (!held) throw new Error('CHANNEL_LEASE_LOST');
      await tx.query(`UPDATE channel_events SET status = $4, outcome = $5, handoff_id = $6, payload_ciphertext = NULL, processed_at = $7
        WHERE tenant_id = $1 AND channel = $2 AND event_digest = $3 AND status = 'PENDING'`,
      [tenantId, commit.channel, commit.eventDigest, commit.status, commit.outcome, commit.handoffId, now]);
      const optedOut = commit.conversationStatus === 'OPTED_OUT';
      await tx.query(`UPDATE channel_conversations SET
          status = coalesce($3, status),
          state_ciphertext = CASE WHEN $3 = 'OPTED_OUT' THEN NULL WHEN $4 THEN $5 ELSE state_ciphertext END,
          address_ciphertext = CASE WHEN $3 = 'OPTED_OUT' THEN NULL ELSE address_ciphertext END,
          last_activity_at = $6, updated_at = $6
        WHERE tenant_id = $1 AND conversation_id = $2`,
      [tenantId, conversationId, commit.conversationStatus ?? null, commit.stateSealed !== undefined, commit.stateSealed ?? null, now]);
      await audit(tx, [{ channel: commit.channel, conversationId, kind: commit.status === 'DONE' ? 'TURN_DONE' : 'TURN_FAILED', code: commit.outcome, handoffId: commit.handoffId },
        ...commit.conversationStatus ? [{ channel: commit.channel, conversationId, kind: commit.conversationStatus === 'OPTED_OUT' ? 'OPTED_OUT' : 'OPTED_IN' }] : []], now);
      return optedOut && !commit.outbox.length ? [] : insertOutbox(tx, conversationId, commit.outbox, now);
    }),
    async release(conversationId, token) {
      const row = (await db.query(`UPDATE channel_conversations SET lease_token = NULL, lease_until = NULL WHERE tenant_id = $1 AND conversation_id = $2 AND lease_token = $3
        AND NOT EXISTS (SELECT 1 FROM channel_events WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'PENDING') RETURNING conversation_id`,
      [tenantId, conversationId, token])).rows[0];
      return Boolean(row);
    },
    async claimDue(conversationId, now, limit, kinds) {
      const rows = (await db.query(`UPDATE channel_outbox SET status = 'SENDING', attempts = attempts + 1, updated_at = $3 WHERE (tenant_id, outbox_id) IN (
          SELECT tenant_id, outbox_id FROM channel_outbox WHERE tenant_id = $1 AND conversation_id = $2 AND kind = ANY($5::text[])
            AND status = 'PENDING' AND next_attempt_at <= $3
          ORDER BY created_at, sequence FOR UPDATE SKIP LOCKED LIMIT $4)
        RETURNING *`, [tenantId, conversationId, now, limit, [...kinds]])).rows;
      return rows.map(outboxOf).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.sequence - b.sequence);
    },
    async markSent(outboxId, providerDigest, now) {
      await db.query(auditedOutbox(`UPDATE channel_outbox SET status = 'SENT', body_ciphertext = NULL, provider_message_digest = $3, delivery = coalesce(delivery, 'SENT'),
        error_code = NULL, updated_at = $4 WHERE tenant_id = $1 AND outbox_id = $2 AND status IN ('PENDING', 'SENDING')`, `'OUTBOUND_SENT'`, 'NULL'),
      [tenantId, outboxId, providerDigest, now]);
    },
    async markRetry(outboxId, code, nextAttemptAt, now) {
      await db.query(auditedOutbox(`UPDATE channel_outbox SET status = 'PENDING', error_code = $3, next_attempt_at = $4, updated_at = $5 WHERE tenant_id = $1 AND outbox_id = $2
        AND status IN ('PENDING', 'SENDING')`, `'OUTBOUND_RETRY'`), [tenantId, outboxId, code, nextAttemptAt, now]);
    },
    async markUncertain(outboxId, code, confirmBy, now) {
      await db.query(auditedOutbox(`UPDATE channel_outbox SET status = 'UNCERTAIN', body_ciphertext = NULL, error_code = $3, next_attempt_at = $4, updated_at = $5
        WHERE tenant_id = $1 AND outbox_id = $2 AND status IN ('PENDING', 'SENDING')`, `'OUTBOUND_UNCERTAIN'`), [tenantId, outboxId, code, confirmBy, now]);
    },
    async markEnded(outboxId, status, code, now) {
      await db.query(auditedOutbox(`UPDATE channel_outbox SET status = $3, body_ciphertext = NULL, error_code = $4, updated_at = $5 WHERE tenant_id = $1 AND outbox_id = $2
        AND status IN ('PENDING', 'SENDING')`, `'OUTBOUND_' || $3`), [tenantId, outboxId, status, code, now]);
    },
    async settleStale(conversationId, staleBefore, confirmBy, now) {
      return (await db.query(auditedOutbox(`UPDATE channel_outbox SET status = 'UNCERTAIN', body_ciphertext = NULL, error_code = 'SEND_INTERRUPTED', next_attempt_at = $4,
        updated_at = $5 WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'SENDING' AND updated_at < $3`, `'OUTBOUND_UNCERTAIN'`),
      [tenantId, conversationId, staleBefore, confirmBy, now])).rows.length;
    },
    async expireUncertain(conversationId, now) {
      const ids = (await db.query(auditedOutbox(`UPDATE channel_outbox SET status = 'FAILED', error_code = 'SEND_OUTCOME_UNKNOWN', updated_at = $3
        WHERE tenant_id = $1 AND conversation_id = $2 AND status = 'UNCERTAIN' AND next_attempt_at <= $3`, `'OUTBOUND_FAILED'`), [tenantId, conversationId, now])).rows
        .map(r => String(r.outbox_id));
      if (!ids.length) return [];
      return (await db.query('SELECT * FROM channel_outbox WHERE tenant_id = $1 AND outbox_id = ANY($2::text[]) ORDER BY created_at, sequence', [tenantId, ids])).rows.map(outboxOf);
    },
    applyDelivery: (correlationId, providerDigest, status: DeliveryRank, errorCode, now) => db.transaction(async tx => {
      const byCorrelation = correlationId && CORRELATION.test(correlationId)
        ? (await tx.query('SELECT * FROM channel_outbox WHERE tenant_id = $1 AND outbox_id = $2 FOR UPDATE', [tenantId, correlationId])).rows[0] : undefined;
      const row = byCorrelation ?? (await tx.query('SELECT * FROM channel_outbox WHERE tenant_id = $1 AND provider_message_digest = $2 FOR UPDATE', [tenantId, providerDigest])).rows[0];
      if (!row) return false;
      const current = row.delivery === null ? null : String(row.delivery);
      // A report for another provider message than the one recorded for this row is not ours.
      if (row.provider_message_digest && !buffer(row.provider_message_digest)!.equals(providerDigest)) return false;
      if (current === 'FAILED' || (status !== 'FAILED' && current !== null && (RANK[current] ?? 0) >= RANK[status]!)) return false;
      // A send whose result was lost (a timeout or a crash after the provider accepted it) is confirmed by the provider's own report.
      const open = row.status === 'SENDING' || row.status === 'PENDING' || row.status === 'UNCERTAIN';
      await tx.query(`UPDATE channel_outbox SET delivery = $3, error_code = coalesce($4, error_code), provider_message_digest = $5,
          status = CASE WHEN $6 AND $3 <> 'FAILED' THEN 'SENT' WHEN $6 THEN 'FAILED' ELSE status END,
          body_ciphertext = CASE WHEN $6 THEN NULL ELSE body_ciphertext END, updated_at = $7
        WHERE tenant_id = $1 AND outbox_id = $2`, [tenantId, row.outbox_id, status, errorCode, providerDigest, open, now]);
      await audit(tx, [{ channel: String((await tx.query('SELECT channel FROM channel_conversations WHERE tenant_id = $1 AND conversation_id = $2',
        [tenantId, row.conversation_id])).rows[0]?.channel ?? 'UNKNOWN'), conversationId: String(row.conversation_id), kind: `DELIVERY_${status}`, code: errorCode,
      handoffId: row.handoff_id === null ? null : String(row.handoff_id), outboxId: String(row.outbox_id) }], now);
      return true;
    }),
    enqueue: (conversationId, outbox, now) => db.transaction(tx => insertOutbox(tx, conversationId, outbox, now)),
    async allow(bucket, limit, windowSeconds, now) {
      const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
      const row = (await db.query<{ count: number }>(`INSERT INTO mcp_rate_limits (tenant_id, bucket, window_start, count) VALUES ($1, $2, $3, 1)
        ON CONFLICT (tenant_id, bucket, window_start) DO UPDATE SET count = mcp_rate_limits.count + 1 RETURNING count`, [tenantId, bucket, windowStart])).rows[0];
      return (row?.count ?? Infinity) <= limit;
    },
    async purge(now) {
      const ago = (ms: number) => new Date(now.getTime() - ms);
      await db.transaction(async tx => {
        // Stranded inbound payloads (a crashed turn) are erased: the message is dropped, never processed late.
        await tx.query(`UPDATE channel_events SET status = 'FAILED', outcome = 'EXPIRED_UNPROCESSED', payload_ciphertext = NULL, processed_at = $2
          WHERE tenant_id = $1 AND status = 'PENDING' AND received_at < $3`, [tenantId, now, ago(RETENTION.transientMs)]);
        // An unsent body past its lifetime: a dead letter (keeping its last provider error) if it already failed transiently, else SKIPPED.
        await tx.query(auditedOutbox(`UPDATE channel_outbox SET body_ciphertext = NULL, updated_at = $2,
            status = CASE WHEN error_code IS NOT NULL AND error_code <> 'ORDER_HELD' THEN 'DEAD' ELSE 'SKIPPED' END,
            error_code = CASE WHEN error_code IS NOT NULL AND error_code <> 'ORDER_HELD' THEN error_code ELSE 'EXPIRED_UNSENT' END
          WHERE tenant_id = $1 AND status = 'PENDING' AND created_at < $3`, `'OUTBOUND_' || u.status`), [tenantId, now, ago(RETENTION.transientMs)]);
        // A send interrupted long ago, or never confirmed: its outcome stays unknown (never resent).
        await tx.query(auditedOutbox(`UPDATE channel_outbox SET status = 'FAILED', error_code = 'SEND_OUTCOME_UNKNOWN', body_ciphertext = NULL, updated_at = $2
          WHERE tenant_id = $1 AND status IN ('SENDING', 'UNCERTAIN') AND created_at < $3`, `'OUTBOUND_FAILED'`), [tenantId, now, ago(2 * RETENTION.transientMs)]);
        await tx.query(`UPDATE channel_conversations SET state_ciphertext = NULL, updated_at = $2 WHERE tenant_id = $1 AND state_ciphertext IS NOT NULL
          AND last_activity_at < $3 AND (lease_until IS NULL OR lease_until <= $2)`, [tenantId, now, ago(RETENTION.stateIdleMs)]);
        await tx.query(`UPDATE channel_conversations SET address_ciphertext = NULL, updated_at = $2 WHERE tenant_id = $1 AND address_ciphertext IS NOT NULL
          AND coalesce(last_inbound_at, created_at) < $3`, [tenantId, now, ago(RETENTION.addressMs)]);
        await tx.query('DELETE FROM channel_events WHERE tenant_id = $1 AND received_at < $2 AND status <> \'PENDING\'', [tenantId, ago(RETENTION.recordMs)]);
        await tx.query(`DELETE FROM channel_outbox WHERE tenant_id = $1 AND created_at < $2 AND status NOT IN ('PENDING', 'SENDING', 'UNCERTAIN')`,
          [tenantId, ago(RETENTION.recordMs)]);
        await tx.query('DELETE FROM channel_audit WHERE tenant_id = $1 AND at < $2', [tenantId, ago(RETENTION.auditMs)]);
        await tx.query(`DELETE FROM channel_conversations WHERE tenant_id = $1 AND status = 'ACTIVE' AND last_activity_at < $2 AND coalesce(last_inbound_at, created_at) < $2
          AND (lease_until IS NULL OR lease_until <= $3)`, [tenantId, ago(RETENTION.conversationIdleMs), now]);
        await tx.query(`DELETE FROM mcp_rate_limits WHERE tenant_id = $1 AND (bucket LIKE 'channel:%' OR bucket LIKE 'handoff:conversation:%') AND window_start < $2`,
          [tenantId, ago(86_400_000)]);
      });
    },
    async strandedConversations(now, limit) {
      return (await db.query(`SELECT c.conversation_id, c.channel FROM channel_conversations c WHERE c.tenant_id = $1 AND (c.lease_until IS NULL OR c.lease_until <= $2)
        AND EXISTS (SELECT 1 FROM channel_events e WHERE e.tenant_id = c.tenant_id AND e.conversation_id = c.conversation_id AND e.status = 'PENDING')
        ORDER BY c.last_activity_at LIMIT $3`, [tenantId, now, limit])).rows.map(refOf);
    },
    async dueConversations(now, staleBefore, limit) {
      // A conversation whose turn holds the lease is left alone: that turn delivers its own messages (an approval link lives only there).
      return (await db.query(`SELECT c.conversation_id, c.channel FROM channel_conversations c WHERE c.tenant_id = $1 AND (c.lease_until IS NULL OR c.lease_until <= $2)
        AND EXISTS (SELECT 1 FROM channel_outbox o
          WHERE o.tenant_id = c.tenant_id AND o.conversation_id = c.conversation_id AND ((o.status = 'PENDING' AND o.next_attempt_at <= $2)
            OR (o.status = 'SENDING' AND o.updated_at < $3) OR (o.status = 'UNCERTAIN' AND o.next_attempt_at <= $2)))
        ORDER BY c.last_activity_at LIMIT $4`, [tenantId, now, staleBefore, limit])).rows.map(refOf);
    },
    async watchedHandoffs(since, limit) {
      return (await db.query(`SELECT DISTINCT ON (e.handoff_id) e.handoff_id, e.conversation_id, c.channel, e.processed_at FROM channel_events e
          JOIN channel_conversations c ON c.tenant_id = e.tenant_id AND c.conversation_id = e.conversation_id
        WHERE e.tenant_id = $1 AND e.handoff_id IS NOT NULL AND NOT e.handoff_settled AND e.processed_at >= $2 AND c.status = 'ACTIVE'
        ORDER BY e.handoff_id, e.processed_at DESC`, [tenantId, since])).rows
        .sort((a, b) => date(b.processed_at).getTime() - date(a.processed_at).getTime()).slice(0, limit)
        .map(row => ({ ...refOf(row), handoffId: String(row.handoff_id) }));
    },
    async settleHandoff(handoffId) {
      await db.query('UPDATE channel_events SET handoff_settled = true WHERE tenant_id = $1 AND handoff_id = $2 AND NOT handoff_settled', [tenantId, handoffId]);
    },
    audit: (entries, now) => audit(db, entries, now),
  };
}
