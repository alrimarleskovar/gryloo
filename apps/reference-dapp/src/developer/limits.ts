// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: per-plan limits of a developer project (per project × environment). A plan is data on the project row; only
 * `free` is assigned in this build, `pro` and `enterprise` are reserved with the same values until pricing exists. Counters live in
 * the shared fixed-window table (`dev:<project>:<environment>:<metric>` buckets); the per-instance simulation concurrency cap of the
 * platform applies on top, to every surface together.
 */
import type { DeveloperPlan } from './store.ts';

export type PlanLimits = { readonly requestsPerMinute: number; readonly simulationsPerHour: number; readonly approvalsPerHour: number;
  readonly pendingApprovals: number; readonly webhookEndpoints: number };
const FREE: PlanLimits = Object.freeze({ requestsPerMinute: 300, simulationsPerHour: 30, approvalsPerHour: 60, pendingApprovals: 100, webhookEndpoints: 5 });
export const PLAN_LIMITS: Readonly<Record<DeveloperPlan, PlanLimits>> = Object.freeze({ free: FREE, pro: FREE, enterprise: FREE });
export const limitsOf = (plan: DeveloperPlan): PlanLimits => PLAN_LIMITS[plan] ?? FREE;
