// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the durable state of automations (migration 0010), behind one interface with one implementation (PostgreSQL,
 * `pg-store.ts`). Two kinds of caller:
 *
 *   the owner      every read and write names the verified owner (namespace + account); tenant, owner and id are all in each query,
 *                  so a guessed id finds nothing. Owner changes are compare-and-set on the rule's `version`.
 *   the evaluator  `evaluate` locks one rule row, re-checks it is ACTIVE and due, lets the caller decide with reads made inside that
 *                  transaction (limit usage, the source saved workflow), and commits the decision atomically: the rule's new
 *                  schedule/trigger state, at most one occurrence per trigger key (`ON CONFLICT DO NOTHING` on the unique key), the
 *                  history rows and the notification work item. Two evaluators of one rule serialize on the row lock; a retried
 *                  evaluation of an advanced rule is a no-op.
 *
 * Nothing stored here is authority: no key, signature, quote, transaction or approval secret.
 */
import type { StrategySpec } from '../engine/strategy-spec';
import type { Binding, WorkflowSource } from './binding.ts';
import type { AutomationKind, Definition } from './definition.ts';
import type { Spend, Usage } from './limits.ts';
import type { Period } from './schedule.ts';
import type { TriggerState } from './trigger.ts';

export type Owner = { readonly namespace: 'eip155' | 'solana'; readonly address: string };
export type RuleState = 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'ARCHIVED';
export type Attention = 'WORKFLOW_CHANGED' | 'STRATEGY_STALE';
export type RuleRecord = {
  readonly ruleId: string; readonly owner: Owner; readonly name: string; readonly kind: AutomationKind; readonly state: RuleState;
  readonly executionMode: 'CONFIRM_EACH_TIME'; readonly definition: Definition; readonly binding: Binding | null; readonly timezone: string;
  readonly nextEvaluationAt: Date | null; readonly scheduleCursor: Date | null; readonly lastEvaluationAt: Date | null; readonly lastOutcome: string | null;
  readonly lastObservation: Readonly<Record<string, unknown>> | null; readonly triggerState: TriggerState; readonly attention: Attention | null;
  readonly expiresAt: Date | null; readonly version: number; readonly createdAt: Date; readonly updatedAt: Date;
};
export type NewRule = Pick<RuleRecord, 'ruleId' | 'owner' | 'name' | 'kind' | 'definition' | 'binding' | 'timezone' | 'expiresAt'> & {
  readonly nextEvaluationAt: Date; readonly scheduleCursor: Date | null };

export type OccurrenceState = 'PENDING_OWNER' | 'APPROVAL_CREATED' | 'COMPLETED' | 'DISMISSED' | 'EXPIRED';
export type OccurrenceKind = 'SCHEDULE' | 'PRICE' | 'WATCH';
export const OPEN_OCCURRENCE: readonly OccurrenceState[] = Object.freeze(['PENDING_OWNER', 'APPROVAL_CREATED']);
export type OccurrenceRecord = {
  readonly occurrenceId: string; readonly ruleId: string; readonly owner: Owner; readonly triggerKey: string; readonly kind: OccurrenceKind;
  readonly state: OccurrenceState; readonly strategy: StrategySpec | null; readonly workflowHash: string | null; readonly spend: Spend | null;
  readonly observation: Readonly<Record<string, unknown>> | null; readonly dueAt: Date; readonly expiresAt: Date; readonly handoffId: string | null;
  readonly outcome: string | null; readonly decidedAt: Date | null; readonly createdAt: Date; readonly updatedAt: Date;
};
export type NewOccurrence = Pick<OccurrenceRecord, 'occurrenceId' | 'triggerKey' | 'kind' | 'strategy' | 'workflowHash' | 'spend' | 'observation' | 'dueAt' | 'expiresAt'>;
export type EvaluationRecord = { readonly evaluationId: string; readonly ruleId: string; readonly at: Date; readonly outcome: string; readonly triggerKey: string | null;
  readonly occurrenceId: string | null; readonly observation: Readonly<Record<string, unknown>> | null; readonly detail: Readonly<Record<string, unknown>> | null };
export type NewEvaluation = Omit<EvaluationRecord, 'evaluationId' | 'ruleId'>;
export type NotificationRecord = { readonly occurrenceId: string; readonly channel: string; readonly status: 'QUEUED' | 'SKIPPED' | 'FAILED'; readonly code: string | null;
  readonly updatedAt: Date };

/** Reads the evaluator may make inside its locked transaction. */
export type EvaluationReads = {
  /** The rule's counted occurrences in the current periods of its limits (`since` per period), excluding `except`. */
  readonly usage: (periodStarts: { readonly amount: Date | null; readonly count: Date | null }, except?: string) => Promise<Usage>;
  /** The owner's saved workflow the binding came from: its current hash and version, or null when gone. */
  readonly source: (owner: Owner, source: WorkflowSource) => Promise<{ readonly workflowHash: string; readonly version: number } | null>;
};
/** What one evaluation commits. `occurrence` is inserted only if its trigger key is new; the commit reports whether it was. */
export type EvaluationCommit = {
  readonly nextEvaluationAt: Date; readonly scheduleCursor?: Date; readonly triggerState?: TriggerState; readonly lastOutcome: string;
  readonly lastObservation?: Readonly<Record<string, unknown>> | null; readonly attention?: Attention | null; readonly expire?: boolean;
  readonly occurrence?: NewOccurrence | null; readonly evaluations: readonly NewEvaluation[];
};
export type EvaluationResult =
  | { readonly kind: 'SKIPPED'; readonly reason: 'NOT_FOUND' | 'NOT_ACTIVE' | 'NOT_DUE' }
  | { readonly kind: 'COMMITTED'; readonly rule: RuleRecord; readonly occurrence: OccurrenceRecord | null; readonly duplicate: boolean };

