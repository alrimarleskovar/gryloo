// SPDX-License-Identifier: AGPL-3.0-only
// Selectively adapted from the delivery's server read adapter. No submission or observation calls.
import { cloudApiBaseUrl, callCloudFlow } from '../../server/cloud-api-client';
import { currentWalletPrincipal } from '../../server/session-principal';
import { WALLET_PRINCIPAL_HEADER, normalizePrincipal } from '../../server/run-ownership';
import { dashboardRunId, object, optionalText, textValue, toDashboardRun } from './run-mapping';
import type { DashboardDetailResponse, DashboardSnapshot } from './types';

async function connection(expectedAccount: string): Promise<{ connection: DashboardSnapshot['connection']; account: string | null; base: URL | null }> {
  const expected = normalizePrincipal(typeof expectedAccount === 'string' ? expectedAccount.toLowerCase() : null);
  if (!expected) return { connection: 'SIGN_IN_REQUIRED', account: null, base: null };
  const principal = await currentWalletPrincipal().catch(() => null);
  if (!principal || principal !== expected) return { connection: 'SIGN_IN_REQUIRED', account: null, base: null };
  try {
    const base = cloudApiBaseUrl();
    return { connection: base ? 'CONNECTED' : 'NOT_CONFIGURED', account: principal, base };
  } catch { return { connection: 'UNAVAILABLE', account: principal, base: null }; }
}
async function cloudGet(base: URL, path: string, account: string): Promise<unknown> {
  const target = new URL(path, base.href.endsWith('/') ? base : new URL(base.href + '/'));
  const response = await fetch(target, { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { ...process.env.API_AUTH_TOKEN ? { authorization: `Bearer ${process.env.API_AUTH_TOKEN}` } : {}, [WALLET_PRINCIPAL_HEADER]: account } });
  if (response.status === 404) throw new Error('RUN_NOT_FOUND');
  const body: unknown = await response.json();
  if (!response.ok || !object(body) || body.ok !== true) throw new Error('CLOUD_API_UNAVAILABLE');
  return body.value;
}
export async function loadDashboardSnapshot(expectedAccount: string): Promise<DashboardSnapshot> {
  const scope = await connection(expectedAccount);
  const empty: DashboardSnapshot = { connection: scope.connection, account: scope.account, runs: [], hasMore: false };
  if (!scope.base || !scope.account) return empty;
  try {
    const value = await cloudGet(scope.base, 'v1/runs?limit=100', scope.account);
    if (!object(value) || !Array.isArray(value.items)) throw new Error('CLOUD_API_UNAVAILABLE');
    return { ...empty, runs: value.items.flatMap(item => { const run = toDashboardRun(item, scope.account!); return run ? [run] : []; }), hasMore: Boolean(optionalText(value.next)) };
  } catch { return { ...empty, connection: 'UNAVAILABLE' }; }
}

/** Details are resolved only after the owned index record is checked. Unknown IDs never become example runs. */
export async function loadDashboardRunDetail(expectedAccount: string, runId: string): Promise<DashboardDetailResponse> {
  const scope = await connection(expectedAccount);
  const empty: DashboardDetailResponse = { connection: scope.connection, account: scope.account, detail: null };
  if (!scope.base || !scope.account) return empty;
  if (!dashboardRunId(runId)) return { ...empty, connection: 'NOT_FOUND' };
  try {
    const raw = await cloudGet(scope.base, `v1/runs/${encodeURIComponent(runId)}`, scope.account);
    const run = toDashboardRun(raw, scope.account);
    if (!run || run.runId !== runId || !object(raw)) return { ...empty, connection: 'NOT_FOUND' };
    const [evidence, record] = await Promise.allSettled([
      cloudGet(scope.base, `v1/runs/${encodeURIComponent(runId)}/evidence`, scope.account),
      // Existing status is a read-only load. Never call observe, begin, recover, handoff or report.
      callCloudFlow<unknown>(run.flow, 'status', [runId], { principal: scope.account }),
    ]);
    const evidenceRaw = evidence.status === 'fulfilled' && Array.isArray(evidence.value) ? evidence.value : null;
    const recordRaw = record.status === 'fulfilled' && record.value.ok ? record.value.value : null;
    return { ...empty, detail: { run, record: recordRaw, recordUnavailable: recordRaw === null, evidenceUnavailable: evidenceRaw === null,
      attempts: Array.isArray(raw.attempts) ? raw.attempts.filter(object).filter(item => textValue(item.attemptId) && textValue(item.step) && textValue(item.state)).map(item => ({
        attemptId: textValue(item.attemptId), step: textValue(item.step), state: textValue(item.state), transactionHash: optionalText(item.transactionHash), reconciled: item.reconciled === true })) : [],
      evidence: (evidenceRaw ?? []).filter(object).filter(item => optionalText(item.bundleHash)).map(item => ({ bundleHash: textValue(item.bundleHash), environment: textValue(item.environment),
        outcome: textValue(item.outcome), verified: item.verified === true, createdAt: optionalText(item.createdAt) })) } };
  } catch (cause) { return { ...empty, connection: cause instanceof Error && cause.message === 'RUN_NOT_FOUND' ? 'NOT_FOUND' : 'UNAVAILABLE' }; }
}
