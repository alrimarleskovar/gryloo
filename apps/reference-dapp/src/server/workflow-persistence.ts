// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { cloudApiBaseUrl, type FlowResult } from './cloud-api-client.ts';
import { embeddedRuntime, flowRuntimeKind } from './flow-runtime.ts';
import { currentWalletPrincipals } from './session-principal.ts';
import { workflowOwner, WORKFLOW_OWNER_HEADER, type WorkflowOwner } from '../domain/saved-workflow.ts';

/** BFF session boundary shared by all save/list/open operations. Browser addresses are only selection hints. */
export async function workflowOperation<T>(method: 'list' | 'get' | 'save', args: readonly unknown[], expected: WorkflowOwner,
  seams: { principals?: typeof currentWalletPrincipals; transport?: typeof fetch; env?: Readonly<Record<string, string | undefined>> } = {}): Promise<FlowResult<T>> {
  try {
    if (!expected || !workflowOwner(`${expected.namespace}:${expected.address}`)) return { ok: false, code: 'WALLET_SESSION_REQUIRED' };
    const principals = await (seams.principals ?? currentWalletPrincipals)();
    const principal = principals.find(p => p.namespace === expected.namespace && p.address === expected.address);
    if (!principal) return { ok: false, code: 'WALLET_SESSION_REQUIRED' };
    const env = seams.env ?? process.env, kind = flowRuntimeKind(env);
    if (kind === 'embedded') return await (await embeddedRuntime(env)).backend.callWorkflows(method, args, principal) as FlowResult<T>;
    if (kind !== 'remote') return { ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' };
    const base = cloudApiBaseUrl(env)!;
    const url = new URL(`v1/workflows/${method}`, base.href.endsWith('/') ? base : new URL(base.href + '/'));
    const response = await (seams.transport ?? fetch)(url, { method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', ...env.API_AUTH_TOKEN ? { authorization: `Bearer ${env.API_AUTH_TOKEN}` } : {},
        [WORKFLOW_OWNER_HEADER]: `${principal.namespace}:${principal.address}`, ...method === 'save' ? { 'idempotency-key': randomUUID() } : {} }, body: JSON.stringify({ args }) });
    const value = await response.json() as FlowResult<T>;
    if (!response.ok || !value || typeof value.ok !== 'boolean') return { ok: false, code: 'WORKFLOW_UNAVAILABLE' };
    return value;
  } catch { return { ok: false, code: 'WORKFLOW_UNAVAILABLE' }; }
}
