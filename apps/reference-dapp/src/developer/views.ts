// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the public views of the Developer API — explicit allowlist mappers from the platform's results to the
 * response schemas (`schemas.ts`). No internal structure leaves: no flow name or mode, adapter id, editor command, IR document, node
 * id, calldata, transaction, nonce, Review commitment or journal. Every view of a strategy, simulation or approval says it authorizes
 * nothing.
 */
import type { Composition, WorkflowComposition } from '../engine/strategy-engine';
import { APPROVAL_REQUIRES, handoffFindings, pickRow, planNamespace, reviewWorkflow, type CapabilityFact, type ExecutionPlan, type Gates, type HandoffRecord,
  type OwnedRun, type PlanStep, type RunProgress, type SimulationPreview } from '../platform/index.ts';
import type { DeveloperEnvironment } from './config.ts';
import { publicReason } from './errors.ts';
import type { ApprovalBody, CapabilityBody, EvidenceBody, ExecutionBody, SimulationBody, StrategyBody, StrategyValidationBody, WebhookEndpointBody } from './schemas.ts';
import type { EndpointRecord, StrategyRecord } from './store.ts';

const reason = (code: string | null) => code === null ? null : publicReason(code);
const stepView = (s: PlanStep) => ({ index: s.index, action: s.action, network: s.network, destinationNetwork: s.destinationNetwork, kind: s.kind, protocol: s.protocol,
  fundsClass: s.fundsClass, environment: s.environment, stepWorkflowHash: s.workflowHash });
export const planView = (plan: ExecutionPlan): StrategyBody['executionPlan'] => ({ kind: plan.kind, reason: reason(plan.reason), steps: plan.steps.map(stepView) });

/** The Strategy Review of every step, with its BLOCK findings split into the owner's own pre-execution steps and genuine blockers. */
export function validationView(workflow: WorkflowComposition): StrategyBody['validation'] {
  const reviewed = reviewWorkflow(workflow), split = workflow.steps.map(handoffFindings);
  const blockers = [...new Set(split.flatMap(s => s.blockers.map(b => b.code)))], preExecution = [...new Set(split.flatMap(s => s.preExecution))];
  return { valid: blockers.length === 0, summary: reviewed.summary, preExecution, blockers,
    findings: reviewed.steps.flatMap(step => step.findings.map(f => ({ level: f.level, code: f.code, source: f.source, message: f.message }))) };
}
/** The four facts now, and whether FloFi would hand this strategy to its owner. */
export function availabilityView(gates: Gates, validation: StrategyBody['validation']): StrategyBody['availability'] {
  const gate = reason(gates.handoff.reason);
  return { approvable: gates.handoff.allowed && validation.valid, reason: gate ?? (validation.valid ? null : 'REVIEW_BLOCKED'),
    supportedByCode: gates.supportedByCode.execute, enabledByDeployment: gates.enabledByDeployment.enabled, enabledByPolicy: gates.enabledByPolicy.enabled,
    demonstratedEvidence: gates.demonstratedEvidence, mockedHarness: gates.enabledByDeployment.mockedHarness };
}
const prefixed = (workflow: WorkflowComposition, pick: (c: Composition) => readonly string[]) =>
  workflow.steps.length === 1 ? [...pick(workflow.steps[0]!)] : workflow.steps.flatMap((c, i) => pick(c).map(line => `Step ${i + 1}: ${line}`));

