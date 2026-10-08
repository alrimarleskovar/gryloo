// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: Channel Core's durable state on a disposable loopback PostgreSQL (migration 0009). Deduplication under
 * concurrent duplicate deliveries, one lease holder per conversation with fencing, the transactional outbox (claimed once, retried,
 * dead-lettered, never resent once its outcome is uncertain) and its monotonic delivery reports, the scheduled sweep's queries, the
 * content-free audit trail, tenant isolation, and data minimization enforced by the schema itself: no payload survives processing, no
 * body survives sending, an opted-out sender keeps only its digest, and retention erases transient content.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import { channelKeys, channelRowId, keyedDigest, leaseToken, open, seal, sealContext } from './crypto.ts';
import { createPgChannelStore } from './pg-store.ts';
import type { NewOutbox } from './store.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
const keys = channelKeys(randomBytes(32).toString('hex'));
const store = () => createPgChannelStore(t.db, 'default');
const at = (iso: string) => new Date(iso);
const ALL = ['REPLY', 'APPROVAL', 'NOTIFICATION'] as const;
const NOW = at('2026-10-07T12:00:00Z');
async function conversation(subject = randomBytes(8).toString('hex'), now = NOW) {
  return store().ensureConversation('WHATSAPP', '106540352242922', keyedDigest(keys.subject, subject), now, now, channelRowId('chc'));
}
const event = (conversationId: string | null, id = randomBytes(12).toString('hex'), sentAt = NOW, status: 'PENDING' | 'IGNORED' = 'PENDING') => ({
  channel: 'WHATSAPP', eventDigest: keyedDigest(keys.event, id), conversationId, sentAt, status,
  payloadSealed: status === 'PENDING' ? seal(keys.seal, JSON.stringify({ kind: 'TEXT', text: 'hello' }), 'x') : null, outcome: status === 'IGNORED' ? 'IGNORED_NOT_ALLOWLISTED' : null });
const outbox = (key: string, sequence = 0): NewOutbox => ({ outboxId: channelRowId('cho'), dedupeKey: key, kind: 'REPLY', sequence, bodySealed: seal(keys.seal, 'body', key),
  handoffId: null });

