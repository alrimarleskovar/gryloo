// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the scheduled dispatch (`/api/channels/dispatch`) on a disposable loopback PostgreSQL, with both providers on one
 * Channel Core (WhatsApp's recording fixture, Telegram's Bot API double) and a recording MOCKED engine runtime.
 *
 * Channel work no longer waits for the next inbound message: a turn whose processing was lost after the 200 runs at the next sweep (in
 * order, under a fresh lease) or is answered "late" once too old; a transient send failure is retried by the sweep; a send interrupted
 * by a crash is never resent (WhatsApp may still confirm it, Telegram cannot); approval progress reaches the chat without anyone keeping
 * /approve open, each notification once, and a finished approval is no longer followed. Concurrent sweeps never send a message twice,
 * each conversation is served by its own provider, and the endpoints exist only behind the scheduler's bearer.
 */
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import { applyApproval, claimApproval, type WalletRef } from '../../platform/index.ts';
import { approvalSurface } from '../../server/approval-surface.ts';
import { editorReducer, initialEditor } from '../../domain/editor';
import { dappReviewContext } from '../../engine/strategy-engine';
import { handleChannelDispatch, handleChannelHealth } from '../dispatch-http.ts';
import { handleTelegramWebhook } from '../telegram/handler.ts';
import { botApi, botError, TELEGRAM_USER, telegramEnv, telegramRequest, textUpdate, type BotScript } from '../telegram/fixtures.test-harness.ts';
import { handleWhatsAppWebhook } from '../whatsapp/handler.ts';
import { fixtureTransport, type FixtureRecord } from '../whatsapp/transport.ts';
import { inbound, webhookRequest, whatsAppEnv } from '../whatsapp/fixtures.test-harness.ts';
import { recordingRuntime } from './engine.test-harness.ts';
import { createPgChannelStore } from './pg-store.ts';

const OWNER = '0x1111111111111111111111111111111111111111';
const SUPPLY = (amount: string) => `supply ${amount} USDC to Aave on Base Sepolia beneficiary ${OWNER}`;
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });

/**
 * One deployment with both providers, a dispatch token, and controllable clocks and provider answers. Each is its own tenant (as each
 * deployment is), so a sweep sees exactly this deployment's channel state.
 */
async function deployment(script?: BotScript) {
  const tenantId = `ch-${randomBytes(6).toString('hex')}`;
  await t.db.query('INSERT INTO tenants (tenant_id) VALUES ($1)', [tenantId]);
  const token = randomBytes(24).toString('base64url'), tg = telegramEnv(), wa = whatsAppEnv();
  const env = { ...wa.env, ...tg.env, TENANT_ID: tenantId, FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256: createHash('sha256').update(token).digest('hex') };
  const api = botApi(script), waSent: FixtureRecord[] = [], host = { db: t.db, tenantId }, calls: string[] = [], runtime = recordingRuntime(calls);
  let clock = Date.now();
  const now = () => new Date(clock), advance = (seconds: number) => { clock += seconds * 1000; };
  const common = { env, host, runtime, interpreter: null, now, sleep: async () => undefined };
  const telegram = (text: string, schedule?: (work: () => Promise<void>) => void) => handleTelegramWebhook(telegramRequest(textUpdate(text, { date: Math.floor(clock / 1000) }),
    tg.webhookSecret), { ...common, fetch: api.fetch, ...schedule ? { schedule } : {} });
  const whatsapp = (text: string) => handleWhatsAppWebhook(webhookRequest(inbound([{ text, timestamp: Math.floor(clock / 1000) }]), wa.appSecret),
    { ...common, transport: fixtureTransport(waSent) });
  const seams = { telegramFetch: api.fetch, whatsappTransport: fixtureTransport(waSent) };
  const dispatch = async (bearer: string | null = token) => handleChannelDispatch(new Request('http://127.0.0.1:3100/api/channels/dispatch',
    { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} }), { ...common, seams });
  const sweep = async () => { const r = await dispatch(); expect(r.status).toBe(200); return await r.json() as Record<string, number | boolean>; };
  return { env, token, api, waSent, host, calls, runtime, now, advance, telegram, whatsapp, dispatch, sweep, tg, wa, seams, tenantId };
}
const evm = (address: string): WalletRef => ({ namespace: 'eip155', address });
const outbox = async (tenantId: string, conversationChannel: string) => (await t.db.query(`SELECT o.kind, o.status, o.error_code FROM channel_outbox o
  JOIN channel_conversations c ON c.tenant_id = o.tenant_id AND c.conversation_id = o.conversation_id WHERE o.tenant_id = $1 AND c.channel = $2
  ORDER BY o.created_at, o.sequence`, [tenantId, conversationChannel])).rows;

