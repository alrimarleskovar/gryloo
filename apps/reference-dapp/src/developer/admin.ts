// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the operator's developer-project administration (the CLI `backend/developer-admin.ts` is a thin wrapper).
 * There is no self-service sign-up, organization or role model: the deployment owner creates projects and SANDBOX keys. A new key
 * is returned exactly once and only its keyed digest is stored. Production (live) keys cannot be issued in this build.
 */
import { DEVELOPER_ENVIRONMENTS, DEVELOPER_SCOPES, type DeveloperKeys, type DeveloperScope } from './config.ts';
import { apiKeyDigest, newApiKey } from './keys.ts';
import type { DeveloperStore } from './store.ts';
import type { HandoffStore } from '../platform/index.ts';

export type AdminDeps = { readonly store: DeveloperStore; readonly handoffs: HandoffStore; readonly config: { readonly keys: Pick<DeveloperKeys, 'apiKey'> };
  readonly now: () => Date };
export const PROJECT_ID = /^prj_[a-z2-7]{26}$/;
export const KEY_ID = /^key_[a-z2-7]{26}$/;
/** An operator-set display name as the owner sees it on /approve: 1–64 printable characters, no surrounding spaces. */
export const projectNameValid = (name: string) => name.length >= 1 && name.length <= 64 && name === name.trim() && !/[\p{Cc}\p{Cf}]/u.test(name);
/** `requester_ref` of a developer requester: `<project id>.<environment>` (lower case; fits the shared requester grammar). */
export const developerRequesterRef = (projectId: string, environment: string) => `${projectId}.${environment}`;

export async function createProject(deps: AdminDeps, displayName: string): Promise<{ readonly projectId: string }> {
  if (!projectNameValid(displayName)) throw new Error('PROJECT_NAME_INVALID');
  return { projectId: await deps.store.createProject(displayName, deps.now()) };
}

/** A new SANDBOX key for an ACTIVE project. The caller shows `key` once and never stores or logs it. */
export async function issueSandboxKey(deps: AdminDeps, projectId: string, scopes: readonly DeveloperScope[] = DEVELOPER_SCOPES) {
  if (!PROJECT_ID.test(projectId)) throw new Error('PROJECT_ID_INVALID');
  const unique = [...new Set(scopes)];
  if (unique.length === 0 || unique.some(s => !(DEVELOPER_SCOPES as readonly string[]).includes(s))) throw new Error('SCOPES_INVALID');
  const { key, hint } = newApiKey('sandbox');
  const keyId = await deps.store.createKey(projectId, 'sandbox', unique, apiKeyDigest(deps.config, key), hint, deps.now());
  if (!keyId) throw new Error('PROJECT_NOT_ACTIVE');
  return { keyId, key, hint, environment: 'sandbox' as const, scopes: unique };
}

export async function revokeKey(deps: AdminDeps, keyId: string): Promise<{ readonly revoked: boolean }> {
  if (!KEY_ID.test(keyId)) throw new Error('KEY_ID_INVALID');
  return { revoked: await deps.store.revokeKey(keyId, deps.now()) };
}

/**
 * Disables a project: every key stops authenticating at once and every approval it still has open (PENDING or CLAIMED) is revoked,
 * so a disabled integration can no longer put a proposal in front of anyone. Approvals already applied are the owners' own
 * workflows in FloFi and are not touched.
 */
export async function disableProject(deps: AdminDeps, projectId: string): Promise<{ readonly disabled: boolean; readonly revokedApprovals: number }> {
  if (!PROJECT_ID.test(projectId)) throw new Error('PROJECT_ID_INVALID');
  const now = deps.now(), disabled = await deps.store.disableProject(projectId, now);
  let revokedApprovals = 0;
  for (const environment of DEVELOPER_ENVIRONMENTS) {
    const requester = { kind: 'DEVELOPER_PROJECT' as const, ref: developerRequesterRef(projectId, environment) };
    for (const h of await deps.handoffs.listForRequester(requester, now, 1_000)) {
      if (h.status !== 'PENDING' && h.status !== 'CLAIMED') continue;
      if ((await deps.handoffs.revokeForRequester(h.handoffId, requester, now))?.status === 'REVOKED') revokedApprovals++;
    }
  }
  return { disabled, revokedApprovals };
}

export async function listKeys(deps: AdminDeps, projectId: string) {
  if (!PROJECT_ID.test(projectId)) throw new Error('PROJECT_ID_INVALID');
  return (await deps.store.listKeys(projectId)).map(k => ({ keyId: k.keyId, environment: k.environment, hint: k.hint, scopes: k.scopes, status: k.status,
    createdAt: k.createdAt.toISOString(), revokedAt: k.revokedAt?.toISOString() ?? null, lastUsedAt: k.lastUsedAt?.toISOString() ?? null }));
}

/** Read-only webhook delivery state (never the endpoint URL or a secret). */
export async function listDeliveries(deps: AdminDeps, projectId: string, limit = 50) {
  if (!PROJECT_ID.test(projectId)) throw new Error('PROJECT_ID_INVALID');
  return (await deps.store.listDeliveries(projectId, Math.max(1, Math.min(500, Math.trunc(limit))))).map(d => ({ deliveryId: d.deliveryId, endpointId: d.endpointId,
    eventId: d.eventId, eventType: d.eventType, status: d.status, attempts: d.attempts, nextAttemptAt: d.nextAttemptAt.toISOString(), lastStatus: d.lastStatus,
    lastError: d.lastError, createdAt: d.createdAt.toISOString() }));
}
