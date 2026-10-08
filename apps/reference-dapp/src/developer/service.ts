// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the Developer API's operations, each a thin composition of the shared platform (`src/platform`) for one
 * authenticated principal — the same composition, canonical IR and workflow hash, review, four facts, simulation preview, approval
 * handoff and owner-scoped reads as MCP and FloFi Web. Every store call is scoped by the principal's project and environment.
 *
 * What no operation can do: sign, submit, prepare or authorize a transaction, approve a Review, claim an approval, read a run its owner
 * did not share, or act on mainnet with a sandbox credential. The runtime is used only for `mode`, `info`, previews and owner-scoped
 * run reads (as the wallet that claimed and shared the approval).
 */
import { composeWorkflowBound, type WorkflowComposition } from '../engine/strategy-engine';
import { capabilityFacts, composeWorkflowOrRefuse, ENGINE_VERSION, evaluateWorkflowGates, evidenceView as ownerEvidence, findOwnedRun, openApprovalSession, PlatformRefusal,
  requestApproval, sharedRuns, simulatePreview, TERMINAL, typedId, workflowPlan, type ApprovalDeps, type EngineRuntime, type HandoffPolicy, type HandoffStore,
  type RequesterScope, type WindowLimit } from '../platform/index.ts';
import { developerApprovalLinkScheme, developerHandoffRules, developerRequester } from './approval-profile.ts';
import { SANDBOX_POLICY, type DeveloperConfig } from './config.ts';
import { classify, DeveloperError, fail } from './errors.ts';
import type { PlanLimits } from './limits.ts';
import type { ApprovalBody, CapabilityListBody, DeletedBody, EvidenceBody, ExecutionBody, SimulationBody, StrategyBody, StrategyValidationBody,
  WebhookEndpointBody } from './schemas.ts';
import { developerRequesterRef, type DeveloperEventType, type DeveloperPrincipal, type DeveloperStore, type ProjectScope, type StrategyRecord } from './store.ts';
import { approvalView, capabilityView, endpointView, evidenceView, executionView, simulationView, strategyView, validationResultView } from './views.ts';
import { webhookSecret, webhookUrlCheck } from './webhooks.ts';

/** Everything one request of one principal may use. */
export type DeveloperContext = {
  readonly config: DeveloperConfig; readonly tenantId: string; readonly principal: DeveloperPrincipal; readonly scope: ProjectScope;
  readonly store: DeveloperStore; readonly handoffs: HandoffStore; readonly runtime: EngineRuntime; readonly limits: PlanLimits; readonly allow: WindowLimit;
  readonly now: Date;
};
/** Sandbox: test funds only, every mainnet off. Production credentials do not exist in this build (refused before any operation). */
const policyOf = (ctx: DeveloperContext): HandoffPolicy => ctx.scope.environment === 'sandbox' ? SANDBOX_POLICY : { ok: false, code: 'MCP_HANDOFF_POLICY_INVALID' };
const requesterOf = (ctx: DeveloperContext): RequesterScope => ({ kind: 'DEVELOPER_PROJECT', ref: developerRequesterRef(ctx.scope.projectId, ctx.scope.environment) });
export const limitBucket = (scope: ProjectScope, metric: string) => `dev:${scope.projectId}:${scope.environment}:${metric}`;
const MAX_STRATEGY_BYTES = 16_000;

export async function listCapabilities(ctx: DeveloperContext, query: { network?: string; action?: string }): Promise<CapabilityListBody> {
  const facts = await capabilityFacts(ctx.runtime, policyOf(ctx), query as Parameters<typeof capabilityFacts>[2]);
  return { object: 'list', environment: ctx.scope.environment, data: facts.map(f => capabilityView(f, ctx.scope.environment)), ownerExecution: 'IN_FLOFI_WITH_THE_OWNER_WALLET_ONLY' };
}

