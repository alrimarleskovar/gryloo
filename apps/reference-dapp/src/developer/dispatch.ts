// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: webhook delivery (Standard Webhooks). Deliveries are leased (`FOR UPDATE SKIP LOCKED`, one holder per attempt)
 * and settled only by their lease holder; success is any 2xx; otherwise they are retried after 30 s, 2 min, 10 min, 30 min, 1 h, 3 h,
 * 6 h, 12 h and 24 h (±20 % jitter) — ten attempts in about two days — and then DEAD. `webhook-id` is the event id on every attempt and
 * every endpoint, so consumers deduplicate on it; the signature covers id, timestamp and body.
 *
 * The transport is the platform's pinned HTTPS POST (public addresses only, re-resolved per attempt, port 443, no redirects followed,
 * 10 s, at most 1 KiB of the response read). Plain loopback HTTP exists only with the local test seam. Nothing in FloFi waits for, reads
 * or depends on a delivery: a failing endpoint changes no approval, claim, run or API response.
 *
 * Triggers (the embedded runtime has no worker): after Developer API responses, after /approve transitions of developer approvals, and
 * the internal dispatch endpoint for a scheduler (Vercel Cron or any other).
 */
import { request as httpRequest } from 'node:http';
import { createPgHandoffStore, deploymentEngineRuntime, pinnedHttpsRequest, resolveApprovalSecret, assertSafeOutput, type EngineRuntime,
  type HandoffStore } from '../platform/index.ts';
import { embeddedRuntime, flowRuntimeKind } from '../server/flow-runtime.ts';
import { DEVELOPER_LINK_PREFIX, developerApprovalLinkScheme } from './approval-profile.ts';
import { readDeveloperConfig, type DeveloperConfig } from './config.ts';
import { syncDeveloperApprovals, type SyncFilter } from './events.ts';
import { createPgDeveloperStore } from './pg-store.ts';
import type { WebhookEventBody } from './schemas.ts';
import { scopeOfRequesterRef, type DeliveryClaim, type DeveloperStore, type EventRecord, type ProjectScope } from './store.ts';
import { signWebhook, webhookSecretBytes } from './webhooks.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const WEBHOOK_RETRY_SECONDS: readonly number[] = Object.freeze([30, 120, 600, 1_800, 3_600, 10_800, 21_600, 43_200, 86_400]);
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_SECONDS.length + 1;
export const WEBHOOK_TIMEOUT_MS = 10_000;
const LEASE_MS = 60_000;

export type WebhookRequest = { readonly url: string; readonly headers: Readonly<Record<string, string>>; readonly body: string };
export type WebhookTransport = (request: WebhookRequest) => Promise<{ readonly status: number }>;

