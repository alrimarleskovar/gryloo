// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the operator endpoints of the channels, for a scheduler and for readiness checks. Both exist only when
 * FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256 is set (404 otherwise) and require `Authorization: Bearer <token>` whose SHA-256 equals it
 * (constant-time; Vercel Cron sends `Bearer $CRON_SECRET`, so the digest of CRON_SECRET is configured).
 *
 *   /api/channels/dispatch   GET (Vercel Cron) or POST: one bounded sweep (`core/dispatch.ts`); answers counts only
 *   /api/channels/health     GET: readiness — each provider's state (enabled, or its closed refusal code), the schema, the runtime and
 *                            the dispatch configuration; never a secret, a provider id, an address or a count of anyone's messages
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { EngineRuntime } from '../platform/index.ts';
import type { ChannelInterpreter } from './core/conversation.ts';
import { dispatchChannels, DISPATCH_LIMITS, type DispatchLimits } from './core/dispatch.ts';
import { channelInterpreter } from './core/interpreter.ts';
import { channelLogger, type ChannelLogSink } from './core/log.ts';
import { createChannelService } from './core/service.ts';
import { channelProviders, type ProviderSeams } from './providers.ts';
import { channelProviderStatus, readChannelDeployment } from './registry.ts';
import { channelHost, channelRuntime, type ChannelHost } from './runtime.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type ChannelOperatorOptions = { readonly env?: Env; readonly logger?: ChannelLogSink | null; readonly host?: ChannelHost; readonly runtime?: EngineRuntime;
  readonly seams?: ProviderSeams; readonly interpreter?: ChannelInterpreter | null; readonly now?: () => Date; readonly limits?: DispatchLimits;
  readonly sleep?: (ms: number) => Promise<void> };
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: HEADERS });

/** The bearer check shared by both endpoints: 404 without a configured digest (no endpoint at all), 401 on a wrong token. */
function authorized(request: Request, digest: Buffer | null): Response | null {
  if (!digest) return json(404, { ok: false, code: 'ROUTE_NOT_FOUND' });
  const bearer = /^Bearer ([\x21-\x7e]{16,512})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!bearer || !timingSafeEqual(createHash('sha256').update(bearer, 'utf8').digest(), digest)) return json(401, { ok: false, code: 'DISPATCH_TOKEN_INVALID' });
  return null;
}

export async function handleChannelDispatch(request: Request, options: ChannelOperatorOptions = {}): Promise<Response> {
  const env = options.env ?? process.env, log = channelLogger(options.logger), now = options.now ?? (() => new Date());
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
  const result = readChannelDeployment(env);
  if (!result.ok) return json(404, { ok: false, code: 'ROUTE_NOT_FOUND' });
  const { core } = result.deployment;
  const refused = authorized(request, core.dispatchTokenDigest);
  if (refused) return refused;
  const host = await channelHost(env, core, options.host);
  if ('code' in host) return json(503, { ok: false, code: host.code });
  const { store, platform } = channelRuntime(env, core, host, options.runtime);
  const providers = channelProviders(result.deployment, options.seams);
  const interpreter = options.interpreter !== undefined ? options.interpreter : channelInterpreter(env, { enabled: core.copilot });
  const services = new Map([...providers.adapters.values()].map(adapter => [adapter.channel, createChannelService({ core, store, log, now, platform, adapter, interpreter,
    previewTimeoutMs: 30_000, ...options.sleep ? { sleep: options.sleep } : {} })]));
  try {
    const summary = await dispatchChannels({ core, store, platform, log, now, adapters: providers.adapters, services, ...options.sleep ? { sleep: options.sleep } : {} },
      options.limits ?? DISPATCH_LIMITS);
    return json(200, { ok: true, object: 'channel_dispatch', ...summary });
  } catch {
    log.warn('channel.dispatch.failed', { code: 'CHANNEL_DISPATCH_FAILED' });
    return json(503, { ok: false, code: 'CHANNEL_DISPATCH_FAILED' });
  }
}

export async function handleChannelHealth(request: Request, options: ChannelOperatorOptions = {}): Promise<Response> {
  const env = options.env ?? process.env;
  if (request.method !== 'GET') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
  const result = readChannelDeployment(env);
  if (!result.ok) return json(404, { ok: false, code: 'ROUTE_NOT_FOUND' });
  const { core } = result.deployment;
  const refused = authorized(request, core.dispatchTokenDigest);
  if (refused) return refused;
  const host = await channelHost(env, core, options.host);
  const providers = channelProviders(result.deployment, options.seams).byRoute;
  const status = channelProviderStatus(env).map(p => {
    const provider = providers.get(p.route);
    return { route: p.route, enabled: p.enabled, code: p.code, reason: p.reason, ...provider ? { mode: provider.mode, channel: provider.adapter.channel,
      windowHours: provider.adapter.windowHours, deliveryReports: provider.adapter.deliveryReports, outsideWindow: provider.adapter.outsideWindow,
      confirmsUncertainSends: provider.adapter.confirmsUncertainSends } : {} };
  });
  const ready = !('code' in host);
  return json(ready ? 200 : 503, { ok: ready, object: 'channel_health', store: ready ? 'READY' : host.code, hosted: core.hosted, origin: core.origin,
    copilot: core.copilot, simulation: core.simulation, testFunds: core.policy.testFunds, mainnetNetworks: core.policy.mainnetNetworks, dispatch: 'CONFIGURED',
    providers: status });
}
