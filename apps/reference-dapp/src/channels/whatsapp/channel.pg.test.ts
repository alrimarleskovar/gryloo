// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the WhatsApp channel end to end at the HTTP boundary, on a disposable loopback PostgreSQL (shipped migrations
 * through 0008) with a recording engine runtime (MOCKED flows; any execution method would be recorded) and the fixture transport.
 *
 * Signed deliveries become content-free records and one turn each; duplicates and retries never duplicate a turn, a reply or a
 * handoff. A proposal becomes a CHANNEL_CONVERSATION approval on the shared platform — no MCP account, no grant — whose link is
 * delivered once and stored nowhere. On /approve the wallet proof stays mandatory, the intended wallet alone may claim, replaced
 * proposals are refused, and a channel identity is never a wallet. Messages like "yes" or "execute" change nothing. Logs and tables
 * hold no message text, sender id, link or secret.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import { applyApproval, claimApproval, PlatformRefusal, viewApproval, type WalletRef } from '../../platform/index.ts';
import { approvalSurface } from '../../server/approval-surface.ts';
import { editorReducer, initialEditor } from '../../domain/editor';
import { dappReviewContext } from '../../engine/strategy-engine';
import type { Command } from '../../domain/commands';
import { recordingRuntime } from '../core/engine.test-harness.ts';
import { handleWhatsAppWebhook } from './handler.ts';
import { fixtureTransport, type FixtureRecord } from './transport.ts';
import { inbound, messageId, sha256Hex, statuses, USER_BSUID, USER_PHONE, webhookRequest, whatsAppEnv } from './fixtures.test-harness.ts';

const OWNER = '0x1111111111111111111111111111111111111111', OTHER = '0x2222222222222222222222222222222222222222';
const SECOND_BSUID = 'BR.FLOFITESTUSER0002';
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });

function deployment(overrides: Record<string, string | undefined> = {}) {
  const fixture = whatsAppEnv({ FLOFI_WHATSAPP_ALLOWED_SENDERS: `${sha256Hex(USER_BSUID)},${sha256Hex(SECOND_BSUID)}`, ...overrides });
  const calls: string[] = [], sent: FixtureRecord[] = [], logs: string[] = [], runtime = recordingRuntime(calls), host = { db: t.db, tenantId: 'default' };
  const logger = { info: (e: string, f?: unknown) => logs.push(JSON.stringify([e, f])), warn: (e: string, f?: unknown) => logs.push(JSON.stringify([e, f])) };
  const post = async (body: unknown, options: Parameters<typeof webhookRequest>[2] = {}, env = fixture.env) =>
    handleWhatsAppWebhook(webhookRequest(body, fixture.appSecret, options), { env, host, runtime, transport: fixtureTransport(sent), interpreter: null, logger });
  const say = (text: string, bsuid = USER_BSUID) => post(inbound([{ text, bsuid }]));
  const surface = () => approvalSurface(fixture.env, () => undefined, { host, runtime });
  const lastLink = () => { const body = [...sent].reverse().find(r => (r.body as { interactive?: { type?: string } }).interactive?.type === 'cta_url')?.body as
    { interactive: { action: { parameters: { url: string } } } } | undefined; return body?.interactive.action.parameters.url ?? null; };
  const secretOf = (url: string) => decodeURIComponent(new URL(url).hash.slice(1));
  const texts = () => sent.map(r => { const b = r.body as { text?: { body: string }; interactive?: { body: { text: string } } }; return b.text?.body ?? b.interactive?.body.text ?? ''; });
  return { ...fixture, calls, sent, logs, post, say, surface, lastLink, secretOf, texts, host };
}
const refusal = async (work: Promise<unknown>) => { try { await work; return 'NO_REFUSAL'; } catch (e) { return e instanceof PlatformRefusal ? e.message : String(e); } };
const evm = (address: string): WalletRef => ({ namespace: 'eip155', address });
const workflowOf = (command: Command) => editorReducer(initialEditor(), command, dappReviewContext()).workflow;
const SUPPLY = (amount = '100', beneficiary = OWNER) => `supply ${amount} USDC to Aave on Base Sepolia beneficiary ${beneficiary}`;

