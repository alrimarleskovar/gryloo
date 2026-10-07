// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: Channel Core's durable state on a disposable loopback PostgreSQL (staged migration 0008). Deduplication under
 * concurrent duplicate deliveries, one lease holder per conversation with fencing, the transactional outbox and its monotonic
 * delivery reports, and data minimization enforced by the schema itself: no payload survives processing, no body survives sending,
 * an opted-out sender keeps only its digest, and retention erases transient content lazily.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import { createChannelTestDatabase } from './channel-db.test-harness.ts';
import { channelKeys, channelRowId, keyedDigest, leaseToken, open, seal, sealContext } from './crypto.ts';
import { createPgChannelStore } from './pg-store.ts';
import type { NewOutbox } from './store.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createChannelTestDatabase(); });
afterAll(async () => { await t?.drop(); });
const keys = channelKeys(randomBytes(32).toString('hex'));
const store = () => createPgChannelStore(t.db, 'default');
const at = (iso: string) => new Date(iso);
const NOW = at('2026-10-07T12:00:00Z');
async function conversation(subject = randomBytes(8).toString('hex'), now = NOW) {
  return store().ensureConversation('WHATSAPP', '106540352242922', keyedDigest(keys.subject, subject), now, now, channelRowId('chc'));
}
const event = (conversationId: string | null, id = randomBytes(12).toString('hex'), sentAt = NOW, status: 'PENDING' | 'IGNORED' = 'PENDING') => ({
  channel: 'WHATSAPP', eventDigest: keyedDigest(keys.event, id), conversationId, sentAt, status,
  payloadSealed: status === 'PENDING' ? seal(keys.seal, JSON.stringify({ kind: 'TEXT', text: 'hello' }), 'x') : null, outcome: status === 'IGNORED' ? 'IGNORED_NOT_ALLOWLISTED' : null });
const outbox = (key: string, sequence = 0): NewOutbox => ({ outboxId: channelRowId('cho'), dedupeKey: key, kind: 'REPLY', sequence, bodySealed: seal(keys.seal, 'body', key),
  handoffId: null });

