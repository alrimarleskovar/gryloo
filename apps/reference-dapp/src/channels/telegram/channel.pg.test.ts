// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the Telegram channel end to end at the HTTP boundary, on a disposable loopback PostgreSQL (shipped migrations
 * through 0009) with a recording engine runtime (MOCKED flows; any execution method would be recorded) and a Bot API double behind a
 * fake `fetch` (nothing leaves the process).
 *
 * The secret token is checked before parsing; duplicate Updates never duplicate a turn; /start greets; an exact command becomes a
 * CHANNEL_CONVERSATION approval on the shared platform whose link travels once, in a URL button, and is stored nowhere; on /approve
 * the wallet proof stays mandatory and only the intended wallet may claim; taps are acknowledged; blocking the bot opts out and
 * withdraws the live link; Bot API failures follow their class (blocked: never retried; throttled: after retry_after; a send whose
 * outcome is unknown: never resent, and an approval link withdrawn). Logs and tables hold no message text, user id, token or link.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import { claimApproval, PlatformRefusal, viewApproval, type WalletRef } from '../../platform/index.ts';
import { approvalSurface } from '../../server/approval-surface.ts';
import { recordingRuntime } from '../core/engine.test-harness.ts';
import { blockedUpdate, BOT_ID, botApi, botError, callbackUpdate, TELEGRAM_OTHER_USER, TELEGRAM_USER, telegramEnv, telegramRequest, textUpdate,
  type BotScript } from './fixtures.test-harness.ts';
import { handleTelegramWebhook } from './handler.ts';

const OWNER = '0x1111111111111111111111111111111111111111', OTHER = '0x2222222222222222222222222222222222222222';
const SUPPLY = (amount = '100') => `supply ${amount} USDC to Aave on Base Sepolia beneficiary ${OWNER}`;
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });

function deployment(script?: BotScript, overrides: Record<string, string | undefined> = {}) {
  const f = telegramEnv(overrides), api = botApi(script), calls: string[] = [], logs: string[] = [], host = { db: t.db, tenantId: 'default' };
  const runtime = recordingRuntime(calls);
  const logger = { info: (e: string, x?: unknown) => logs.push(JSON.stringify([e, x])), warn: (e: string, x?: unknown) => logs.push(JSON.stringify([e, x])) };
  const post = (update: unknown, secret: string | null = f.webhookSecret, now?: () => Date) =>
    handleTelegramWebhook(telegramRequest(update, secret), { env: f.env, host, runtime, fetch: api.fetch, interpreter: null, logger, sleep: async () => undefined,
      ...now ? { now } : {} });
  const say = (text: string, user = TELEGRAM_USER) => post(textUpdate(text, { user }));
  const surface = () => approvalSurface(f.env, () => undefined, { host, runtime });
  const secretOf = (url: string) => decodeURIComponent(new URL(url).hash.slice(1));
  return { ...f, api, calls, logs, host, post, say, surface, secretOf };
}
const refusal = async (work: Promise<unknown>) => { try { await work; return 'NO_REFUSAL'; } catch (e) { return e instanceof PlatformRefusal ? e.message : String(e); } };
const evm = (address: string): WalletRef => ({ namespace: 'eip155', address });
const conversationOfLastHandoff = async () => (await t.db.query(`SELECT handoff_id, requester_ref, status FROM mcp_handoffs WHERE client_name = 'Telegram'
  ORDER BY created_at DESC LIMIT 1`)).rows[0] as { handoff_id: string; requester_ref: string; status: string };

