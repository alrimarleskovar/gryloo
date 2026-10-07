// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the HTTP boundary of the WhatsApp adapter (`/api/channels/whatsapp`). Order of checks, each failing closed before
 * any processing:
 *
 *   enablement and the D1 activation guard (404 on any hosted deployment) → configuration (503) → GET: subscription verification →
 *   POST: content type and 4 MiB body bound (413) → X-Hub-Signature-256 over the raw bytes (401) → JSON → this account and number →
 *   the embedded PostgreSQL runtime and the channel schema (503, never memory or files) → content-free event records → 200
 *
 * Processing runs after the response (`schedule`, Next's `after()` in the route), one lease holder per conversation, so Meta's retries
 * and duplicate deliveries never duplicate a turn. Logs are content-free (`core/log.ts`). In this build the transport is the recording
 * fixture: nothing is ever sent to Meta.
 */
import type { Database } from '@defi-workflow-engine/cloud-runtime';
import { createPgHandoffStore, deploymentEngineRuntime, type EngineRuntime } from '../../platform/index.ts';
import { embeddedRuntime, flowRuntimeKind } from '../../server/flow-runtime.ts';
import { channelApprovalScheme } from '../core/approval.ts';
import type { ChannelInterpreter } from '../core/conversation.ts';
import { channelInterpreter } from '../core/interpreter.ts';
import { channelLogger, type ChannelLogSink } from '../core/log.ts';
import { createPgChannelStore } from '../core/pg-store.ts';
import { createChannelService } from '../core/service.ts';
import { readChannelDeployment } from '../registry.ts';
import { createWhatsAppAdapter } from './adapter.ts';
import { fixtureTransport, type WhatsAppTransport } from './transport.ts';
import { MAX_WEBHOOK_BYTES, parseWebhook, signatureValid, verifySubscription } from './webhook.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type WhatsAppWebhookOptions = {
  readonly env?: Env;
  /** Runs the turn processing after the response is sent (the route passes Next's `after`); tests await it. */
  readonly schedule?: (work: () => Promise<void>) => void;
  readonly logger?: ChannelLogSink | null;
  /** Test seams: the database host, the engine runtime, the transport, the interpreter, the clock, the preview time bound. */
  readonly host?: { readonly db: Database; readonly tenantId: string };
  readonly runtime?: EngineRuntime;
  readonly transport?: WhatsAppTransport;
  readonly interpreter?: ChannelInterpreter | null;
  readonly now?: () => Date;
  readonly previewTimeoutMs?: number;
};
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const answer = (status: number, code: string) => Response.json({ ok: status < 300, code }, { status, headers: HEADERS });

async function readBounded(request: Request): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function handleWhatsAppWebhook(request: Request, options: WhatsAppWebhookOptions = {}): Promise<Response> {
  const env = options.env ?? process.env, log = channelLogger(options.logger), now = options.now ?? (() => new Date());
  const result = readChannelDeployment(env);
  if (!result.ok) {
    if (result.status === 503) log.warn('channel.configuration_invalid', { channel: 'whatsapp', code: result.code });
    return answer(result.status, result.code);
  }
  const { core, whatsapp } = result.deployment;
  if (request.method === 'GET') return verifySubscription(new URL(request.url), whatsapp);
  if (request.method !== 'POST') return answer(405, 'METHOD_NOT_ALLOWED');
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) return answer(415, 'WHATSAPP_CONTENT_TYPE_INVALID');
  const raw = await readBounded(request);
  if (!raw) return answer(413, 'WHATSAPP_PAYLOAD_TOO_LARGE');
  if (!signatureValid(raw, request.headers.get('x-hub-signature-256'), whatsapp.appSecrets)) {
    log.warn('channel.signature_invalid', { channel: 'whatsapp' });
    return answer(401, 'WHATSAPP_SIGNATURE_INVALID');
  }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { return answer(400, 'WHATSAPP_PAYLOAD_INVALID'); }
  const parsed = parseWebhook(body, whatsapp);
  // Authentic but not ours (another product or account): acknowledged so the provider stops retrying, never processed.
  if (!parsed) return answer(200, 'IGNORED');
  let host = options.host;
  if (!host) {
    if (flowRuntimeKind(env) !== 'embedded') return answer(503, 'CHANNEL_STORE_UNAVAILABLE');
    try { const runtime = await embeddedRuntime(env); host = { db: runtime.db, tenantId: runtime.tenantId }; } catch { return answer(503, 'CHANNEL_STORE_UNAVAILABLE'); }
  }
  if (host.tenantId !== core.tenantId) return answer(503, 'CHANNEL_STORE_UNAVAILABLE');
  const store = createPgChannelStore(host.db, host.tenantId);
  if (!await store.schemaInstalled().catch(() => false)) return answer(503, 'CHANNEL_SCHEMA_NOT_INSTALLED');
  const service = createChannelService({ core, store, log, now, previewTimeoutMs: options.previewTimeoutMs ?? 60_000,
    // The fixture transport keeps nothing beyond this request: no rendered message, link or recipient is retained in process memory.
    adapter: createWhatsAppAdapter(whatsapp.phoneNumberId, options.transport ?? fixtureTransport()),
    interpreter: options.interpreter !== undefined ? options.interpreter : channelInterpreter(env, { enabled: core.copilot }),
    platform: { origin: core.origin, scheme: channelApprovalScheme(core.keys), handoffs: createPgHandoffStore(host.db, host.tenantId), allow: store.allow,
      runtime: options.runtime ?? deploymentEngineRuntime(env), policy: core.policy } });
  let ingested;
  try { ingested = await service.ingest(parsed.messages, parsed.deliveries); }
  catch { log.warn('channel.store_unavailable', { channel: 'whatsapp' }); return answer(503, 'CHANNEL_STORE_UNAVAILABLE'); }
  const work = async () => {
    for (const conversation of ingested.conversations) {
      try { await service.drain(conversation); } catch { log.warn('channel.drain.failed', { channel: 'whatsapp', conversation }); }
    }
  };
  if (options.schedule) options.schedule(work); else await work();
  return answer(200, 'ACCEPTED');
}
