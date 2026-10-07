// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the durable state of the Developer Platform (migration 0007), behind one interface with one implementation
 * (PostgreSQL, `pg-store.ts`). Every API-facing operation is scoped by the authenticated principal's project and environment (never by
 * an id from the request); a foreign or absent id is simply not found. Approval handoffs themselves live in the shared approval model
 * (`src/platform/handoff-store.ts`); this store only holds their binding, the webhook events derived from them and the deliveries.
 */
import type { ExecutionPlan } from '../platform/index.ts';
import type { DeveloperEnvironment, DeveloperScope } from './config.ts';

export const DEVELOPER_EVENT_TYPES = Object.freeze(['approval.claimed', 'approval.applied', 'approval.ended', 'execution.started', 'execution.failed',
  'execution.reconciled'] as const);
export type DeveloperEventType = (typeof DEVELOPER_EVENT_TYPES)[number];
export type DeveloperPlan = 'free' | 'pro' | 'enterprise';
/** The authenticated caller: one API key of one project in one environment. Never a wallet, never a person, never authority. */
export type DeveloperPrincipal = { readonly projectId: string; readonly projectName: string; readonly environment: DeveloperEnvironment; readonly keyId: string;
  readonly scopes: readonly DeveloperScope[]; readonly plan: DeveloperPlan };
/** The project-and-environment scope every developer resource belongs to. */
export type ProjectScope = { readonly projectId: string; readonly environment: DeveloperEnvironment };
export type StrategyRecord = { readonly strategyId: string; readonly projectId: string; readonly environment: DeveloperEnvironment; readonly strategy: unknown;
  readonly workflowHash: string; readonly engineVersion: string; readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS'; readonly networkEnvironment: string;
  readonly plan: ExecutionPlan; readonly createdAt: Date };
export type ApprovalBinding = { readonly handoffId: string; readonly projectId: string; readonly environment: DeveloperEnvironment; readonly strategyId: string;
  readonly workflowHash: string; readonly syncState: 'OPEN' | 'DONE'; readonly createdAt: Date };
export type NewEvent = { readonly type: DeveloperEventType; readonly dedupeKey: string; readonly approvalId: string; readonly data: Readonly<Record<string, unknown>> };
export type EventRecord = { readonly eventId: string; readonly projectId: string; readonly environment: DeveloperEnvironment; readonly type: DeveloperEventType;
  readonly approvalId: string; readonly data: Readonly<Record<string, unknown>>; readonly createdAt: Date };
export type EndpointRecord = { readonly endpointId: string; readonly projectId: string; readonly environment: DeveloperEnvironment; readonly url: string;
  readonly eventTypes: readonly DeveloperEventType[]; readonly status: 'ACTIVE' | 'DELETED'; readonly createdAt: Date };
/** A delivery leased to one dispatcher: the event, where it goes, and the lease that alone may settle it. */
export type DeliveryClaim = { readonly deliveryId: string; readonly projectId: string; readonly environment: DeveloperEnvironment; readonly endpointId: string;
  readonly url: string; readonly endpointActive: boolean; readonly attempts: number; readonly leaseToken: string; readonly event: EventRecord };
export type DeliverySettlement = { readonly status: 'PENDING' | 'SUCCEEDED' | 'DEAD'; readonly lastStatus: number | null; readonly lastError: string | null;
  readonly nextAttemptAt: Date | null };
export type DeliveryRecord = { readonly deliveryId: string; readonly endpointId: string; readonly eventId: string; readonly eventType: DeveloperEventType;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'DEAD'; readonly attempts: number; readonly nextAttemptAt: Date; readonly lastStatus: number | null;
  readonly lastError: string | null; readonly createdAt: Date };
export type KeyRecord = { readonly keyId: string; readonly environment: DeveloperEnvironment; readonly hint: string; readonly scopes: readonly DeveloperScope[];
  readonly status: 'ACTIVE' | 'REVOKED'; readonly createdAt: Date; readonly revokedAt: Date | null; readonly lastUsedAt: Date | null };
export type UsageRow = { readonly day: string; readonly metric: string; readonly dimension: string; readonly count: number };

export interface DeveloperStore {
  /** Operator: a new ACTIVE project. */
  readonly createProject: (displayName: string, now: Date) => Promise<string>;
  /** Operator: disables a project (every key stops authenticating at once). */
  readonly disableProject: (projectId: string, now: Date) => Promise<boolean>;
  /** Operator: a new key's digest for an ACTIVE project (`null` when the project is absent or disabled). */
  readonly createKey: (projectId: string, environment: DeveloperEnvironment, scopes: readonly DeveloperScope[], digest: Buffer, hint: string, now: Date) => Promise<string | null>;
  readonly revokeKey: (keyId: string, now: Date) => Promise<boolean>;
  readonly listKeys: (projectId: string) => Promise<readonly KeyRecord[]>;
  readonly listDeliveries: (projectId: string, limit: number) => Promise<readonly DeliveryRecord[]>;

  /** The principal of an ACTIVE key of an ACTIVE project, else null (absent, revoked and disabled are indistinguishable). */
  readonly authenticate: (digest: Buffer, now: Date) => Promise<DeveloperPrincipal | null>;
  readonly createStrategy: (record: Omit<StrategyRecord, 'createdAt'>, now: Date) => Promise<StrategyRecord>;
  readonly strategy: (scope: ProjectScope, strategyId: string) => Promise<StrategyRecord | null>;
  /** The approval of this project whose owner shares a run with it (APPLIED, sharing on, run bound), else null. */
  readonly approvalForRun: (scope: ProjectScope, runId: string) => Promise<string | null>;
  /** A new ACTIVE webhook endpoint, or null when the project already has `maxActive` of them. */
  readonly createEndpoint: (scope: ProjectScope, url: string, eventTypes: readonly DeveloperEventType[], maxActive: number, now: Date) => Promise<EndpointRecord | null>;
  /** Deletes an ACTIVE endpoint of this project and ends its pending deliveries; false when absent or another project's. */
  readonly deleteEndpoint: (scope: ProjectScope, endpointId: string, now: Date) => Promise<boolean>;

  /** Records the events not yet recorded (by dedupe key) and fans each new one out to the subscribed ACTIVE endpoints. */
  readonly recordEvents: (scope: ProjectScope, events: readonly NewEvent[], now: Date) => Promise<readonly EventRecord[]>;
  /** Claims OPEN approval bindings to (re)derive events for, least recently synced first (concurrent sweeps take different rows). */
  readonly approvalsToSync: (filter: { readonly scope?: ProjectScope; readonly handoffId?: string }, limit: number, now: Date) => Promise<readonly ApprovalBinding[]>;
  readonly markSynced: (handoffId: string, done: boolean, now: Date) => Promise<void>;
  /** Leases due deliveries (one attempt each); only the lease holder may settle them. */
  readonly claimDeliveries: (filter: { readonly scope?: ProjectScope }, limit: number, now: Date, leaseMs: number) => Promise<readonly DeliveryClaim[]>;
  readonly settleDelivery: (deliveryId: string, leaseToken: string, settlement: DeliverySettlement, now: Date) => Promise<boolean>;
  readonly incrementUsage: (scope: ProjectScope, metric: string, dimension: string, now: Date, by?: number) => Promise<void>;
  readonly usage: (scope: ProjectScope, fromDay: string, toDay: string) => Promise<readonly UsageRow[]>;
  /** Bounded retention: events (and their deliveries) after 30 days, unreferenced strategies after 90 days. */
  readonly purge: (now: Date) => Promise<void>;
}
