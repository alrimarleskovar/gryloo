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
import { MAX_SEND_ATTEMPTS } from './delivery.ts';
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
async function deployment(script?: BotScript, random: () => number = () => 0.5) {
  const tenantId = `ch-${randomBytes(6).toString('hex')}`;
  await t.db.query('INSERT INTO tenants (tenant_id) VALUES ($1)', [tenantId]);
  const token = randomBytes(24).toString('base64url'), tg = telegramEnv(), wa = whatsAppEnv();
  const env = { ...wa.env, ...tg.env, TENANT_ID: tenantId, FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256: createHash('sha256').update(token).digest('hex') };
  const api = botApi(script), waSent: FixtureRecord[] = [], host = { db: t.db, tenantId }, calls: string[] = [], runtime = recordingRuntime(calls);
  let clock = Date.now();
  const now = () => new Date(clock), advance = (seconds: number) => { clock += seconds * 1000; };
  // The retry jitter is pinned (a deterministic seam): each test states the jitter it exercises.
  const common = { env, host, runtime, interpreter: null, now, sleep: async () => undefined, random };
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

  it('retries a transiently failed send on schedule, after its backoff, until delivered, without another inbound message', async () => {
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
  });

  // The documented policy: a once-a-minute scheduler gives a transiently failing message exactly six provider attempts inside its
  // 15-minute body lifetime, at the extremes of the ±20 % jitter, then DEAD (dead letter, body erased) — never left PENDING or SKIPPED.
  for (const [label, jitter, offsets] of [['minimum', 0, [0, 60, 120, 180, 300, 540]], ['maximum', 1, [0, 60, 120, 180, 360, 720]]] as const) {
    it(`dead-letters after exactly six provider calls with ${label} jitter under a once-a-minute scheduler`, async () => {
      let failing = false, clock = () => 0;
      const attempts: number[] = [];
      const d = await deployment(call => {
        if (call.method !== 'sendMessage' || !failing) return null;
        attempts.push(clock());
        return botError(500, 'Internal Server Error');
      }, () => jitter);
      clock = () => d.now().getTime();
      await d.telegram('/start');
      d.advance(1);
      failing = true;
      await d.telegram('help');
      const first = d.now().getTime();
      for (let minute = 1; minute <= 15; minute++) { d.advance(60); await d.sweep(); }
      expect((await outbox(d.tenantId, 'TELEGRAM')).at(-1)).toEqual({ kind: 'REPLY', status: 'DEAD', error_code: 'PROVIDER_UNAVAILABLE' });
      expect(attempts).toHaveLength(6);
      expect(attempts.map(at => (at - first) / 1000)).toEqual([...offsets]);
      expect(attempts.at(-1)! - first).toBeLessThanOrEqual(15 * 60_000);
      const body = (await t.db.query(`SELECT body_ciphertext FROM channel_outbox WHERE tenant_id = $1 AND status = 'DEAD'`, [d.tenantId])).rows;
      expect(body).toEqual([{ body_ciphertext: null }]);
    });
  }

  // A message held behind an earlier one that is retrying waits in order and consumes none of its own attempts: `attempts` equals the
  // provider calls made for it, whether the head recovers or ends DEAD (before this, every hold counted as an attempt, and a head backing
  // off past the next sweep let a later message overtake it).
  const GREETING = /^FloFi \(automated assistant\)/, HELP = /^What I can do/;
  async function heldBehind(greetingFailures: number, helpFailures: number) {
    const calls: { text: string; at: number; ok: boolean }[] = [];
    let clock = () => 0;
    const d = await deployment(call => {
      if (call.method !== 'sendMessage') return null;
      const text = String(call.params.text), mine = calls.filter(c => GREETING.test(text) ? GREETING.test(c.text) : HELP.test(c.text)).length;
      const fail = mine < (GREETING.test(text) ? greetingFailures : helpFailures);
      calls.push({ text, at: clock(), ok: !fail });
      return fail ? botError(500, 'Internal Server Error') : null;
    }, () => 0.5);
    clock = () => d.now().getTime();
    const t0 = d.now().getTime();
    await d.telegram('/start');
    const rows = async () => (await t.db.query(`SELECT o.status, o.attempts, o.error_code FROM channel_outbox o JOIN channel_conversations c
      ON c.tenant_id = o.tenant_id AND c.conversation_id = o.conversation_id WHERE o.tenant_id = $1 AND c.channel = 'TELEGRAM' ORDER BY o.created_at, o.sequence`,
      [d.tenantId])).rows;
    for (let minute = 1; minute <= 14; minute++) {
      d.advance(60); await d.sweep();
      // Never out of order: the help text reaches the provider only once the greeting is delivered or has ended.
      const [greeting] = await rows();
      if (greeting!.status === 'PENDING') expect(calls.filter(c => HELP.test(c.text))).toEqual([]);
    }
    const of = (pattern: RegExp) => calls.filter(c => pattern.test(c.text));
    return { d, rows: await rows(), greeting: of(GREETING), help: of(HELP), t0 };
  }

  it('holds a message behind a retrying one in order, without consuming its attempts, until the head is delivered', async () => {
    const { d, rows, greeting, help, t0 } = await heldBehind(4, 1);
    // The greeting's backoff (5, 15, 45, 120 s) outlasts a sweep at +240 s: the help text waits there too instead of overtaking it.
    expect(greeting.map(c => [(c.at - t0) / 1000, c.ok])).toEqual([[0, false], [60, false], [120, false], [180, false], [300, true]]);
    expect(help.map(c => [(c.at - t0) / 1000, c.ok])).toEqual([[300, false], [360, true]]);
    expect(rows).toEqual([{ status: 'SENT', attempts: 5, error_code: null }, { status: 'SENT', attempts: 2, error_code: null }]);
    expect(d.api.texts()).toEqual([expect.stringMatching(GREETING), expect.stringMatching(HELP)]);
  });

  it('keeps a held message\'s attempts its own when the head dead-letters: it is sent next, and retried with its own budget', async () => {
    const { d, rows, greeting, help, t0 } = await heldBehind(6, 1);
    expect(greeting.map(c => (c.at - t0) / 1000)).toEqual([0, 60, 120, 180, 300, 600]);
    expect(greeting.every(c => !c.ok)).toBe(true);
    // Held behind the greeting at every sweep for ten minutes, yet its first provider call is its first attempt.
    expect(help.map(c => [(c.at - t0) / 1000, c.ok])).toEqual([[600, false], [660, true]]);
    expect(rows).toEqual([{ status: 'DEAD', attempts: 6, error_code: 'PROVIDER_UNAVAILABLE' }, { status: 'SENT', attempts: 2, error_code: null }]);
    expect(d.api.texts()).toEqual([expect.stringMatching(HELP)]);
    const holds = (await t.db.query(`SELECT count(*)::int AS n FROM channel_audit WHERE tenant_id = $1 AND kind = 'OUTBOUND_RETRY' AND code = 'ORDER_HELD'`,
      [d.tenantId])).rows[0]!.n as number;
    expect(holds).toBeGreaterThan(MAX_SEND_ATTEMPTS);
  });

  it('records an expired message that already failed as DEAD and one never attempted as SKIPPED when the scheduler stalls', async () => {
    let calls = 0;
    const d = await deployment(call => { if (call.method !== 'sendMessage') return null; calls++; return botError(500, 'Internal Server Error'); }, () => 1);
    // First contact: the greeting fails once; the help text behind it is held, never sent to the provider.
    await d.telegram('/start');
    expect(calls).toBe(1);
    // The scheduler stops for 16 minutes; the next sweep finds both bodies past their lifetime.
    d.advance(16 * 60);
    await d.sweep();
    expect(await outbox(d.tenantId, 'TELEGRAM')).toEqual([{ kind: 'REPLY', status: 'DEAD', error_code: 'PROVIDER_UNAVAILABLE' },
      { kind: 'REPLY', status: 'SKIPPED', error_code: 'EXPIRED_UNSENT' }]);
    expect(calls).toBe(1);
    const audit = (await t.db.query(`SELECT kind, code FROM channel_audit WHERE tenant_id = $1 AND kind IN ('OUTBOUND_DEAD', 'OUTBOUND_SKIPPED') ORDER BY audit_id`,
      [d.tenantId])).rows;
    expect(audit).toEqual([{ kind: 'OUTBOUND_DEAD', code: 'PROVIDER_UNAVAILABLE' }, { kind: 'OUTBOUND_SKIPPED', code: 'EXPIRED_UNSENT' }]);
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
      VALUES ($6, $1, $2, $3, 'REPLY', $4, 'SENDING', 0, $5, $5)`, [`cho_${'c'.repeat(26)}`, conversation!.conversation_id, `reply:crash:${randomBytes(4).toString('hex')}`,
      randomBytes(64), d.now(), d.tenantId]);
    d.advance(3 * 60);
    await d.sweep();
    // The claim counted nothing; the interrupted send counts once (it may have reached the provider) and is never made again.
    expect((await t.db.query(`SELECT status, attempts, error_code, body_ciphertext FROM channel_outbox WHERE outbox_id = $1`, [`cho_${'c'.repeat(26)}`])).rows[0])
      .toEqual({ status: 'FAILED', attempts: 1, error_code: 'SEND_OUTCOME_UNKNOWN', body_ciphertext: null });
    expect(d.api.sent()).toHaveLength(sentBefore);
    expect(await store.claimDue(String(conversation!.conversation_id), new Date(d.now().getTime() + 3_600_000), 8, ['REPLY'])).toEqual([]);
    // WhatsApp: the same crash leaves it UNCERTAIN for Meta's report to confirm.
    await d.whatsapp('help');
    const [wa] = (await t.db.query(`SELECT conversation_id FROM channel_conversations WHERE tenant_id = $1 AND channel = 'WHATSAPP'`, [d.tenantId])).rows;
    await t.db.query(`INSERT INTO channel_outbox (tenant_id, outbox_id, conversation_id, dedupe_key, kind, body_ciphertext, status, attempts, created_at, updated_at)
      VALUES ($6, $1, $2, $3, 'REPLY', $4, 'SENDING', 0, $5, $5)`, [`cho_${'d'.repeat(26)}`, wa!.conversation_id, `reply:crash:${randomBytes(4).toString('hex')}`,
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
