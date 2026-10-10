// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the HTTP boundary of every provider webhook (`/api/channels/<route>`), identical for all providers. Order of
 * checks, each failing closed before any processing:
 *
 *   the provider's enablement and activation guard (404) → configuration (503) → a non-POST: the provider's handshake or 405 →
 *   POST: content type (415) and the provider's body bound (413) → authenticity over the exact raw bytes and headers (401) → JSON (400)
 *   → this provider endpoint's payload (else 200 IGNORED) → the shared PostgreSQL platform state host and the channel schema (503, never memory or
 *   files) → content-free event records (deduplicated) → 200 ACCEPTED
 *
 * The turns run after the response (`schedule`: Next's `after()` in the routes), one lease holder per conversation, so provider retries
 * and duplicate deliveries never duplicate a turn; if that work is lost (a crash, a timeout), the scheduled dispatch finds the pending
 * events and runs them. Logs are content-free (`core/log.ts`).
 */
import type { EngineRuntime } from '../platform/index.ts';
import type { ChannelInterpreter } from './core/conversation.ts';
import { channelInterpreter } from './core/interpreter.ts';
import { channelLogger, type ChannelLogSink } from './core/log.ts';
import { createChannelService } from './core/service.ts';
import type { ChannelVisualRenderer } from './core/types.ts';
import { channelSubscriptions } from './subscriptions.ts';
import { channelProviders, type ProviderSeams } from './providers.ts';
import { readChannelDeployment, type ChannelRoute } from './registry.ts';
import { channelHost, channelRuntime, type ChannelHost } from './runtime.ts';
import { channelVisualRenderer } from './visuals.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type ChannelWebhookOptions = {
  readonly env?: Env;
  /** Runs the turn processing after the response is sent (the routes pass Next's `after`); tests await it. */
  readonly schedule?: (work: () => Promise<void>) => void;
  readonly logger?: ChannelLogSink | null;
  /** Test seams: the database host, the engine runtime, provider transports, the interpreter, the clock, the preview time bound. */
  readonly host?: ChannelHost;
  readonly runtime?: EngineRuntime;
  readonly seams?: ProviderSeams;
  readonly interpreter?: ChannelInterpreter | null;
  readonly now?: () => Date;
  readonly previewTimeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** The retry jitter's source (tests pin it; production uses Math.random). */
  readonly random?: () => number;
  /** BUILD-WORKFLOW-VISUAL-PRESENTATION-001: the workflow renderer (default: FloFi's shared one; null sends proposals as text only). */
  readonly visuals?: ChannelVisualRenderer | null;
};
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const answer = (status: number, code: string) => Response.json({ ok: status < 300, code }, { status, headers: HEADERS });

async function readBounded(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function handleChannelWebhook(route: ChannelRoute, request: Request, options: ChannelWebhookOptions = {}): Promise<Response> {
  const env = options.env ?? process.env, log = channelLogger(options.logger), now = options.now ?? (() => new Date());
  const result = readChannelDeployment(env, route);
  if (!result.ok) {
    if (result.status === 503) log.warn('channel.configuration_invalid', { route, code: result.code });
    return answer(result.status, result.code);
  }
  const { core } = result.deployment, provider = channelProviders(result.deployment, options.seams).byRoute.get(route)!;
  const prefix = provider.adapter.channel;
  if (request.method !== 'POST') return request.method === 'GET' && provider.handshake ? provider.handshake(new URL(request.url)) : answer(405, 'METHOD_NOT_ALLOWED');
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) return answer(415, `${prefix}_CONTENT_TYPE_INVALID`);
  const raw = await readBounded(request, provider.maxBodyBytes);
  if (!raw) return answer(413, `${prefix}_PAYLOAD_TOO_LARGE`);
  if (!provider.authentic(raw, request.headers)) {
    log.warn('channel.authentication_failed', { channel: prefix, code: provider.authenticationFailure });
    return answer(401, provider.authenticationFailure);
  }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { return answer(400, `${prefix}_PAYLOAD_INVALID`); }
  const parsed = provider.normalize(body, now());
  // Authentic but not ours (another product, account or update kind): acknowledged so the provider stops retrying, never processed.
  if (!parsed) return answer(200, 'IGNORED');
  const host = await channelHost(env, core, options.host);
  if ('code' in host) return answer(503, host.code);
  const { store, platform } = channelRuntime(env, core, host, options.runtime);
  const service = createChannelService({ core, store, log, now, platform, previewTimeoutMs: options.previewTimeoutMs ?? 60_000, adapter: provider.adapter,
    interpreter: options.interpreter !== undefined ? options.interpreter : channelInterpreter(env, { enabled: core.copilot }), subscriptions: channelSubscriptions(env, host),
    visuals: options.visuals !== undefined ? options.visuals : channelVisualRenderer,
    ...options.sleep ? { sleep: options.sleep } : {}, ...options.random ? { random: options.random } : {} });
  let ingested;
  try { ingested = await service.ingest(parsed.messages, parsed.deliveries); }
  catch { log.warn('channel.store_unavailable', { channel: prefix }); return answer(503, 'CHANNEL_STORE_UNAVAILABLE'); }
  const work = async () => {
    if (parsed.acknowledgements.length) await provider.acknowledge(parsed.acknowledgements).catch(() => undefined);
    for (const conversation of ingested.conversations) {
      try { await service.drain(conversation); } catch { log.warn('channel.drain.failed', { channel: prefix, conversation }); }
    }
  };
  if (options.schedule) options.schedule(work); else await work();
  return answer(200, 'ACCEPTED');
}
