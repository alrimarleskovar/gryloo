// SPDX-License-Identifier: Apache-2.0
/**
 * Request and response types of the FloFi Developer API v1. They describe the wire format only; FloFi's server is the single source of
 * truth for every value (the SDK never composes, validates, hashes or simulates anything). The server keeps these types in exact parity
 * with its own schemas (a type test in the FloFi repository fails on any drift).
 */

export type Environment = 'sandbox' | 'production';
export type FundsClass = 'TEST_FUNDS' | 'REAL_FUNDS';
/** What an object authorizes: nothing. Only the owner's wallet, in FloFi, can sign. */
export type Authority = 'NONE';
export type DeveloperEventType = 'approval.claimed' | 'approval.applied' | 'approval.ended' | 'execution.started' | 'execution.failed' | 'execution.reconciled';
export type ApprovalStatus = 'PENDING' | 'CLAIMED' | 'APPLIED' | 'EXPIRED' | 'SUPERSEDED' | 'REVOKED' | 'STALE';
/** A FloFi StrategySpec: a version 1 strategy (one action) or `{ version: 2, steps: [...] }`. FloFi validates it; the SDK does not. */
export type StrategyInput = Record<string, unknown>;

export type CapabilitiesQuery = { network?: string; action?: string };
export type CreateStrategyRequest = { strategy: StrategyInput };
export type SimulateStrategyRequest = {
  /** The account whose PUBLIC balances the read-only simulation reads. Not an owner, not authenticated, grants nothing. */
  simulationSubject: string;
};
export type CreateApprovalRequest = { strategyId: string; workflowHash: string };
export type CreateWebhookEndpointRequest = { url: string; events?: DeveloperEventType[] };

export type PlanStep = { index: number; action: string; network: string; destinationNetwork: string | null; kind: string; protocol: string; fundsClass: FundsClass;
  environment: string; stepWorkflowHash: string };
export type ExecutionPlan = { kind: 'SINGLE_FLOW' | 'COMPOSITE_FLOW' | 'SEQUENTIAL' | 'NOT_EXECUTABLE'; reason: string | null; steps: PlanStep[] };
export type Finding = { level: 'BLOCK' | 'WARNING' | 'INFORMATION'; code: string; source: string; message: string };
export type Validation = { valid: boolean; summary: { block: number; warning: number; information: number }; findings: Finding[]; blockers: string[];
  preExecution: string[] };
export type Availability = { approvable: boolean; reason: string | null; supportedByCode: boolean; enabledByDeployment: boolean; enabledByPolicy: boolean;
  demonstratedEvidence: string; mockedHarness: boolean };

export type Capability = { object: 'capability'; action: string; network: string; destinationNetwork: string | null; fundsClass: FundsClass; networkEnvironment: string;
  executionPlan: { kind: string; steps: number };
  operations: { compose: { available: boolean; reason: string | null }; simulate: { available: boolean; reason: string | null };
    approve: { available: boolean; reason: string | null }; execute: { available: false; reason: 'OWNER_WALLET_IN_FLOFI_ONLY' } };
  availability: { supportedByCode: boolean; enabledByDeployment: boolean; enabledByPolicy: boolean; demonstratedEvidence: string; mockedHarness: boolean };
  exampleStrategy: Record<string, unknown> };
export type CapabilityList = { object: 'list'; environment: Environment; data: Capability[]; ownerExecution: 'IN_FLOFI_WITH_THE_OWNER_WALLET_ONLY' };

export type Strategy = { id: string; object: 'strategy'; environment: Environment; strategy: Record<string, unknown>; workflowHash: string; engineVersion: string;
  fundsClass: FundsClass; networkEnvironment: string; executionPlan: ExecutionPlan; validation: Validation; availability: Availability; summary: string;
  explanation: string[]; notes: string[]; createdAt: string; authority: Authority };
export type StrategyValidation = { object: 'strategy_validation'; strategyId: string; workflowHash: string; engineVersion: string; reproducible: true;
  validation: Validation; availability: Availability; executionPlan: ExecutionPlan; checkedAt: string; authority: Authority };
export type Simulation = { object: 'simulation'; strategyId: string; workflowHash: string; kind: string; provenance: string; observedAt: string | null;
  expiresAt: string | null; simulationSubject: string | null; subjectRole: 'SIMULATION_SUBJECT_ONLY_NOT_AN_OWNER_OR_AUTHORIZATION'; preview: true; persisted: false;
  authorizable: false; evidenceLevel: 'MOCKED_SIMULATION_PREVIEW' | 'SIMULATION_PREVIEW_NOT_EXECUTION'; facts: Record<string, unknown>;
  canonicalArtifacts: Record<string, unknown> | null; notes: string[]; authority: Authority };

export type EvidenceSummary = { environment: string; outcome: string; bundleHash: string };
export type ApprovalExecution = { id: string; status: string; reconciled: boolean; terminal: boolean; errorCode: string | null; evidence: EvidenceSummary | null;
  updatedAt: string };
export type Approval = { id: string; object: 'approval'; environment: Environment; strategyId: string; workflowHash: string; status: ApprovalStatus;
  /** The FloFi link to give the end user (its secret travels in the fragment). Returned on creation (and as a fresh short-lived link on an idempotent replay). */
  approvalUrl: string | null; approvalUrlExpiresAt: string | null; expiresAt: string; networkEnvironment: string; fundsClass: FundsClass; executionPlan: ExecutionPlan;
  walletNamespace: 'eip155' | 'solana'; requires: string[]; claimed: boolean; applied: boolean;
  /** The owner chose to share run status and evidence with your project (off by default). */
  statusShared: boolean; executions: ApprovalExecution[]; executionsVisible: boolean; note: string | null; createdAt: string; authority: Authority };
export type Attempt = { attemptId: string | null; step: string | null; state: string | null; transactionHash: string | null; reconciled: boolean | null; updatedAt: string | null };
export type Execution = { id: string; object: 'execution'; approvalId: string; status: string; provenance: string; reconciled: boolean; terminal: boolean;
  errorCode: string | null; attentionRequired: boolean | null; owner: string; attempts: Attempt[]; createdAt: string | null; updatedAt: string | null;
  accessBasis: 'OWNER_SHARED_WITH_PROJECT' };
export type Evidence = { object: 'evidence'; executionId: string; approvalId: string; status: string; provenance: string;
  evidence: { bundleHash: string; environment: string; outcome: string; canonical: boolean; bundle: Record<string, unknown> | null } | null;
  reason: 'NO_RECONCILED_EVIDENCE_YET' | null; accessBasis: 'OWNER_SHARED_WITH_PROJECT' };
export type WebhookEndpoint = { id: string; object: 'webhook_endpoint'; environment: Environment; url: string; events: DeveloperEventType[]; status: 'ACTIVE' | 'DELETED';
  /** The signing secret (`whsec_…`), returned once at creation; null on an idempotent replay. Store it like a password. */
  secret: string | null; secretAlreadyIssued: boolean; createdAt: string };
export type DeletedWebhookEndpoint = { id: string; object: 'webhook_endpoint'; deleted: true };
/** A verified webhook event. `data` is a hint: fetch the resource for its current state. */
export type WebhookEvent = { id: string; object: 'event'; type: DeveloperEventType; apiVersion: 'v1'; environment: Environment; createdAt: string;
  data: Record<string, unknown> };
export type ErrorBody = { error: { code: string; reason: string; message: string; issues?: { path: string; rule: string }[]; requestId: string } };
