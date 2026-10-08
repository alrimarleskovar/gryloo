// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: linking a channel conversation (Telegram) to an owner's automation notifications — migration 0010.
 *
 *   1. In FloFi, the owner's verified session creates a one-time code (`XXXX-XXXX-XXXX`, ~59 bits, 10 minutes, one per owner at a
 *      time, at most 5 per hour). Only its keyed digest (HKDF of FLOFI_AUTOMATION_SECRET) is stored.
 *   2. In the chat, the owner sends `automations <code>`. Channel Core hands it to `consumeLinkCode` (at most 5 attempts per
 *      conversation per hour), which consumes the code once and links that conversation to the owner for 90 days. The conversation
 *      keeps its sealed send address while linked (`channel_conversations.retain_until`); STOP or an unlink in FloFi ends it.
 *
 * A link carries no authority: notifications only point to the owner's FloFi session, and a sender id is never a wallet identity.
 */
import { createHmac, randomInt } from 'node:crypto';
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import type { AutomationKeys } from './config.ts';
import type { Owner } from './store.ts';

export const LINK_CODE_TTL_MS = 10 * 60_000;
export const LINK_TTL_MS = 90 * 86_400_000;
export const LINK_CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const digestOf = (keys: AutomationKeys, code: string) => createHmac('sha256', keys.linkCode).update(code, 'utf8').digest();
/** An opaque, per-owner abuse-limit bucket (never an address). */
export const ownerBucket = (keys: AutomationKeys, owner: Owner) => `automation:link:${createHmac('sha256', keys.linkCode).update(`${owner.namespace}:${owner.address}`).digest('hex').slice(0, 32)}`;

export function newLinkCode(): string {
  const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]!).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}
/** A fresh code for the owner; any earlier unconsumed code of theirs stops working. */
export async function createLinkCode(db: Database, tenantId: string, keys: AutomationKeys, owner: Owner, now: Date): Promise<{ readonly code: string; readonly expiresAt: Date }> {
  const code = newLinkCode(), expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  await db.transaction(async tx => {
    await tx.query(`DELETE FROM automation_link_codes WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3 AND consumed_at IS NULL`,
      [tenantId, owner.namespace, owner.address]);
    await tx.query(`INSERT INTO automation_link_codes (tenant_id, code_digest, owner_namespace, owner_account, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, digestOf(keys, code), owner.namespace, owner.address, expiresAt, now]);
  });
  return { code, expiresAt };
}
export type LinkResult = { readonly ok: true; readonly owner: Owner; readonly expiresAt: Date } | { readonly ok: false; readonly code: 'AUTOMATION_LINK_CODE_INVALID' };
/** Consumes a code once and links the conversation to its owner (moving the conversation from any earlier owner). */
export async function consumeLinkCode(db: Database, tenantId: string, keys: AutomationKeys, input: { readonly channel: string; readonly conversationId: string;
  readonly code: string; readonly now: Date }): Promise<LinkResult> {
  const code = input.code.toUpperCase();
  if (!LINK_CODE.test(code)) return { ok: false, code: 'AUTOMATION_LINK_CODE_INVALID' };
  return db.transaction(async tx => {
    const row = (await tx.query<{ owner_namespace: Owner['namespace']; owner_account: string }>(`UPDATE automation_link_codes SET consumed_at = $3
      WHERE tenant_id = $1 AND code_digest = $2 AND consumed_at IS NULL AND expires_at > $3 RETURNING owner_namespace, owner_account`,
    [tenantId, digestOf(keys, code), input.now])).rows[0];
    if (!row) return { ok: false, code: 'AUTOMATION_LINK_CODE_INVALID' } as const;
    const owner: Owner = { namespace: row.owner_namespace, address: row.owner_account }, expiresAt = new Date(input.now.getTime() + LINK_TTL_MS);
    const released = (await tx.query<{ conversation_id: string }>(`DELETE FROM automation_notification_targets WHERE tenant_id = $1
      AND (conversation_id = $2 OR (owner_namespace = $3 AND owner_account = $4 AND channel = $5)) RETURNING conversation_id`,
    [tenantId, input.conversationId, owner.namespace, owner.address, input.channel])).rows.map(r => r.conversation_id).filter(id => id !== input.conversationId);
    if (released.length) await tx.query(`UPDATE channel_conversations SET retain_until = NULL WHERE tenant_id = $1 AND conversation_id = ANY($2::text[])`, [tenantId, released]);
    await tx.query(`INSERT INTO automation_notification_targets (tenant_id, owner_namespace, owner_account, channel, conversation_id, linked_at, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [tenantId, owner.namespace, owner.address, input.channel, input.conversationId, input.now, expiresAt]);
    await tx.query(`UPDATE channel_conversations SET retain_until = $3 WHERE tenant_id = $1 AND conversation_id = $2`, [tenantId, input.conversationId, expiresAt]);
    return { ok: true, owner, expiresAt } as const;
  });
}
/** Ends a conversation's link (STOP in the chat). */
export async function unlinkConversation(db: Database, tenantId: string, conversationId: string): Promise<boolean> {
  return db.transaction(async tx => {
    const n = (await tx.query(`DELETE FROM automation_notification_targets WHERE tenant_id = $1 AND conversation_id = $2`, [tenantId, conversationId])).rowCount;
    await tx.query(`UPDATE channel_conversations SET retain_until = NULL WHERE tenant_id = $1 AND conversation_id = $2`, [tenantId, conversationId]);
    return n > 0;
  });
}
/** Ends the owner's link on a channel (unlink in FloFi). */
export async function unlinkOwner(db: Database, tenantId: string, owner: Owner, channel: string): Promise<boolean> {
  return db.transaction(async tx => {
    const rows = (await tx.query<{ conversation_id: string }>(`DELETE FROM automation_notification_targets WHERE tenant_id = $1 AND owner_namespace = $2 AND owner_account = $3
      AND channel = $4 RETURNING conversation_id`, [tenantId, owner.namespace, owner.address, channel])).rows;
    if (rows.length) await tx.query(`UPDATE channel_conversations SET retain_until = NULL WHERE tenant_id = $1 AND conversation_id = ANY($2::text[])`,
      [tenantId, rows.map(r => r.conversation_id)]);
    return rows.length > 0;
  });
}
export type Target = { readonly channel: string; readonly conversationId: string; readonly expiresAt: Date };
/** The owner's live links to ACTIVE conversations. */
export async function targetsOf(db: Database, tenantId: string, owner: Owner, now: Date): Promise<readonly Target[]> {
  return (await db.query<{ channel: string; conversation_id: string; expires_at: Date }>(`SELECT t.channel, t.conversation_id, t.expires_at
    FROM automation_notification_targets t JOIN channel_conversations c ON c.tenant_id = t.tenant_id AND c.conversation_id = t.conversation_id
    WHERE t.tenant_id = $1 AND t.owner_namespace = $2 AND t.owner_account = $3 AND t.expires_at > $4 AND c.status = 'ACTIVE' ORDER BY t.channel`,
  [tenantId, owner.namespace, owner.address, now])).rows.map(r => ({ channel: r.channel, conversationId: r.conversation_id, expiresAt: new Date(r.expires_at) }));
}
