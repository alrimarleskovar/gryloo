// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the Developer API v1 contract as TypeBox schemas. Request schemas are closed (an unknown field is refused,
 * never echoed); response schemas type every public view (`views.ts`), generate the OpenAPI document and pin the SDK's types. A
 * strategy is exactly FloFi's StrategySpec (`StrategyInputSchema`): no second strategy language. Nothing here carries calldata, a
 * transaction, a signature or a wallet secret.
 */
import { Type, type Static, type TLiteral, type TSchema, type TUnion } from '@sinclair/typebox';
import { NETWORK_IDS, STRATEGY_ACTIONS, StrategyInputSchema } from '../engine/strategy-spec';
import { DEVELOPER_EVENT_TYPES } from './store.ts';

const strict = { additionalProperties: false } as const;
const id = (prefix: string, description: string) => Type.String({ pattern: `^${prefix}_[a-z2-7]{26}$`, description });
const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
type LiteralTuple<T extends readonly string[]> = { -readonly [K in keyof T]: TLiteral<T[K] & string> };
/** A union of string literals that keeps its exact literal type (so `Static` is `'a' | 'b'`, not `string`). */
const literals = <const T extends readonly string[]>(values: T, description?: string): TUnion<LiteralTuple<T>> =>
  Type.Union(values.map(v => Type.Literal(v)) as unknown as LiteralTuple<T>, description ? { description } : {}) as TUnion<LiteralTuple<T>>;

export const StrategyId = id('str', 'A FloFi Developer strategy id.');
export const ApprovalId = id('apr', 'A FloFi approval id.');
export const EndpointId = id('whe', 'A webhook endpoint id.');
export const WorkflowHash = Type.String({ pattern: '^0x[0-9a-f]{64}$', description: 'The semantic workflow hash FloFi computed for the strategy.' });
export const ExecutionId = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$', description: 'A FloFi execution (run) id. It is a lookup key, not an access grant.' });
export const EventType = literals(DEVELOPER_EVENT_TYPES);
const Timestamp = Type.String({ description: 'RFC 3339 timestamp.' });
const Environment = literals(['sandbox', 'production'] as const, 'The credential environment. Only `sandbox` exists in this release.');
const FundsClass = literals(['TEST_FUNDS', 'REAL_FUNDS'] as const);
const Authority = Type.Literal('NONE', { description: 'What this object authorizes: nothing. Only the owner\'s wallet, in FloFi, can sign.' });
const Codes = Type.Array(Type.String({ pattern: '^[A-Z][A-Z0-9_]{2,80}$' }));

// ── Requests ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const CapabilitiesQuery = Type.Object({ network: Type.Optional(literals(NETWORK_IDS)), action: Type.Optional(literals(STRATEGY_ACTIONS)) }, strict);
export const CreateStrategyRequest = Type.Object({ strategy: StrategyInputSchema }, { ...strict, description: 'A FloFi StrategySpec: a version 1 strategy or a version 2 step list.' });
export const ValidateStrategyRequest = Type.Object({}, strict);
export const SimulateStrategyRequest = Type.Object({ simulationSubject: Type.String({ pattern: '^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$',
  description: 'The account whose PUBLIC balances and allowances the read-only simulation reads (EVM address or Solana public key). It is not authenticated, ' +
    'not an owner and grants nothing; nothing is stored for it.' }) }, strict);
export const CreateApprovalRequest = Type.Object({ strategyId: StrategyId, workflowHash: Type.String({ pattern: '^0x[0-9a-f]{64}$',
  description: 'The workflowHash of that strategy, as returned when it was created. A different hash is refused (STRATEGY_CHANGED).' }) }, strict);
export const CreateWebhookEndpointRequest = Type.Object({ url: Type.String({ minLength: 10, maxLength: 2048, description: 'An https URL on port 443.' }),
  events: Type.Optional(Type.Array(EventType, { maxItems: DEVELOPER_EVENT_TYPES.length, uniqueItems: true, description: 'Event types to receive; omitted or empty = all.' })) }, strict);

// ── Responses ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PlanStepView = Type.Object({ index: Type.Integer(), action: Type.String(), network: Type.String(), destinationNetwork: Nullable(Type.String()), kind: Type.String(),
  protocol: Type.String(), fundsClass: FundsClass, environment: Type.String(), stepWorkflowHash: WorkflowHash }, strict);
const PlanView = Type.Object({ kind: literals(['SINGLE_FLOW', 'COMPOSITE_FLOW', 'SEQUENTIAL', 'NOT_EXECUTABLE'] as const), reason: Nullable(Type.String()),
  steps: Type.Array(PlanStepView) }, strict);