describe('BUILD-CHANNELS-001 Telegram channel (PostgreSQL, Bot API double, MOCKED engine)', () => {
  it('refuses unauthenticated, malformed and foreign deliveries before any processing', async () => {
    const d = deployment();
    expect((await d.post(textUpdate('help'), null)).status).toBe(401);
    expect(await (await d.post(textUpdate('help'), 'wrong-secret-of-the-right-shape-but-not-ours')).json()).toEqual({ ok: false, code: 'TELEGRAM_SECRET_TOKEN_INVALID' });
    const get = await handleTelegramWebhook(new Request('http://127.0.0.1:3100/api/channels/telegram'), { env: d.env, host: d.host });
    expect(get.status).toBe(405);
    const form = await handleTelegramWebhook(new Request('http://127.0.0.1:3100/api/channels/telegram', { method: 'POST', body: 'x',
      headers: { 'content-type': 'text/plain', 'x-telegram-bot-api-secret-token': d.webhookSecret } }), { env: d.env, host: d.host });
    expect([form.status, await form.json()]).toEqual([415, { ok: false, code: 'TELEGRAM_CONTENT_TYPE_INVALID' }]);
    expect(await (await d.post({ not: 'an update' })).json()).toEqual({ ok: true, code: 'IGNORED' });
    expect(await (await d.post(textUpdate('hi', { chat: { id: -100123, type: 'supergroup' } }))).json()).toEqual({ ok: true, code: 'ACCEPTED' });
    expect(d.api.sent()).toHaveLength(0);
    // Off unless enabled: the route does not exist.
    const off = await handleTelegramWebhook(telegramRequest(textUpdate('help'), d.webhookSecret), { env: { ...d.env, FLOFI_TELEGRAM: undefined }, host: d.host });
    expect([off.status, await off.json()]).toEqual([404, { ok: false, code: 'TELEGRAM_NOT_ENABLED' }]);
  });

  it('greets on /start, runs one turn per Update (redeliveries change nothing) and never answers an unlisted user', async () => {
    const d = deployment(), start = textUpdate('/start');
    expect((await d.post(start)).status).toBe(200);
    expect((await d.post(start)).status).toBe(200);
    expect(d.api.texts()).toEqual([expect.stringMatching(/^FloFi \(automated assistant\)/), expect.stringMatching(/^What I can do/)]);
    expect((await d.say('help', TELEGRAM_OTHER_USER)).status).toBe(200);
    expect(d.api.sent()).toHaveLength(2);
    const ignored = (await t.db.query(`SELECT count(*)::int AS n FROM channel_events WHERE channel = 'TELEGRAM' AND outcome = 'IGNORED_NOT_ALLOWLISTED'`)).rows[0]!.n;
    expect(ignored).toBeGreaterThanOrEqual(1);
  });

  it('turns an exact command into a channel approval whose link travels once in a URL button; only the intended wallet may claim it', async () => {
    const d = deployment();
    await d.say(SUPPLY());
    const url = d.api.lastLink()!;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:3100\/approve#flofi_chs_[A-Za-z0-9_-]{43}$/);
    expect(d.api.texts().at(-1)).toMatch(/^Strategy ready:[\s\S]*Nothing is authorized yet/);
    const handoff = await conversationOfLastHandoff();
    const row = (await t.db.query(`SELECT requester_kind, account_id, grant_id, client_id, client_name FROM mcp_handoffs WHERE handoff_id = $1`, [handoff.handoff_id])).rows[0];
    expect(row).toEqual({ requester_kind: 'CHANNEL_CONVERSATION', account_id: null, grant_id: null, client_id: `telegram:${BOT_ID}`, client_name: 'Telegram' });
    const secret = d.secretOf(url);
    expect(await viewApproval(await d.surface(), secret, [])).toMatchObject({ status: 'PENDING', requesterKind: 'CHANNEL_CONVERSATION', clientName: 'Telegram', authority: 'NONE' });
    expect(await refusal(claimApproval(await d.surface(), secret, [], false))).toBe('EVM_WALLET_PROOF_REQUIRED');
    expect(await refusal(claimApproval(await d.surface(), secret, [evm(OTHER)], false))).toBe('CHANNEL_INTENDED_WALLET_MISMATCH');
    expect((await claimApproval(await d.surface(), secret, [evm(OWNER)], false)).view).toMatchObject({ status: 'CLAIMED', claimedByYou: true });
    // A "yes" in the chat authorizes nothing, and nothing ever reached an execution path.
    await d.say('yes, execute it');
    expect(d.api.texts().at(-1)).toMatch(/^Nothing can be authorized here/);
    expect(d.calls).not.toContain('EXECUTION_PATH');
    // The link is stored nowhere.
    const tables = JSON.stringify((await t.db.query('SELECT * FROM channel_outbox')).rows) + JSON.stringify((await t.db.query('SELECT * FROM channel_audit')).rows);
    expect(tables).not.toContain(secret);
  });

  it('acknowledges taps, and treats a blocked bot as STOP: the live link is withdrawn and nothing is sent back', async () => {
    const d = deployment();
    await d.say(SUPPLY('7'));
    const live = await conversationOfLastHandoff();
    await d.post(callbackUpdate('c1'));
    expect(d.api.calls.some(c => c.method === 'answerCallbackQuery')).toBe(true);
    const before = d.api.sent().length;
    await d.post(blockedUpdate());
    expect(d.api.sent()).toHaveLength(before);
    expect((await t.db.query('SELECT status FROM mcp_handoffs WHERE handoff_id = $1', [live.handoff_id])).rows[0]!.status).toBe('REVOKED');
    expect((await t.db.query('SELECT status, address_ciphertext, state_ciphertext FROM channel_conversations WHERE conversation_id = $1', [live.requester_ref])).rows[0])
      .toEqual({ status: 'OPTED_OUT', address_ciphertext: null, state_ciphertext: null });
    // While opted out, messages are ignored; /start resumes.
    await d.say('help');
    expect(d.api.sent()).toHaveLength(before);
    await d.say('/start');
    expect(d.api.texts().slice(before)).toEqual(['Messages resumed.', expect.stringMatching(/^What I can do/)]);
  });

  it('follows the Bot API\'s failure classes: blocked is final, throttled waits for retry_after, an unknown outcome is never resent', async () => {
    // Blocked: FAILED, never retried.
    const blocked = deployment(call => call.method === 'sendMessage' ? botError(403, 'Forbidden: bot was blocked by the user') : null);
    await blocked.say('help');
    const withCode = async (code: string) => (await t.db.query(`SELECT o.status, o.error_code, o.next_attempt_at, o.attempts FROM channel_outbox o
      JOIN channel_conversations c ON c.tenant_id = o.tenant_id AND c.conversation_id = o.conversation_id WHERE c.channel = 'TELEGRAM' AND o.error_code = $1
      ORDER BY o.created_at DESC LIMIT 1`, [code])).rows[0]!;
    expect(await withCode('PROVIDER_RECIPIENT_BLOCKED')).toMatchObject({ status: 'FAILED', attempts: 1 });
    // Throttled: retried no earlier than Telegram's retry_after.
    const base = Date.now();
    const throttled = deployment(call => call.method === 'sendMessage' ? botError(429, 'Too Many Requests: retry after 90', { retry_after: 90 }) : null);
    await throttled.post(textUpdate('status'), throttled.webhookSecret, () => new Date(base));
    const retry = await withCode('PROVIDER_THROTTLED');
    expect(retry).toMatchObject({ status: 'PENDING', error_code: 'PROVIDER_THROTTLED', attempts: 1 });
    expect(new Date(retry.next_attempt_at as string).getTime() - base).toBeGreaterThanOrEqual(90_000);
    // Unknown outcome (a timeout after sending): an approval message is tried once, never resent, and its link withdrawn.
    const lost = deployment(call => call.method === 'sendMessage' && call.params.reply_markup && JSON.stringify(call.params.reply_markup).includes('"url"') ? 'TIMEOUT' : null);
    await lost.say(SUPPLY('6'));
    const handoff = await conversationOfLastHandoff();
    expect(lost.api.sent().filter(c => lost.api.linkOf(c))).toHaveLength(1);
    expect(handoff.status).toBe('REVOKED');
    expect(lost.api.texts().at(-1)).toMatch(/could not be delivered, so it was withdrawn/);
    const approvalRow = (await t.db.query(`SELECT status, error_code FROM channel_outbox WHERE handoff_id = $1 AND kind = 'APPROVAL'`, [handoff.handoff_id])).rows;
    expect(approvalRow).toEqual([{ status: 'FAILED', error_code: 'SEND_OUTCOME_UNKNOWN' }]);
  });

  it('logs and stores nothing but closed codes, digests, ciphertext and opaque ids', async () => {
    const d = deployment();
    await d.say(SUPPLY('5'));
    const url = d.api.lastLink()!;
    const logs = d.logs.join('\n');
    expect(logs).toMatch(/channel\.turn/);
    const tables = ['channel_conversations', 'channel_events', 'channel_outbox', 'channel_audit'];
    let stored = '';
    for (const table of tables) stored += JSON.stringify((await t.db.query(`SELECT * FROM ${table}`)).rows);
    for (const value of [d.token, d.webhookSecret, d.channelSecret, String(TELEGRAM_USER), 'supply 5 USDC', OWNER, url, 'flofi_chs_'])
      for (const [where, text] of [['logs', logs], ['tables', stored]] as const) expect(text, `${where}: ${value.slice(0, 12)}`).not.toContain(value);
  });
});
