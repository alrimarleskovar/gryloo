// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the BFF boundary of delegated execution — the Automations pattern (`automation-operation.ts`):
 *
 *   - the owner the browser names is only a selection hint: it must be a wallet THIS request proved (HttpOnly session cookies); the other
 *     proven wallets are passed along so a Credential can only be enrolled for a wallet the owner actually controls in this browser;
 *   - registering a passkey additionally needs a fresh wallet sign-in (≤ 15 minutes), so a stolen long-lived session cannot add one;
 *   - embedded runtime: the operation runs here, on this deployment's PostgreSQL (`delegation/operations.ts`);
 *   - remote runtime: forwarded to `POST /v1/delegation/:method` with the API bearer, the verified owner in `x-flofi-workflow-owner` and the
 *     proven wallets in `x-flofi-wallet-principals` (server-to-server headers the browser never reaches);
 *   - anything else fails closed. Nothing here signs or submits anything.
 */
import { randomUUID } from 'node:crypto';
import { cloudApiBaseUrl, type FlowResult } from './cloud-api-client.ts';
import { flowRuntimeKind } from './flow-runtime.ts';
import { currentSolanaSession, currentWalletSession, type WalletPrincipal } from './session-principal.ts';
import { WALLET_SESSION_TTL_SECONDS } from './wallet-session.ts';
import { workflowOwner, WORKFLOW_OWNER_HEADER, type WorkflowOwner } from '../domain/saved-workflow.ts';
import { APPROVAL_PRINCIPALS_HEADER } from '../automations/api-headers.ts';
import { readAutomationConfig } from '../automations/config.ts';
import { automationHost } from '../automations/runtime.ts';
import { readDelegationConfig } from '../delegation/config.ts';
import { FRESH_SESSION_MS, FRESH_SESSION_OPERATIONS, IDEMPOTENT_DELEGATION_OPERATIONS, isDelegationOperation, ownerDelegationService, runDelegationOperation,
  type DelegationOperation } from '../delegation/operations.ts';

type Env = Readonly<Record<string, string | undefined>>;
type ProvenSession = WalletPrincipal & { readonly issuedAt: number };
type Seams = { readonly sessions?: () => Promise<readonly ProvenSession[]>; readonly transport?: typeof fetch; readonly env?: Env; readonly now?: () => Date };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const failure = (cause: unknown, fallback = 'DELEGATION_UNAVAILABLE') => ({ ok: false as const, code: cause instanceof Error && CODE.test(cause.message) ? cause.message : fallback });

/** The wallets this request proved, with when each session was issued (derived from its sealed expiry). */
async function provenSessions(): Promise<readonly ProvenSession[]> {
  const [evm, solana] = await Promise.all([currentWalletSession(), currentSolanaSession()]);
  const issued = (expiresAt: string) => Date.parse(expiresAt) - WALLET_SESSION_TTL_SECONDS * 1000;
  return [...evm ? [{ namespace: 'eip155' as const, address: evm.account, issuedAt: issued(evm.expiresAt) }] : [],
    ...solana ? [{ namespace: 'solana' as const, address: solana.account, issuedAt: issued(solana.expiresAt) }] : []];
}

export async function delegationOperation<T>(method: DelegationOperation, args: readonly unknown[], expected: WorkflowOwner, seams: Seams = {}): Promise<FlowResult<T>> {
  try {
    if (!isDelegationOperation(method) || !expected || !workflowOwner(`${expected.namespace}:${expected.address}`)) return { ok: false, code: 'WALLET_SESSION_REQUIRED' };
    const sessions = await (seams.sessions ?? provenSessions)();
    const principal = sessions.find(p => p.namespace === expected.namespace && p.address === expected.address);
    if (!principal) return { ok: false, code: 'WALLET_SESSION_REQUIRED' };
    const now = seams.now ?? (() => new Date());
    if (FRESH_SESSION_OPERATIONS.has(method) && now().getTime() - principal.issuedAt > FRESH_SESSION_MS) return { ok: false, code: 'PASSKEY_FRESH_SIGN_IN_REQUIRED' };
    const owner = { namespace: principal.namespace, address: principal.address }, proven = sessions.map(s => ({ namespace: s.namespace, address: s.address }));
    const env = seams.env ?? process.env;
    if (flowRuntimeKind(env) === 'remote') {
      const base = cloudApiBaseUrl(env)!;
      const response = await (seams.transport ?? fetch)(new URL(`v1/delegation/${method}`, base.href.endsWith('/') ? base : new URL(base.href + '/')), { method: 'POST',
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { 'content-type': 'application/json',
          ...env.API_AUTH_TOKEN ? { authorization: `Bearer ${env.API_AUTH_TOKEN}` } : {}, [WORKFLOW_OWNER_HEADER]: `${owner.namespace}:${owner.address}`,
          [APPROVAL_PRINCIPALS_HEADER]: proven.map(p => `${p.namespace}:${p.address}`).join(','),
          ...IDEMPOTENT_DELEGATION_OPERATIONS.has(method) ? { 'idempotency-key': randomUUID() } : {} }, body: JSON.stringify({ args }) });
      if (response.status === 404) return { ok: false, code: 'DELEGATION_NOT_ENABLED' };
      const body = await response.json().catch(() => null) as { ok?: unknown; value?: unknown; code?: unknown } | null;
      if (body?.ok === true && 'value' in body) return { ok: true, value: body.value as T };
      return { ok: false, code: body?.ok === false && typeof body.code === 'string' && CODE.test(body.code) ? body.code : 'DELEGATION_UNAVAILABLE' };
    }
    const automations = readAutomationConfig(env);
    if (!automations.enabled) return { ok: false, code: automations.code };
    const config = readDelegationConfig(env);
    if (!config.enabled) return { ok: false, code: config.code };
    const host = await automationHost(env, automations);
    if ('code' in host) return { ok: false, code: host.code };
    const service = ownerDelegationService(config, automations, host, () => undefined, now);
    return { ok: true, value: await runDelegationOperation(service, owner, proven, method, args) as T };
  } catch (cause) { return failure(cause); }
}

/** Whether this deployment serves delegated execution's owner operations (it names nobody). Remote: the API, which holds the configuration, answers. */
export async function delegationAvailability(seams: Pick<Seams, 'transport' | 'env'> = {}): Promise<{ readonly enabled: boolean }> {
  const env = seams.env ?? process.env;
  try {
    if (flowRuntimeKind(env) === 'remote') {
      const base = cloudApiBaseUrl(env)!;
      const response = await (seams.transport ?? fetch)(new URL('v1/delegation/availability', base.href.endsWith('/') ? base : new URL(base.href + '/')), { method: 'POST',
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { 'content-type': 'application/json',
          ...env.API_AUTH_TOKEN ? { authorization: `Bearer ${env.API_AUTH_TOKEN}` } : {} }, body: JSON.stringify({ args: [] }) });
      const body = await response.json().catch(() => null) as { ok?: unknown; value?: { enabled?: unknown } } | null;
      return { enabled: response.ok && body?.ok === true && body.value?.enabled === true };
    }
    return { enabled: readAutomationConfig(env).enabled && readDelegationConfig(env).enabled };
  } catch { return { enabled: false }; }
}
