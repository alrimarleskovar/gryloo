// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: what the Automations workspace receives from the server — plain data, no server code, safe for the browser
 * bundle. No view carries an approval secret, a key, a signature, calldata or another owner's data.
 */
export type ObservedAssetView = 'ETH' | 'BTC' | 'SOL';
export type ActionView = { readonly network: string; readonly networkLabel: string; readonly inputAsset: string; readonly outputAsset: string; readonly amount: string;
  readonly slippageBps: number | null; readonly side: 'BUY' | 'SELL' | null; readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS' } | null;
export type ObservationView = { readonly asset: string; readonly priceUsd: string; readonly observedAt: string; readonly source: string; readonly evidence: string;
  readonly previousPriceUsd?: string | null; readonly previousObservedAt?: string | null } | { readonly asset: string; readonly code: string };
export type RuleView = {
  readonly ruleId: string; readonly name: string; readonly kind: 'SCHEDULED_DCA' | 'PRICE_TRIGGER' | 'DAILY_WATCH'; readonly state: 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'ARCHIVED';
  readonly executionMode: 'CONFIRM_EACH_TIME' | 'DELEGATED_WITH_LIMITS'; readonly authorizationId: string | null; readonly version: number; readonly timezone: string;
  readonly schedule: { readonly frequency: 'DAILY' | 'WEEKLY'; readonly weekday: number | null; readonly time: string } | null;
  readonly condition: { readonly type: string; readonly asset: string; readonly threshold: string | null; readonly reference: string | null; readonly percent: string | null;
    readonly effectiveThreshold: string; readonly checkEveryMinutes: number } | null;
  readonly watch: { readonly assets: readonly string[] } | null;
  readonly limits: { readonly maxAmountPerExecution: string | null; readonly maxAmountPerPeriod: { readonly amount: string; readonly period: string } | null;
    readonly maxOccurrencesPerPeriod: { readonly count: number; readonly period: string } | null; readonly cooldownMinutes: number; readonly maxSlippageBps: number | null };
  readonly action: ActionView; readonly source: { readonly workflowId: string; readonly version: number } | null;
  readonly nextEvaluationAt: string | null; readonly lastEvaluationAt: string | null; readonly lastOutcome: string | null;
  readonly lastObservation: ObservationView | null; readonly armed: boolean | null; readonly attention: 'WORKFLOW_CHANGED' | 'STRATEGY_STALE' | null;
  readonly expiresAt: string | null; readonly createdAt: string; readonly pending: number;
};
export type RunView = { readonly executionId: string; readonly status: string; readonly reconciled: boolean; readonly terminal: boolean; readonly errorCode: string | null;
  readonly evidenceEnvironment: string | null; readonly evidenceOutcome: string | null; readonly evidenceBundleHash: string | null };
export type OccurrenceView = {
  readonly occurrenceId: string; readonly ruleId: string; readonly ruleName: string; readonly kind: 'SCHEDULE' | 'PRICE' | 'WATCH';
  readonly state: 'PENDING_OWNER' | 'APPROVAL_CREATED' | 'COMPLETED' | 'DISMISSED' | 'EXPIRED' | 'DELEGATED'; readonly dueAt: string; readonly expiresAt: string;
  readonly action: ActionView; readonly observations: readonly ObservationView[]; readonly outcome: string | null; readonly decidedAt: string | null;
  readonly approval: { readonly status: string; readonly runs: readonly RunView[] } | null;
  readonly notifications: readonly { readonly channel: string; readonly status: string; readonly code: string | null }[];
};
export type HistoryEntryView = { readonly at: string; readonly outcome: string; readonly occurrenceId: string | null; readonly observation: ObservationView | null;
  readonly detail: Readonly<Record<string, unknown>> | null };
export type RouteCapability = { readonly asset: ObservedAssetView; readonly network: string; readonly networkLabel: string; readonly quote: string; readonly base: string;
  readonly executable: boolean; readonly reason: string | null; readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS' };
export type CapabilityView = {
  readonly priceSource: 'off' | 'chainlink' | 'fixture'; readonly priceEvidence: 'PUBLIC_READ_ONLY' | 'MOCKED' | null; readonly observable: readonly ObservedAssetView[];
  readonly routes: readonly RouteCapability[]; readonly unavailable: readonly { readonly asset: ObservedAssetView; readonly code: string }[];
};
export type TelegramView = { readonly available: boolean; readonly linked: { readonly expiresAt: string } | null };
export type OverviewView = { readonly rules: readonly RuleView[]; readonly pending: readonly OccurrenceView[]; readonly recent: readonly OccurrenceView[];
  readonly capabilities: CapabilityView; readonly telegram: TelegramView };
export type RuleHistoryView = { readonly rule: RuleView; readonly entries: readonly HistoryEntryView[]; readonly occurrences: readonly OccurrenceView[] };
export type OpenedView = { readonly approvalUrl: string; readonly expiresAt: string };
export type LinkCodeView = { readonly code: string; readonly expiresAt: string; readonly command: string };