describe('BUILD-CHANNELS-001 channel store (PostgreSQL, migration 0009)', () => {
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
    // An approval message is invisible to a claim that does not ask for approvals (only its own turn holds its link).
    await s.enqueue(c.conversationId, [{ ...outbox(`reply:${c.conversationId}:approval`, 2), kind: 'APPROVAL' }], NOW);
    expect(await s.claimDue(c.conversationId, NOW, 8, ['NOTIFICATION'])).toEqual([]);
    const due = await s.claimDue(c.conversationId, NOW, 8, ['REPLY', 'NOTIFICATION']);
    expect(due.map(o => o.dedupeKey)).toEqual([`notify:${c.conversationId}:a`, `notify:${c.conversationId}:b`]);
    expect(await s.claimDue(c.conversationId, NOW, 8, ['REPLY', 'NOTIFICATION'])).toEqual([]);
    expect((await s.claimDue(c.conversationId, NOW, 8, ALL)).map(o => o.kind)).toEqual(['APPROVAL']);
    const providerA = keyedDigest(keys.provider, 'wamid.A');
    await s.markSent(due[0]!.outboxId, providerA, NOW);
    expect(await s.applyDelivery(null, providerA, 'READ', null, NOW)).toBe(true);
    expect(await s.applyDelivery(null, providerA, 'DELIVERED', null, NOW)).toBe(false); // never backwards
    // The second message's send result was lost (crash after the provider accepted it): its own report recovers it.
    const providerB = keyedDigest(keys.provider, 'wamid.B');
    expect(await s.applyDelivery(due[1]!.outboxId, providerB, 'SENT', null, NOW)).toBe(true);
    const rows = (await t.db.query(`SELECT outbox_id, status, delivery, body_ciphertext FROM channel_outbox WHERE conversation_id = $1 AND kind = 'REPLY' ORDER BY sequence`,
      [c.conversationId])).rows;
    expect(rows.map(r => [r.status, r.delivery, r.body_ciphertext])).toEqual([['SENT', 'READ', null], ['SENT', 'SENT', null]]);
    // A report naming another provider message for a known row is not ours.
    expect(await s.applyDelivery(due[0]!.outboxId, keyedDigest(keys.provider, 'wamid.other'), 'READ', null, NOW)).toBe(false);
  });

  it('retries transient failures and erases bodies at every terminal state', async () => {
    const s = store(), c = await conversation();
    await s.enqueue(c.conversationId, [outbox(`reply:${c.conversationId}:x`)], NOW);
    const [first] = await s.claimDue(c.conversationId, NOW, 8, ALL);
    await s.markRetry(first!.outboxId, 'PROVIDER_THROTTLED', new Date(NOW.getTime() + 5_000), NOW);
    expect(await s.claimDue(c.conversationId, NOW, 8, ALL)).toEqual([]);
    const [again] = await s.claimDue(c.conversationId, new Date(NOW.getTime() + 6_000), 8, ALL);
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

  it('erases transient content: stranded payloads, unsent bodies, idle state and lapsed addresses, then old records', async () => {
    // 52 hours ago: past the address retention (24-hour window + 24 hours for template notifications).
    const then = at('2026-10-05T08:00:00Z'), s = store(), c = await conversation(randomBytes(8).toString('hex'), then);
    await s.storeAddress(c.conversationId, seal(keys.seal, 'address', 'a'));
    await s.recordEvents([event(c.conversationId, 'stranded', then)], then);
    await s.enqueue(c.conversationId, [outbox(`reply:${c.conversationId}:old`)], then);
    // A second body that already failed transiently: past its lifetime it is a dead letter, not "never attempted".
    await s.enqueue(c.conversationId, [outbox(`reply:${c.conversationId}:failed`, 1)], then);
    const [held, failed] = await s.claimDue(c.conversationId, then, 8, ALL);
    await s.markRetry(held!.outboxId, 'ORDER_HELD', new Date(then.getTime() + 5_000), then);
    await s.markRetry(failed!.outboxId, 'PROVIDER_UNAVAILABLE', new Date(then.getTime() + 5_000), then);
    await t.db.query('UPDATE channel_conversations SET state_ciphertext = $2, last_activity_at = $3 WHERE conversation_id = $1',
      [c.conversationId, seal(keys.seal, '{}', 's'), then]);
    await s.purge(NOW);
    const conv = (await s.conversation(c.conversationId))!;
    expect(conv).toMatchObject({ stateSealed: null, addressSealed: null });
    const ev = (await t.db.query('SELECT status, outcome, payload_ciphertext FROM channel_events WHERE conversation_id = $1', [c.conversationId])).rows[0]!;
    expect(ev).toEqual({ status: 'FAILED', outcome: 'EXPIRED_UNPROCESSED', payload_ciphertext: null });
    const ob = (await t.db.query('SELECT status, error_code, body_ciphertext FROM channel_outbox WHERE conversation_id = $1 ORDER BY sequence', [c.conversationId])).rows;
    expect(ob).toEqual([{ status: 'SKIPPED', error_code: 'EXPIRED_UNSENT', body_ciphertext: null },
      { status: 'DEAD', error_code: 'PROVIDER_UNAVAILABLE', body_ciphertext: null }]);
    // Eight days later the content-free records go too, and the idle conversation record with them.
    await s.purge(new Date(NOW.getTime() + 9 * 86_400_000));
    expect(await s.conversation(c.conversationId)).toBeNull();
  });

  it('never resends a send whose outcome is unknown: interrupted and uncertain sends wait for a report, then end unknown', async () => {
    const s = store(), c = await conversation();
    await s.enqueue(c.conversationId, [outbox(`reply:${c.conversationId}:u`, 0), outbox(`reply:${c.conversationId}:crash`, 1)], NOW);
    const [u, crashed] = await s.claimDue(c.conversationId, NOW, 8, ALL);
    // A timeout after sending: UNCERTAIN, body erased, never claimable again.
    await s.markUncertain(u!.outboxId, 'PROVIDER_TIMEOUT', new Date(NOW.getTime() + 600_000), NOW);
    // A crash between claim and answer: the stale SENDING row is settled the same way.
    expect(await s.settleStale(c.conversationId, NOW, new Date(NOW.getTime() + 600_000), NOW)).toBe(0);
    const later = new Date(NOW.getTime() + 180_000);
    expect(await s.settleStale(c.conversationId, new Date(later.getTime() - 120_000), new Date(later.getTime() + 600_000), later)).toBe(1);
    expect(await s.claimDue(c.conversationId, new Date(NOW.getTime() + 3_600_000), 8, ALL)).toEqual([]);
    const statuses = async () => (await t.db.query('SELECT outbox_id, status, error_code, body_ciphertext FROM channel_outbox WHERE conversation_id = $1 ORDER BY sequence',
      [c.conversationId])).rows.map(r => [r.status, r.error_code, r.body_ciphertext]);
    expect(await statuses()).toEqual([['UNCERTAIN', 'PROVIDER_TIMEOUT', null], ['UNCERTAIN', 'SEND_INTERRUPTED', null]]);
    // The provider's own report (correlated by our id) confirms the first; the second is never confirmed and ends unknown.
    expect(await s.applyDelivery(u!.outboxId, keyedDigest(keys.provider, 'wamid.U'), 'DELIVERED', null, later)).toBe(true);
    expect(await s.expireUncertain(c.conversationId, later)).toEqual([]);
    const expired = await s.expireUncertain(c.conversationId, new Date(later.getTime() + 600_000));
    expect(expired.map(o => [o.outboxId, o.status, o.errorCode])).toEqual([[crashed!.outboxId, 'FAILED', 'SEND_OUTCOME_UNKNOWN']]);
    expect(await statuses()).toEqual([['SENT', 'PROVIDER_TIMEOUT', null], ['FAILED', 'SEND_OUTCOME_UNKNOWN', null]]);
    await expect(t.db.query(`UPDATE channel_outbox SET body_ciphertext = $2 WHERE outbox_id = $1`, [u!.outboxId, randomBytes(40)])).rejects.toThrow();
  });

  it('dead-letters a message whose transient failures exhausted its attempts', async () => {
    const s = store(), c = await conversation();
    await s.enqueue(c.conversationId, [outbox(`reply:${c.conversationId}:d`)], NOW);
    const [o] = await s.claimDue(c.conversationId, NOW, 8, ALL);
    await s.markEnded(o!.outboxId, 'DEAD', 'PROVIDER_UNAVAILABLE', NOW);
    const row = (await t.db.query('SELECT status, error_code, body_ciphertext FROM channel_outbox WHERE outbox_id = $1', [o!.outboxId])).rows[0]!;
    expect(row).toEqual({ status: 'DEAD', error_code: 'PROVIDER_UNAVAILABLE', body_ciphertext: null });
  });

  it('finds the scheduled sweep\'s work: stranded turns, due or unconfirmed sends without a live lease, and approvals to follow', async () => {
    const s = store(), c = await conversation(), d = await conversation(), token = leaseToken();
    const has = (refs: readonly { conversationId: string }[], id: string) => refs.some(r => r.conversationId === id);
    await s.recordEvents([event(c.conversationId, randomBytes(6).toString('hex'))], NOW);
    expect(has(await s.strandedConversations(NOW, 500), c.conversationId)).toBe(true);
    // A live lease means a turn is running: not stranded, and its outbox is that turn's to deliver.
    await s.acquire(c.conversationId, token, NOW, 300);
    await s.enqueue(c.conversationId, [outbox(`reply:${c.conversationId}:due`)], NOW);
    expect(has(await s.strandedConversations(NOW, 500), c.conversationId)).toBe(false);
    expect(has(await s.dueConversations(NOW, new Date(NOW.getTime() - 120_000), 500), c.conversationId)).toBe(false);
    const lapsed = new Date(NOW.getTime() + 301_000);
    expect(has(await s.strandedConversations(lapsed, 500), c.conversationId)).toBe(true);
    expect(has(await s.dueConversations(lapsed, new Date(lapsed.getTime() - 120_000), 500), c.conversationId)).toBe(true);
    // A retry not yet due is not work.
    await s.enqueue(d.conversationId, [outbox(`reply:${d.conversationId}:later`)], NOW);
    const [o] = await s.claimDue(d.conversationId, NOW, 8, ALL);
    await s.markRetry(o!.outboxId, 'PROVIDER_THROTTLED', new Date(NOW.getTime() + 60_000), NOW);
    expect(has(await s.dueConversations(NOW, new Date(NOW.getTime() - 120_000), 500), d.conversationId)).toBe(false);
    expect(has(await s.dueConversations(new Date(NOW.getTime() + 61_000), NOW, 500), d.conversationId)).toBe(true);
    // An approval created by a turn is followed until it is settled.
    const e = event(d.conversationId, randomBytes(6).toString('hex')), lease = leaseToken(), handoffId = `apr_${'b'.repeat(26)}`;
    await s.recordEvents([e], NOW);
    await s.acquire(d.conversationId, lease, NOW, 300);
    await s.nextEvent(d.conversationId, lease, NOW);
    await s.completeTurn(d.conversationId, lease, { channel: 'WHATSAPP', eventDigest: e.eventDigest, status: 'DONE', outcome: 'APPROVAL_CREATED', handoffId, outbox: [] }, NOW);
    expect((await s.watchedHandoffs(new Date(NOW.getTime() - 60_000), 500)).filter(w => w.handoffId === handoffId))
      .toEqual([{ conversationId: d.conversationId, channel: 'WHATSAPP', handoffId }]);
    await s.settleHandoff(handoffId);
    expect((await s.watchedHandoffs(new Date(NOW.getTime() - 60_000), 500)).filter(w => w.handoffId === handoffId)).toEqual([]);
  });

  it('keeps a content-free audit trail of every state change, in the same transaction', async () => {
    const s = store(), c = await conversation(), e = event(c.conversationId, 'audited'), token = leaseToken();
    await s.recordEvents([e], NOW);
    await s.acquire(c.conversationId, token, NOW, 300);
    await s.nextEvent(c.conversationId, token, NOW);
    await s.completeTurn(c.conversationId, token, { channel: 'WHATSAPP', eventDigest: e.eventDigest, status: 'DONE', outcome: 'HELP', handoffId: null,
      outbox: [outbox(`reply:${c.conversationId}:audit`)] }, NOW);
    const [o] = await s.claimDue(c.conversationId, NOW, 8, ALL);
    await s.markRetry(o!.outboxId, 'PROVIDER_THROTTLED', NOW, NOW);
    const [again] = await s.claimDue(c.conversationId, NOW, 8, ALL);
    await s.markSent(again!.outboxId, keyedDigest(keys.provider, 'wamid.audit'), NOW);
    await s.applyDelivery(again!.outboxId, keyedDigest(keys.provider, 'wamid.audit'), 'READ', null, NOW);
    const rows = (await t.db.query(`SELECT channel, kind, code, outbox_id FROM channel_audit WHERE conversation_id = $1 ORDER BY audit_id`, [c.conversationId])).rows;
    expect(rows.map(r => [r.kind, r.code])).toEqual([['INBOUND_RECORDED', null], ['TURN_DONE', 'HELP'], ['OUTBOUND_QUEUED_REPLY', null], ['OUTBOUND_RETRY', 'PROVIDER_THROTTLED'],
      ['OUTBOUND_SENT', null], ['DELIVERY_READ', null]]);
    expect(rows.every(r => r.channel === 'WHATSAPP')).toBe(true);
    // Nothing but closed codes and opaque ids: the schema refuses free text.
    await expect(s.audit([{ channel: 'WHATSAPP', conversationId: c.conversationId, kind: 'NOTE', code: 'hello there' }], NOW)).rejects.toThrow();
    // Audit rows outlive the records they describe, then go after 30 days.
    await s.purge(new Date(NOW.getTime() + 29 * 86_400_000));
    expect((await t.db.query('SELECT count(*)::int AS n FROM channel_audit WHERE conversation_id = $1', [c.conversationId])).rows[0]!.n).toBe(6);
    await s.purge(new Date(NOW.getTime() + 31 * 86_400_000));
    expect((await t.db.query('SELECT count(*)::int AS n FROM channel_audit WHERE conversation_id = $1', [c.conversationId])).rows[0]!.n).toBe(0);
  });

  it('isolates tenants: another deployment sharing the database sees, sweeps and settles none of these rows', async () => {
    await t.db.query(`INSERT INTO tenants (tenant_id) VALUES ('other-tenant') ON CONFLICT DO NOTHING`);
    const mine = store(), theirs = createPgChannelStore(t.db, 'other-tenant'), c = await conversation();
    await mine.recordEvents([event(c.conversationId, randomBytes(6).toString('hex'))], NOW);
    await mine.enqueue(c.conversationId, [outbox(`reply:${c.conversationId}:iso`)], NOW);
    expect(await theirs.conversation(c.conversationId)).toBeNull();
    expect((await theirs.strandedConversations(NOW, 500)).some(r => r.conversationId === c.conversationId)).toBe(false);
    expect((await theirs.dueConversations(NOW, NOW, 500)).some(r => r.conversationId === c.conversationId)).toBe(false);
    expect(await theirs.claimDue(c.conversationId, NOW, 8, ALL)).toEqual([]);
    expect(await theirs.acquire(c.conversationId, leaseToken(), NOW, 300)).toBe(false);
    // The same sender on the other deployment is another conversation.
    const twin = await theirs.ensureConversation('WHATSAPP', '106540352242922', (await t.db.query('SELECT subject_digest FROM channel_conversations WHERE conversation_id = $1',
      [c.conversationId])).rows[0]!.subject_digest as Buffer, NOW, NOW, channelRowId('chc'));
    expect(twin.conversationId).not.toBe(c.conversationId);
    await theirs.purge(new Date(NOW.getTime() + 60 * 86_400_000));
    expect(await mine.conversation(c.conversationId)).not.toBeNull();
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
