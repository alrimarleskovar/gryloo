// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the MOCKED WhatsApp journeys end to end, on the embedded PostgreSQL runtime (shipped migrations + staged 0008)
 * with MOCKED loopback chains and the fixture transport — no Meta endpoint, no public network, no real transaction:
 *
 *   signed webhook → Channel Core turn → canonical StrategySpec → CHANNEL_CONVERSATION approval on the shared platform → link
 *   delivered once → FloFi /approve: wallet-proven claim (status shared) → applied proposal → the owner's own, unchanged flow
 *   (simulate → Review → wallet-signed transactions → reconciliation) → the /approve ping tells the chat "loaded in FloFi", then
 *   "Execution reconciled ✅ · evidence: MOCKED".
 *
 * Every request gets a brand-new runtime instance, as a serverless platform may give it. The channel never calls a flow method that
 * could authorize or send: the only "sends" are the owner's wallet transactions, counted by the MOCKED chains.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import type { TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import type { FlowName } from '../../../backend/flows.ts';
import { createLendingHarness, OWNER as LENDING_OWNER } from '../../../e2e/lending-harness.mjs';
import { createRouterHarness, ROUTER_OWNER, type RouterHarness } from '../../../e2e/router-harness.ts';
import type { Command } from '../../domain/commands';
import { act, intent } from '../../domain/copilot-session.test-harness';
import { editorReducer, initialEditor } from '../../domain/editor';
import { dappReviewContext } from '../../engine/strategy-engine';
import { applyApproval, claimApproval, embeddedEngineRuntime, viewApproval, type WalletRef } from '../../platform/index.ts';
import { approvalSurface } from '../../server/approval-surface.ts';
import { createEmbeddedRuntime, type EmbeddedSeams } from '../../server/flow-runtime.ts';
import type { LendingRecord } from '../../server/lending-composition-service.ts';
import type { RouterBegin, RouterRecord } from '../../server/router-service.ts';
import { pingChannelApproval } from '../approval-ping.ts';
import { createChannelTestDatabase } from '../core/channel-db.test-harness.ts';
import type { ChannelInterpreter } from '../core/conversation.ts';
import { handleWhatsAppWebhook } from './handler.ts';
import { fixtureTransport, type FixtureRecord } from './transport.ts';
import { inbound, USER_BSUID, USER_PHONE, webhookRequest, whatsAppEnv } from './fixtures.test-harness.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createChannelTestDatabase(); });
afterAll(async () => { await t?.drop(); });
type Result<T> = { ok: boolean; value?: T; code?: string };
function ok<T>(result: Result<T>): T { if (!result.ok) throw new Error(result.code); return result.value as T; }
const evm = (address: string): WalletRef => ({ namespace: 'eip155', address });
const workflowOf = (command: Command) => editorReducer(initialEditor(), command, dappReviewContext()).workflow as SemanticWorkflow;

/** A scripted untrusted interpreter: exactly the structured answers a model may return, in order. */
function scripted(script: Record<string, unknown>[]): { interpreter: ChannelInterpreter; calls: () => number } {
  let calls = 0;
  return { calls: () => calls, interpreter: async () => { calls++; const next = script.shift(); if (!next) throw new Error('unexpected model call'); return { ok: true, intent: next as never }; } };
}

