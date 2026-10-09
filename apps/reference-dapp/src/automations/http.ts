// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the operator endpoints of automations on a web deployment running the EMBEDDED runtime — an OPTIONAL trigger
 * (Previews, a deployment without a worker, recovery, a manual pass) and readiness checks. Standard production needs neither: the
 * Railway worker's sweep is the scheduler (`worker.ts`), and the Railway API serves the workspace (`api.ts`). Both exist only while
 * automations are enabled AND FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256 is set (404 otherwise), and require `Authorization: Bearer <token>`
 * whose SHA-256 equals it (constant-time; Vercel Cron sends `Bearer $CRON_SECRET`, so the digest of CRON_SECRET is configured).
 *
 *   /api/automations/dispatch   GET (Vercel Cron) or POST: one bounded pass (`dispatch.ts`); answers counts only. With
 *                               FLOFI_AUTOMATION_TEST_CLOCK=enabled (never on a hosted deployment) it takes `x-flofi-automation-now`.
 *   /api/automations/health     GET: readiness — the store, the price source and its observable assets, the policy, the notifier;
 *                               never a secret, an owner, an address or anyone's automation
 *
 * There is no "run this automation now" endpoint: evaluation only ever produces proposals for the owner, never execution.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createPostgresWorkQueue, type Logger, type WorkQueue } from '@defi-workflow-engine/cloud-runtime';
import { readAutomationConfig } from './config.ts';
import { dispatchAutomations, DISPATCH_LIMITS, type DispatchLimits } from './dispatch.ts';
import { automationLogger, type AutomationLogSink } from './log.ts';
import { automationHost, automationRuntime, dispatchWorkerId, type AutomationHost, type AutomationSeams } from './runtime.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type AutomationOperatorOptions = { readonly env?: Env; readonly logger?: (AutomationLogSink & Logger) | null; readonly host?: AutomationHost; readonly seams?: AutomationSeams;
  readonly now?: () => Date; readonly limits?: DispatchLimits; readonly queue?: WorkQueue };
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: HEADERS });
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => silent };

function authorized(request: Request, digest: Buffer | null): Response | null {
  if (!digest) return json(404, { ok: false, code: 'ROUTE_NOT_FOUND' });
  const bearer = /^Bearer ([\x21-\x7e]{16,512})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!bearer || !timingSafeEqual(createHash('sha256').update(bearer, 'utf8').digest(), digest)) return json(401, { ok: false, code: 'DISPATCH_TOKEN_INVALID' });
  return null;
}

export async function handleAutomationDispatch(request: Request, options: AutomationOperatorOptions = {}): Promise<Response> {
  const env = options.env ?? process.env;
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
  const config = readAutomationConfig(env);
  if (!config.enabled) return json(404, { ok: false, code: 'ROUTE_NOT_FOUND' });
  const refused = authorized(request, config.dispatchTokenDigest);
  if (refused) return refused;
  // The deterministic test clock exists only where the configuration allows it (never hosted); anywhere else the header is refused.
  const clock = request.headers.get('x-flofi-automation-now');
  if (clock !== null && (!config.testClock || Number.isNaN(Date.parse(clock)))) return json(400, { ok: false, code: 'AUTOMATION_TEST_CLOCK_REFUSED' });
  const now = clock !== null ? () => new Date(clock) : options.now ?? (() => new Date());
  const host = await automationHost(env, config, options.host);
  if ('code' in host) return json(503, { ok: false, code: host.code });
  const log = automationLogger(options.logger ?? null), rt = automationRuntime(env, config, host, log, now, options.seams);
  const workerId = dispatchWorkerId(env);
  const queue = options.queue ?? createPostgresWorkQueue({ db: host.db, ownerId: workerId, tenantId: host.tenantId, leaseMs: 60_000 });
  try {
    const summary = await dispatchAutomations(rt, queue, options.logger ?? silent, workerId, options.limits ?? DISPATCH_LIMITS);
    return json(200, { ok: true, object: 'automation_dispatch', ...summary });
  } catch {
    log.warn('automation.dispatch_failed', { code: 'AUTOMATION_DISPATCH_FAILED' });
    return json(503, { ok: false, code: 'AUTOMATION_DISPATCH_FAILED' });
  }
}

export async function handleAutomationHealth(request: Request, options: AutomationOperatorOptions = {}): Promise<Response> {
  const env = options.env ?? process.env;
  if (request.method !== 'GET') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
  const config = readAutomationConfig(env);
  if (!config.enabled) return json(404, { ok: false, code: 'ROUTE_NOT_FOUND' });
  const refused = authorized(request, config.dispatchTokenDigest);
  if (refused) return refused;
  const host = await automationHost(env, config, options.host), ready = !('code' in host);
  const rt = ready ? automationRuntime(env, config, host, automationLogger(null), () => new Date(), options.seams) : null;
  return json(ready ? 200 : 503, { ok: ready, object: 'automation_health', store: ready ? 'READY' : host.code, executionMode: 'CONFIRM_EACH_TIME',
    priceSource: config.price.kind, observable: rt ? [...rt.price.assets] : [], testFunds: config.policy.testFunds, mainnetNetworks: config.policy.mainnetNetworks,
    notifications: { inApp: true, telegram: rt?.notifier ? 'ENABLED' : 'NOT_ENABLED' }, testClock: config.testClock, dispatch: 'CONFIGURED' });
}