export function strategyView(record: StrategyRecord, workflow: WorkflowComposition, gates: Gates): StrategyBody {
  const validation = validationView(workflow);
  return { id: record.strategyId, object: 'strategy', environment: record.environment, strategy: record.strategy as Record<string, unknown>,
    workflowHash: record.workflowHash, engineVersion: record.engineVersion, fundsClass: record.fundsClass, networkEnvironment: record.networkEnvironment,
    executionPlan: planView(record.plan), validation, availability: availabilityView(gates, validation),
    summary: workflow.steps.length === 1 ? workflow.steps[0]!.summary : prefixed(workflow, c => [c.summary]).join(' '),
    explanation: prefixed(workflow, c => c.explanation), notes: [...workflow.notes], createdAt: record.createdAt.toISOString(), authority: 'NONE' };
}
export function validationResultView(record: StrategyRecord, workflow: WorkflowComposition, gates: Gates & { readonly plan: ExecutionPlan }, engineVersion: string,
  now: Date): StrategyValidationBody {
  const validation = validationView(workflow);
  return { object: 'strategy_validation', strategyId: record.strategyId, workflowHash: record.workflowHash, engineVersion, reproducible: true, validation,
    availability: availabilityView(gates, validation), executionPlan: planView(gates.plan), checkedAt: now.toISOString(), authority: 'NONE' };
}

export function simulationView(strategyId: string, preview: SimulationPreview): SimulationBody {
  const { composition: c, view } = preview;
  return { object: 'simulation', strategyId, workflowHash: c.workflowHash, kind: view.kind, provenance: view.provenance, observedAt: view.observedAt, expiresAt: view.expiresAt,
    simulationSubject: preview.simulationSubject, subjectRole: 'SIMULATION_SUBJECT_ONLY_NOT_AN_OWNER_OR_AUTHORIZATION', preview: true, persisted: false, authorizable: false,
    evidenceLevel: view.provenance === 'MOCKED' ? 'MOCKED_SIMULATION_PREVIEW' : 'SIMULATION_PREVIEW_NOT_EXECUTION', facts: view.facts,
    canonicalArtifacts: view.canonicalArtifacts, authority: 'NONE',
    notes: ['Amounts are integer native units of the named tokens.', 'Quotes and state expire; FloFi re-simulates with the owner before any Review.',
      'A simulation is evidence of what would happen at the observed block, not a guarantee and not an execution.'] };
}

export function capabilityView(fact: CapabilityFact, environment: DeveloperEnvironment): CapabilityBody {
  const { row, gates } = fact, sandbox = environment === 'sandbox', composable = !sandbox || row.funds === 'TEST_FUNDS';
  const approve = !composable ? 'SANDBOX_TEST_FUNDS_ONLY' : reason(gates.handoff.reason);
  return { object: 'capability', action: row.action, network: row.network, destinationNetwork: row.destinationNetwork, fundsClass: row.funds,
    networkEnvironment: row.publicEnvironment, executionPlan: { kind: gates.plan.kind, steps: gates.plan.steps.length },
    operations: { compose: { available: composable, reason: composable ? null : 'SANDBOX_TEST_FUNDS_ONLY' },
      simulate: { available: composable && fact.previewable, reason: !composable ? 'SANDBOX_TEST_FUNDS_ONLY' : reason(fact.previewUnavailableReason) },
      approve: { available: approve === null, reason: approve }, execute: { available: false, reason: 'OWNER_WALLET_IN_FLOFI_ONLY' } },
    availability: { supportedByCode: gates.supportedByCode.execute, enabledByDeployment: gates.enabledByDeployment.enabled, enabledByPolicy: gates.enabledByPolicy.enabled,
      demonstratedEvidence: gates.demonstratedEvidence, mockedHarness: gates.enabledByDeployment.mockedHarness },
    exampleStrategy: { ...row.example } as Record<string, unknown> };
}

const runView = (r: RunProgress): ApprovalBody['executions'][number] => ({ id: r.executionId, status: r.status, reconciled: r.reconciled, terminal: r.terminal,
  errorCode: r.errorCode, evidence: r.evidenceEnvironment && r.evidenceOutcome && r.evidenceBundleHash
    ? { environment: r.evidenceEnvironment, outcome: r.evidenceOutcome, bundleHash: r.evidenceBundleHash } : null, updatedAt: r.updatedAt });
