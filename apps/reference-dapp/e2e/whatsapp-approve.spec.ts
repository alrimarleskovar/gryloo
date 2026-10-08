// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the WhatsApp channel meets FloFi's /approve in a real browser, on the embedded PostgreSQL runtime with the MOCKED
 * loopback lending harness and the FIXTURE provider (nothing is ever sent to Meta; never a public network or a real transaction):
 *
 *   the real webhook route under `next start` (subscription check, forged delivery refused, a signed delivery accepted and turned into
 *   a CHANNEL_CONVERSATION approval after the response) → LINK for a fresh link, captured from the fixture transport in this process
 *   (an approval link is never stored anywhere, so the spec takes it the way the user's phone would) → /approve: another proven
 *   wallet is refused (intended wallet), the owner proves the intended wallet, opts in to sharing status, loads and applies the
 *   proposal → the /approve ping hands "loaded in FloFi" to the conversation, once → the product's own simulation and Review, where
 *   current main blocks MOCKED financial authority (no approval, no execution, no wallet transaction) → STATUS in the chat.
 *
 * The owner's full execution lifecycle (five wallet-signed steps, reconciliation, "Execution reconciled ✅ · evidence: MOCKED" back in
 * the chat) is proven by `src/channels/whatsapp/journey.pg.test.ts`, as for MCP and the Developer API.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet.ts';
import { handleWhatsAppWebhook } from '../src/channels/whatsapp/handler.ts';
import { fixtureTransport, type FixtureRecord } from '../src/channels/whatsapp/transport.ts';
import { inbound, signed, webhookRequest } from '../src/channels/whatsapp/fixtures.test-harness.ts';
import { E2E_APP_ORIGIN as APP_ORIGIN } from './app-origin';
import { CHANNEL_E2E, channelE2eEnv, channelE2eUsers } from './channel-constants';
import { handoffIds, handoffOfLink, newHandoffs, query } from './channel-fixtures';
import { chooseWallet, openSimulationDetails } from './fixtures';
import { guardedContext, installJourneyWallet } from './journey-fixtures';
import { assertMcpHarness } from './mcp-fixtures';
import { assertExecutionBlocked } from './release-safety-fixtures';
import { installLendingWallet, LENDING_OWNER, lendingRpc, lendingSends } from './lending-fixtures';

const ROUTE = `${APP_ORIGIN}/api/channels/whatsapp`;
const COMPOSITION = `compose supply 0.1 USDC to Aave then borrow 0.01 USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps owner ${LENDING_OWNER}`;
/** The same deployment the app server runs, used in this process only to turn one message into a reply the spec can read. */
const serverEnv = () => ({ FLOFI_RUNTIME: 'embedded', DATABASE_URL: process.env.FLOFI_E2E_DATABASE_URL!, FLOFI_PUBLIC_ORIGIN: APP_ORIGIN,
  GRYLOO_LENDING_HARNESS: 'MOCKED_LOOPBACK_ONLY', ...channelE2eEnv() });
const texts = (sent: readonly FixtureRecord[]) => sent.map(r => { const b = r.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b.text?.body ?? b.interactive?.body.text ?? ''; });
const approval = (page: Page) => page.getByRole('region', { name: 'External proposal' });