/** Composes, checks and stores an immutable strategy: its canonical form, workflow hash, engine version and plan never change. */
export async function createStrategy(ctx: DeveloperContext, body: { strategy: unknown }): Promise<StrategyBody> {
  let workflow: WorkflowComposition;
  try { workflow = composeWorkflowOrRefuse(body.strategy, undefined); } catch (error) { throw classify(error, 'compose'); }
  if (ctx.scope.environment === 'sandbox' && workflow.fundsClass !== 'TEST_FUNDS') fail('MAINNET_DISABLED', 'SANDBOX_TEST_FUNDS_ONLY');
  if (Buffer.byteLength(JSON.stringify(workflow.strategy), 'utf8') > MAX_STRATEGY_BYTES) fail('INVALID_STRATEGY', 'STRATEGY_TOO_LARGE');
  const plan = workflowPlan(workflow), gates = await evaluateWorkflowGates(workflow, ctx.runtime, policyOf(ctx));
  const record = await ctx.store.createStrategy({ strategyId: typedId('str'), projectId: ctx.scope.projectId, environment: ctx.scope.environment, strategy: workflow.strategy,
    workflowHash: workflow.workflowHash, engineVersion: ENGINE_VERSION, fundsClass: workflow.fundsClass, networkEnvironment: plan.networkEnvironment, plan }, ctx.now);
  return strategyView(record, workflow, gates);
}

async function storedStrategy(ctx: DeveloperContext, strategyId: string): Promise<StrategyRecord> {
  return await ctx.store.strategy(ctx.scope, strategyId) ?? fail('NOT_FOUND', 'STRATEGY_NOT_FOUND');
}
/** The stored strategy re-composed with the CURRENT engine; if that no longer reproduces its hash, it is stale (create it again). */
function recomposed(record: StrategyRecord): WorkflowComposition {
  const workflow = composeWorkflowBound(record.strategy, record.workflowHash);
  return workflow.ok ? workflow : fail('STRATEGY_STALE', 'STRATEGY_STALE');
}

export async function validateStoredStrategy(ctx: DeveloperContext, strategyId: string): Promise<StrategyValidationBody> {
  const record = await storedStrategy(ctx, strategyId), workflow = recomposed(record);
  return validationResultView(record, workflow, await evaluateWorkflowGates(workflow, ctx.runtime, policyOf(ctx)), ENGINE_VERSION, ctx.now);
}

/** FloFi's own read-only simulation of the stored strategy: nothing is persisted, signed or sent, and it is never authorizable. */
export async function simulateStoredStrategy(ctx: DeveloperContext, strategyId: string, body: { simulationSubject: string }): Promise<SimulationBody> {
  const record = await storedStrategy(ctx, strategyId);
  recomposed(record);
  try {
    const preview = await simulatePreview(ctx.runtime, { strategy: record.strategy, workflowHash: record.workflowHash, simulationSubject: body.simulationSubject },
      { budget: () => ctx.allow(limitBucket(ctx.scope, 'simulations'), ctx.limits.simulationsPerHour, 3_600, ctx.now) });
    return simulationView(record.strategyId, preview);
  } catch (error) { throw classify(error, 'simulate'); }
}

const approvalDeps = (ctx: DeveloperContext): ApprovalDeps => ({ origin: ctx.config.origin, scheme: developerApprovalLinkScheme(ctx.config), handoffs: ctx.handoffs,
  allow: ctx.allow, runtime: ctx.runtime, policy: policyOf(ctx), rules: developerHandoffRules(ctx.limits), now: ctx.now });

/**
 * Hands one immutable strategy revision to its owner: the platform re-composes it, requires its exact workflow hash, evaluates the
 * four facts and the review, and stores a PENDING approval (the database binds it to this strategy). The returned link only SHOWS
 * the proposal in FloFi; the owner proves a wallet, re-simulates, reviews the Strategy Manifest and signs there.
 */
