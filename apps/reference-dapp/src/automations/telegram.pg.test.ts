// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: automation notifications through the EXISTING Channel Core and Telegram adapter (no second bot stack), on a
 * disposable loopback PostgreSQL with the Bot API double behind a fake `fetch` (nothing leaves the process):
 *
 *   the owner's one-time code (FloFi) → `automations <CODE>` in the chat (the real webhook handler) → linked → a due occurrence →
 *   one Telegram message with a button to the owner's FloFi workspace (no approval secret, no authority) → retries never resend →
 *   a refused delivery changes nothing about the occurrence → STOP unlinks → nothing more is sent. Link codes are single-use and
 *   short-lived; a linked conversation keeps its sealed address while linked, and loses it once unlinked.
 */
import { createLogger, createPostgresWorkQueue } from '@defi-workflow-engine/cloud-runtime';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { createPgChannelStore } from '../channels/core/pg-store.ts';
import { botApi, botError, textUpdate, telegramEnv, telegramRequest, TELEGRAM_USER, type BotScript } from '../channels/telegram/fixtures.test-harness.ts';
import { handleTelegramWebhook } from '../channels/telegram/handler.ts';
import { createPgHandoffStore, fixedWindow } from '../platform/index.ts';
import { enabledRuntime, OWNER_A, scriptedPrices, weeklyDca } from './automation.test-harness.ts';
import { readAutomationConfig, type AutomationConfig } from './config.ts';
import { dispatchAutomations } from './dispatch.ts';
import { automationLogger } from './log.ts';
import { automationRuntime, newAutomationId } from './runtime.ts';
import { createPgAutomationStore } from './pg-store.ts';
import { createAutomationService } from './service.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
beforeEach(async () => { await t.db.query('TRUNCATE automation_notifications, automation_evaluations, automation_occurrences, automation_rules, automation_link_codes, automation_notification_targets, work_items, mcp_handoffs, mcp_rate_limits, channel_outbox, channel_events, channel_audit, channel_conversations CASCADE'); });
const silent = createLogger({ service: 'test', sink: () => undefined });

function deployment(script?: BotScript) {
  const f = telegramEnv({ FLOFI_AUTOMATIONS: 'enabled', FLOFI_AUTOMATION_SECRET: 'automation-secret-'.padEnd(48, 'x') }), api = botApi(script);
  const config = readAutomationConfig(f.env) as AutomationConfig;
  if (!config.enabled) throw new Error('AUTOMATION_CONFIG');
  const host = { db: t.db, tenantId: 'default' }, logs: string[] = [];
  const sink = { info: (e: string, x?: unknown) => logs.push(JSON.stringify([e, x])), warn: (e: string, x?: unknown) => logs.push(JSON.stringify([e, x])) };
  let clock = new Date();
  const now = () => new Date(clock.getTime()), prices = scriptedPrices();
  const rt = () => automationRuntime(f.env, config, host, automationLogger(sink), now, { runtime: enabledRuntime, price: prices.source, channelSeams: { telegramFetch: api.fetch },
    channelLog: sink });
  const service = createAutomationService({ config, db: t.db, store: createPgAutomationStore(t.db, 'default'), handoffs: createPgHandoffStore(t.db, 'default'),
    allow: fixedWindow(t.db, 'default').allow, runtime: enabledRuntime, price: prices.source, log: automationLogger(sink), now, newId: newAutomationId, telegramAvailable: true });
  const say = (text: string) => handleTelegramWebhook(telegramRequest(textUpdate(text, { user: TELEGRAM_USER }), f.webhookSecret), { env: f.env, host, runtime: enabledRuntime,
    fetch: api.fetch, interpreter: null, logger: sink, sleep: async () => undefined });
  const dispatch = () => dispatchAutomations(rt(), createPostgresWorkQueue({ db: t.db, ownerId: 'w', tenantId: 'default' }), silent, 'w');
  return { ...f, api, config, service, say, dispatch, logs, set(at: string) { clock = new Date(at); }, now };
}

