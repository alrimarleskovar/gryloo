// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: Automations on the Railway API (the remote runtime of production: Vercel BFF → Railway API → PostgreSQL), added
 * to the API's existing routes by `backend/main.ts api` when the API sets FLOFI_AUTOMATIONS=enabled. Both routes sit behind the API's
 * bearer token like every other route, and follow the saved-workflow convention for the owner:
 *
 *   POST /v1/automations/:method   the owner operations of `operations.ts` (and `availability`, which names nobody). The owner is the
 *                                  server-to-server `x-flofi-workflow-owner` header the BFF sets from the verified wallet session; every
 *                                  query is scoped to it, so another owner's id answers NOT FOUND. `create` needs an idempotency key.
 *   POST /v1/approvals/:method     `/approve` for automation links (view, claim, apply, share — and resume, PR #72's recovery of an
 *                                  APPLIED proposal by its id for its proven claimant, which reissues nothing): the shared platform
 *                                  functions with the automation contributor only, the shared handoff store and this API's own engine
 *                                  gates. The proven wallets travel in `x-flofi-wallet-principals`, set by the BFF from the HttpOnly
 *                                  session cookies.
 *
 * CRUD, state changes and no-authority approval links only: nothing here signs, submits, runs or previews a flow (the engine runtime is
 * used for its read-only gates and the owner's own run status). Evaluation is the worker's (`worker.ts`), never a request's.
 */
import { createIdempotencyStore, createRunQueries, HttpError, requestHash, type Database, type HttpRequest, type Logger, type Route } from '@defi-workflow-engine/cloud-runtime';
import type { Backend } from '../../backend/app.ts';
import { workflowOwner, WORKFLOW_OWNER_HEADER } from '../domain/saved-workflow.ts';
import { applyApproval, assembleApprovalSurface, claimApproval, createPgHandoffStore, embeddedEngineRuntime, resumeApproval, shareApproval, viewApproval,
  type WalletRef } from '../platform/index.ts';
import { ownerRunReaders } from '../server/flow-runtime.ts';
import { APPROVAL_PRINCIPALS_HEADER } from './api-headers.ts';
import { automationApprovalContributor } from './approval.ts';
import { readAutomationConfig } from './config.ts';
import { automationLogger } from './log.ts';
import { IDEMPOTENT_OPERATIONS, isAutomationOperation, ownerAutomationService, runAutomationOperation } from './operations.ts';
import { automationHost } from './runtime.ts';

type Env = Readonly<Record<string, string | undefined>>;
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const closed = (error: unknown, fallback: string) => ({ ok: false as const, code: error instanceof Error && CODE.test(error.message) ? error.message : fallback });

/** The proven wallets in the principals header: each a well-formed owner, one per namespace. Anything malformed is a 400. */
export function principalsOf(raw: unknown): readonly WalletRef[] {
  if (raw === undefined || raw === '') return [];
  if (typeof raw !== 'string' || raw.length > 200) throw new HttpError(400, 'WALLET_PRINCIPAL_INVALID');
  const list = raw.split(',').map(part => workflowOwner(part.trim()));
  if (list.length > 2 || list.some(p => p === null) || new Set(list.map(p => p!.namespace)).size !== list.length) throw new HttpError(400, 'WALLET_PRINCIPAL_INVALID');
  return list.map(p => ({ namespace: p!.namespace, address: p!.address }));
}
const argsOf = (request: HttpRequest) => {
  const body = request.body as { args?: unknown } | null;
  if (!body || typeof body !== 'object' || !Array.isArray(body.args) || Object.keys(body).length !== 1) throw new HttpError(400, 'AUTOMATION_INPUT_INVALID');
  return body.args as readonly unknown[];
};

export type AutomationApiDeps = { readonly db: Database; readonly tenantId: string; readonly backend: Backend; readonly logger: Logger; readonly now?: () => Date };
export function automationApiRoutes(env: Env, deps: AutomationApiDeps): Route[] {
  const config = readAutomationConfig(env), now = deps.now ?? (() => new Date()), log = automationLogger(deps.logger);
  const engine = embeddedEngineRuntime({ backend: deps.backend, ...ownerRunReaders(createRunQueries(deps.db, deps.tenantId)) });
  const host = async () => {
    if (!config.enabled) throw new Error(config.code);
    const resolved = await automationHost(env, config, { db: deps.db, tenantId: deps.tenantId });
    if ('code' in resolved) throw new Error(resolved.code);
    return { config, host: resolved };
  };
  const idempotency = createIdempotencyStore({ db: deps.db, tenantId: deps.tenantId });

  return [
    { method: 'POST', name: 'automations', pattern: /^\/v1\/automations\/([A-Za-z]{1,40})$/, handler: async (request, match) => {
      const method = match[1]!;
      if (method === 'availability') {
        argsOf(request);
        return { status: 200, body: { ok: true, value: config.enabled ? { enabled: true, code: null } : { enabled: false, code: config.code } } };
      }
      if (!isAutomationOperation(method)) throw new HttpError(404, 'AUTOMATION_OPERATION_UNKNOWN');
      const owner = workflowOwner(request.headers[WORKFLOW_OWNER_HEADER]);
      if (!owner) throw new HttpError(401, 'WALLET_SESSION_REQUIRED');
      const args = argsOf(request);
      const run = async () => {
        try {
          const { config: enabled, host: resolved } = await host();
          return { ok: true as const, value: await runAutomationOperation(ownerAutomationService(env, enabled, resolved, log, now, { runtime: engine }), owner, method, args) };
        } catch (error) { return closed(error, 'AUTOMATION_UNAVAILABLE'); }
      };
      if (!IDEMPOTENT_OPERATIONS.has(method)) return { status: 200, body: await run() };
      // The owner is part of the request identity: a key replayed under another owner is a conflict, never a replay.
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string') throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED');
      const scope = `automations/${method.toLowerCase()}`, hash = requestHash(scope, [owner, ...args]);
      let claim;
      try { claim = await idempotency.begin(scope, key, hash); } catch (error) { if ((error as Error).message === 'IDEMPOTENCY_KEY_INVALID') throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID'); throw error; }
      if (claim.kind === 'REPLAY') return { status: 200, body: claim.response };
      if (claim.kind === 'CONFLICT') throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED');
      if (claim.kind === 'IN_PROGRESS') throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS');
      const result = await run();
      if (result.ok) await idempotency.complete(scope, key, hash, result); else await idempotency.release(scope, key, hash);
      return { status: 200, body: result };
    } },
    { method: 'POST', name: 'approvals', pattern: /^\/v1\/approvals\/(view|claim|apply|share|resume)$/, handler: async (request, match) => {
      const method = match[1]!, wallets = principalsOf(request.headers[APPROVAL_PRINCIPALS_HEADER]), args = argsOf(request);
      const secret = args[0];
      try {
        const { config: enabled, host: resolved } = await host();
        const contributor = automationApprovalContributor(env, enabled)!;
        const surface = assembleApprovalSurface([contributor(resolved, () => undefined)], createPgHandoffStore(resolved.db, resolved.tenantId), engine);
        if (method === 'view' && args.length === 1) return { status: 200, body: { ok: true, value: await viewApproval(surface, secret, wallets, now()) } };
        if (method === 'claim' && args.length === 2) return { status: 200, body: { ok: true, value: await claimApproval(surface, secret, wallets, args[1] === true, now()) } };
        if (method === 'apply' && args.length === 2) return { status: 200, body: { ok: true, value: await applyApproval(surface, secret, wallets, args[1], now()) } };
        if (method === 'share' && args.length === 2) return { status: 200, body: { ok: true, value: await shareApproval(surface, secret, wallets, args[1] === true, now()) } };
        if (method === 'resume' && args.length === 1) return { status: 200, body: { ok: true, value: await resumeApproval(surface, secret, wallets) } };
        return { status: 200, body: { ok: false, code: 'APPROVAL_REQUEST_INVALID' } };
      } catch (error) { return { status: 200, body: closed(error, 'APPROVAL_FAILED') }; }
    } },
  ];
}
