// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the Developer API's error model. A small, stable set of public `code`s (each with one HTTP status and one fixed
 * message) and a `reason`: the classified engine, gate or limit code behind it. `issues` name schema paths and rules, never values.
 * No stack trace, provider body, SQL, host name, URL or secret ever reaches an error body.
 */
import { PlatformRefusal } from '../platform/index.ts';

export const PUBLIC_ERRORS = Object.freeze({
  INVALID_REQUEST: [400, 'The request is malformed, too large or has unknown fields or parameters.'],
  INVALID_STRATEGY: [400, 'The strategy is not a valid FloFi StrategySpec for this engine.'],
  UNAUTHORIZED: [401, 'A valid FloFi Developer API key is required.'],
  FORBIDDEN: [403, 'This credential may not perform this operation.'],
  MAINNET_DISABLED: [403, 'Sandbox credentials compose and hand over test-funds strategies only.'],
  NOT_FOUND: [404, 'No such resource for this project and environment.'],
  METHOD_NOT_ALLOWED: [405, 'This method is not supported on this resource.'],
  STRATEGY_CHANGED: [409, 'The workflow hash does not match the stored strategy. Create a new strategy for a changed intent.'],
  STRATEGY_STALE: [409, 'The current FloFi engine no longer reproduces this strategy\'s workflow hash. Create the strategy again.'],
  IDEMPOTENCY_CONFLICT: [409, 'This Idempotency-Key was used with a different request.'],
  IDEMPOTENCY_IN_PROGRESS: [409, 'A request with this Idempotency-Key is still in progress. Retry later.'],
  APPROVAL_EXPIRED: [410, 'This approval is no longer open. Request a new approval.'],
  CAPABILITY_NOT_SUPPORTED: [422, 'FloFi cannot do this for this strategy on this deployment now.'],
  REVIEW_BLOCKED: [422, 'FloFi\'s Strategy Review blocks handing this strategy to its owner.'],
  SIMULATION_FAILED: [422, 'The read-only simulation could not complete.'],
  RATE_LIMITED: [429, 'Too many requests for this project. Retry after the indicated delay.'],
  INTERNAL_ERROR: [500, 'FloFi could not complete the request.'],
  SERVICE_UNAVAILABLE: [503, 'This service is temporarily unavailable on this deployment.'],
} as const satisfies Record<string, readonly [number, string]>);
export type PublicCode = keyof typeof PUBLIC_ERRORS;
export type Issue = { readonly path: string; readonly rule: string };

export class DeveloperError extends Error {
  readonly status: number;
  /** `status` overrides the code's usual status where the contract names two (413 for an oversized request). */
  constructor(readonly code: PublicCode, readonly reason: string,
    readonly detail: { readonly issues?: readonly Issue[]; readonly retryAfter?: number; readonly status?: 413 } = {}) {
    super(code);
    this.status = detail.status ?? PUBLIC_ERRORS[code][0];
  }
}
export const fail = (code: PublicCode, reason: string, detail: DeveloperError['detail'] = {}): never => { throw new DeveloperError(code, reason, detail); };

const REASON = /^[A-Z][A-Z0-9_]{2,80}$/;
/** Shared engine codes keep their meaning; surface-specific names become neutral (MCP_CLOUD_RUNTIME_REQUIRED → CLOUD_RUNTIME_REQUIRED). */
const RENAMED: Readonly<Record<string, string>> = Object.freeze({ HANDOFF_RATE_LIMITED: 'APPROVALS_PER_HOUR', HANDOFF_PENDING_LIMIT: 'PENDING_APPROVALS',
  SIMULATION_RATE_LIMITED: 'SIMULATIONS_PER_HOUR', HANDOFF_STALE: 'STRATEGY_STALE', STRATEGY_WORKFLOW_HASH_MISMATCH: 'STRATEGY_STALE' });
export const publicReason = (code: string) => { const neutral = code.replace(/^MCP_/, ''); return RENAMED[neutral] ?? neutral; };

