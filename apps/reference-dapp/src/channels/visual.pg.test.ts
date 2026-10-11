// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: the workflow picture on Telegram and WhatsApp, end to end at the HTTP boundary, on a disposable
 * loopback PostgreSQL with a recording engine runtime (MOCKED flows; any execution would be recorded), the Bot API double and the
 * WhatsApp fixture transport (nothing leaves the process).
 *
 *   picture displayed (photo / image header, with the same text and the same Open FloFi link)
 *     → Open in FloFi: the existing approval handoff, validated on /approve
 *     → the exact canonical workflow → the same workflow hash the picture shows → claimed and applied by the intended, proven wallet
 *
 * The picture is never the handoff: it is drawn from the handoff's own canonical strategy, and a picture that cannot be drawn leaves a
 * complete, claimable text proposal. Nothing signs or executes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { semanticWorkflowHash } from '../engine/strategy-engine';
import { applyApproval, claimApproval, composeWorkflowOrRefuse, type WalletRef } from '../platform/index.ts';
import { workflowVisualModel } from '../platform/workflow-visual.ts';
import { approvalSurface } from '../server/approval-surface.ts';
import { isPng } from '../server/workflow-visual-image.ts';
import { act, intent } from '../domain/copilot-session.test-harness';
import { recordingRuntime } from './core/engine.test-harness.ts';
import type { ChannelVisual, ChannelVisualRenderer } from './core/types.ts';
import { botApi, telegramEnv, telegramRequest, textUpdate, type BotFile } from './telegram/fixtures.test-harness.ts';
import { handleTelegramWebhook } from './telegram/handler.ts';
import { channelVisualRenderer } from './visuals.ts';
import { inbound, webhookRequest, whatsAppEnv } from './whatsapp/fixtures.test-harness.ts';
import { handleWhatsAppWebhook } from './whatsapp/handler.ts';
import { fixtureTransport, type FixtureRecord, type FixtureUpload } from './whatsapp/transport.ts';

const OWNER = '0x1111111111111111111111111111111111111111';
const SUPPLY = `supply 3 USDC to Aave on Base Sepolia beneficiary ${OWNER}`;
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });

const evm = (address: string): WalletRef => ({ namespace: 'eip155', address });
const secretOf = (url: string) => decodeURIComponent(new URL(url).hash.slice(1));
type Handoff = { handoff_id: string; workflow_hash: string; strategy: unknown; status: string };
const lastHandoff = async (client: string) => (await t.db.query(`SELECT handoff_id, workflow_hash, strategy, status FROM mcp_handoffs WHERE client_name = $1
  ORDER BY created_at DESC LIMIT 1`, [client])).rows[0] as Handoff;
/** The shared renderer, recording what it was asked to draw. */
function recording(inner: ChannelVisualRenderer = channelVisualRenderer) {
  const seen: ChannelVisual[] = [];
  const renderer: ChannelVisualRenderer = visual => { seen.push(visual); return inner(visual); };
  return { renderer, seen };
}
/**
 * The /approve side of continuity: the handoff behind the delivered link is the canonical workflow the picture shows; the intended,
 * proven wallet claims it and applies exactly that workflow; nothing executed.
 */
async function openInFloFi(env: Record<string, string | undefined>, url: string, client: string, pictured: string | null, calls: string[]) {
  const host = { db: t.db, tenantId: 'default' }, surface = await approvalSurface(env, () => undefined, { host, runtime: recordingRuntime(calls) });
  const handoff = await lastHandoff(client);
  if (pictured) {
    expect(pictured).toBe(handoff.workflow_hash);
    expect(workflowVisualModel(composeWorkflowOrRefuse(handoff.strategy, handoff.workflow_hash)).workflowHash).toBe(pictured);
  }
  const claimed = await claimApproval(surface, secretOf(url), [evm(OWNER)], false);
  expect(claimed.view).toMatchObject({ status: 'CLAIMED', authority: 'NONE' });
  expect([claimed.workflowHash, semanticWorkflowHash(claimed.workflow)]).toEqual([handoff.workflow_hash, handoff.workflow_hash]);
  expect((await applyApproval(surface, secretOf(url), [evm(OWNER)], claimed.workflow)).status).toBe('APPLIED');
  expect(calls).not.toContain('EXECUTION_PATH');
  return handoff;
}