describe('BUILD-CHANNELS-001 channel store (PostgreSQL, staged migration 0008)', () => {
  it('reports the schema and keeps one conversation per sender, with the window following the provider send time', async () => {
    expect(await store().schemaInstalled()).toBe(true);
    const a = await conversation('sender-1'), again = await store().ensureConversation('WHATSAPP', '106540352242922', keyedDigest(keys.subject, 'sender-1'),
      at('2026-10-07T11:00:00Z'), NOW, channelRowId('chc'));
    expect(again.conversationId).toBe(a.conversationId);
    // A late (re)delivery of an older message never moves the window forward.
    expect(again.lastInboundAt).toEqual(NOW);
    const raw = (await t.db.query('SELECT * FROM channel_conversations WHERE conversation_id = $1', [a.conversationId])).rows[0]!;
    expect(JSON.stringify(raw)).not.toMatch(/sender-1/);
  });

  it('deduplicates a provider message delivered twice, in one batch and in concurrent requests', async () => {
    const c = await conversation(), dup = event(c.conversationId, 'wamid.same');
    expect((await store().recordEvents([dup, dup], NOW)).length).toBe(1);
    const results = await Promise.all(Array.from({ length: 6 }, () => createPgChannelStore(t.open(2), 'default').recordEvents([event(c.conversationId, 'wamid.race')], NOW)));
    expect(results.flat().length).toBe(1);
    expect((await t.db.query('SELECT count(*)::int AS n FROM channel_events WHERE conversation_id = $1', [c.conversationId])).rows[0]!.n).toBe(2);
  });

  it('lets one lease holder process a conversation, fences a holder whose lease lapsed and releases only when no work is pending', async () => {
    const s = store(), c = await conversation(), first = leaseToken(), second = leaseToken();
    await s.recordEvents([event(c.conversationId, 'e1', at('2026-10-07T11:59:58Z')), event(c.conversationId, 'e2', at('2026-10-07T11:59:59Z'))], NOW);
    expect(await s.acquire(c.conversationId, first, NOW, 300)).toBe(true);
    expect(await s.acquire(c.conversationId, second, NOW, 300)).toBe(false);
    const e1 = await s.nextEvent(c.conversationId, first, NOW);
    expect(e1?.eventDigest).toEqual(keyedDigest(keys.event, 'e1'));
    expect(e1?.attempts).toBe(1);
    await s.completeTurn(c.conversationId, first, { channel: 'WHATSAPP', eventDigest: e1!.eventDigest, status: 'DONE', outcome: 'REPLIED', handoffId: null,
      stateSealed: seal(keys.seal, '{}', 'state'), outbox: [outbox(`reply:${c.conversationId}:1`)] }, NOW);
    expect(await s.release(c.conversationId, first, NOW)).toBe(false); // e2 is still pending
    // The lease lapses; another instance takes over and the old holder's late commit is refused.
    const later = new Date(NOW.getTime() + 301_000);
    expect(await s.acquire(c.conversationId, second, later, 300)).toBe(true);
    await expect(s.completeTurn(c.conversationId, first, { channel: 'WHATSAPP', eventDigest: keyedDigest(keys.event, 'e2'), status: 'DONE', outcome: 'REPLIED',
      handoffId: null, outbox: [] }, later)).rejects.toThrow('CHANNEL_LEASE_LOST');
    const e2 = await s.nextEvent(c.conversationId, second, later);
    await s.completeTurn(c.conversationId, second, { channel: 'WHATSAPP', eventDigest: e2!.eventDigest, status: 'DONE', outcome: 'REPLIED', handoffId: null, outbox: [] }, later);
    expect(await s.release(c.conversationId, second, later)).toBe(true);
    // Content never survives processing (and the database itself refuses it).
    const rows = (await t.db.query('SELECT status, payload_ciphertext FROM channel_events WHERE conversation_id = $1', [c.conversationId])).rows;
    expect(rows.every(r => r.status === 'DONE' && r.payload_ciphertext === null)).toBe(true);
    await expect(t.db.query(`UPDATE channel_events SET payload_ciphertext = $2 WHERE conversation_id = $1`, [c.conversationId, randomBytes(40)])).rejects.toThrow();
  });

  it('delivers the outbox once per key, in order, and applies provider reports monotonically (crash recovery included)', async () => {
    const s = store(), c = await conversation();
    expect((await s.enqueue(c.conversationId, [outbox(`notify:${c.conversationId}:a`, 0), outbox(`notify:${c.conversationId}:b`, 1)], NOW)).length).toBe(2);
    expect((await s.enqueue(c.conversationId, [outbox(`notify:${c.conversationId}:a`, 0)], NOW)).length).toBe(0);
    const due = await s.claimDue(c.conversationId, NOW, new Date(NOW.getTime() - 120_000), 8);
    expect(due.map(o => o.dedupeKey)).toEqual([`notify:${c.conversationId}:a`, `notify:${c.conversationId}:b`]);
    expect(await s.claimDue(c.conversationId, NOW, new Date(NOW.getTime() - 120_000), 8)).toEqual([]);
    const providerA = keyedDigest(keys.provider, 'wamid.A');
    await s.markSent(due[0]!.outboxId, providerA, NOW);
    expect(await s.applyDelivery(null, providerA, 'READ', null, NOW)).toBe(true);
    expect(await s.applyDelivery(null, providerA, 'DELIVERED', null, NOW)).toBe(false); // never backwards
    // The second message's send result was lost (crash after the provider accepted it): its own report recovers it.
    const providerB = keyedDigest(keys.provider, 'wamid.B');
    expect(await s.applyDelivery(due[1]!.outboxId, providerB, 'SENT', null, NOW)).toBe(true);
    const rows = (await t.db.query('SELECT outbox_id, status, delivery, body_ciphertext FROM channel_outbox WHERE conversation_id = $1 ORDER BY sequence', [c.conversationId])).rows;
    expect(rows.map(r => [r.status, r.delivery, r.body_ciphertext])).toEqual([['SENT', 'READ', null], ['SENT', 'SENT', null]]);
    // A report naming another provider message for a known row is not ours.
    expect(await s.applyDelivery(due[0]!.outboxId, keyedDigest(keys.provider, 'wamid.other'), 'READ', null, NOW)).toBe(false);
  });

  it('retries transient failures and erases bodies at every terminal state', async () => {
    const s = store(), c = await conversation();
    await s.enqueue(c.conversationId, [outbox(`reply:${c.conversationId}:x`)], NOW);
    const [first] = await s.claimDue(c.conversationId, NOW, NOW, 8);
    await s.markRetry(first!.outboxId, 'PROVIDER_THROTTLED', new Date(NOW.getTime() + 5_000), NOW);
    expect(await s.claimDue(c.conversationId, NOW, NOW, 8)).toEqual([]);
    const [again] = await s.claimDue(c.conversationId, new Date(NOW.getTime() + 6_000), NOW, 8);
    expect(again?.attempts).toBe(2);
    await s.markEnded(again!.outboxId, 'FAILED', 'PROVIDER_POLICY_RESTRICTED', NOW);
    const row = (await t.db.query('SELECT status, body_ciphertext, error_code FROM channel_outbox WHERE outbox_id = $1', [again!.outboxId])).rows[0]!;
    expect(row).toMatchObject({ status: 'FAILED', body_ciphertext: null, error_code: 'PROVIDER_POLICY_RESTRICTED' });
  });

  it('keeps only the digest and status of an opted-out sender and refuses any content for it', async () => {
    const s = store(), c = await conversation(), token = leaseToken();
    await s.storeAddress(c.conversationId, seal(keys.seal, '{"kind":"phone","value":"x"}', sealContext('default', 'channel_conversations', c.conversationId, 'address')));
    await s.recordEvents([event(c.conversationId, 'stop')], NOW);
    await s.acquire(c.conversationId, token, NOW, 300);
    const e = await s.nextEvent(c.conversationId, token, NOW);
    await s.completeTurn(c.conversationId, token, { channel: 'WHATSAPP', eventDigest: e!.eventDigest, status: 'DONE', outcome: 'OPTED_OUT', handoffId: null,
      stateSealed: seal(keys.seal, '{}', 'state'), conversationStatus: 'OPTED_OUT', outbox: [] }, NOW);
    const row = (await s.conversation(c.conversationId))!;
    expect(row).toMatchObject({ status: 'OPTED_OUT', addressSealed: null, stateSealed: null });
    await s.storeAddress(c.conversationId, seal(keys.seal, 'x', 'y'));
    expect((await s.conversation(c.conversationId))!.addressSealed).toBeNull();
    await expect(t.db.query('UPDATE channel_conversations SET state_ciphertext = $2 WHERE conversation_id = $1', [c.conversationId, randomBytes(40)])).rejects.toThrow();
  });

  it('records senders outside the allowlist without a conversation or any content', async () => {
    const e = event(null, 'stranger', NOW, 'IGNORED');
    expect((await store().recordEvents([e], NOW)).length).toBe(1);
    const row = (await t.db.query('SELECT conversation_id, payload_ciphertext, outcome FROM channel_events WHERE event_digest = $1', [e.eventDigest])).rows[0]!;
    expect(row).toEqual({ conversation_id: null, payload_ciphertext: null, outcome: 'IGNORED_NOT_ALLOWLISTED' });
  });

  it('erases transient content lazily: stranded payloads, unsent bodies, idle state and lapsed addresses, then old records', async () => {
    const s = store(), c = await conversation(randomBytes(8).toString('hex'), at('2026-10-06T08:00:00Z'));
    await s.storeAddress(c.conversationId, seal(keys.seal, 'address', 'a'));
    await s.recordEvents([event(c.conversationId, 'stranded', at('2026-10-06T08:00:00Z'))], at('2026-10-06T08:00:00Z'));
    await s.enqueue(c.conversationId, [outbox(`reply:${c.conversationId}:old`)], at('2026-10-06T08:00:00Z'));
    await t.db.query('UPDATE channel_conversations SET state_ciphertext = $2, last_activity_at = $3 WHERE conversation_id = $1',
      [c.conversationId, seal(keys.seal, '{}', 's'), at('2026-10-06T08:00:00Z')]);
    await s.purge(NOW);
    const conv = (await s.conversation(c.conversationId))!;
    expect(conv).toMatchObject({ stateSealed: null, addressSealed: null });
    const ev = (await t.db.query('SELECT status, outcome, payload_ciphertext FROM channel_events WHERE conversation_id = $1', [c.conversationId])).rows[0]!;
    expect(ev).toEqual({ status: 'FAILED', outcome: 'EXPIRED_UNPROCESSED', payload_ciphertext: null });
    const ob = (await t.db.query('SELECT status, error_code, body_ciphertext FROM channel_outbox WHERE conversation_id = $1', [c.conversationId])).rows[0]!;
    expect(ob).toEqual({ status: 'SKIPPED', error_code: 'EXPIRED_UNSENT', body_ciphertext: null });
    // Eight days later the content-free records go too, and the idle conversation record with them.
    await s.purge(new Date(NOW.getTime() + 9 * 86_400_000));
    expect(await s.conversation(c.conversationId)).toBeNull();
  });

  it('seals values bound to their row: another row, key or alteration does not open', () => {
    const aad = sealContext('default', 'channel_conversations', 'chc_a', 'state'), sealed = seal(keys.seal, '{"v":1}', aad);
    expect(open(keys.seal, sealed, aad)).toBe('{"v":1}');
    expect(open(keys.seal, sealed, sealContext('default', 'channel_conversations', 'chc_b', 'state'))).toBeNull();
    expect(open(channelKeys(randomBytes(32).toString('hex')).seal, sealed, aad)).toBeNull();
    const tampered = Buffer.from(sealed); tampered[tampered.length - 1]! ^= 1;
    expect(open(keys.seal, tampered, aad)).toBeNull();
  });

  it('counts abuse limits in fixed windows', async () => {
    const s = store(), bucket = `channel:test:${randomBytes(4).toString('hex')}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await s.allow(bucket, 3, 60, NOW));
    expect(results).toEqual([true, true, true, false]);
    expect(await s.allow(bucket, 3, 60, new Date(NOW.getTime() + 60_000))).toBe(true);
  });
});