const Finding = Type.Object({ level: literals(['BLOCK', 'WARNING', 'INFORMATION'] as const), code: Type.String(), source: Type.String(), message: Type.String() }, strict);
const Counts = Type.Object({ block: Type.Integer(), warning: Type.Integer(), information: Type.Integer() }, strict);
const ValidationView = Type.Object({ valid: Type.Boolean({ description: 'No review finding blocks handing this strategy to its owner.' }), summary: Counts,
  findings: Type.Array(Finding), blockers: Codes, preExecution: Type.Array(Type.String(), { description: 'What FloFi\'s own flow does with the owner before anything can be signed.' }) }, strict);
const AvailabilityView = Type.Object({ approvable: Type.Boolean(), reason: Nullable(Type.String()), supportedByCode: Type.Boolean(), enabledByDeployment: Type.Boolean(),
  enabledByPolicy: Type.Boolean(), demonstratedEvidence: Type.String(), mockedHarness: Type.Boolean({ description: 'This deployment runs the flow against MOCKED chains.' }) }, strict);

export const CapabilityView = Type.Object({ object: Type.Literal('capability'), action: Type.String(), network: Type.String(), destinationNetwork: Nullable(Type.String()),
  fundsClass: FundsClass, networkEnvironment: Type.String(), executionPlan: Type.Object({ kind: Type.String(), steps: Type.Integer() }, strict),
  operations: Type.Object({ compose: Type.Object({ available: Type.Boolean(), reason: Nullable(Type.String()) }, strict),
    simulate: Type.Object({ available: Type.Boolean(), reason: Nullable(Type.String()) }, strict),
    approve: Type.Object({ available: Type.Boolean(), reason: Nullable(Type.String()) }, strict),
    execute: Type.Object({ available: Type.Literal(false), reason: Type.Literal('OWNER_WALLET_IN_FLOFI_ONLY') }, strict) }, strict),
  availability: Type.Object({ supportedByCode: Type.Boolean(), enabledByDeployment: Type.Boolean(), enabledByPolicy: Type.Boolean(), demonstratedEvidence: Type.String(),
    mockedHarness: Type.Boolean() }, strict),
  exampleStrategy: Type.Record(Type.String(), Type.Unknown(), { description: 'A valid version 1 strategy for this row.' }) }, strict);
export const CapabilityList = Type.Object({ object: Type.Literal('list'), environment: Environment, data: Type.Array(CapabilityView),
  ownerExecution: Type.Literal('IN_FLOFI_WITH_THE_OWNER_WALLET_ONLY') }, strict);

export const StrategyView = Type.Object({ id: StrategyId, object: Type.Literal('strategy'), environment: Environment,
  strategy: Type.Record(Type.String(), Type.Unknown(), { description: 'The canonical, normalized StrategySpec FloFi stored (immutable).' }), workflowHash: WorkflowHash,
  engineVersion: Type.String(), fundsClass: FundsClass, networkEnvironment: Type.String(), executionPlan: PlanView, validation: ValidationView, availability: AvailabilityView,
  summary: Type.String(), explanation: Type.Array(Type.String()), notes: Type.Array(Type.String()), createdAt: Timestamp, authority: Authority }, strict);
export const StrategyValidationView = Type.Object({ object: Type.Literal('strategy_validation'), strategyId: StrategyId, workflowHash: WorkflowHash,
  engineVersion: Type.String(), reproducible: Type.Literal(true), validation: ValidationView, availability: AvailabilityView, executionPlan: PlanView, checkedAt: Timestamp,
  authority: Authority }, strict);
export const SimulationView = Type.Object({ object: Type.Literal('simulation'), strategyId: StrategyId, workflowHash: WorkflowHash, kind: Type.String(),
  provenance: Type.String(), observedAt: Nullable(Type.String()), expiresAt: Nullable(Type.String()), simulationSubject: Nullable(Type.String()),
  subjectRole: Type.Literal('SIMULATION_SUBJECT_ONLY_NOT_AN_OWNER_OR_AUTHORIZATION'), preview: Type.Literal(true), persisted: Type.Literal(false),
  authorizable: Type.Literal(false), evidenceLevel: literals(['MOCKED_SIMULATION_PREVIEW', 'SIMULATION_PREVIEW_NOT_EXECUTION'] as const),
  facts: Type.Record(Type.String(), Type.Unknown()), canonicalArtifacts: Nullable(Type.Record(Type.String(), Type.Unknown())), notes: Type.Array(Type.String()),
  authority: Authority }, strict);

const EvidenceSummary = Type.Object({ environment: Type.String(), outcome: Type.String(), bundleHash: Type.String() }, strict);
export const ApprovalExecutionView = Type.Object({ id: ExecutionId, status: Type.String(), reconciled: Type.Boolean(), terminal: Type.Boolean(), errorCode: Nullable(Type.String()),
  evidence: Nullable(EvidenceSummary), updatedAt: Timestamp }, strict);