/** One local deployment of the channel (fixture provider) and FloFi, sharing one PostgreSQL; every call is a fresh runtime instance. */
function deployment(harness: Record<string, string>, seams: EmbeddedSeams, interpreter: ChannelInterpreter | null = null) {
  const fixture = whatsAppEnv({ FLOFI_RUNTIME: 'embedded', DATABASE_URL: t.url, ...harness }), env = fixture.env;
  const sent: FixtureRecord[] = [], logs: string[] = [];
  const logger = { info: (e: string, f?: unknown) => logs.push(JSON.stringify([e, f])), warn: (e: string, f?: unknown) => logs.push(JSON.stringify([e, f])) };
  const instance = () => createEmbeddedRuntime(env, { ...seams, busyRetries: 3 });
  const within = async <T>(work: (i: Awaited<ReturnType<typeof instance>>) => Promise<T>) => { const i = await instance(); try { return await work(i); } finally { await i.close(); } };
  const seam = (i: Awaited<ReturnType<typeof instance>>) => ({ host: { db: i.db, tenantId: i.tenantId }, runtime: embeddedEngineRuntime(i), transport: fixtureTransport(sent), logger });
  const say = (text: string) => within(async i => (await handleWhatsAppWebhook(webhookRequest(inbound([{ text }]), fixture.appSecret), { env, interpreter, ...seam(i) })).status);
  const surface = <T>(work: (s: Awaited<ReturnType<typeof approvalSurface>>) => Promise<T>) =>
    within(async i => work(await approvalSurface(env, () => undefined, { host: { db: i.db, tenantId: i.tenantId }, runtime: embeddedEngineRuntime(i) })));
  const ping = (secret: string, wallets: readonly WalletRef[]) => within(i => pingChannelApproval(env, secret, wallets, seam(i)));
  const flow = <T>(name: FlowName, owner: string, method: string, ...args: unknown[]) => within(async i => ok<T>(await i.backend.callFlow(name, method, args, undefined, owner) as Result<T>));
  const texts = () => sent.map(r => { const b = r.body as { text?: { body: string }; interactive?: { body: { text: string } } }; return b.text?.body ?? b.interactive?.body.text ?? ''; });
  const link = () => { const b = [...sent].reverse().find(r => (r.body as { interactive?: { type?: string } }).interactive?.type === 'cta_url')?.body as
    { interactive: { action: { parameters: { url: string } } } } | undefined; return b ? decodeURIComponent(new URL(b.interactive.action.parameters.url).hash.slice(1)) : null; };
  return { ...fixture, sent, logs, say, surface, ping, flow, texts, link };
}
type Deployment = ReturnType<typeof deployment>;

/** FloFi /approve for the owner's proven wallet: claim with status shared, load the proposal into the editor, apply. */
async function approveInFloFi(d: Deployment, secret: string, owner: string) {
  const claimed = await d.surface(s => claimApproval(s, secret, [evm(owner)], true));
  expect(claimed.view).toMatchObject({ status: 'CLAIMED', claimedByYou: true, statusShared: true, requesterKind: 'CHANNEL_CONVERSATION', clientName: 'WhatsApp', authority: 'NONE' });
  const workflow = workflowOf(claimed.command);
  expect((await d.surface(s => applyApproval(s, secret, [evm(owner)], workflow))).status).toBe('APPLIED');
  return workflow;
}
/** The channel's view of the run, through the /approve ping, exactly as the open approval page would trigger it. */
async function pingUntilDone(d: Deployment, secret: string, owner: string) {
  const before = d.sent.length, first = await d.ping(secret, [evm(owner)]);
  const again = await d.ping(secret, [evm(owner)]);
  return { first, again, delivered: d.texts().slice(before) };
}
function assertNoLeak(d: Deployment, values: readonly string[]) {
  const logs = d.logs.join('\n');
  for (const value of [d.appSecret, d.verifyToken, d.channelSecret, USER_BSUID, USER_PHONE, 'flofi_chs_', 'http://127.0.0.1:3100/approve', ...values])
    expect(logs, value).not.toContain(value);
}