describe('BUILD-CHANNELS-001 scheduled dispatch (PostgreSQL, both providers, MOCKED engine)', () => {
  it('exists only behind the scheduler\'s bearer, and answers counts only', async () => {
    const d = await deployment();
    expect((await d.dispatch(null)).status).toBe(401);
    expect(await (await d.dispatch('a-wrong-token-of-enough-length')).json()).toEqual({ ok: false, code: 'DISPATCH_TOKEN_INVALID' });
    const noDigest = await handleChannelDispatch(new Request('http://127.0.0.1:3100/api/channels/dispatch', { headers: { authorization: `Bearer ${d.token}` } }),
      { env: { ...d.env, FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256: undefined }, host: d.host });
    expect(noDigest.status).toBe(404);
    const body = await d.sweep();
    expect(body).toMatchObject({ ok: true, object: 'channel_dispatch', purged: true, truncated: false });
    expect(Object.values(body).every(v => typeof v === 'number' || typeof v === 'boolean' || v === 'channel_dispatch')).toBe(true);
  });

  it('runs a turn whose processing was lost after the 200, once and in order, without another inbound message', async () => {
    const d = await deployment();
    // The function died after acknowledging: the turn never ran.
    expect((await d.telegram('/start', () => undefined)).status).toBe(200);
    expect((await d.telegram('help', () => undefined)).status).toBe(200);
    expect(d.api.sent()).toHaveLength(0);
    d.advance(30);
    expect(await d.sweep()).toMatchObject({ stranded: 1, turns: 2 });
    expect(d.api.texts()).toEqual([expect.stringMatching(/^FloFi \(automated assistant\)/), expect.stringMatching(/^What I can do/), expect.stringMatching(/^What I can do/)]);
    expect(await d.sweep()).toMatchObject({ stranded: 0, turns: 0, sent: 0 });
    expect(d.api.sent()).toHaveLength(3);
    // Too old to act on: answered "late", never executed late.
    await d.telegram(SUPPLY('3'), () => undefined);
    d.advance(16 * 60);
    expect(await d.sweep()).toMatchObject({ stranded: 1, turns: 1 });
    expect(d.api.texts().at(-1)).toMatch(/reached FloFi late, so I did not act on it/);
    expect(d.api.sent().some(call => d.api.linkOf(call))).toBe(false);
    expect(d.calls).not.toContain('EXECUTION_PATH');
  });

  it('retries a transiently failed send on schedule, after its backoff, until delivered; then dead-letters exhausted ones', async () => {
    let failing = true;
    const d = await deployment(call => call.method === 'sendMessage' && failing ? botError(500, 'Internal Server Error') : null);
    await d.telegram('/start');
    expect(await outbox(d.tenantId, 'TELEGRAM')).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'PENDING', error_code: 'PROVIDER_UNAVAILABLE' })]));
    // Not yet due: nothing is attempted.
    expect(await d.sweep()).toMatchObject({ conversations: 0, sent: 0 });
    failing = false;
    d.advance(10);
    expect(await d.sweep()).toMatchObject({ conversations: 1, sent: 2 });
    expect(d.api.texts()).toEqual([expect.stringMatching(/^FloFi \(automated assistant\)/), expect.stringMatching(/^What I can do/)]);
    // A provider that stays down: a once-a-minute scheduler tries again after each backoff (all six attempts fit in the body's 15-minute
    // lifetime); after the last one, DEAD (dead letter, body erased), never silently dropped.
    failing = true;
    const attemptsBefore = d.api.sent().length;
    await d.telegram('help');
    for (let i = 0; i < 15; i++) { d.advance(60); await d.sweep(); }
    expect((await outbox(d.tenantId, 'TELEGRAM')).at(-1)).toEqual({ kind: 'REPLY', status: 'DEAD', error_code: 'PROVIDER_UNAVAILABLE' });
    // Six attempts in all: the turn's own, then five by the sweeps.
    expect(d.api.sent().length - attemptsBefore).toBe(6);
  });

  it('never resends a send interrupted by a crash; WhatsApp\'s status webhook can still confirm it, Telegram\'s cannot', async () => {
    const d = await deployment();
    // Telegram: a reply was claimed (SENDING) and the instance died before the answer.
    await d.telegram('/start', () => undefined);
    const store = createPgChannelStore(t.db, d.tenantId);
    const [conversation] = (await t.db.query(`SELECT conversation_id FROM channel_conversations WHERE tenant_id = $1 AND channel = 'TELEGRAM'`, [d.tenantId])).rows;
    await d.sweep();
    const sentBefore = d.api.sent().length;
    await t.db.query(`INSERT INTO channel_outbox (tenant_id, outbox_id, conversation_id, dedupe_key, kind, body_ciphertext, status, attempts, created_at, updated_at)
      VALUES ($6, $1, $2, $3, 'REPLY', $4, 'SENDING', 1, $5, $5)`, [`cho_${'c'.repeat(26)}`, conversation!.conversation_id, `reply:crash:${randomBytes(4).toString('hex')}`,
      randomBytes(64), d.now(), d.tenantId]);
    d.advance(3 * 60);
    await d.sweep();
    expect((await t.db.query(`SELECT status, error_code, body_ciphertext FROM channel_outbox WHERE outbox_id = $1`, [`cho_${'c'.repeat(26)}`])).rows[0])
      .toEqual({ status: 'FAILED', error_code: 'SEND_OUTCOME_UNKNOWN', body_ciphertext: null });
    expect(d.api.sent()).toHaveLength(sentBefore);
    expect(await store.claimDue(String(conversation!.conversation_id), new Date(d.now().getTime() + 3_600_000), 8, ['REPLY'])).toEqual([]);
    // WhatsApp: the same crash leaves it UNCERTAIN for Meta's report to confirm.
    await d.whatsapp('help');
    const [wa] = (await t.db.query(`SELECT conversation_id FROM channel_conversations WHERE tenant_id = $1 AND channel = 'WHATSAPP'`, [d.tenantId])).rows;
    await t.db.query(`INSERT INTO channel_outbox (tenant_id, outbox_id, conversation_id, dedupe_key, kind, body_ciphertext, status, attempts, created_at, updated_at)
      VALUES ($6, $1, $2, $3, 'REPLY', $4, 'SENDING', 1, $5, $5)`, [`cho_${'d'.repeat(26)}`, wa!.conversation_id, `reply:crash:${randomBytes(4).toString('hex')}`,
      randomBytes(64), d.now(), d.tenantId]);
    d.advance(3 * 60);
    await d.sweep();
    expect((await t.db.query(`SELECT status, error_code FROM channel_outbox WHERE outbox_id = $1`, [`cho_${'d'.repeat(26)}`])).rows[0])
      .toEqual({ status: 'UNCERTAIN', error_code: 'SEND_INTERRUPTED' });
    d.advance(11 * 60);
    await d.sweep();
    expect((await t.db.query(`SELECT status, error_code FROM channel_outbox WHERE outbox_id = $1`, [`cho_${'d'.repeat(26)}`])).rows[0])
      .toEqual({ status: 'FAILED', error_code: 'SEND_OUTCOME_UNKNOWN' });
  });

  it('reports approval progress to the chat without /approve open, each notification once, and stops following a finished approval', async () => {
    const d = await deployment();
    await d.telegram(SUPPLY('4'));
    const url = d.api.lastLink()!, secret = decodeURIComponent(new URL(url).hash.slice(1));
    const surface = () => approvalSurface(d.env, () => undefined, { host: d.host, runtime: d.runtime });
    // Nothing to say while it waits for its owner.
    expect(await d.sweep()).toMatchObject({ notified: 0 });
    const claimed = await claimApproval(await surface(), secret, [evm(OWNER)], true);
    await applyApproval(await surface(), secret, [evm(OWNER)], editorReducer(initialEditor(), claimed.command, dappReviewContext()).workflow);
    const before = d.api.delivered().length;
    expect(await d.sweep()).toMatchObject({ notified: 1 });
    expect(d.api.texts().slice(before)).toEqual([expect.stringMatching(/^Your proposal is loaded in FloFi/)]);
    expect(await d.sweep()).toMatchObject({ notified: 0, sent: 0 });
    expect(d.api.delivered()).toHaveLength(before + 1);
    // An approval nobody opens expires: nothing more can follow, so the sweep stops following it (the applied one is still followed).
    await d.telegram(SUPPLY('2'));
    const latest = (await t.db.query(`SELECT handoff_id FROM mcp_handoffs WHERE tenant_id = $1 AND client_name = 'Telegram' ORDER BY created_at DESC LIMIT 1`,
      [d.tenantId])).rows[0]!.handoff_id as string;
    const settled = async (id: string) => (await t.db.query(`SELECT bool_and(handoff_settled) AS settled FROM channel_events WHERE handoff_id = $1`, [id])).rows[0]!.settled;
    await d.sweep();
    expect(await settled(latest)).toBe(false);
    d.advance(16 * 60);
    await d.sweep();
    expect(await settled(latest)).toBe(true);
    expect(await settled(String(claimed.view.approvalId))).toBe(false);
    expect(d.calls).not.toContain('EXECUTION_PATH');
  });

  it('sends every due message exactly once under concurrent sweeps, each conversation through its own provider', async () => {
    let failing = true;
    const d = await deployment(call => call.method === 'sendMessage' && failing ? botError(500, 'Internal Server Error') : null);
    await d.telegram('/start');
    await d.whatsapp('help');
    const waBefore = d.waSent.length;
    failing = false;
    d.advance(10);
    const results = await Promise.all([d.sweep(), d.sweep(), d.sweep()]);
    expect(results.reduce((n, r) => n + (r.sent as number), 0)).toBe(2);
    expect(d.api.texts()).toEqual([expect.stringMatching(/^FloFi \(automated assistant\)/), expect.stringMatching(/^What I can do/)]);
    expect(d.waSent.length).toBe(waBefore);
    const tg = d.api.sent().map(c => c.params.chat_id);
    expect(new Set(tg)).toEqual(new Set([String(TELEGRAM_USER)]));
  });

  it('reports readiness to the operator without a secret, an id or anyone\'s data', async () => {
    const d = await deployment();
    const health = await handleChannelHealth(new Request('http://127.0.0.1:3100/api/channels/health', { headers: { authorization: `Bearer ${d.token}` } }),
      { env: d.env, host: d.host, seams: d.seams });
    expect(health.status).toBe(200);
    const body = await health.json() as { providers: Record<string, unknown>[] };
    expect(body).toMatchObject({ ok: true, store: 'READY', dispatch: 'CONFIGURED', testFunds: true, mainnetNetworks: [] });
    expect(body.providers).toEqual([
      expect.objectContaining({ route: 'whatsapp', enabled: true, mode: 'fixture', channel: 'WHATSAPP', windowHours: 24, confirmsUncertainSends: true }),
      expect.objectContaining({ route: 'telegram', enabled: true, mode: 'live', channel: 'TELEGRAM', windowHours: null, deliveryReports: [], confirmsUncertainSends: false })]);
    const text = JSON.stringify(body);
    for (const value of [d.token, d.tg.token, d.tg.webhookSecret, d.wa.appSecret, d.wa.verifyToken, d.tg.channelSecret, '7000000001', '106540352242922'])
      expect(text).not.toContain(value);
    expect((await handleChannelHealth(new Request('http://127.0.0.1:3100/api/channels/health'), { env: d.env, host: d.host })).status).toBe(401);
  });
});