/** The approval as its developer sees it: its state, never the claiming wallet; runs and evidence only while the owner shares them. */
export function approvalView(h: HandoffRecord, environment: DeveloperEnvironment, runs: readonly RunProgress[] | null,
  link: { readonly url: string; readonly expiresAt: string } | null): ApprovalBody {
  return { id: h.handoffId, object: 'approval', environment, strategyId: String(h.requesterContext.strategyId), workflowHash: h.workflowHash, status: h.status,
    approvalUrl: link?.url ?? null, approvalUrlExpiresAt: link?.expiresAt ?? null, expiresAt: h.expiresAt.toISOString(), networkEnvironment: h.networkEnvironment,
    fundsClass: h.fundsClass, executionPlan: planView(h.plan), walletNamespace: planNamespace(h.plan), requires: [...APPROVAL_REQUIRES], claimed: h.claimed !== null,
    applied: h.appliedAt !== null, statusShared: h.shareStatus, executions: (runs ?? []).map(runView), executionsVisible: runs !== null,
    note: h.status === 'APPLIED' && !h.shareStatus ? 'The owner has not shared the status of runs started from this approval.' : null,
    createdAt: h.createdAt.toISOString(), authority: 'NONE' };
}

const nullable = <T>(value: unknown, test: (v: unknown) => v is T): T | null => test(value) ? value : null;
const isString = (v: unknown): v is string => typeof v === 'string', isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
/** A run the owner shared with this project, read as its owner: status and attempts only (never calldata, nonces or the journal). */
export function executionView(found: OwnedRun, approvalId: string): ExecutionBody {
  const run = found.run as unknown as Record<string, unknown>, facts = pickRow(run, ['errorCode', 'needsObservation', 'attentionRequired', 'hasEvidence', 'createdAt', 'updatedAt']);
  const errorCode = nullable(facts.errorCode, isString), reconciled = facts.hasEvidence === true;
  return { id: found.run.runId, object: 'execution', approvalId, status: found.run.status, provenance: String(found.run.provenance), reconciled,
    terminal: facts.needsObservation !== true && (reconciled || errorCode !== null), errorCode, attentionRequired: nullable(facts.attentionRequired, isBoolean),
    owner: found.owner, attempts: (Array.isArray(run.attempts) ? run.attempts : []).slice(0, 64).map(a => {
      const p = pickRow(a, ['attemptId', 'step', 'state', 'transactionHash', 'reconciled', 'updatedAt']);
      return { attemptId: nullable(p.attemptId, isString), step: nullable(p.step, isString), state: nullable(p.state, isString),
        transactionHash: nullable(p.transactionHash, isString), reconciled: nullable(p.reconciled, isBoolean), updatedAt: nullable(p.updatedAt, isString) };
    }), createdAt: nullable(facts.createdAt, isString), updatedAt: nullable(facts.updatedAt, isString), accessBasis: 'OWNER_SHARED_WITH_PROJECT' };
}
type PlatformEvidence = { readonly executionId: string; readonly status: string; readonly provenance: string;
  readonly evidence: { readonly bundleHash: string; readonly environment: string; readonly outcome: string; readonly canonicalBundle: unknown; readonly canonical: boolean } | null };
/** The reconciled Evidence Bundle with its own environment and outcome, exactly as FloFi recorded them (never upgraded). */
export function evidenceView(view: PlatformEvidence, approvalId: string): EvidenceBody {
  const e = view.evidence;
  return { object: 'evidence', executionId: view.executionId, approvalId, status: view.status, provenance: String(view.provenance),
    evidence: e ? { bundleHash: e.bundleHash, environment: e.environment, outcome: e.outcome, canonical: e.canonical,
      bundle: e.canonicalBundle && typeof e.canonicalBundle === 'object' ? e.canonicalBundle as Record<string, unknown> : null } : null,
    reason: e ? null : 'NO_RECONCILED_EVIDENCE_YET', accessBasis: 'OWNER_SHARED_WITH_PROJECT' };
}

export const endpointView = (e: EndpointRecord, secret: string | null, secretAlreadyIssued: boolean): WebhookEndpointBody => ({ id: e.endpointId,
  object: 'webhook_endpoint', environment: e.environment, url: e.url, events: [...e.eventTypes], status: e.status, secret, secretAlreadyIssued,
  createdAt: e.createdAt.toISOString() });