describe('BUILD-CHANNELS-001 MOCKED WhatsApp journeys (embedded runtime, MOCKED chains, fixture provider)', () => {
  it('bridge on the testnet router: chat → approval → owner wallet in FloFi → reconciled → "Execution reconciled ✅ · evidence: MOCKED" in the chat', async () => {
    const FLOW: FlowName = 'crosschain-router-testnet', h: RouterHarness = createRouterHarness({ profile: TESTNET, nonce: 41n });
    const d = deployment({ GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY' },
      { rpc: { [FLOW]: h.baseRpc }, routers: { [FLOW]: { destinationRpc: h.arbitrumRpc, providers: h.providers } } });

    expect(await d.say('bridge 5 USDC from Base Sepolia to Arbitrum Sepolia via auto slippage 50 bps')).toBe(200);
    expect(d.texts().at(-1)).toMatch(/Strategy ready:\n1\. Bridge 5 USDC[\s\S]*Network: Base Sepolia → Arbitrum Sepolia \(test funds\)[\s\S]*Nothing is authorized yet/);
    const secret = d.link()!;
    expect(secret).toMatch(/^flofi_chs_[A-Za-z0-9_-]{43}$/);
    // "Yes" in the chat is nothing: no claim, no run, no transaction.
    await d.say('yes, execute it');
    expect(d.texts().at(-1)).toMatch(/Nothing can be authorized here/);
    expect((await d.surface(s => viewApproval(s, secret, []))).status).toBe('PENDING');
    // Before the owner claims, the ping has nothing to say (and a stranger's wallet never does).
    expect(await d.ping(secret, [evm(ROUTER_OWNER)])).toEqual({ channel: true, active: true });
    expect(h.counters.sends).toBe(0);

    const workflow = await approveInFloFi(d, secret, ROUTER_OWNER);
    const loaded = await pingUntilDone(d, secret, ROUTER_OWNER);
    expect(loaded.first).toEqual({ channel: true, active: true });
    expect(loaded.delivered).toEqual([expect.stringMatching(/^Your proposal is loaded in FloFi for the connected wallet\. Nothing is signed yet/)]);
    expect(await d.ping(secret, [evm('0x' + '9'.repeat(40))])).toEqual({ channel: true, active: true });

    // The owner's own, unchanged journey in FloFi: fresh simulation, Review, two wallet-signed transactions, reconciliation.
    const owner = <T>(method: string, ...args: unknown[]) => d.flow<T>(FLOW, ROUTER_OWNER, method, ...args);
    const run = await owner<RouterRecord>('simulate', workflow, ROUTER_OWNER);
    await owner('review', run.id, run.review.commitment, workflow);
    for (const step of ['APPROVAL', 'DEPOSIT']) {
      const begun = await owner<RouterBegin>('begin', run.id, ROUTER_OWNER, workflow);
      expect(begun.attempt.step).toBe(step);
      await owner('handoff', run.id);
      await owner('report', run.id, { kind: 'HASH', hash: h.wallet.send(begun.transaction) });
      await owner('observe', run.id);
    }
    let final = await owner<RouterRecord>('observe', run.id);
    for (let i = 0; i < 12 && final.phase !== 'RECONCILED'; i++) { h.advance(5); final = await owner<RouterRecord>('observe', run.id); }
    expect(final).toMatchObject({ phase: 'RECONCILED', verdict: 'RECONCILED' });

    const reconciled = await pingUntilDone(d, secret, ROUTER_OWNER);
    expect(reconciled.first).toEqual({ channel: true, active: false });
    expect(reconciled.delivered).toEqual([`Execution reconciled ✅ · evidence: MOCKED · outcome: RECONCILED · bundle ${final.evidence!.bundleHash.slice(0, 6)}…${final.evidence!.bundleHash.slice(-4)}`]);
    expect(reconciled.again).toEqual({ channel: true, active: false });
    await d.say('status');
    expect(d.texts().at(-1)).toMatch(/Execution reconciled ✅ · evidence: MOCKED/);
    // The chat never received a transaction, calldata, a signature, the owner's wallet or the run id.
    const chat = d.texts().join('\n');
    expect(chat).not.toMatch(/0x[0-9a-fA-F]{20,}|calldata/i);
    expect(chat).not.toContain(final.id);
    expect(h.counters.sends).toBe(2);
    assertNoLeak(d, [ROUTER_OWNER, final.id]);
  }, 240_000);

  it('the lending composition from natural language (scripted untrusted interpreter): clarify the owner, approve, five owner-signed steps, reconciled', async () => {
    const FLOW: FlowName = 'lending-composition', model = createLendingHarness();
    const composition = (owner: string | null) => intent.composition([act.lending('SUPPLY', { amount: '0.1', asset: 'USDC', beneficiary: owner }),
      act.lending('BORROW', { amount: '0.01', asset: 'USDC', beneficiary: owner }), act.swap({ network: 'BASE_SEPOLIA', inputAsset: 'USDC', outputAsset: 'WETH' })]);
    const ai = scripted([composition(null), composition(LENDING_OWNER)]);
    const d = deployment({ GRYLOO_LENDING_HARNESS: 'MOCKED_LOOPBACK_ONLY' }, { rpc: { [FLOW]: model.rpc } }, ai.interpreter);

    await d.say('Supply 0.1 USDC on Aave, borrow 0.01 USDC and swap the borrowed USDC to WETH on Base Sepolia');
    expect(d.link()).toBeNull();
    await d.say(`Use ${LENDING_OWNER}`);
    expect(ai.calls()).toBe(2);
    const ready = d.texts().at(-1)!;
    expect(ready).toMatch(/Strategy ready:\n1\. Supply 0\.1 USDC[\s\S]*2\. Borrow 0\.01 USDC[\s\S]*3\. Swap[\s\S]*USDC → WETH[\s\S]*Network: Base Sepolia \(test funds\)/);
    expect(ready).toMatch(/open FloFi, connect the wallet 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}[\s\S]*Interpreted from your message with an AI assistant/);
    const secret = d.link()!;
    expect(model.transactions).toHaveLength(0);

    // Only the wallet the strategy names may load it; the owner proves it, shares status and applies.
    expect(await d.surface(s => claimApproval(s, secret, [evm(ROUTER_OWNER)], true)).catch(e => e.message)).toBe('CHANNEL_INTENDED_WALLET_MISMATCH');
    const workflow = await approveInFloFi(d, secret, LENDING_OWNER);
    expect((await pingUntilDone(d, secret, LENDING_OWNER)).delivered).toEqual([expect.stringMatching(/^Your proposal is loaded in FloFi/)]);

    const owner = <T>(method: string, ...args: unknown[]) => d.flow<T>(FLOW, LENDING_OWNER, method, ...args);
    const simulated = await owner<LendingRecord>('simulate', workflow, LENDING_OWNER);
    let r = await owner<LendingRecord>('review', simulated.id, simulated.reviews[0]!.commitment, workflow);
    for (let i = 0; i < 5; i++) {
      const begin = await owner<{ attemptId: string; transaction: Record<string, string> }>('begin', r.id, LENDING_OWNER, workflow);
      await owner('handoff', r.id, begin.attemptId);
      const hash = await model.rpc('MOCK_submit', [begin.transaction]) as string;     // the owner's wallet, the only submitter
      await owner('report', r.id, begin.attemptId, { kind: 'HASH', hash });
      r = await owner<LendingRecord>('observe', r.id);
      if (r.status !== 'COMPLETED') { r = await owner<LendingRecord>('refresh', r.id); r = await owner<LendingRecord>('review', r.id, r.reviews.at(-1)!.commitment, workflow); }
    }
    expect(r.status).toBe('COMPLETED');
    expect(r.evidence?.bundle.outcome).toBe('RECONCILED');

    const reconciled = await pingUntilDone(d, secret, LENDING_OWNER);
    expect(reconciled.first).toEqual({ channel: true, active: false });
    expect(reconciled.delivered).toEqual([expect.stringMatching(/^Execution reconciled ✅ · evidence: MOCKED · outcome: RECONCILED · bundle 0x[0-9a-f]{4}…[0-9a-f]{4}$/)]);
    expect(model.transactions).toHaveLength(5);
    expect(ai.calls()).toBe(2);
    assertNoLeak(d, [LENDING_OWNER, LENDING_OWNER.toLowerCase(), r.id, 'Supply 0.1 USDC']);
  }, 300_000);
});
