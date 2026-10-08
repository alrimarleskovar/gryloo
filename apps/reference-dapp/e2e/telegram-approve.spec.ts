// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the Telegram channel meets FloFi's /approve in a real browser, on the embedded PostgreSQL runtime with the MOCKED
 * loopback testnet router and the loopback Bot API double (127.0.0.1:8559; nothing reaches Telegram, never a public network or a real
 * transaction):
 *
 *   the real webhook route under `next start` (a delivery without the secret token refused; /start greets with the first-contact notice)
 *   → an exact bridge command becomes a CHANNEL_CONVERSATION approval after the response, its link sent once in a URL button (read from
 *   the double the way the user's phone shows it) → /approve: "FROM TELEGRAM", nothing authorized, sharing off by default; the owner
 *   proves a wallet, opts in, loads and adds the proposal → the product's own simulation and Strategy Manifest Review, where current
 *   main blocks MOCKED financial authority (no approval, no execution, no wallet transaction) → the scheduled dispatch (bearer only)
 *   reports "loaded in FloFi" to the chat once; STATUS reads the same.
 *
 * The owner's full execution lifecycle (wallet-signed steps, reconciliation, "Execution reconciled ✅ · evidence: MOCKED") is proven
 * by `src/channels/whatsapp/journey.pg.test.ts` on the same Channel Core, as for MCP and the Developer API.
 */
import { test, expect, type Page } from '@playwright/test';
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet.ts';
import { E2E_APP_ORIGIN as APP_ORIGIN } from './app-origin';
import { CHANNEL_E2E, channelE2eUsers, TELEGRAM_DOUBLE } from './channel-constants';
import { handoffOfLink, query } from './channel-fixtures';
import { chooseWallet, openSimulationDetails } from './fixtures';
import { guardedContext, installJourneyWallet, journeySends, walletRequests } from './journey-fixtures';
import { assertMcpHarness } from './mcp-fixtures';
import { assertExecutionBlocked } from './release-safety-fixtures';
import { routerControl } from './router-fixtures';

const ROUTE = `${APP_ORIGIN}/api/channels/telegram`, BRIDGE = 'bridge 1 USDC from Base Sepolia to Arbitrum Sepolia via auto slippage 50 bps';
type BotCall = { method: string; params: { chat_id?: string; text?: string; reply_markup?: { inline_keyboard: { text: string; url?: string }[][] } } };
/** This test's own Telegram user (fresh per run and repetition), so /start is always the first exchange of a new conversation. */
const user = () => channelE2eUsers(test.info().repeatEachIndex).telegram;
/** The double's calls to this test's chat only (the dispatch may also deliver what another test's conversation left pending). */
const calls = async (): Promise<BotCall[]> => ((await (await fetch(`${TELEGRAM_DOUBLE}/__flofi/calls`)).json()) as BotCall[])
  .filter(c => String(c.params.chat_id) === String(user()));
const texts = async () => (await calls()).filter(c => c.method === 'sendMessage').map(c => c.params.text ?? '');
let updateId = Math.floor(Date.now() / 1000);
const update = (text: string, from = user()) => ({ update_id: ++updateId, message: { message_id: updateId, date: Math.floor(Date.now() / 1000), text,
  from: { id: from, is_bot: false, first_name: 'Owner' }, chat: { id: from, type: 'private', first_name: 'Owner' } } });
const approval = (page: Page) => page.getByRole('region', { name: 'External proposal' });
const bridge = (page: Page) => page.getByRole('region', { name: 'Cross-chain bridge' });
const dispatch = () => fetch(`${APP_ORIGIN}/api/channels/dispatch`, { headers: { authorization: `Bearer ${process.env.FLOFI_E2E_CHANNEL_DISPATCH_TOKEN}` } });

test.describe('BUILD-CHANNELS-001 Telegram → /approve (loopback Bot API double, MOCKED router; MOCKED execution blocked)', () => {
  test.beforeAll(() => { assertMcpHarness(); if (process.env.GRYLOO_CHANNEL_E2E !== CHANNEL_E2E) throw new Error('MOCK_RESET_DENIED'); });

  test('webhook → channel approval → /approve → owner Review (MOCKED blocked) → "loaded" back in the chat by the scheduled dispatch', async ({ browser, request }) => {
    test.setTimeout(120_000);
    const owner = createTestWallet();
    await routerControl('MOCK_reset', [{ network: 'testnet', owner: owner.address, wallets: [] }]);
    await fetch(`${TELEGRAM_DOUBLE}/__flofi/reset`, { method: 'POST' });
    const deliver = (text: string, secret = process.env.FLOFI_E2E_TELEGRAM_WEBHOOK_SECRET!) =>
      request.post(ROUTE, { headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, data: update(text) });

    // 1. The real route under Next: the secret token is required; /start greets with the first-contact notice.
    expect((await request.post(ROUTE, { headers: { 'content-type': 'application/json' }, data: update('/start') })).status()).toBe(401);
    expect((await request.get(ROUTE)).status()).toBe(405);
    const started = await deliver('/start');
    expect([started.status(), await started.json()]).toEqual([200, { ok: true, code: 'ACCEPTED' }]);
    await expect.poll(texts, { timeout: 30_000 }).toEqual([expect.stringMatching(/^FloFi \(automated assistant\)/), expect.stringMatching(/^What I can do/)]);

    // 2. An exact command: a channel approval after the response, its link once in a URL button; "yes" authorizes nothing.
    expect((await deliver(BRIDGE)).status()).toBe(200);
    await expect.poll(async () => (await calls()).some(c => c.params.reply_markup?.inline_keyboard[0]?.[0]?.url), { timeout: 30_000 }).toBe(true);
    const linkCall = (await calls()).find(c => c.params.reply_markup?.inline_keyboard[0]?.[0]?.url)!;
    const url = linkCall.params.reply_markup!.inline_keyboard[0]![0]!.url!;
    expect(url).toMatch(new RegExp(`^${APP_ORIGIN.replace(/[.]/g, '\\.')}/approve#flofi_chs_[A-Za-z0-9_-]{43}$`));
    expect(linkCall.params.text).toMatch(/^Strategy ready:[\s\S]*Nothing is authorized yet/);
    // The handoff is the one this link belongs to (never "the latest Telegram one": other specs and runs share the database).
    const handoff = await handoffOfLink(url);
    expect(handoff).toMatchObject({ requester_kind: 'CHANNEL_CONVERSATION', account_id: null, grant_id: null, client_name: 'Telegram', status: 'PENDING' });
    await deliver('yes, execute it');
    await expect.poll(async () => (await texts()).at(-1), { timeout: 30_000 }).toMatch(/^Nothing can be authorized here/);

    // 3. /approve in the owner's browser.
    const { context, unexpected } = await guardedContext(browser);
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await installJourneyWallet(page, [owner]);
    await page.goto(url);
    const region = approval(page);
    await expect(region).toContainText('EXTERNAL PROPOSAL · FROM TELEGRAM');
    await expect(region).toContainText('Nothing is authorized yet.');
    expect(page.url()).not.toContain('flofi_chs_');
    await expect(region.getByRole('checkbox')).not.toBeChecked();
    await region.getByRole('checkbox').check();
    await region.getByRole('button', { name: 'Connect wallet and prove ownership' }).click();
    await chooseWallet(page, 'Browser wallet');
    await expect(region).toContainText(`Signed in as ${owner.address}`);
    await region.getByRole('button', { name: 'Load proposal' }).click();
    await region.getByRole('button', { name: 'Add to my workflow' }).click();
    await expect(region.getByRole('status')).toContainText('Ready for your review.');
    expect((await query<{ status: string; share_status: boolean }>(`SELECT status, share_status FROM mcp_handoffs WHERE handoff_id = $1`, [handoff.handoff_id]))[0])
      .toEqual({ status: 'APPLIED', share_status: true });

    // 4. The product's own simulation and Strategy Manifest Review; MOCKED financial authority cannot be approved or executed.
    await page.getByRole('button', { name: 'Simulate fees', exact: true }).click();
    await openSimulationDetails(page);
    await bridge(page).getByRole('button', { name: 'Get route and simulate' }).click();
    await expect(bridge(page)).toContainText('Strategy Manifest');
    await expect(page.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
    await expect(page.locator('.review-validity')).toContainText('A simulation that can authorize this workflow is required before approval.');
    await assertExecutionBlocked(page, journeySends);
    expect(await walletRequests(page)).not.toContain('eth_sendTransaction');
    expect(await journeySends()).toBe(0);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();

    // 5. The scheduled dispatch reports progress to the chat, once (no page needs to stay open); a wrong bearer gets nothing.
    expect((await fetch(`${APP_ORIGIN}/api/channels/dispatch`, { headers: { authorization: 'Bearer not-the-scheduler-token-xx' } })).status).toBe(401);
    const loaded = () => query<{ status: string; body: boolean }>(`SELECT status, body_ciphertext IS NOT NULL AS body FROM channel_outbox WHERE kind = 'NOTIFICATION'
      AND dedupe_key = $1`, [`notify:${handoff.handoff_id}:loaded`]);
    // The /approve ping may already have sent it; the dispatch sends it if not, and never twice.
    expect((await dispatch()).status).toBe(200);
    await expect.poll(loaded, { timeout: 30_000 }).toEqual([{ status: 'SENT', body: false }]);
    expect((await dispatch()).status).toBe(200);
    expect((await texts()).filter(t => /^Your proposal is loaded in FloFi/.test(t))).toHaveLength(1);
    await deliver('status');
    await expect.poll(async () => (await texts()).at(-1), { timeout: 30_000 }).toMatch(/^Proposal in a FloFi workflow/);
    // Nothing a chat received carries calldata, a full address, a key or the link's secret again.
    const all = (await texts()).join('\n');
    expect(all).not.toMatch(/0x[0-9a-fA-F]{20,}|calldata|flofi_chs_/);
  });
});
