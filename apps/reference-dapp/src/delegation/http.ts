// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: `/api/delegation/dispatch` — an OPTIONAL drain of delegated-execution work on a deployment that hosts the executor
 * (local rehearsals and the loopback browser suites; a hosted deployment cannot configure a signer, so there it always answers 404). It is
 * separate from `/api/automations/dispatch` on purpose: the automation scheduler's import closure stays free of any signing capability.
 *
 * It exists only when FLOFI_DELEGATION_DISPATCH_TOKEN_SHA256 is set and the executor is enabled on this process, and requires
 * `Authorization: Bearer <token>` whose SHA-256 equals it (constant-time). With FLOFI_AUTOMATION_TEST_CLOCK=enabled (never hosted) it takes
 * `x-flofi-automation-now`, the same deterministic clock as the automation scheduler. Answers counts only.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createPostgresWorkQueue, createWorker, type Logger } from '@defi-workflow-engine/cloud-runtime';
import { readAutomationConfig } from '../automations/config.ts';
import { automationHost } from '../automations/runtime.ts';
import { isHostedDeployment } from '../server/deployment.ts';
import { DELEGATION_WORK_KINDS } from './runtime.ts';
import { delegationWorkerParts } from './worker.ts';

type Env = Readonly<Record<string, string | undefined>>;
const HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: HEADERS });
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => silent };

export async function handleDelegationDispatch(request: Request, options: { readonly env?: Env; readonly logger?: Logger } = {}): Promise<Response> {
  const env = options.env ?? process.env;
  if (request.method !== 'POST') return json(405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
  const raw = env.FLOFI_DELEGATION_DISPATCH_TOKEN_SHA256 ?? '';
  if (!/^[0-9a-f]{64}$/.test(raw) || isHostedDeployment(env)) return json(404, { ok: false, code: 'ROUTE_NOT_FOUND' });
  const bearer = /^Bearer ([\x21-\x7e]{16,512})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!bearer || !timingSafeEqual(createHash('sha256').update(bearer, 'utf8').digest(), Buffer.from(raw, 'hex'))) return json(401, { ok: false, code: 'DISPATCH_TOKEN_INVALID' });
  const automations = readAutomationConfig(env);
  if (!automations.enabled) return json(404, { ok: false, code: 'ROUTE_NOT_FOUND' });
  const clock = request.headers.get('x-flofi-automation-now');
  if (clock !== null && (!automations.testClock || Number.isNaN(Date.parse(clock)))) return json(400, { ok: false, code: 'AUTOMATION_TEST_CLOCK_REFUSED' });
  const now = clock !== null ? () => new Date(clock) : () => new Date();
  const host = await automationHost(env, automations);
  if ('code' in host) return json(503, { ok: false, code: host.code });
  const logger = options.logger ?? silent, parts = delegationWorkerParts(env, host.db, host.tenantId, logger, { now });
  if ('disabled' in parts) return json(404, { ok: false, code: 'ROUTE_NOT_FOUND' });
  const workerId = `delegation-${createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 8)}`;
  const queue = createPostgresWorkQueue({ db: host.db, ownerId: workerId, tenantId: host.tenantId, leaseMs: 60_000 });
  await parts.sweep().catch(() => undefined);
  const worker = createWorker({ queue: { ...queue, claim: limit => queue.claim(limit, DELEGATION_WORK_KINDS) }, handlers: parts.handlers, logger, workerId, concurrency: 2 });
  const deadline = Date.now() + 45_000;
  let processed = 0;
  while (Date.now() < deadline) { const n = await worker.drainOnce(); processed += n; if (n === 0) break; }
  return json(200, { ok: true, object: 'delegation_dispatch', processed });
}