test.describe('BUILD-CHANNELS-001 WhatsApp → /approve (fixture provider, MOCKED lending chain; MOCKED execution blocked)', () => {
  test.beforeAll(() => { assertMcpHarness(); if (process.env.GRYLOO_CHANNEL_E2E !== CHANNEL_E2E) throw new Error('MOCK_RESET_DENIED'); });

  test('webhook → channel approval → intended wallet on /approve → owner Review (MOCKED blocked) → "loaded" back in the chat', async ({ browser, request }) => {
    test.setTimeout(180_000);
    const fixtureOwner = createTestWallet(new Uint8Array(32).fill(0x43)), stranger = createTestWallet();
    expect(fixtureOwner.address).toBe(LENDING_OWNER);
    await lendingRpc('MOCK_reset', [{}]);
    const env = serverEnv(), user = channelE2eUsers(test.info().repeatEachIndex).whatsapp;
    // Every handoff that exists before this spec's first delivery belongs to someone else (MCP, Developer, Telegram, an earlier run).
    const before = await handoffIds();

    // 1. The real route under Next.
    const verify = await request.get(`${ROUTE}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)}&hub.challenge=7071`);
    expect([verify.status(), await verify.text()]).toEqual([200, '7071']);
    const deliver = (text: string, signature?: string) => {
      const s = signed(inbound([{ text, bsuid: user }]), env.WHATSAPP_APP_SECRET);
      return request.post(ROUTE, { headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? s.signature }, data: s.raw });
    };
    expect((await deliver(COMPOSITION, `sha256=${'0'.repeat(64)}`)).status()).toBe(401);
    const accepted = await deliver(COMPOSITION);
    expect([accepted.status(), await accepted.json()]).toEqual([200, { ok: true, code: 'ACCEPTED' }]);
    // The turn ran after the response: exactly one new channel approval (no MCP account or grant), its message sent to the fixture provider.
    await expect.poll(async () => (await newHandoffs('WhatsApp', before)).length, { timeout: 30_000 }).toBe(1);
    const [first] = await newHandoffs('WhatsApp', before);
    await expect.poll(async () => query<{ status: string }>(`SELECT status FROM channel_outbox WHERE kind = 'APPROVAL' AND handoff_id = $1`, [first!.handoff_id]),
      { timeout: 30_000 }).toEqual([{ status: 'SENT' }]);
    expect(first).toMatchObject({ requester_kind: 'CHANNEL_CONVERSATION', account_id: null, grant_id: null, client_name: 'WhatsApp', status: 'PENDING' });

    // 2. LINK: a fresh link replaces the first (now withdrawn), read from the fixture transport the way the user's phone would.
    const sent: FixtureRecord[] = [];
    const say = async (text: string) => expect((await handleWhatsAppWebhook(webhookRequest(inbound([{ text, bsuid: user }]), env.WHATSAPP_APP_SECRET),
      { env, transport: fixtureTransport(sent) })).status).toBe(200);
    await say('link');
    const linkMessage = sent.find(r => (r.body as { interactive?: { type?: string } }).interactive?.type === 'cta_url')!.body as { interactive: { action: { parameters: { url: string } } } };
    const url = linkMessage.interactive.action.parameters.url;
    expect(url).toMatch(new RegExp(`^${APP_ORIGIN.replace(/[.]/g, '\\.')}/approve#flofi_chs_[A-Za-z0-9_-]{43}$`));
    // The link's own handoff: new, in the same conversation as the first, which it withdrew.
    const linked = await handoffOfLink(url);
    expect(linked).toMatchObject({ requester_kind: 'CHANNEL_CONVERSATION', requester_ref: first!.requester_ref, client_name: 'WhatsApp', status: 'PENDING' });
    expect((await newHandoffs('WhatsApp', before)).map(h => [h.handoff_id, h.status])).toEqual([[first!.handoff_id, 'REVOKED'], [linked.handoff_id, 'PENDING']]);

    // 3. /approve: a proven wallet other than the one the strategy names cannot load it.
    const { context, unexpected } = await guardedContext(browser);
    const other = await context.newPage();
    await installJourneyWallet(other, [stranger]);
    await other.goto(url);
    await expect(approval(other)).toContainText('EXTERNAL PROPOSAL · FROM WHATSAPP');
    await expect(approval(other)).toContainText('Nothing is authorized yet.');
    await expect(approval(other).getByRole('checkbox')).not.toBeChecked();
    await approval(other).getByRole('button', { name: 'Connect wallet and prove ownership' }).click();
    await chooseWallet(other, 'Browser wallet');
    await expect(approval(other)).toContainText(`Signed in as ${stranger.address}`);
    await approval(other).getByRole('button', { name: 'Load proposal' }).click();
    await expect(approval(other)).toContainText('CHANNEL_INTENDED_WALLET_MISMATCH');
    await other.close();

    // 4. The owner's browser: prove the intended wallet, opt in to sharing (off by default for a channel), load and apply.
    const signing = await context.newPage();
    const errors: string[] = []; signing.on('pageerror', e => errors.push(e.message));
    await installLendingWallet(signing, { signer: fixtureOwner });
    await signing.goto(url);
    const region = approval(signing);
    await expect(region).toContainText('EXTERNAL PROPOSAL · FROM WHATSAPP');
    // The secret left the address bar for this tab's session storage (where the ping reads it too).
    await expect(signing).not.toHaveURL(/flofi_chs_/);
    await expect(region.getByRole('checkbox')).not.toBeChecked();
    await region.getByRole('checkbox').check();
    await region.getByRole('button', { name: 'Connect wallet and prove ownership' }).click();
    await chooseWallet(signing, 'Browser wallet');
    await expect(region).toContainText(`Signed in as ${LENDING_OWNER}`);
    await region.getByRole('button', { name: 'Load proposal' }).click();
    await region.getByRole('button', { name: 'Add to my workflow' }).click();
    await expect(region.getByRole('status')).toContainText('Ready for your review.');
    const handoff = await handoffOfLink(url);
    expect(handoff).toMatchObject({ handoff_id: linked.handoff_id, status: 'APPLIED', share_status: true });
    const notification = (suffix: string) => query<{ status: string; body: boolean }>(`SELECT status, body_ciphertext IS NOT NULL AS body FROM channel_outbox
      WHERE kind = 'NOTIFICATION' AND dedupe_key LIKE $1`, [`notify:${handoff.handoff_id}:${suffix}`]);
    // The ping on the open page tells the chat the proposal is loaded (once; the message body is erased once sent).
    await expect.poll(() => notification('loaded'), { timeout: 45_000 }).toEqual([{ status: 'SENT', body: false }]);

    // 5. The product's own simulation and Review of the lending composition; MOCKED financial authority cannot be approved or executed.
    const lending = signing.getByRole('region', { name: 'Lending composition' });
    await signing.getByRole('button', { name: 'Simulate fees', exact: true }).click();
    await openSimulationDetails(signing);
    await signing.getByRole('button', { name: 'Simulate lending composition', exact: true }).click();
    await expect(lending).toContainText('Expected output:');
    await expect(signing.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
    await expect(signing.locator('.review-validity')).toContainText('A simulation that can authorize this workflow is required before approval.');
    await expect(signing.getByRole('button', { name: 'Review approved', exact: true })).toHaveCount(0);
    await assertExecutionBlocked(signing, () => lendingSends(signing));
    expect(await lendingSends(signing)).toBe(0);

    // 6. Back in the chat: STATUS reads the same public facts; no execution ran, and nothing it shows carries calldata or a full address.
    await say('status');
    expect(texts(sent).at(-1)).toMatch(/^Proposal in a FloFi workflow/);
    expect(texts(sent).join('\n')).not.toMatch(/0x[0-9a-fA-F]{20,}|calldata/i);
    expect((await query<{ dedupe_key: string; status: string }>(`SELECT dedupe_key, status FROM channel_outbox WHERE kind = 'NOTIFICATION' AND conversation_id = $1`,
      [first!.requester_ref])).map(r => [r.dedupe_key, r.status])).toEqual([[`notify:${handoff.handoff_id}:loaded`, 'SENT']]);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });
});
