// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-001 backend-for-frontend forwarding. When API_BASE_URL is configured (cloud deployment), the
 * existing server actions forward their exact contract to the stateless Flofi API instead of running the
 * services in this process. The browser still talks only to its own origin (CSP `connect-src 'self'`); the
 * API token is server-only. Each invocation carries one idempotency key reused across bounded transport
 * retries, so a lost response cannot apply a mutation twice.
 * BUILD-JOURNEY-001: the wallet session principal (verified from the HttpOnly session cookie by the caller) travels in a
 * server-to-server header; the API binds runs to it. The browser never talks to the API, so it can never set that header.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { WALLET_PRINCIPAL_HEADER } from './run-ownership.ts';

export type FlowResult<T> = { ok: true; value: T } | { ok: false; code: string };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const READ_ONLY = new Set(['status', 'mode']);

export function cloudApiBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): URL | null {
  const raw = env.API_BASE_URL;
  if (!raw) return null;
  let url: URL; try { url = new URL(raw); } catch { throw new Error('CLOUD_API_CONFIGURATION_INVALID'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:') || url.username || url.password || url.search || url.hash) throw new Error('CLOUD_API_CONFIGURATION_INVALID');
  return url;
}

export async function callCloudFlow<T>(flow: string, method: string, args: readonly unknown[], options: {
  env?: Readonly<Record<string, string | undefined>>; transport?: typeof fetch; sleep?: (ms: number) => Promise<void>; principal?: string | null } = {}): Promise<FlowResult<T>> {
  const env = options.env ?? process.env, transport = options.transport ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let base: URL | null;
  try { base = cloudApiBaseUrl(env); } catch (error) { return { ok: false, code: (error as Error).message }; }
  if (!base) return { ok: false, code: 'CLOUD_API_NOT_CONFIGURED' };
  const target = new URL(`v1/flows/${encodeURIComponent(flow)}/${encodeURIComponent(method)}`, base.href.endsWith('/') ? base : new URL(base.href + '/'));
  const key = READ_ONLY.has(method) ? null : randomUUID();
  const traceparent = `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try {
      response = await transport(target, { method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(240_000),
        headers: { 'content-type': 'application/json', traceparent, ...env.API_AUTH_TOKEN ? { authorization: `Bearer ${env.API_AUTH_TOKEN}` } : {},
          ...key ? { 'idempotency-key': key } : {}, ...options.principal ? { [WALLET_PRINCIPAL_HEADER]: options.principal } : {} }, body: JSON.stringify({ args }) });
    } catch {
      // The request may or may not have arrived; the same idempotency key makes the retry safe.
      if (attempt < 3) { await sleep(500 * 2 ** attempt); continue; }
      return { ok: false, code: 'CLOUD_API_UNAVAILABLE' };
    }
    let body: unknown = null;
    try { body = await response.json(); } catch { /* handled below */ }
    const result = body as { ok?: unknown; value?: unknown; code?: unknown } | null;
    if (response.status === 409 && result?.code === 'IDEMPOTENCY_IN_PROGRESS' && attempt < 3) { await sleep(1_000 * (attempt + 1)); continue; }
    if ([502, 503, 504].includes(response.status) && attempt < 3) { await sleep(500 * 2 ** attempt); continue; }
    if (result?.ok === true && 'value' in result) return { ok: true, value: result.value as T };
    if (result?.ok === false && typeof result.code === 'string' && CODE.test(result.code)) return { ok: false, code: result.code };
    return { ok: false, code: 'CLOUD_API_UNAVAILABLE' };
  }
  return { ok: false, code: 'CLOUD_API_UNAVAILABLE' };
}

export type CloudRunSummary = { runId: string; flow: string; status: string; ownerAccount: string | null; hasEvidence: boolean; updatedAt: string };
/** BUILD-JOURNEY-001: the signed-in wallet's most recent runs of one flow (the API filters by the principal header). */
export async function listCloudRuns(flow: string, principal: string, options: { env?: Readonly<Record<string, string | undefined>>; transport?: typeof fetch } = {}):
  Promise<FlowResult<CloudRunSummary[]>> {
  const env = options.env ?? process.env, transport = options.transport ?? fetch;
  let base: URL | null;
  try { base = cloudApiBaseUrl(env); } catch (error) { return { ok: false, code: (error as Error).message }; }
  if (!base) return { ok: false, code: 'CLOUD_API_NOT_CONFIGURED' };
  const target = new URL(`v1/runs?${new URLSearchParams({ flow, limit: '25' })}`, base.href.endsWith('/') ? base : new URL(base.href + '/'));
  try {
    const response = await transport(target, { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { ...env.API_AUTH_TOKEN ? { authorization: `Bearer ${env.API_AUTH_TOKEN}` } : {}, [WALLET_PRINCIPAL_HEADER]: principal } });
    const body = await response.json() as { ok?: unknown; value?: { items?: unknown } };
    if (!response.ok || body.ok !== true || !Array.isArray(body.value?.items)) return { ok: false, code: 'CLOUD_API_UNAVAILABLE' };
    return { ok: true, value: (body.value.items as CloudRunSummary[]).filter(r => r.ownerAccount === principal && r.flow === flow)
      .map(r => ({ runId: r.runId, flow: r.flow, status: r.status, ownerAccount: r.ownerAccount, hasEvidence: r.hasEvidence, updatedAt: r.updatedAt })) };
  } catch { return { ok: false, code: 'CLOUD_API_UNAVAILABLE' }; }
}