describe('BUILD-WORKFLOW-VISUAL-PRESENTATION-001 channel workflow picture (PostgreSQL)', () => {
  it('Telegram: the proposal is one photo — the PNG of the canonical workflow, its text as caption, the Open FloFi button — and opens that exact workflow', async () => {
    const f = telegramEnv(), api = botApi(), calls: string[] = [], { renderer, seen } = recording();
    await handleTelegramWebhook(telegramRequest(textUpdate(SUPPLY), f.webhookSecret), { env: f.env, host: { db: t.db, tenantId: 'default' }, runtime: recordingRuntime(calls),
      fetch: api.fetch, interpreter: null, visuals: renderer });
    const photo = api.delivered().find(c => api.linkOf(c))!;
    expect(photo.method).toBe('sendPhoto');
    expect(isPng(new Uint8Array((photo.params.photo as BotFile).bytes))).toBe(true);
    expect(String(photo.params.caption)).toMatch(/^Strategy ready:\n1\. Supply 3 USDC[\s\S]*Nothing is authorized yet/);
    expect(seen.map(v => [v.language, v.model.steps.map(s => `${s.action} ${s.amounts[0]!.amount} ${s.amounts[0]!.asset} ${s.network}`).join()]))
      .toEqual([['EN', 'SUPPLY 3 USDC Base Sepolia']]);
    await openInFloFi(f.env, api.linkOf(photo)!, 'Telegram', seen[0]!.model.workflowHash, calls);
  });

  it('Telegram in Portuguese: a Portuguese conversation gets the Portuguese picture with its Portuguese caption, and opens the same workflow', async () => {
    const f = telegramEnv({ FLOFI_CHANNEL_COPILOT: 'enabled' }), api = botApi(), calls: string[] = [], { renderer, seen } = recording();
    // The untrusted interpreter, scripted: exactly the structured answer a model may return for the user's Portuguese message.
    const interpreter = async () => ({ ok: true as const, intent: intent.action(act.lending('SUPPLY', { amount: '3', asset: 'USDC', network: 'BASE_SEPOLIA', beneficiary: OWNER }), 'PT') as never });
    await handleTelegramWebhook(telegramRequest(textUpdate(`Coloca 3 USDC na Aave na Base Sepolia para ${OWNER}`), f.webhookSecret), { env: f.env,
      host: { db: t.db, tenantId: 'default' }, runtime: recordingRuntime(calls), fetch: api.fetch, interpreter, visuals: renderer });
    const photo = api.delivered().find(c => api.linkOf(c))!;
    expect([photo.method, seen.map(v => v.language)]).toEqual(['sendPhoto', ['PT']]);
    expect(String(photo.params.caption)).toMatch(/^Estratégia pronta:[\s\S]*Nada está autorizado ainda/);
    await openInFloFi(f.env, api.linkOf(photo)!, 'Telegram', seen[0]!.model.workflowHash, calls);
  });

  it('Telegram without a picture (renderer unavailable or failing) sends the complete text proposal, and it opens the same workflow', async () => {
    for (const inner of [async () => null, async () => { throw new Error('RENDER_FAILED'); }] as ChannelVisualRenderer[]) {
      const f = telegramEnv(), api = botApi(), calls: string[] = [], { renderer, seen } = recording(inner);
      await handleTelegramWebhook(telegramRequest(textUpdate(SUPPLY), f.webhookSecret), { env: f.env, host: { db: t.db, tenantId: 'default' }, runtime: recordingRuntime(calls),
        fetch: api.fetch, interpreter: null, visuals: renderer });
      const message = api.delivered().find(c => api.linkOf(c))!;
      expect([message.method, seen.length, api.calls.filter(c => c.method === 'sendPhoto').length]).toEqual(['sendMessage', 1, 0]);
      expect(String(message.params.text)).toMatch(/^Strategy ready:[\s\S]*Nothing is authorized yet/);
      await openInFloFi(f.env, api.linkOf(message)!, 'Telegram', seen[0]!.model.workflowHash, calls);
    }
  });

  it('WhatsApp: the picture is uploaded as bytes and heads the same CTA message; Open FloFi opens that exact workflow', async () => {
    const fixture = whatsAppEnv(), sent: FixtureRecord[] = [], uploads: FixtureUpload[] = [], calls: string[] = [], { renderer, seen } = recording();
    await handleWhatsAppWebhook(webhookRequest(inbound([{ text: SUPPLY }]), fixture.appSecret), { env: fixture.env, host: { db: t.db, tenantId: 'default' },
      runtime: recordingRuntime(calls), transport: fixtureTransport(sent, uploads), interpreter: null, visuals: renderer });
    const cta = sent.map(r => r.body as { interactive?: { type: string; header?: { image: { id: string } }; body: { text: string }; action: { parameters: { url: string } } } })
      .find(b => b.interactive?.type === 'cta_url')!;
    expect(uploads).toHaveLength(1);
    expect([uploads[0]!.mimeType, isPng(uploads[0]!.bytes)]).toEqual(['image/png', true]);
    expect(cta.interactive!.header).toEqual({ type: 'image', image: { id: uploads[0]!.mediaId } });
    expect(cta.interactive!.body.text).toMatch(/^Strategy ready:[\s\S]*Nothing is authorized yet/);
    // The picture went to the provider's media store as bytes: the proposal names no picture URL, only its media id and the approval link.
    expect(JSON.stringify(cta)).not.toMatch(/\.png|https?:\/\/(?!127\.0\.0\.1:3100\/approve#flofi_chs_)/);
    await openInFloFi(fixture.env, cta.interactive!.action.parameters.url, 'WhatsApp', seen[0]!.model.workflowHash, calls);
  });

  it('WhatsApp without a picture sends the existing text CTA message, still claimable as the same workflow', async () => {
    const fixture = whatsAppEnv(), sent: FixtureRecord[] = [], uploads: FixtureUpload[] = [], calls: string[] = [];
    await handleWhatsAppWebhook(webhookRequest(inbound([{ text: SUPPLY }]), fixture.appSecret), { env: fixture.env, host: { db: t.db, tenantId: 'default' },
      runtime: recordingRuntime(calls), transport: fixtureTransport(sent, uploads), interpreter: null, visuals: null });
    const cta = sent.map(r => r.body as { interactive?: { type: string; header?: unknown; action: { parameters: { url: string } } } }).find(b => b.interactive?.type === 'cta_url')!;
    expect([uploads.length, cta.interactive!.header]).toEqual([0, undefined]);
    await openInFloFi(fixture.env, cta.interactive!.action.parameters.url, 'WhatsApp', null, calls);
  });
});
