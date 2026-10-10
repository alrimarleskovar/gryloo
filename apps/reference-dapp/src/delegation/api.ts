// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: delegated-execution owner operations on the Railway API (production's remote runtime), added by `backend/main.ts api`
 * when the API sets FLOFI_DELEGATION=enabled (and FLOFI_AUTOMATIONS=enabled). Behind the API's bearer like every route:
 *
 *   POST /v1/delegation/:method   the closed operations of `operations.ts`. The owner is the server-to-server `x-flofi-workflow-owner` header;
 *                                 the proven wallets are `x-flofi-wallet-principals` (both set only by the BFF from HttpOnly session cookies).
 *
 * Owner operations only: no executor, no session signature, no submission (session keys can be created and destroyed, never used, here).
 */
import { createIdempotencyStore, HttpError, requestHash, type Database, type HttpRequest, type Logger, type Route } from '@defi-workflow-engine/cloud-runtime';
import { workflowOwner, WORKFLOW_OWNER_HEADER } from '../domain/saved-workflow.ts';
import { APPROVAL_PRINCIPALS_HEADER } from '../automations/api-headers.ts';
import { principalsOf } from '../automations/api.ts';
import { readAutomationConfig } from '../automations/config.ts';
import { automationHost } from '../automations/runtime.ts';
import { readDelegationConfig } from './config.ts';
import { IDEMPOTENT_DELEGATION_OPERATIONS, isDelegationOperation, ownerDelegationService, runDelegationOperation } from './operations.ts';

type Env = Readonly<Record<string, string | undefined>>;
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const closed = (error: unknown) => ({ ok: false as const, code: error instanceof Error && CODE.test(error.message) ? error.message : 'DELEGATION_UNAVAILABLE' });
const argsOf = (request: HttpRequest) => {
  const body = request.body as { args?: unknown } | null;
  if (!body || typeof body !== 'object' || !Array.isArray(body.args) || Object.keys(body).length !== 1) throw new HttpError(400, 'DELEGATION_INPUT_INVALID');
  return body.args as readonly unknown[];
};
export type DelegationApiDeps = { readonly db: Database; readonly tenantId: string; readonly logger: Logger; readonly now?: () => Date };
export function delegationApiRoutes(env: Env, deps: DelegationApiDeps): Route[] {
  const now = deps.now ?? (() => new Date()), idempotency = createIdempotencyStore({ db: deps.db, tenantId: deps.tenantId });
  return [{ method: 'POST', name: 'delegation', pattern: /^\/v1\/delegation\/([A-Za-z]{1,40})$/, handler: async (request, match) => {
    const method = match[1]!;
    if (method === 'availability') {
      argsOf(request);
      return { status: 200, body: { ok: true, value: { enabled: readAutomationConfig(env).enabled && readDelegationConfig(env).enabled } } };
    }
    if (!isDelegationOperation(method)) throw new HttpError(404, 'DELEGATION_OPERATION_UNKNOWN');
    const owner = workflowOwner(request.headers[WORKFLOW_OWNER_HEADER]);
    if (!owner) throw new HttpError(401, 'WALLET_SESSION_REQUIRED');
    const proven = principalsOf(request.headers[APPROVAL_PRINCIPALS_HEADER]);
    if (!proven.some(p => p.namespace === owner.namespace && p.address === owner.address)) throw new HttpError(401, 'WALLET_SESSION_REQUIRED');
    const args = argsOf(request);
    const run = async () => {
      try {
        const automations = readAutomationConfig(env), config = readDelegationConfig(env);
        if (!automations.enabled) throw new Error(automations.code);
        if (!config.enabled) throw new Error(config.code);
        const host = await automationHost(env, automations, { db: deps.db, tenantId: deps.tenantId });
        if ('code' in host) throw new Error(host.code);
        const service = ownerDelegationService(config, automations, host, (event, fields) => deps.logger.info(event, fields), now);
        return { ok: true as const, value: await runDelegationOperation(service, owner, proven, method, args) };
      } catch (error) { return closed(error); }
    };
    if (!IDEMPOTENT_DELEGATION_OPERATIONS.has(method)) return { status: 200, body: await run() };
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string') throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED');
    const scope = `delegation/${method.toLowerCase()}`, hash = requestHash(scope, [owner, ...args]);
    const claim = await idempotency.begin(scope, key, hash);
    if (claim.kind === 'REPLAY') return { status: 200, body: claim.response };
    if (claim.kind !== 'NEW') throw new HttpError(409, claim.kind === 'CONFLICT' ? 'IDEMPOTENCY_KEY_REUSED' : 'IDEMPOTENCY_IN_PROGRESS');
    const result = await run();
    if (result.ok) await idempotency.complete(scope, key, hash, result); else await idempotency.release(scope, key, hash);
    return { status: 200, body: result };
  } }];
}