export const ApprovalView = Type.Object({ id: ApprovalId, object: Type.Literal('approval'), environment: Environment, strategyId: StrategyId, workflowHash: WorkflowHash,
  status: literals(['PENDING', 'CLAIMED', 'APPLIED', 'EXPIRED', 'SUPERSEDED', 'REVOKED', 'STALE'] as const),
  approvalUrl: Nullable(Type.String({ description: 'The FloFi link to send to the end user (its secret is in the fragment). Returned on creation; never stored by FloFi.' })),
  approvalUrlExpiresAt: Nullable(Timestamp), expiresAt: Timestamp, networkEnvironment: Type.String(), fundsClass: FundsClass, executionPlan: PlanView,
  walletNamespace: literals(['eip155', 'solana'] as const), requires: Type.Array(Type.String()), claimed: Type.Boolean(), applied: Type.Boolean(),
  statusShared: Type.Boolean({ description: 'The owner chose to share run status and evidence with this project (off by default).' }),
  executions: Type.Array(ApprovalExecutionView), executionsVisible: Type.Boolean(), note: Nullable(Type.String()), createdAt: Timestamp, authority: Authority }, strict);
const Attempt = Type.Object({ attemptId: Nullable(Type.String()), step: Nullable(Type.String()), state: Nullable(Type.String()), transactionHash: Nullable(Type.String()),
  reconciled: Nullable(Type.Boolean()), updatedAt: Nullable(Type.String()) }, strict);
export const ExecutionView = Type.Object({ id: ExecutionId, object: Type.Literal('execution'), approvalId: ApprovalId, status: Type.String(), provenance: Type.String(),
  reconciled: Type.Boolean(), terminal: Type.Boolean(), errorCode: Nullable(Type.String()), attentionRequired: Nullable(Type.Boolean()),
  owner: Type.String({ description: 'The wallet that claimed the approval and signed (shared by its owner).' }), attempts: Type.Array(Attempt), createdAt: Nullable(Type.String()),
  updatedAt: Nullable(Type.String()), accessBasis: Type.Literal('OWNER_SHARED_WITH_PROJECT') }, strict);
export const EvidenceView = Type.Object({ object: Type.Literal('evidence'), executionId: ExecutionId, approvalId: ApprovalId, status: Type.String(), provenance: Type.String(),
  evidence: Nullable(Type.Object({ bundleHash: Type.String(), environment: Type.String({ description: 'Copied from the Evidence Bundle (MOCKED, TESTNET_EXECUTED, …); never upgraded.' }),
    outcome: Type.String(), canonical: Type.Boolean(), bundle: Nullable(Type.Record(Type.String(), Type.Unknown())) }, strict)),
  reason: Nullable(Type.Literal('NO_RECONCILED_EVIDENCE_YET')), accessBasis: Type.Literal('OWNER_SHARED_WITH_PROJECT') }, strict);
export const WebhookEndpointView = Type.Object({ id: EndpointId, object: Type.Literal('webhook_endpoint'), environment: Environment, url: Type.String(),
  events: Type.Array(EventType, { description: 'Empty = every event type.' }), status: literals(['ACTIVE', 'DELETED'] as const),
  secret: Nullable(Type.String({ description: 'The signing secret (`whsec_…`), returned once at creation; null on an idempotent replay.' })),
  secretAlreadyIssued: Type.Boolean(), createdAt: Timestamp }, strict);
export const DeletedView = Type.Object({ id: EndpointId, object: Type.Literal('webhook_endpoint'), deleted: Type.Literal(true) }, strict);
export const ErrorView = Type.Object({ error: Type.Object({ code: Type.String(), reason: Type.String(), message: Type.String(),
  issues: Type.Optional(Type.Array(Type.Object({ path: Type.String(), rule: Type.String() }, strict))), requestId: Type.String() }, strict) }, strict);
/** The webhook payload (`POST` to the endpoint, signed per Standard Webhooks). `data` is a hint; fetch the resource for its current state. */
export const WebhookEventView = Type.Object({ id: Type.String({ pattern: '^evt_[a-z2-7]{26}$' }), object: Type.Literal('event'), type: EventType, apiVersion: Type.Literal('v1'),
  environment: Environment, createdAt: Timestamp, data: Type.Record(Type.String(), Type.Unknown()) }, strict);

export type CapabilityListBody = Static<typeof CapabilityList>;
export type CapabilityBody = Static<typeof CapabilityView>;
export type StrategyBody = Static<typeof StrategyView>;
export type StrategyValidationBody = Static<typeof StrategyValidationView>;
export type SimulationBody = Static<typeof SimulationView>;
export type ApprovalBody = Static<typeof ApprovalView>;
export type ExecutionBody = Static<typeof ExecutionView>;
export type EvidenceBody = Static<typeof EvidenceView>;
export type WebhookEndpointBody = Static<typeof WebhookEndpointView>;
export type DeletedBody = Static<typeof DeletedView>;
export type ErrorBody = Static<typeof ErrorView>;
export type WebhookEventBody = Static<typeof WebhookEventView>;