export interface AutomationStore {
  // ── Owner operations ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** A new ACTIVE rule; `AUTOMATION_RULE_LIMIT` past `maxRules` non-archived rules for the owner. */
  readonly createRule: (rule: NewRule, now: Date, maxRules: number) => Promise<RuleRecord>;
  readonly listRules: (owner: Owner) => Promise<readonly RuleRecord[]>;
  readonly getRule: (owner: Owner, ruleId: string) => Promise<RuleRecord | null>;
  /**
   * Pause, resume or archive (compare-and-set on `version`): `AUTOMATION_NOT_FOUND`, `AUTOMATION_VERSION_CONFLICT`, or the database's
   * transition refusal. Resuming takes `nextEvaluationAt` (computed from now); archiving expires the rule's open occurrences.
   */
  readonly setState: (owner: Owner, ruleId: string, expectedVersion: number, next: 'ACTIVE' | 'PAUSED' | 'ARCHIVED', now: Date,
    resume?: { readonly nextEvaluationAt: Date; readonly scheduleCursor: Date | null }) => Promise<RuleRecord>;
  /** Replaces the bound action (owner's explicit rebind) and clears `attention`. */
  readonly rebind: (owner: Owner, ruleId: string, expectedVersion: number, binding: Binding, now: Date) => Promise<RuleRecord>;
  readonly listOccurrences: (owner: Owner, filter: { readonly ruleId?: string; readonly open?: boolean; readonly limit: number }, now: Date) => Promise<readonly OccurrenceRecord[]>;
  readonly getOccurrence: (owner: Owner, occurrenceId: string, now: Date) => Promise<OccurrenceRecord | null>;
  readonly history: (owner: Owner, ruleId: string, limit: number) => Promise<readonly EvaluationRecord[]>;
  readonly notifications: (owner: Owner, occurrenceIds: readonly string[]) => Promise<readonly NotificationRecord[]>;
  /** The owner ends an open occurrence: DISMISSED (or COMPLETED for a watch report the owner acted on). */
  /** Ends an open occurrence; with `expectedHandoffId`, only if its handoff is still that one (AUTOMATION_OCCURRENCE_CHANGED otherwise). */
  readonly decide: (owner: Owner, occurrenceId: string, state: 'DISMISSED' | 'COMPLETED', outcome: string, now: Date, expectedHandoffId?: string | null) => Promise<OccurrenceRecord>;
  /**
   * The owner's handoff for an open occurrence: compare-and-set from the handoff it had (`expectedHandoffId`) to `handoffId`, while the
   * rule is ACTIVE with `expectedRuleVersion` and the occurrence open and unexpired; `check` re-validates the limits with reads inside the
   * same locked transaction. Returns the updated occurrence or a closed refusal.
   */
  readonly attachHandoff: (owner: Owner, occurrenceId: string, expected: { readonly handoffId: string | null; readonly ruleVersion: number }, handoffId: string, now: Date,
    check: (rule: RuleRecord, occurrence: OccurrenceRecord, reads: EvaluationReads) => Promise<string | null>) => Promise<{ readonly ok: true; readonly occurrence: OccurrenceRecord } | { readonly ok: false; readonly code: string }>;

  // ── Evaluator and scheduler ──────────────────────────────────────────────────────────────────────────────────────────────
  readonly ruleById: (ruleId: string) => Promise<RuleRecord | null>;
  readonly occurrenceById: (occurrenceId: string) => Promise<OccurrenceRecord | null>;
  /** Inserts one `automation.evaluate` work item per ACTIVE rule due at `now` (deduplicated by rule and due time); returns the count. */
  readonly enqueueDue: (now: Date, limit: number) => Promise<number>;
  /** One evaluation under the rule's row lock (see the module comment). `decide` must only use `reads` for database access. */
  readonly evaluate: (ruleId: string, now: Date, decide: (rule: RuleRecord, reads: EvaluationReads) => Promise<EvaluationCommit>) => Promise<EvaluationResult>;
  /** Open occurrences past their expiry become EXPIRED; rules past their `expires_at` become EXPIRED. Returns the counts. */
  readonly expireLapsed: (now: Date, limit: number) => Promise<{ readonly occurrences: number; readonly rules: number }>;
  /** APPROVAL_CREATED occurrences (oldest update first) whose handoff state the scheduler should look at. */
  readonly awaitingApproval: (limit: number) => Promise<readonly OccurrenceRecord[]>;
  /** APPROVAL_CREATED → COMPLETED once its handoff was applied in the owner's workflow. */
  readonly completeApproval: (occurrenceId: string, handoffId: string, now: Date) => Promise<boolean>;
  readonly recordNotification: (occurrenceId: string, channel: string, status: NotificationRecord['status'], code: string | null, now: Date) => Promise<void>;
  /** Retention: history older than 90 days, ended occurrences older than 400 days, used or expired link codes. */
  readonly purge: (now: Date) => Promise<void>;
  /** False until migration 0010 is installed: every automation operation then fails closed. */
  readonly schemaInstalled: () => Promise<boolean>;
}

/** Rule limits per owner (non-archived), and history page sizes. */
export const MAX_RULES_PER_OWNER = 25;
export const PERIOD_KEYS: readonly Period[] = Object.freeze(['DAY', 'WEEK', 'MONTH']);