const BY_REASON: Readonly<Record<string, PublicCode>> = Object.freeze({
  STRATEGY_STALE: 'STRATEGY_STALE', STRATEGY_SCHEMA_INVALID: 'INVALID_STRATEGY', REVIEW_BLOCKED: 'REVIEW_BLOCKED',
  APPROVALS_PER_HOUR: 'RATE_LIMITED', PENDING_APPROVALS: 'RATE_LIMITED', SIMULATIONS_PER_HOUR: 'RATE_LIMITED',
  SIMULATION_BUSY: 'SERVICE_UNAVAILABLE', SIMULATION_SUBJECT_INVALID: 'INVALID_REQUEST',
  SIMULATE_ONE_STEP_AT_A_TIME: 'CAPABILITY_NOT_SUPPORTED', SIMULATION_LOCAL_FORK_ONLY: 'CAPABILITY_NOT_SUPPORTED', SIMULATION_REQUIRES_OWNER_BROWSER: 'CAPABILITY_NOT_SUPPORTED',
  MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED: 'CAPABILITY_NOT_SUPPORTED', OWNER_EXECUTION_NOT_IMPLEMENTED: 'CAPABILITY_NOT_SUPPORTED', NO_EXECUTION_FLOW: 'CAPABILITY_NOT_SUPPORTED',
  FLOW_NOT_ENABLED_IN_DEPLOYMENT: 'CAPABILITY_NOT_SUPPORTED', EXECUTION_SWITCH_UNKNOWN: 'CAPABILITY_NOT_SUPPORTED', OWNER_EXECUTION_NOT_ENABLED_IN_DEPLOYMENT: 'CAPABILITY_NOT_SUPPORTED',
  TEST_FUNDS_HANDOFF_DISABLED_BY_POLICY: 'CAPABILITY_NOT_SUPPORTED', HANDOFF_POLICY_INVALID: 'CAPABILITY_NOT_SUPPORTED',
  MAINNET_HANDOFF_DISABLED_BY_POLICY: 'MAINNET_DISABLED', SANDBOX_TEST_FUNDS_ONLY: 'MAINNET_DISABLED',
  CLOUD_RUNTIME_REQUIRED: 'SERVICE_UNAVAILABLE', CLOUD_RUNTIME_NOT_CONFIGURED: 'SERVICE_UNAVAILABLE', CLOUD_RUNTIME_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  DEVELOPER_STORE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  APPROVAL_NOT_FOUND: 'NOT_FOUND', RUN_NOT_FOUND: 'NOT_FOUND', STRATEGY_NOT_FOUND: 'NOT_FOUND',
  APPROVAL_EXPIRED: 'APPROVAL_EXPIRED', APPROVAL_SUPERSEDED: 'APPROVAL_EXPIRED', APPROVAL_REVOKED: 'APPROVAL_EXPIRED', APPROVAL_STALE: 'APPROVAL_EXPIRED',
});
/** What an unlisted reason means in the operation that produced it: an engine refusal of the strategy, a failed flow simulation, or ours. */
export type Operation = 'compose' | 'simulate' | 'other';
const FALLBACK: Readonly<Record<Operation, PublicCode>> = Object.freeze({ compose: 'INVALID_STRATEGY', simulate: 'SIMULATION_FAILED', other: 'INTERNAL_ERROR' });

/** The public error for a thrown value: a DeveloperError as is, a platform refusal or engine code classified, anything else INTERNAL_ERROR. */
export function classify(error: unknown, operation: Operation = 'other'): DeveloperError {
  if (error instanceof DeveloperError) return error;
  const raw = error instanceof Error && REASON.test(error.message) ? error.message : null;
  if (!raw) return new DeveloperError('INTERNAL_ERROR', 'INTERNAL_ERROR');
  const reason = publicReason(raw), code = BY_REASON[reason] ?? FALLBACK[operation];
  const extra = error instanceof PlatformRefusal ? error.extra : {};
  const issues = Array.isArray(extra.issues) ? (extra.issues as Issue[]).filter(i => typeof i?.path === 'string' && typeof i.rule === 'string').slice(0, 50)
    .map(i => ({ path: i.path, rule: i.rule }))
    : Array.isArray(extra.blockers) ? (extra.blockers as { code?: unknown }[]).filter(b => typeof b?.code === 'string').map(b => ({ path: '/strategy', rule: String(b.code) })) : undefined;
  return new DeveloperError(code, code === 'INTERNAL_ERROR' && !BY_REASON[reason] ? 'INTERNAL_ERROR' : reason,
    { ...issues?.length ? { issues } : {}, ...reason === 'SIMULATION_BUSY' ? { retryAfter: 5 } : {} });
}