describe('BUILD-CHANNELS-001 WhatsApp channel (PostgreSQL, fixture provider, MOCKED engine)', () => {
  it('verifies the subscription and refuses forged, oversized, mistyped or unconfigured deliveries before storing anything', async () => {
    const d = deployment(), base = 'http://127.0.0.1:3100/api/channels/whatsapp';
    const get = await handleWhatsAppWebhook(new Request(`${base}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(d.verifyToken)}&hub.challenge=4242`), { env: d.env });
    expect([get.status, await get.text()]).toEqual([200, '4242']);
    const before = (await t.db.query('SELECT count(*)::int AS n FROM channel_events')).rows[0]!.n;
    expect((await d.post(inbound([{ text: 'hi' }]), { signature: 'sha256=' + '0'.repeat(64) })).status).toBe(401);
    expect((await d.post(inbound([{ text: 'hi' }]), { signature: null })).status).toBe(401);
    expect((await d.post(inbound([{ text: 'hi' }]), { contentType: 'text/plain' })).status).toBe(415);
    expect((await d.post(inbound([{ text: 'x'.repeat(4_300_000) }]))).status).toBe(413);
    expect((await d.post(inbound([{ text: 'hi' }]), {}, { ...d.env, VERCEL: '1', VERCEL_ENV: 'production' })).status).toBe(404);
    expect((await d.post(inbound([{ text: 'hi' }]), {}, { ...d.env, FLOFI_CHANNEL_SECRET: undefined })).status).toBe(503);
    expect((await d.post(inbound([{ text: 'hi' }]), {}, { ...d.env, FLOFI_WHATSAPP: undefined })).status).toBe(404);
    expect((await t.db.query('SELECT count(*)::int AS n FROM channel_events')).rows[0]!.n).toBe(before);
    expect(d.sent).toHaveLength(0);
  });

  it('turns a message into a CHANNEL_CONVERSATION approval on the shared platform: no MCP account or grant, link delivered once, stored nowhere', async () => {
    const d = deployment(), accountsBefore = (await t.db.query('SELECT count(*)::int AS n FROM mcp_accounts')).rows[0]!.n;
    expect((await d.say(SUPPLY())).status).toBe(200);
    const url = d.lastLink()!;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:3100\/approve#flofi_chs_[A-Za-z0-9_-]{43}$/);
    const ready = d.texts().at(-1)!;
    expect(ready).toMatch(/Strategy ready:\n1\. Supply 100 USDC · Aave V3 · Base Sepolia\nNetwork: Base Sepolia \(test funds\)/);
    expect(ready).toMatch(/Nothing is authorized yet: open FloFi, connect the wallet 0x1111…1111, review the Strategy Manifest and sign there/);
    expect(ready).toMatch(/Simulation preview passed \(read-only, MOCKED\)/);
    expect(ready).not.toContain(OWNER);
    const row = (await t.db.query(`SELECT requester_kind, requester_id, requester_context, account_id, grant_id, client_id, client_name, status FROM mcp_handoffs
      WHERE requester_kind = 'CHANNEL_CONVERSATION' ORDER BY created_at DESC LIMIT 1`)).rows[0]!;
    expect(row).toMatchObject({ requester_kind: 'CHANNEL_CONVERSATION', requester_id: expect.stringMatching(/^chc_[a-z2-7]{26}$/), account_id: null, grant_id: null,
      client_id: '106540352242922'.replace(/^/, 'whatsapp:'), client_name: 'WhatsApp', status: 'PENDING', requester_context: { intendedWallet: evm(OWNER) } });
    expect((await t.db.query('SELECT count(*)::int AS n FROM mcp_accounts')).rows[0]!.n).toBe(accountsBefore);
    // The secret is nowhere at rest: not in the outbox, the events, the conversation state or the handoff row.
    const dump = JSON.stringify((await t.db.query(`SELECT * FROM channel_outbox`)).rows) + JSON.stringify((await t.db.query(`SELECT * FROM mcp_handoffs`)).rows);
    expect(dump).not.toContain(d.secretOf(url));
    expect(d.calls.every(c => /^(mode|info|preview):/.test(c))).toBe(true);
    expect(d.calls).toContain('preview:aave-supply');
  });

  it('never duplicates a turn, a reply or a handoff when the provider redelivers (sequentially or concurrently)', async () => {
    const d = deployment(), body = inbound([{ id: messageId(), text: SUPPLY('7') }]);
    await d.post(body);
    const handoffs = async () => (await t.db.query(`SELECT count(*)::int AS n FROM mcp_handoffs WHERE workflow_hash IN (SELECT workflow_hash FROM mcp_handoffs
      WHERE client_name = 'WhatsApp' ORDER BY created_at DESC LIMIT 1)`)).rows[0]!.n;
    const sentOnce = d.sent.length, once = await handoffs();
    await Promise.all([d.post(body), d.post(body), d.post(body)]);
    await d.post(body);
    expect(d.sent.length).toBe(sentOnce);
    expect(await handoffs()).toBe(once);
  });

  it('keeps the wallet proof mandatory and lets only the intended wallet claim; a sender id is never a wallet', async () => {
    const d = deployment();
    await d.say(SUPPLY('3'));
    const secret = d.secretOf(d.lastLink()!), surface = await d.surface();
    const view = await viewApproval(surface, secret, []);
    expect(view).toMatchObject({ status: 'PENDING', clientName: 'WhatsApp', requesterKind: 'CHANNEL_CONVERSATION', authority: 'NONE', authorized: false, sameAccount: false,
      statusShared: false, walletNamespace: 'eip155' });
    expect(JSON.stringify(view)).not.toMatch(/intendedWallet|BR\.FLOFI|5511900000001/);
    expect(await refusal(claimApproval(surface, secret, [], true))).toBe('EVM_WALLET_PROOF_REQUIRED');
    expect(await refusal(claimApproval(surface, secret, [{ namespace: 'solana', address: USER_BSUID }], true))).toBe('EVM_WALLET_PROOF_REQUIRED');
    expect(await refusal(claimApproval(surface, secret, [evm(OTHER)], true))).toBe('CHANNEL_INTENDED_WALLET_MISMATCH');
    const claimed = await claimApproval(surface, secret, [evm(OWNER)], false);
    expect(claimed.command).toMatchObject({ type: 'ADD_SUPPLY', input: { amount: '3', beneficiary: OWNER } });
    expect(claimed.view).toMatchObject({ status: 'CLAIMED', claimedByYou: true });
    const applied = await applyApproval(surface, secret, [evm(OWNER)], workflowOf(claimed.command));
    expect(applied.status).toBe('APPLIED');
    // STATUS reports the approval but no run: the owner did not share run status with the conversation.
    await d.say('status');
    expect(d.texts().at(-1)).toMatch(/Proposal in a FloFi workflow[\s\S]*has not shared run status/);
  });

  it('treats "yes", "confirm" and "execute" as nothing: no state change, no execution path, only the zero-authority notice', async () => {
    const d = deployment();
    await d.say(SUPPLY('4'));
    const secret = d.secretOf(d.lastLink()!), calls = d.calls.length;
    for (const word of ['yes', 'confirm', 'execute', 'sim', 'executar']) {
      await d.say(word);
      expect(d.texts().at(-1)).toMatch(/Nothing can be authorized here|Nada pode ser autorizado aqui/);
    }
    expect((await viewApproval(await d.surface(), secret, [])).status).toBe('PENDING');
    expect(d.calls.slice(calls).filter(c => !/^(mode|info):/.test(c))).toEqual([]);
  });

  it('revokes a link whenever the pending proposal is materially replaced: correction, LINK and NEW', async () => {
    const d = deployment();
    await d.say(SUPPLY('10'));
    const first = d.secretOf(d.lastLink()!);
    await d.say(SUPPLY('5'));
    const second = d.secretOf(d.lastLink()!);
    expect(d.texts().at(-1)).toMatch(/The previous approval link no longer works/);
    const surface = await d.surface();
    expect((await viewApproval(surface, first, [])).status).toBe('REVOKED');
    expect(await refusal(claimApproval(surface, first, [evm(OWNER)], false))).toBe('HANDOFF_REVOKED');
    await d.say('link');
    const third = d.secretOf(d.lastLink()!);
    expect(third).not.toBe(second);
    expect((await viewApproval(surface, second, [])).status).toBe('REVOKED');
    await d.say('new');
    expect(d.texts().at(-1)).toMatch(/Cancelled/);
    expect((await viewApproval(surface, third, [])).status).toBe('REVOKED');
  });

  it('isolates requesters: another conversation sees nothing of this one and cannot reach its proposal', async () => {
    const d = deployment();
    await d.say(SUPPLY('6'));
    const secret = d.secretOf(d.lastLink()!);
    await d.say('status', SECOND_BSUID);
    expect(d.texts().at(-1)).toMatch(/There is no proposal from this chat yet/);
    // Another conversation's NEW or LINK never reaches this proposal.
    await d.say('new', SECOND_BSUID);
    await d.say('link', SECOND_BSUID);
    expect((await viewApproval(await d.surface(), secret, [])).status).toBe('PENDING');
    const conversations = (await t.db.query(`SELECT DISTINCT requester_id FROM mcp_handoffs WHERE client_name = 'WhatsApp'`)).rows.map(r => r.requester_id);
    expect(conversations.length).toBeGreaterThanOrEqual(1);
    // The MCP surface's links cannot resolve a channel handoff (and the channel scheme cannot resolve an MCP one).
    const mcpOnly = await approvalSurface({ ...d.env, FLOFI_WHATSAPP: undefined }, () => undefined, { host: d.host, runtime: recordingRuntime([]) }).catch(e => e.message);
    expect(mcpOnly).toBe('APPROVALS_NOT_ENABLED');
    expect(await refusal(viewApproval(await d.surface(), secret.replace('flofi_chs_', 'flofi_hs_'), []))).toBe('HANDOFF_NOT_FOUND');
  });

  it('refuses secrets without storing them, answers unsupported content, and stays silent for senders outside the allowlist', async () => {
    const d = deployment(), phrase = 'my seed phrase is ' + Array.from({ length: 12 }, (_, i) => ['alpha', 'bravo', 'delta', 'eagle'][i % 4]).join(' ');
    await d.say(phrase);
    expect(d.texts().at(-1)).toMatch(/Never send a private key or seed phrase[\s\S]*already reached the messaging provider/);
    await d.say(`0x${randomBytes(32).toString('hex')}`);
    expect(d.texts().at(-1)).toMatch(/Never send a private key/);
    await d.post(inbound([{ type: 'audio', extra: { audio: { id: 'm1' } } }]));
    expect(d.texts().at(-1)).toMatch(/I can only read text messages/);
    const sent = d.sent.length, stranger = 'BR.STRANGER0000001';
    await d.say(SUPPLY('2'), stranger);
    expect(d.sent.length).toBe(sent);
    const ignored = (await t.db.query(`SELECT conversation_id, outcome FROM channel_events WHERE outcome = 'IGNORED_NOT_ALLOWLISTED'`)).rows;
    expect(ignored.length).toBeGreaterThan(0);
    expect(ignored.every(r => r.conversation_id === null)).toBe(true);
    const everything = JSON.stringify((await t.db.query('SELECT * FROM channel_events')).rows) + JSON.stringify((await t.db.query('SELECT * FROM channel_conversations')).rows)
      + JSON.stringify((await t.db.query('SELECT * FROM channel_outbox')).rows);
    for (const plain of ['seed phrase', 'alpha bravo', stranger, USER_BSUID, USER_PHONE, 'supply 2 USDC']) expect(everything, plain).not.toContain(plain);
  });

  it('withdraws an approval whose message could not be delivered (its link is gone) and retries other replies in order, once', async () => {
    const d = deployment(), base = Date.now(), at = (s: number) => () => new Date(base + s * 1000);
    let failures = 0, approvalAttempts = 0;
    const fixture = fixtureTransport(d.sent), unavailable = { kind: 'ANSWER' as const, status: 503, body: JSON.stringify({ error: { code: 131000 } }), retryAfterMs: null };
    // The Cloud API reports itself unavailable for every approval message, and once for the next plain reply.
    const flaky: typeof fixture = Object.assign(async (request: { readonly body: Record<string, unknown> }) => {
      if ((request.body.interactive as { type?: string } | undefined)?.type === 'cta_url') { approvalAttempts++; return unavailable; }
      if (failures++ === 0) return unavailable;
      return fixture(request);
    }, { sent: fixture.sent });
    const post = (text: string, now: () => Date) => handleWhatsAppWebhook(webhookRequest(inbound([{ text }]), d.appSecret),
      { env: d.env, host: d.host, runtime: recordingRuntime([]), transport: flaky, interpreter: null, now, sleep: async () => undefined });
    await post(SUPPLY('9'), at(0));
    // The approval message was retried in place (its link exists only in that turn), then withdrawn at once with its link.
    expect(approvalAttempts).toBe(3);
    const [handoff] = (await t.db.query(`SELECT handoff_id, status FROM mcp_handoffs WHERE client_name = 'WhatsApp' ORDER BY created_at DESC LIMIT 1`)).rows;
    expect(handoff!.status).toBe('REVOKED');
    const approvalRow = (await t.db.query(`SELECT status, error_code, body_ciphertext IS NULL AS erased FROM channel_outbox WHERE handoff_id = $1 AND kind = 'APPROVAL'`,
      [handoff!.handoff_id])).rows;
    expect(approvalRow).toEqual([{ status: 'FAILED', error_code: 'PROVIDER_UNAVAILABLE', erased: true }]);
    // The "send LINK" notice failed once too: it waits for its backoff, nothing was delivered yet.
    expect(d.sent).toHaveLength(0);
    await post('help', at(60));
    await post('status', at(120));
    const texts = d.texts();
    expect(texts.filter(t => /could not be delivered, so it was withdrawn/.test(t))).toHaveLength(1);
    expect(texts.findIndex(t => /could not be delivered/.test(t))).toBeLessThan(texts.findIndex(t => /^What I can do/.test(t)));
    expect(texts.filter(t => /^Strategy ready/.test(t))).toHaveLength(0);
    expect(d.sent.some(r => (r.body as { interactive?: { type?: string } }).interactive?.type === 'cta_url')).toBe(false);
    expect(new Set(d.sent.map(r => (r.body as { biz_opaque_callback_data: string }).biz_opaque_callback_data)).size).toBe(d.sent.length);
  });

  it('never resends a reply whose outcome is unknown, and lets the status webhook confirm it', async () => {
    const d = deployment(), fixture = fixtureTransport(d.sent);
    let calls = 0;
    // Meta took the message but the answer was lost (a timeout after sending).
    const lost: typeof fixture = Object.assign(async (request: { readonly body: Record<string, unknown> }) => {
      calls++; await fixture(request); return { kind: 'UNCERTAIN' as const, code: 'PROVIDER_TIMEOUT' };
    }, { sent: fixture.sent });
    await handleWhatsAppWebhook(webhookRequest(inbound([{ text: 'help' }]), d.appSecret), { env: d.env, host: d.host, runtime: recordingRuntime([]), transport: lost,
      interpreter: null });
    const id = (d.sent.at(-1)!.body as { biz_opaque_callback_data: string }).biz_opaque_callback_data;
    const row = async () => (await t.db.query('SELECT status, delivery, error_code, body_ciphertext IS NULL AS erased FROM channel_outbox WHERE outbox_id = $1', [id])).rows[0];
    expect(await row()).toEqual({ status: 'UNCERTAIN', delivery: null, error_code: 'PROVIDER_TIMEOUT', erased: true });
    // Another turn never sends it again.
    const tried = calls;
    await d.say('status');
    expect(d.sent.filter(r => (r.body as { biz_opaque_callback_data: string }).biz_opaque_callback_data === id)).toHaveLength(1);
    expect(calls).toBe(tried);
    // Meta's status webhook echoes our correlation id: the send is confirmed.
    await d.post(statuses([{ id: 'wamid.LOSTANSWER', status: 'delivered', correlation: id }]));
    expect(await row()).toEqual({ status: 'SENT', delivery: 'DELIVERED', error_code: 'PROVIDER_TIMEOUT', erased: true });
  });

  it('erases a crashed turn\'s payload once it is too late to act on it, instead of processing it late', async () => {
    const d = deployment(), past = new Date(Date.now() - 20 * 60_000), id = messageId();
    // The turn never runs (the instance died after acknowledging): the event stays PENDING with its encrypted payload.
    await handleWhatsAppWebhook(webhookRequest(inbound([{ id, text: SUPPLY('8') }]), d.appSecret), { env: d.env, host: d.host, runtime: recordingRuntime([]),
      transport: fixtureTransport(d.sent), interpreter: null, now: () => past, schedule: () => undefined });
    const stranded = async () => (await t.db.query(`SELECT status, outcome, payload_ciphertext IS NOT NULL AS payload FROM channel_events WHERE received_at = $1`, [past])).rows;
    expect(await stranded()).toEqual([{ status: 'PENDING', outcome: null, payload: true }]);
    const sent = d.sent.length;
    await d.post(statuses([{ id: 'wamid.unrelated2', status: 'read' }]));
    expect(await stranded()).toEqual([{ status: 'FAILED', outcome: 'EXPIRED_UNPROCESSED', payload: false }]);
    expect(d.sent.length).toBe(sent);
  });

  it('applies provider delivery reports to the outbox by the echoed correlation id', async () => {
    const d = deployment();
    await d.say('help');
    const last = d.sent.at(-1)!.body as { biz_opaque_callback_data: string };
    const id = last.biz_opaque_callback_data;
    await d.post(statuses([{ id: 'wamid.unrelated', status: 'read', correlation: id }]));
    const row = (await t.db.query('SELECT status, delivery FROM channel_outbox WHERE outbox_id = $1', [id])).rows[0]!;
    // The report names another provider message than the one recorded for this row: not ours, nothing changes.
    expect(row).toEqual({ status: 'SENT', delivery: 'SENT' });
  });

  it('understands only exact commands with the interpreter disabled, and logs nothing but closed codes and opaque ids', async () => {
    const d = deployment({ FLOFI_CHANNEL_COPILOT: 'disabled' });
    await d.say('Put 100 USDC into Aave on Base Sepolia please');
    expect(d.texts().at(-1)).toMatch(/I could not read that as a strategy/);
    const logs = d.logs.join('\n');
    expect(logs).toMatch(/channel\.turn/);
    for (const secret of [d.appSecret, d.verifyToken, d.channelSecret, USER_BSUID, USER_PHONE, 'flofi_chs_', 'Put 100 USDC', OWNER, 'http://127.0.0.1:3100/approve'])
      expect(logs, secret).not.toContain(secret);
  });
});
