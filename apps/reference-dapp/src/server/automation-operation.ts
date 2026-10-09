// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the BFF boundary of the Automations workspace and of automation approval links — the saved-workflow pattern
 * (`workflow-persistence.ts`):
 *
 *   - the owner the browser names is only a selection hint: it must be a wallet THIS request proved (HttpOnly session cookies);
 *   - embedded runtime: the operation runs here, on this deployment's PostgreSQL (`automations/operations.ts`);
 *   - remote runtime (production: Vercel → Railway API): it is forwarded to `POST /v1/automations/:method` with the API bearer and the
 *     verified owner in `x-flofi-workflow-owner`; an automation approval link to `POST /v1/approvals/:method` with the proven wallets in
 *     `x-flofi-wallet-principals`. Both headers are server-to-server: the browser never reaches the API;
 *   - anything else fails closed.
 */
import { randomUUID } from 'node:crypto';
import { cloudApiBaseUrl, type FlowResult } from './cloud-api-client.ts';
import { flowRuntimeKind } from './flow-runtime.ts';
import { currentWalletPrincipals, type WalletPrincipal } from './session-principal.ts';
import { workflowOwner, WORKFLOW_OWNER_HEADER, type WorkflowOwner } from '../domain/saved-workflow.ts';
import { APPROVAL_PRINCIPALS_HEADER } from '../automations/api-headers.ts';
import { readAutomationConfig } from '../automations/config.ts';
import { AUTOMATION_LINK_PREFIX } from '../automations/link-format.ts';
import { automationLogger, automationRouteLogger } from '../automations/log.ts';
import { IDEMPOTENT_OPERATIONS, isAutomationOperation, ownerAutomationService, runAutomationOperation, type AutomationOperation } from '../automations/operations.ts';
import { automationHost } from '../automations/runtime.ts';

type Env = Readonly<Record<string, string | undefined>>;
type Seams = { readonly principals?: () => Promise<readonly WalletPrincipal[]>; readonly transport?: typeof fetch; readonly env?: Env };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const failure = (cause: unknown, fallback = 'AUTOMATION_UNAVAILABLE') => ({ ok: false as const, code: cause instanceof Error && CODE.test(cause.message) ? cause.message : fallback });

/** One forwarded call to the API; a well-formed `{ ok, value | code }` body or a closed code. A 404 is an API without automations. */
async function forward<T>(env: Env, transport: typeof fetch, path: string, headers: Record<string, string>, args: readonly unknown[], unavailable: string): Promise<FlowResult<T>> {
  const base = cloudApiBaseUrl(env)!;
  const response = await transport(new URL(path, base.href.endsWith('/') ? base : new URL(base.href + '/')), { method: 'POST', cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(30_000), headers: { 'content-type': 'application/json', ...env.API_AUTH_TOKEN ? { authorization: `Bearer ${env.API_AUTH_TOKEN}` } : {}, ...headers },
    body: JSON.stringify({ args }) });
  if (response.status === 404) return { ok: false, code: 'AUTOMATIONS_NOT_ENABLED' };
  const body = await response.json().catch(() => null) as { ok?: unknown; value?: unknown; code?: unknown } | null;
  if (body?.ok === true && 'value' in body) return { ok: true, value: body.value as T };
  if (body?.ok === false && typeof body.code === 'string' && CODE.test(body.code)) return { ok: false, code: body.code };
  return { ok: false, code: unavailable };
}

/** One owner operation for `expected`, which must be a wallet this request proved. */
export async function automationOperation<T>(method: AutomationOperation, args: readonly unknown[], expected: WorkflowOwner, seams: Seams = {}): Promise<FlowResult<T>> {
  try {
    if (!isAutomationOperation(method) || !expected || !workflowOwner(`${expected.namespace}:${expected.address}`)) return { ok: false, code: 'WALLET_SESSION_REQUIRED' };
    const principal = (await (seams.principals ?? currentWalletPrincipals)()).find(p => p.namespace === expected.namespace && p.address === expected.address);
    if (!principal) return { ok: false, code: 'WALLET_SESSION_REQUIRED' };
    const owner = { namespace: principal.namespace, address: principal.address }, env = seams.env ?? process.env, kind = flowRuntimeKind(env);
    if (kind === 'remote') return await forward<T>(env, seams.transport ?? fetch, `v1/automations/${method}`, { [WORKFLOW_OWNER_HEADER]: `${owner.namespace}:${owner.address}`,
      ...IDEMPOTENT_OPERATIONS.has(method) ? { 'idempotency-key': randomUUID() } : {} }, args, 'AUTOMATION_UNAVAILABLE');
    const config = readAutomationConfig(env);
    if (!config.enabled) return { ok: false, code: config.code };
    const host = await automationHost(env, config);
    if ('code' in host) return { ok: false, code: host.code };
    const log = automationLogger(await automationRouteLogger()), now = () => new Date();
    return { ok: true, value: await runAutomationOperation(ownerAutomationService(env, config, host, log, now), owner, method, args) as T };
  } catch (cause) { return failure(cause); }
}

/** Whether this deployment serves automations (it names nobody). On the remote runtime the API, which holds their configuration, answers. */
export async function automationAvailability(seams: Pick<Seams, 'transport' | 'env'> = {}): Promise<{ readonly enabled: boolean; readonly code: string | null }> {
  const env = seams.env ?? process.env;
  try {
    if (flowRuntimeKind(env) === 'remote') {
      const result = await forward<{ enabled: boolean; code: string | null }>(env, seams.transport ?? fetch, 'v1/automations/availability', {}, [], 'AUTOMATION_UNAVAILABLE');
      return result.ok && typeof result.value?.enabled === 'boolean' ? { enabled: result.value.enabled, code: result.value.code ?? null } : { enabled: false, code: result.ok ? 'AUTOMATION_UNAVAILABLE' : result.code };
    }
    const config = readAutomationConfig(env);
    return config.enabled ? { enabled: true, code: null } : { enabled: false, code: config.code };
  } catch (cause) { return { enabled: false, code: failure(cause).code }; }
}

/** Whether `/approve` must forward this approval secret to the API: an automation link on the remote runtime (other kinds are unchanged). */
export const remoteAutomationApproval = (secret: unknown, env: Env = process.env) =>
  flowRuntimeKind(env) === 'remote' && typeof secret === 'string' && secret.startsWith(AUTOMATION_LINK_PREFIX);

/** `/approve` for an automation link on the remote runtime. Throws the API's closed code, exactly as the in-process surface would. */
export async function remoteApproval<T>(method: 'view' | 'claim' | 'apply' | 'share', args: readonly unknown[], seams: Seams = {}): Promise<T> {
  const env = seams.env ?? process.env, wallets = await (seams.principals ?? currentWalletPrincipals)();
  let result: FlowResult<T>;
  try {
    result = await forward<T>(env, seams.transport ?? fetch, `v1/approvals/${method}`,
      wallets.length ? { [APPROVAL_PRINCIPALS_HEADER]: wallets.map(w => `${w.namespace}:${w.address}`).join(',') } : {}, args, 'APPROVAL_STORE_UNAVAILABLE');
  } catch { throw new Error('APPROVAL_STORE_UNAVAILABLE'); }
  if (!result.ok) throw new Error(result.code === 'AUTOMATIONS_NOT_ENABLED' ? 'APPROVALS_NOT_ENABLED' : result.code);
  return result.value;
}