/** POST to a loopback HTTP endpoint: the local test seam only (FLOFI_DEVELOPER_WEBHOOK_LOOPBACK on a non-hosted server). */
function loopbackPost(url: URL, headers: Readonly<Record<string, string>>, body: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: url.hostname === 'localhost' ? '127.0.0.1' : url.hostname.replace(/^\[|\]$/g, ''), port: url.port || 80,
      path: url.pathname + url.search, method: 'POST', headers, agent: false }, response => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode ?? 0 }));
      response.on('error', reject);
    });
    req.setTimeout(WEBHOOK_TIMEOUT_MS, () => req.destroy(new Error('WEBHOOK_TIMEOUT')));
    req.on('error', reject);
    req.end(body);
  });
}
/** The deployment's transport: pinned HTTPS to public addresses; loopback HTTP only when the local test seam is on. */
export function webhookTransport(config: Pick<DeveloperConfig, 'webhookLoopback'>): WebhookTransport {
  return async ({ url, headers, body }) => {
    const target = new URL(url);
    if (target.protocol === 'http:') {
      if (!config.webhookLoopback || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw new Error('WEBHOOK_URL_NOT_ALLOWED');
      return loopbackPost(target, headers, body);
    }
    return pinnedHttpsRequest({ url: target, method: 'POST', headers, body, maxBytes: 1_024, truncate: true, timeoutMs: WEBHOOK_TIMEOUT_MS, errorPrefix: 'WEBHOOK' });
  };
}

/** The event as delivered (and as the SDK's `verifyWebhook` returns it). */
export function eventEnvelope(event: EventRecord): WebhookEventBody {
  return { id: event.eventId, object: 'event', type: event.type, apiVersion: 'v1', environment: event.environment, createdAt: event.createdAt.toISOString(),
    data: { ...event.data } };
}
/** When a failed attempt is retried (±20 % jitter), or null once the attempts are exhausted. */
export function nextAttemptAt(attempts: number, now: Date, random: () => number = Math.random): Date | null {
  const base = WEBHOOK_RETRY_SECONDS[attempts - 1];
  if (base === undefined) return null;
  return new Date(now.getTime() + Math.round(base * 1000 * (0.8 + 0.4 * random())));
}

export type DispatchSummary = { readonly attempted: number; readonly succeeded: number; readonly retrying: number; readonly dead: number };
export type DispatchDeps = { readonly config: Pick<DeveloperConfig, 'keys' | 'webhookLoopback'>; readonly tenantId: string; readonly store: DeveloperStore;
  readonly transport?: WebhookTransport; readonly now?: () => Date; readonly random?: () => number };
const ERROR = /^WEBHOOK_[A-Z_]{2,60}$/;

/** One attempt of one leased delivery, settled by its lease. */
async function attempt(deps: DispatchDeps, transport: WebhookTransport, claim: DeliveryClaim): Promise<'SUCCEEDED' | 'PENDING' | 'DEAD'> {
  const now = deps.now?.() ?? new Date(), scope: ProjectScope = { projectId: claim.projectId, environment: claim.environment };
  const settle = async (status: 'SUCCEEDED' | 'PENDING' | 'DEAD', lastStatus: number | null, lastError: string | null, next: Date | null) => {
    await deps.store.settleDelivery(claim.deliveryId, claim.leaseToken, { status, lastStatus, lastError, nextAttemptAt: next }, deps.now?.() ?? new Date());
    await deps.store.incrementUsage(scope, 'webhook.delivery', status === 'PENDING' ? 'RETRY' : status, now).catch(() => undefined);
    return status;
  };
  if (!claim.endpointActive) return settle('DEAD', null, 'ENDPOINT_DELETED', null);
  const envelope = eventEnvelope(claim.event);
  try { const { data, ...rest } = envelope; assertSafeOutput(rest); assertSafeOutput(data); } catch { return settle('DEAD', null, 'PAYLOAD_GUARD', null); }
  const body = JSON.stringify(envelope), timestamp = Math.floor(now.getTime() / 1000);
  const headers = { 'content-type': 'application/json', 'user-agent': 'FloFi-Webhooks/1', 'webhook-id': envelope.id, 'webhook-timestamp': String(timestamp),
    'webhook-signature': signWebhook(webhookSecretBytes(deps.config, deps.tenantId, claim.endpointId), envelope.id, timestamp, body),
    'flofi-delivery-id': claim.deliveryId, 'flofi-delivery-attempt': String(claim.attempts) };
  let status = 0, error: string | null = null;
  try { status = (await transport({ url: claim.url, headers, body })).status; }
  catch (cause) { error = cause instanceof Error && ERROR.test(cause.message) ? cause.message : 'WEBHOOK_CONNECTION_FAILED'; }
  if (status >= 200 && status < 300) return settle('SUCCEEDED', status, null, null);
  const next = nextAttemptAt(claim.attempts, now, deps.random);
  return settle(next ? 'PENDING' : 'DEAD', status || null, error ?? 'HTTP_STATUS', next);
}

/** Leases up to `limit` due deliveries (optionally of one project) and attempts them concurrently. */
export async function dispatchDeliveries(deps: DispatchDeps, filter: { readonly scope?: ProjectScope }, limit: number): Promise<DispatchSummary> {
  const claims = await deps.store.claimDeliveries(filter, limit, deps.now?.() ?? new Date(), LEASE_MS);
  const transport = deps.transport ?? webhookTransport(deps.config);
  const outcomes = await Promise.all(claims.map(claim => attempt(deps, transport, claim).catch(() => 'PENDING' as const)));
  return { attempted: claims.length, succeeded: outcomes.filter(o => o === 'SUCCEEDED').length, retrying: outcomes.filter(o => o === 'PENDING').length,
    dead: outcomes.filter(o => o === 'DEAD').length };
}

export type NotifyDeps = DispatchDeps & { readonly handoffs: HandoffStore; readonly runtime: EngineRuntime };
/** Derives the events of some open approvals, then delivers what is due. Every failure is contained: notifications never block FloFi. */
export async function syncAndDispatch(deps: NotifyDeps, filter: SyncFilter, budget: { readonly approvals: number; readonly deliveries: number }) {
  const approvals = await syncDeveloperApprovals({ store: deps.store, handoffs: deps.handoffs, runtime: deps.runtime, now: deps.now?.() ?? new Date() }, filter, budget.approvals);
  const deliveries = await dispatchDeliveries(deps, filter.scope ? { scope: filter.scope } : {}, budget.deliveries);
  return { approvals, deliveries };
}

/**
 * After an /approve transition (claim, apply, sharing): when the secret is a developer approval link of this deployment, derive that
 * approval's events now and deliver its project's due notifications. Any other secret, or a deployment without the Developer API or
 * the embedded runtime, is a no-op. Runs after the response; it never changes the transition.
 */
export async function developerApprovalChanged(env: Env, secret: unknown): Promise<void> {
  if (typeof secret !== 'string' || !secret.startsWith(DEVELOPER_LINK_PREFIX)) return;
  const config = readDeveloperConfig(env);
  if (!config.enabled || flowRuntimeKind(env) !== 'embedded') return;
  const resolved = resolveApprovalSecret([developerApprovalLinkScheme(config)], secret);
  if (!resolved) return;
  const host = await embeddedRuntime(env), handoffs = createPgHandoffStore(host.db, host.tenantId);
  const h = await handoffs.bySecret(resolved.digest, new Date(), resolved.kinds);
  if (!h) return;
  const store = createPgDeveloperStore(host.db, host.tenantId), scope = scopeOfRequesterRef(h.requesterRef);
  if (!scope) return;
  await syncDeveloperApprovals({ store, handoffs, runtime: deploymentEngineRuntime(env), now: new Date() }, { handoffId: h.handoffId }, 1);
  await dispatchDeliveries({ config, tenantId: host.tenantId, store }, { scope }, 10);
}
