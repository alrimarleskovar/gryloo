// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the Developer API's part of the shared approval model (`src/platform`):
 *
 *   requester     a developer project in one environment: `{ kind: DEVELOPER_PROJECT, ref: '<project>.<environment>', context: { strategyId } }`;
 *                 the database binds the handoff to that immutable strategy and its exact workflow hash (migration 0007)
 *   link scheme   `flofi_dhs_` links, digested with the developer handoff key (HKDF of FLOFI_DEVELOPER_SECRET); they resolve
 *                 DEVELOPER_PROJECT handoffs only
 *   rules         a 15-minute window, the plan's open-request cap and hourly rate, and NO supersession (many end users may share one
 *                 workflow hash)
 *   /approve      the sandbox policy (test funds only, every mainnet off); a claim also needs the project to be ACTIVE and the
 *                 environment to be sandbox. No viewer requester: an integration is never the owner's browser, so status sharing
 *                 starts OFF and only the owner turns it on.
 *
 * The developer never signs, submits, reviews or approves anything; the owner does all of that in FloFi with their own wallet.
 */
import { approvalLinkScheme, HANDOFF_SECONDS, type ApprovalContributor, type ApprovalLinkScheme, type ApprovalRequester, type HandoffRules } from '../platform/index.ts';
import { readDeveloperConfig, SANDBOX_POLICY, type DeveloperConfig } from './config.ts';
import type { PlanLimits } from './limits.ts';
import { createPgDeveloperStore } from './pg-store.ts';
import { developerRequesterRef, scopeOfRequesterRef, type DeveloperPrincipal } from './store.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const DEVELOPER_LINK_PREFIX = 'flofi_dhs_';
export const developerApprovalLinkScheme = (config: Pick<DeveloperConfig, 'keys'>): ApprovalLinkScheme =>
  approvalLinkScheme(DEVELOPER_LINK_PREFIX, config.keys.handoff, ['DEVELOPER_PROJECT']);
export const developerHandoffRules = (limits: PlanLimits): HandoffRules => Object.freeze({ handoffSeconds: HANDOFF_SECONDS, maxPending: limits.pendingApprovals,
  rate: Object.freeze([limits.approvalsPerHour, 3_600] as const), supersedeSameWorkflow: false });
/** The requester of an approval for one immutable strategy of the principal's project and environment. */
export const developerRequester = (principal: DeveloperPrincipal, strategyId: string): ApprovalRequester => ({ kind: 'DEVELOPER_PROJECT',
  ref: developerRequesterRef(principal.projectId, principal.environment), clientId: principal.projectId, displayName: principal.projectName, context: { strategyId } });

/** The Developer API's contribution to /approve, or null while it is not enabled on this deployment. */
export function developerApprovalContributor(env: Env): ApprovalContributor | null {
  const config = readDeveloperConfig(env);
  if (!config.enabled) return null;
  return host => {
    const store = createPgDeveloperStore(host.db, host.tenantId);
    return { scheme: developerApprovalLinkScheme(config), profiles: { DEVELOPER_PROJECT: { policy: SANDBOX_POLICY, claimPolicy: async h => {
      const scope = scopeOfRequesterRef(h.requesterRef);
      // Production (live) credentials do not exist in this build; a non-sandbox approval is never claimable.
      if (!scope || scope.environment !== 'sandbox') return { ok: false, code: 'LIVE_MODE_DISABLED' };
      return await store.projectActive(scope.projectId) ? { ok: true } : { ok: false, code: 'DEVELOPER_PROJECT_DISABLED' };
    } } } };
  };
}