describe('BUILD-AUTOMATION-001 Telegram notifications through Channel Core', () => {
  it('links a chat with a one-time code, notifies once per occurrence with no authority, and stops after STOP', async () => {
    const d = deployment();
    const { code, command } = await d.service.telegramLinkCode(OWNER_A);
    expect(command).toBe(`automations ${code}`);
    // The code is stored only as a keyed digest.
    expect(JSON.stringify((await t.db.query('SELECT * FROM automation_link_codes')).rows)).not.toContain(code);
    await d.say('/start');
    await d.say(command.toLowerCase());
    expect(d.api.texts().at(-1)).toMatch(/^This chat now receives FloFi automation notifications for 0xa1a1…a1a1 \(for 90 days/);
    expect((await d.service.overview(OWNER_A)).telegram).toMatchObject({ available: true, linked: { expiresAt: expect.any(String) } });
    // Single use: the same code again is refused.
    await d.say(command);
    expect(d.api.texts().at(-1)).toMatch(/^That code is not valid/);

    const rule = await d.service.create(OWNER_A, weeklyDca());
    d.set('2026-10-12T08:00:30Z');
    await d.dispatch();
    const occurrence = (await d.service.overview(OWNER_A)).pending[0]!;
    const sent = d.api.delivered().at(-1)!;
    expect(String(sent.params.text)).toBe(['FloFi automation “Weekly ETH” is due.', 'Prepare 50 USDC → WETH on Base Sepolia?',
      'Nothing is authorized: open FloFi, run a fresh simulation, review the Strategy Manifest and sign with your own wallet.'].join('\n'));
    expect(d.api.linkOf(sent)).toBe(`http://127.0.0.1:3100/app/automations?occurrence=${occurrence.occurrenceId}`);
    expect((await d.service.overview(OWNER_A)).pending[0]!.notifications).toEqual([{ channel: 'TELEGRAM', status: 'QUEUED', code: null }]);
    // No approval secret, token or full address ever went to the chat.
    expect(d.api.texts().join('\n')).not.toMatch(/flofi_[a-z]{0,6}hs_|0x[0-9a-f]{40}|Bearer/);
    // Retries of the notification work never send it twice.
    await t.db.query(`INSERT INTO work_items (tenant_id, kind, dedupe_key, run_id, payload, state, available_at) VALUES ('default', 'automation.notify', $1, NULL, $2, 'READY', now())`,
      [`${occurrence.occurrenceId}:retry`, JSON.stringify({ occurrenceId: occurrence.occurrenceId })]);
    const before = d.api.delivered().length;
    await d.dispatch();
    expect(d.api.delivered().length).toBe(before);

    // STOP unlinks: the next week's occurrence reaches the app only.
    await d.say('stop');
    expect((await d.service.overview(OWNER_A)).telegram.linked).toBeNull();
    const afterStop = d.api.delivered().length;
    d.set('2026-10-19T08:00:30Z');
    await d.dispatch();
    expect((await d.service.overview(OWNER_A)).pending.map(o => o.ruleId)).toEqual([rule.ruleId]);
    expect(d.api.delivered().length).toBe(afterStop);
  });

  it('a refused delivery is only a failed message: the occurrence stays pending for the owner', async () => {
    const d = deployment(call => call.method === 'sendMessage' && String(call.params.text).startsWith('FloFi automation') ? botError(403, 'Forbidden: bot was blocked by the user') : null);
    const { command } = await d.service.telegramLinkCode(OWNER_A);
    await d.say(command);
    await d.service.create(OWNER_A, weeklyDca());
    d.set('2026-10-12T08:00:30Z');
    await d.dispatch();
    const [occurrence] = (await d.service.overview(OWNER_A)).pending;
    expect(occurrence).toMatchObject({ state: 'PENDING_OWNER' });
    expect((await t.db.query(`SELECT status, error_code FROM channel_outbox WHERE dedupe_key = $1`, [`automation:${occurrence!.occurrenceId}`])).rows)
      .toEqual([{ status: 'FAILED', error_code: expect.stringMatching(/^[A-Z_]+$/) }]);
    // The owner can still open it in FloFi.
    expect((await d.service.open(OWNER_A, occurrence!.occurrenceId)).approvalUrl).toMatch(/#flofi_auhs_/);
  });

  it('keeps a linked chat’s sealed address beyond the channel’s address window, and erases it once unlinked', async () => {
    const d = deployment(), { command } = await d.service.telegramLinkCode(OWNER_A);
    await d.say(command);
    const store = createPgChannelStore(t.db, 'default'), later = new Date(Date.now() + 3 * 86_400_000);
    await store.purge(later);
    expect((await t.db.query(`SELECT address_ciphertext IS NOT NULL AS kept FROM channel_conversations`)).rows).toEqual([{ kept: true }]);
    expect((await d.service.telegramUnlink(OWNER_A)).unlinked).toBe(true);
    await store.purge(later);
    expect((await t.db.query(`SELECT address_ciphertext IS NOT NULL AS kept FROM channel_conversations`)).rows).toEqual([{ kept: false }]);
  });

  it('refuses an expired or unknown code without linking anything, and never on WhatsApp', async () => {
    const d = deployment(), { command } = await d.service.telegramLinkCode(OWNER_A);
    await t.db.query(`UPDATE automation_link_codes SET expires_at = now() - interval '1 second', created_at = now() - interval '11 minutes'`);
    await d.say(command);
    expect(d.api.texts().at(-1)).toMatch(/^That code is not valid/);
    await d.say('automations ABCD-EFGH-JKMN');
    expect(d.api.texts().at(-1)).toMatch(/^That code is not valid/);
    expect((await t.db.query(`SELECT count(*)::int AS n FROM automation_notification_targets`)).rows[0]!.n).toBe(0);
    expect(d.logs.join('\n')).not.toMatch(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/);
  });
});