export async function createApproval(ctx: DeveloperContext, body: { strategyId: string; workflowHash: string }): Promise<ApprovalBody> {
  const record = await storedStrategy(ctx, body.strategyId);
  if (record.workflowHash !== body.workflowHash) fail('STRATEGY_CHANGED', 'WORKFLOW_HASH_MISMATCH');
  recomposed(record);
  const result = await requestApproval(approvalDeps(ctx), developerRequester(ctx.principal, record.strategyId), record.strategy, record.workflowHash);
  if (!result.ok) throw classify(new PlatformRefusal(result.code, result.extra ?? {}));
  const h = await ctx.handoffs.forRequester(result.value.approvalId, requesterOf(ctx), ctx.now) ?? fail('INTERNAL_ERROR', 'INTERNAL_ERROR');
  return approvalView(h, ctx.scope.environment, null, { url: result.value.approvalUrl, expiresAt: result.value.expiresAt });
}
/** What an idempotent replay of approval creation returns: the same approval now, with a fresh short-lived link while it is open. */
export async function replayApproval(ctx: DeveloperContext, stored: ApprovalBody): Promise<ApprovalBody> {
  const h = await ctx.handoffs.forRequester(stored.id, requesterOf(ctx), ctx.now) ?? fail('NOT_FOUND', 'APPROVAL_NOT_FOUND');
  if (TERMINAL.includes(h.status)) fail('APPROVAL_EXPIRED', `APPROVAL_${h.status}`);
  let link: { url: string; expiresAt: string } | null = null;
  if (h.status === 'PENDING' || h.status === 'CLAIMED') {
    try {
      const opened = await openApprovalSession(approvalDeps(ctx), developerRequester(ctx.principal, String(h.requesterContext.strategyId)), h.handoffId);
      link = { url: opened.approvalUrl, expiresAt: opened.expiresAt };
    } catch (error) { throw classify(error); }
  }
  return approvalView(h, ctx.scope.environment, await sharedRuns(h, ctx.runtime, ctx.handoffs), link);
}
/** The approval's state now (lazy expiry); runs and evidence only while its owner shares them with this project. */
export async function getApproval(ctx: DeveloperContext, approvalId: string): Promise<ApprovalBody> {
  const h = await ctx.handoffs.forRequester(approvalId, requesterOf(ctx), ctx.now) ?? fail('NOT_FOUND', 'APPROVAL_NOT_FOUND');
  return approvalView(h, ctx.scope.environment, await sharedRuns(h, ctx.runtime, ctx.handoffs), null);
}

/** A run of an APPLIED approval of this project whose owner shares it, read AS that owner; anything else is not found. */
async function sharedRun(ctx: DeveloperContext, executionId: string) {
  const approvalId = await ctx.store.approvalForRun(ctx.scope, executionId) ?? fail('NOT_FOUND', 'EXECUTION_NOT_FOUND');
  const h = await ctx.handoffs.forRequester(approvalId, requesterOf(ctx), ctx.now);
  if (!h || h.status !== 'APPLIED' || !h.shareStatus || !h.claimed || !h.runIds.includes(executionId)) return fail('NOT_FOUND', 'EXECUTION_NOT_FOUND');
  try { return { found: await findOwnedRun(ctx.runtime, [h.claimed.address], executionId), approvalId }; }
  // An absent run, another wallet's run and a run the owner stopped sharing are indistinguishable.
  catch (error) { const e = classify(error); throw e.code === 'NOT_FOUND' ? new DeveloperError('NOT_FOUND', 'EXECUTION_NOT_FOUND') : e; }
}
export async function getExecution(ctx: DeveloperContext, executionId: string): Promise<ExecutionBody> {
  const { found, approvalId } = await sharedRun(ctx, executionId);
  return executionView(found, approvalId);
}
export async function getEvidence(ctx: DeveloperContext, executionId: string): Promise<EvidenceBody> {
  const { found, approvalId } = await sharedRun(ctx, executionId);
  try { return evidenceView(await ownerEvidence(ctx.runtime, found, executionId, 'OWNER_SHARED_WITH_PROJECT'), approvalId); } catch (error) { throw classify(error); }
}

export async function createWebhookEndpoint(ctx: DeveloperContext, body: { url: string; events?: readonly DeveloperEventType[] }): Promise<WebhookEndpointBody> {
  const check = webhookUrlCheck(body.url, ctx.config.webhookLoopback);
  if (!check.ok) return fail('INVALID_REQUEST', check.reason);
  const endpoint = await ctx.store.createEndpoint(ctx.scope, check.url, body.events ?? [], ctx.limits.webhookEndpoints, ctx.now) ?? fail('FORBIDDEN', 'WEBHOOK_ENDPOINT_LIMIT');
  return endpointView(endpoint, webhookSecret(ctx.config, ctx.tenantId, endpoint.endpointId), false);
}
/** Deletes an endpoint: its secret is never used again and its pending deliveries end. Rotation = create a new one, then delete this. */
export async function deleteWebhookEndpoint(ctx: DeveloperContext, endpointId: string): Promise<DeletedBody> {
  if (!await ctx.store.deleteEndpoint(ctx.scope, endpointId, ctx.now)) fail('NOT_FOUND', 'WEBHOOK_ENDPOINT_NOT_FOUND');
  return { id: endpointId, object: 'webhook_endpoint', deleted: true };
}
