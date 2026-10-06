// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: the FloFi MCP tools (names follow Master Spec §14.7). One `McpServer` per HTTP request, built for one
 * authenticated principal. Every tool is read-only with respect to funds and authority:
 *
 *   discovery      get_supported_networks, get_supported_assets, get_capabilities   (registries + deployment enablement)
 *   authoring      compose_strategy, validate_strategy, review_strategy               (pure deterministic facade, no state)
 *   preview        simulate_strategy                                                  (the flow's own simulation, nothing persisted)
 *   observation    get_execution_status, get_evidence                                 (owner-scoped durable reads)
 *
 * There is no tool that submits, signs, authorizes a Review, begins/hands off/reports an attempt, invalidates, recovers or
 * accepts calldata, contract addresses, keys or seed phrases. Inputs are closed schemas; outputs pass `assertSafeOutput`.
 * A FloFi-owned model is never called: the client's own model interprets language, FloFi only computes.
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { McpServer, type CallToolResult, type StandardSchemaWithJSON, type ToolAnnotations } from '@modelcontextprotocol/server';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { codeCapabilities, supportedAssets, supportedNetworks } from '../engine/capability-catalog';
import { composeWorkflowBound, reviewComposition, type Composition, type WorkflowComposition } from '../engine/strategy-engine';
import { compileSchema, MAX_WORKFLOW_STEPS, NETWORK_IDS, STRATEGY_ACTIONS, strategyInputIssues, StrategyInputSchema } from '../engine/strategy-spec';
import { principalScopes, type McpOAuthPrincipal, type McpPrincipal } from './config.ts';
import { PANEL_MIME, PANEL_URI, panelHtml, panelResourceMeta } from './app/panel.ts';
import { evaluateGates, readHandoffPolicy, workflowPlan, type HandoffPolicy } from './execution.ts';
import { APPROVAL_SESSION_SECONDS, approvalProgress, approvalUrl, AUTHORITY_NONE, requestApproval } from './handoff/service.ts';
import { credentialDigest, newCredential } from './oauth/crypto.ts';
import type { McpScope, OAuthConfig } from './oauth/config.ts';
import type { McpState } from './oauth/state.ts';
import type { McpRuntime } from './runtime.ts';
import { assertSafeOutput, previewPlan, projectSimulation, strategyFlow } from './simulation.ts';

export const MCP_SERVER_VERSION = '0.1.0';
export const MCP_TOOL_NAMES = Object.freeze(['get_supported_networks', 'get_supported_assets', 'get_capabilities', 'compose_strategy', 'validate_strategy',
  'simulate_strategy', 'review_strategy', 'get_execution_status', 'get_evidence'] as const);
export const MCP_INSTRUCTIONS = 'FloFi composes, validates, previews and explains DeFi strategies with its deterministic engine. You interpret the user; ' +
  'FloFi computes. Nothing here moves funds or authorizes anything: no tool signs, submits or approves. Execution needs the owner to open the FloFi app, ' +
  're-simulate, review the Strategy Manifest and sign with their own wallet. Carry the `strategy` and `workflowHash` from compose_strategy into later calls. ' +
  'Never ask the user for a private key or seed phrase.';

/**
 * TypeBox + Ajv (the repo's strict schema stack) behind the Standard Schema interface the SDK consumes. Issues name paths and
 * rules only, never values; a `strategy` is reported against its own action's schema rather than every union branch.
 */
function standard<T>(schema: TSchema): StandardSchemaWithJSON<T, T> {
  const compiled = compileSchema<T>(schema), json = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const issuesOf = (value: unknown) => {
    const all = compiled.issues(value), strategy = value && typeof value === 'object' ? (value as { strategy?: unknown }).strategy : undefined;
    const inStrategy = (i: { path: string }) => i.path === '/strategy' || i.path.startsWith('/strategy/');
    if (strategy === undefined || !all.some(inStrategy)) return all;
    return [...all.filter(i => !inStrategy(i)), ...strategyInputIssues(strategy).map(i => ({ path: '/strategy' + (i.path === '/' ? '' : i.path), rule: i.rule }))];
  };
  return { '~standard': { version: 1, vendor: 'flofi',
    validate: value => compiled.check(value) ? { value: value as T } : { issues: issuesOf(value).map(i => ({ message: `${i.path} ${i.rule}`, path: i.path.split('/').filter(Boolean) })) },
    jsonSchema: { input: () => json, output: () => json } } };
}
const strict = { additionalProperties: false } as const;
const pure = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const Hash = Type.String({ pattern: '^0x[0-9a-f]{64}$', description: 'The workflowHash returned by compose_strategy.' });
const ExecutionId = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$', description: 'A FloFi execution (run) id. It is a lookup key, not an access grant.' });
const NetworkFilter = Type.Union(NETWORK_IDS.map(n => Type.Literal(n)), { description: 'Network identifier.' });
const Schemas = {
  none: Type.Object({}, strict),
  assets: Type.Object({ network: Type.Optional(NetworkFilter) }, strict),
  capabilities: Type.Object({ network: Type.Optional(NetworkFilter), action: Type.Optional(Type.Union(STRATEGY_ACTIONS.map(a => Type.Literal(a)))) }, strict),
  compose: Type.Object({ strategy: StrategyInputSchema }, strict),
  bound: Type.Object({ strategy: StrategyInputSchema, workflowHash: Type.Optional(Hash) }, strict),
  simulate: Type.Object({ strategy: StrategyInputSchema, workflowHash: Hash,
    simulationSubject: Type.String({ pattern: '^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$',
      description: 'The account whose PUBLIC balances and allowances the read-only simulation uses (EVM address or Solana public key). It is not authenticated, ' +
        'not an owner and grants nothing; nothing is stored for it.' }) }, strict),
  status: Type.Object({ executionId: ExecutionId, journalAfter: Type.Optional(Type.Integer({ minimum: -1, maximum: 2_147_483_647 })),
    journalLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }, strict),
  evidence: Type.Object({ executionId: ExecutionId }, strict),
};

/**
 * BUILD-MCP-002: the OAuth scope each tool needs. The gateway enforces it at the HTTP level (403 `insufficient_scope`); each
 * handler checks it again. A static developer credential holds `flofi.strategy` and `flofi.runs` (BUILD-MCP-001's surface).
 */
/**
 * BUILD-MCP-002: the approval tools, registered only for an OAuth account (a static credential has no account to hand anything to).
 * `open_approval_session` and `get_execution_progress` are app-only (MCP Apps visibility `["app"]`): the in-chat panel calls them,
 * the model never sees them.
 */
export const APPROVAL_TOOL_NAMES = Object.freeze(['request_user_approval', 'get_approval_status', 'open_approval_session', 'get_execution_progress'] as const);
export const APP_ONLY_TOOLS: readonly ToolName[] = Object.freeze(['open_approval_session', 'get_execution_progress']);
export type ToolName = (typeof MCP_TOOL_NAMES)[number] | (typeof APPROVAL_TOOL_NAMES)[number];
export const TOOL_SCOPES: Readonly<Record<ToolName, McpScope>> = Object.freeze({
  get_supported_networks: 'flofi.strategy', get_supported_assets: 'flofi.strategy', get_capabilities: 'flofi.strategy', compose_strategy: 'flofi.strategy',
  validate_strategy: 'flofi.strategy', simulate_strategy: 'flofi.strategy', review_strategy: 'flofi.strategy', get_execution_status: 'flofi.runs', get_evidence: 'flofi.runs',
  request_user_approval: 'flofi.approval', get_approval_status: 'flofi.approval', open_approval_session: 'flofi.approval', get_execution_progress: 'flofi.approval' });

export type ToolEvent = { readonly tool: string; readonly outcome: string; readonly durationMs: number };
export type ToolContext = { readonly principal: McpPrincipal; readonly runtime: McpRuntime; readonly onTool?: (event: ToolEvent) => void; readonly now?: () => number;
  /** BUILD-MCP-002: present for OAuth deployments. */
  readonly oauth?: OAuthConfig; readonly state?: McpState;
  /** BUILD-MCP-002: the MCP handoff policy (default: test funds only, every mainnet off). */
  readonly policy?: HandoffPolicy;
  /** BUILD-MCP-002: the in-chat MCP App panel attached to request_user_approval, when enabled. */
  readonly ui?: { readonly resourceUri: string; readonly inFrameProbeHosts: readonly string[] } | null };
type Output = Record<string, unknown>;
class ToolFailure extends Error {}
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const failWith = (code: string, extra: Output = {}): never => { throw Object.assign(new ToolFailure(code), { extra }); };
const AUTHORITY = 'NONE: this result authorizes nothing. Only the owner, in the FloFi app, can review the Strategy Manifest and sign with their own wallet.';

const DEFAULT_POLICY = readHandoffPolicy({});
/** BUILD-MCP-002: why this principal may read a run: an operator grant (static credential) or a wallet the account linked on FloFi. */
const accessBasis = (ctx: ToolContext) => ctx.principal.kind === 'mcp-oauth' ? 'ACCOUNT_LINKED_WALLET' : 'OPERATOR_GRANTED_WALLET';
/** BUILD-MCP-002: an approval handoff needs an OAuth account with the `flofi.approval` scope (a static credential has no account). */
const canRequestApproval = (ctx: ToolContext) => ctx.principal.kind === 'mcp-oauth' && ctx.principal.scopes.includes('flofi.approval') && Boolean(ctx.state);
/** One mode/info lookup per flow per call. */
function memoizedRuntime(runtime: McpRuntime): McpRuntime {
  const modes = new Map<string, ReturnType<McpRuntime['mode']>>(), infos = new Map<string, ReturnType<NonNullable<McpRuntime['info']>>>();
  return { ...runtime, mode: flow => { if (!modes.has(flow)) modes.set(flow, runtime.mode(flow)); return modes.get(flow)!; },
    info: flow => { if (!infos.has(flow)) infos.set(flow, runtime.info?.(flow) ?? Promise.resolve(null)); return infos.get(flow)!; } };
}

/** Simulations reach public chains and providers: a small per-instance cap protects them (best effort, never a correctness rule). */
const MAX_CONCURRENT_SIMULATIONS = 2;
let activeSimulations = 0;

/** BUILD-MCP-002: a v1 strategy or a v2 step list; one step is exactly the v1 composition. */
function composedWorkflow(strategy: unknown, workflowHash: string | undefined): WorkflowComposition {
  const result = composeWorkflowBound(strategy, workflowHash);
  return result.ok ? result : failWith(result.code, { issues: result.issues });
}
/** The single-step composition, or a refusal naming the per-step alternative (used by tools that work on one action). */
function composed(strategy: unknown, workflowHash: string | undefined, multiStepCode: string): Composition {
  const workflow = composedWorkflow(strategy, workflowHash);
  return workflow.steps.length === 1 ? workflow.steps[0]! : failWith(multiStepCode, { stepCount: workflow.steps.length });
}
const MULTI_STEP_PLAN = { kind: 'NOT_EXECUTABLE', reason: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED',
  note: 'Each step can be composed, reviewed and previewed on its own; executing a general sequence needs the sequential runner (not yet available).' } as const;
const reviewCounts = (findings: readonly { level: string }[]) => ({ block: findings.filter(f => f.level === 'BLOCK').length, warning: findings.filter(f => f.level === 'WARNING').length,
  information: findings.filter(f => f.level === 'INFORMATION').length });
const stepsOf = (c: Composition) => c.steps.map(s => ({ index: s.index, nodeId: s.nodeId, kind: s.kind, protocol: s.protocol, network: s.network, testFunds: s.testFunds,
  failurePolicy: s.failurePolicy, authorizationClass: s.authorization, detail: s.detail }));
const ownedRun = async (ctx: ToolContext, executionId: string) => {
  for (const wallet of ctx.principal.wallets) {
    const result = await ctx.runtime.run(executionId, wallet);
    if (!result.ok) failWith(result.code);
    if (result.ok && result.value) return { run: result.value, owner: wallet };
  }
  // Absent and not-granted are indistinguishable: an execution id is never an access grant.
  return failWith('RUN_NOT_FOUND');
};
const pickRow = (value: unknown, keys: readonly string[]) => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}, out: Output = {};
  for (const key of keys) { const v = source[key]; if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[key] = v; else if (v instanceof Date) out[key] = v.toISOString(); }
  return out;
};

export function createFlofiMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'flofi', title: 'FloFi', version: MCP_SERVER_VERSION }, { instructions: MCP_INSTRUCTIONS });
  const now = ctx.now ?? (() => performance.now());
  const register = <S extends TSchema>(name: ToolName, title: string, description: string, schema: S, annotations: ToolAnnotations,
    run: (args: Static<S>) => Promise<Output> | Output, toolMeta: Record<string, unknown> = {}) => {
    const scope = TOOL_SCOPES[name];
    // OAuth clients read `securitySchemes` to know which scope to request before calling (ChatGPT reads the `_meta` mirror).
    const security = ctx.oauth ? { securitySchemes: [{ type: 'oauth2', scopes: [scope] }] } : {};
    const meta = Object.keys(security).length || Object.keys(toolMeta).length ? { _meta: { ...security, ...toolMeta } } : {};
    server.registerTool(name, { title, description, inputSchema: standard<Static<S>>(schema), annotations: { title, ...annotations }, ...meta }, async (args: Static<S>): Promise<CallToolResult> => {
      const started = now();
      let result: CallToolResult, outcome = 'OK';
      try {
        if (!principalScopes(ctx.principal).includes(scope)) failWith('MCP_INSUFFICIENT_SCOPE');
        const output = await run(args);
        assertSafeOutput(output);
        result = { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
      } catch (error) {
        outcome = error instanceof Error && CODE.test(error.message) ? error.message : 'MCP_INTERNAL_ERROR';
        const body = { ok: false, code: outcome, ...error instanceof ToolFailure ? (error as ToolFailure & { extra: Output }).extra : {} };
        result = { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body, isError: true };
      }
      ctx.onTool?.({ tool: name, outcome, durationMs: Math.round(now() - started) });
      return result;
    });
  };

  register('get_supported_networks', 'Supported networks', 'Networks FloFi can author strategies for, with CAIP-2 ids, mainnet/testnet/devnet class and the actions available. ' +
    'Derived from FloFi\'s registries.', Schemas.none, pure, () => ({ ok: true, networks: supportedNetworks() }));

  register('get_supported_assets', 'Supported assets', 'Assets a strategy may name, per network, with the exact token address or mint, decimals and the actions that use ' +
    'each. One symbol can be two different tokens on one network (e.g. Base Sepolia Aave USDC vs Circle test USDC).', Schemas.assets, pure,
  args => ({ ok: true, assets: supportedAssets(args.network) }));

  register('get_capabilities', 'Capabilities', 'For each action × network: what FloFi code supports (from the execution capability registry on the composed IR), the evidence ' +
    'it has actually demonstrated, whether this deployment enables it, whether policy allows handing it to its owner for approval, and what this MCP server can do ' +
    '(compose, validate, review, preview, request the owner\'s approval — never execute). Mainnet may be supported by code yet disabled by policy.',
  Schemas.capabilities, { ...pure, idempotentHint: false }, async args => {
    const rows = codeCapabilities().filter(r => (!args.network || r.network === args.network || r.destinationNetwork === args.network) && (!args.action || r.action === args.action));
    const runtime = memoizedRuntime(ctx.runtime), cloud = ctx.runtime.kind === 'remote' || ctx.runtime.kind === 'embedded', approvals = canRequestApproval(ctx);
    return { ok: true, runtime: ctx.runtime.kind, mcpExecution: 'NOT_AVAILABLE', ownerExecution: 'IN_FLOFI_WITH_THE_OWNER_WALLET_ONLY',
      stepLists: { contract: 'strategy version 2: {version: 2, steps: [...]}', maxSteps: MAX_WORKFLOW_STEPS, oneStep: 'identical to version 1 (same strategy, same hash)',
        executableToday: ['every one-action path whose row below can be handed off', 'supply → borrow → swap on base-sepolia (the lending composition)'],
        otherSequences: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED: composed, reviewed and previewed per step; executed by the sequential runner once available' },
      capabilities: await Promise.all(rows.map(async r => {
        const plan = previewPlan(r.example), flow = strategyFlow(r.example), mode = flow ? await runtime.mode(flow) : null;
        const previewable = 'flow' in plan && cloud && (mode === 'live' || mode === 'harness');
        const composition = composed(r.example, undefined, 'CAPABILITY_EXAMPLE_INVALID'), gates = await evaluateGates(composition, runtime, ctx.policy ?? DEFAULT_POLICY);
        return { action: r.action, network: r.network, destinationNetwork: r.destinationNetwork, funds: r.funds, actionTypes: r.actionTypes, adapters: r.adapters,
          supportedByCode: { publicEnvironment: r.publicEnvironment, dimensions: r.supportedByCode, ownerWalletExecutionImplemented: r.ownerWalletExecutionImplemented,
            registryEnvironments: r.registryEnvironments, execute: gates.supportedByCode.execute, executionPlan: gates.plan.kind, steps: gates.plan.steps.length,
            reason: gates.supportedByCode.reason },
          enabledByDeployment: gates.enabledByDeployment, enabledByPolicy: gates.enabledByPolicy,
          demonstratedEvidence: r.demonstratedEvidence ?? 'NONE_DEMONSTRATED',
          deployment: { flow, mode: mode ?? 'UNKNOWN_IN_LOCAL_RUNTIME', enabled: mode === 'live' || mode === 'harness', mockedHarness: mode === 'harness' },
          mcp: { compose: true, validate: true, review: true, simulate: previewable, simulateUnavailableReason: previewable ? null : 'code' in plan ? plan.code
            : !cloud ? (ctx.runtime.kind === 'local' ? 'MCP_CLOUD_RUNTIME_REQUIRED' : 'CLOUD_RUNTIME_NOT_CONFIGURED') : 'FLOW_NOT_ENABLED_IN_DEPLOYMENT', execute: false,
            approvalHandoff: approvals && gates.handoff.allowed, approvalHandoffUnavailableReason: !approvals ? 'MCP_ACCOUNT_REQUIRED' : gates.handoff.reason },
          example: r.example };
      })) };
  });

  register('compose_strategy', 'Compose strategy', 'Deterministically turn structured intent into FloFi\'s canonical Semantic Workflow IR (revision 1), using the same ' +
    'authoring rules as the FloFi app. Unsupported or ambiguous input is refused with a code, never guessed. Keep `strategy` (normalized) and `workflowHash` for ' +
    'validate/simulate/review. The model must not invent addresses: use only values the user gave. A multi-step workflow is `{version: 2, steps: [...]}` ' +
    '(one step is the same as version 1); each step keeps its own IR and hash.', Schemas.compose, pure, args => {
    const w = composedWorkflow(args.strategy, undefined);
    if (w.steps.length === 1) {
      const c = w.steps[0]!, plan = workflowPlan(w);
      return { ok: true, strategy: c.strategy, workflowHash: c.workflowHash, revision: c.workflow.revision, fundsClass: c.fundsClass, workflow: c.workflow,
        steps: stepsOf(c), explanation: c.explanation, summary: c.summary, notes: c.notes, authority: AUTHORITY, stepCount: 1,
        executionPlan: { kind: plan.kind, reason: plan.reason },
        nextSteps: ['validate_strategy or review_strategy with this strategy and workflowHash', 'simulate_strategy for a read-only preview (optional)',
          'request_user_approval to hand it to its owner in FloFi (when available); nothing executes from MCP.'] };
    }
    return { ok: true, strategy: w.strategy, workflowHash: w.workflowHash, fundsClass: w.fundsClass, stepCount: w.steps.length, executionPlan: MULTI_STEP_PLAN,
      workflowSteps: w.steps.map((c, index) => ({ index, action: c.strategy.action, strategy: c.strategy, workflowHash: c.workflowHash, revision: c.workflow.revision,
        fundsClass: c.fundsClass, workflow: c.workflow, steps: stepsOf(c), summary: c.summary, explanation: c.explanation })),
      notes: w.notes, authority: AUTHORITY,
      nextSteps: ['review_strategy for every step\'s findings', 'simulate_strategy one step at a time (pass that step as a version 1 strategy)',
        'Executing a general sequence is not available yet (MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED).'] };
  });

  register('validate_strategy', 'Validate strategy', 'Check a strategy against FloFi\'s authoring rules (networks, assets, amounts, limits) and, when given, the workflowHash ' +
    'from compose_strategy (a mismatch means the strategy changed or FloFi\'s rules changed: compose again).', Schemas.bound, pure, args => {
    const result = composeWorkflowBound(args.strategy, args.workflowHash);
    if (!result.ok) return { ok: true, valid: false, code: result.code, issues: result.issues };
    const findings = result.steps.flatMap(c => reviewComposition(c).findings), counts = reviewCounts(findings);
    return { ok: true, valid: true, workflowHash: result.workflowHash, fundsClass: result.fundsClass, notes: result.notes, stepCount: result.steps.length,
      reviewSummary: { block: counts.block, warning: counts.warning } };
  });

  register('review_strategy', 'Review strategy', 'FloFi\'s deterministic Strategy Review: linter findings, capability blockers for the network\'s public environment and ' +
    'strategy warnings, as BLOCK / WARNING / INFORMATION. It explains; it never approves or authorizes.', Schemas.bound, { ...pure, idempotentHint: false }, async args => {
    const w = composedWorkflow(args.strategy, args.workflowHash);
    if (w.steps.length > 1) {
      const reviews = w.steps.map(c => reviewComposition(c)), all = reviews.flatMap(r => r.findings);
      return { ok: true, workflowHash: w.workflowHash, reviewKind: 'DETERMINISTIC_STRATEGY_REVIEW', authority: AUTHORITY, stepCount: w.steps.length,
        summary: reviewCounts(all), executionPlan: MULTI_STEP_PLAN,
        workflowSteps: reviews.map((review, index) => ({ index, workflowHash: w.steps[index]!.workflowHash, environment: review.environment, summary: reviewCounts(review.findings),
          findings: review.findings, capability: review.capability })),
        nextSteps: ['Each step is reviewed, simulated and signed on its own in FloFi; a general sequence cannot be executed yet.'] };
    }
    const c = w.steps[0]!, review = reviewComposition(c), flow = strategyFlow(c.strategy);
    const mode = flow ? await ctx.runtime.mode(flow) : null;
    return { ok: true, workflowHash: c.workflowHash, reviewKind: 'DETERMINISTIC_STRATEGY_REVIEW', authority: AUTHORITY, environment: review.environment,
      summary: { block: review.findings.filter(f => f.level === 'BLOCK').length, warning: review.findings.filter(f => f.level === 'WARNING').length,
        information: review.findings.filter(f => f.level === 'INFORMATION').length },
      findings: review.findings, capability: review.capability,
      deployment: { flow, mode: mode ?? 'UNKNOWN_IN_LOCAL_RUNTIME' },
      nextSteps: ['A fresh simulation (simulate_strategy previews it; the FloFi app runs the authoritative one).',
        'The owner reviews the route-bound Strategy Manifest in the FloFi app and signs with their own wallet. MCP cannot do either.'] };
  });

  register('simulate_strategy', 'Simulate strategy (read-only preview)', 'Run FloFi\'s own simulation for this exact workflow — live quotes, chain reads and transaction ' +
    'simulation where the flow supports it — as a read-only preview. Nothing is stored, nothing is signed or sent, and the result cannot be authorized. ' +
    '`simulationSubject` is only the account whose public balances the simulation reads. Calldata and transactions are never returned.',
  Schemas.simulate, { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }, async args => {
    const c = composed(args.strategy, args.workflowHash, 'SIMULATE_ONE_STEP_AT_A_TIME'), plan = previewPlan(c.strategy);
    if ('code' in plan) return failWith(plan.code);
    const evm = /^0x[0-9a-fA-F]{40}$/.test(args.simulationSubject);
    if (plan.subject === 'EVM' && !evm || plan.subject === 'SOLANA' && evm) return failWith('SIMULATION_SUBJECT_INVALID');
    if (activeSimulations >= MAX_CONCURRENT_SIMULATIONS) return failWith('MCP_SIMULATION_BUSY');
    activeSimulations++;
    let preview;
    try {
      const subject = evm ? args.simulationSubject.toLowerCase() : args.simulationSubject;
      preview = await ctx.runtime.preview(plan.flow, plan.subject === 'NONE' ? [c.workflow] : [c.workflow, subject]);
    } finally { activeSimulations--; }
    if (!preview.ok) return failWith(preview.code);
    const view = projectSimulation(plan.flow, preview.value);
    return { ok: true, workflowHash: c.workflowHash, flow: plan.flow, kind: view.kind, provenance: view.provenance, observedAt: view.observedAt, expiresAt: view.expiresAt,
      simulationSubject: plan.subject === 'NONE' ? null : args.simulationSubject, subjectRole: 'SIMULATION_SUBJECT_ONLY_NOT_AN_OWNER_OR_AUTHORIZATION',
      preview: true, persisted: false, authorizable: false, evidenceLevel: view.provenance === 'MOCKED' ? 'MOCKED_SIMULATION_PREVIEW' : 'SIMULATION_PREVIEW_NOT_EXECUTION',
      facts: view.facts, canonicalArtifacts: view.canonicalArtifacts, authority: AUTHORITY,
      notes: ['Amounts are integer native units of the named tokens.', 'Quotes and state expire; the FloFi app re-simulates before any Review.',
        'A simulation is evidence of what would happen at the observed block, not a guarantee and not an execution.'] };
  });

  register('get_execution_status', 'Execution status', 'Status, attempts and journal page of one FloFi execution, read from FloFi\'s durable state. Visible only when its ' +
    'owner wallet is one the deployment owner granted to this MCP credential; otherwise it is reported as not found.', Schemas.status, { ...pure, idempotentHint: false }, async args => {
    const { run, owner } = await ownedRun(ctx, args.executionId);
    const page = await ctx.runtime.journal(args.executionId, owner, args.journalAfter ?? null, args.journalLimit ?? 25);
    if (!page.ok) return failWith(page.code);
    return { ok: true, executionId: run.runId, flow: run.flow, status: run.status, provenance: run.provenance, owner, accessBasis: accessBasis(ctx),
      ...pickRow(run, ['errorCode', 'needsObservation', 'attentionRequired', 'hasEvidence', 'createdAt', 'updatedAt']),
      attempts: (Array.isArray(run.attempts) ? run.attempts : []).slice(0, 64).map(a => pickRow(a, ['attemptId', 'step', 'state', 'transactionHash', 'reconciled', 'preparedAtBlock', 'updatedAt'])),
      journal: { items: (page.value?.items ?? []).map(e => pickRow(e, ['sequence', 'entryHash', 'level', 'entityId', 'attemptId', 'fromState', 'toState', 'recordedAt'])),
        next: page.value?.next ?? null },
      notes: ['FloFi\'s canonical durable state; a partner or agent display is only a projection of it.'] };
  });

  register('get_evidence', 'Execution evidence', 'The reconciled Evidence Bundle of one FloFi execution with its own environment (MOCKED, TESTNET_EXECUTED, …) and outcome, ' +
    'exactly as FloFi recorded them. Owner-scoped like get_execution_status.', Schemas.evidence, { ...pure, idempotentHint: false }, async args => {
    const { run, owner } = await ownedRun(ctx, args.executionId);
    const base = { ok: true, executionId: run.runId, flow: run.flow, provenance: run.provenance, status: run.status, owner, accessBasis: accessBasis(ctx) };
    if (!run.hasEvidence) return { ...base, evidence: null, reason: 'NO_RECONCILED_EVIDENCE_YET' };
    const record = await ctx.runtime.evidence(run.flow as Parameters<McpRuntime['evidence']>[0], args.executionId, owner);
    if (!record.ok) return failWith(record.code);
    if (!record.value) return { ...base, evidence: null, reason: 'NO_RECONCILED_EVIDENCE_YET' };
    const content = record.value.content as { bundle?: unknown; evidence?: unknown } | null;
    let bundle: unknown = null;
    for (const candidate of [content?.bundle, content?.evidence]) { try { bundle = validateArtifact('evidence-bundle', candidate); break; } catch { /* next */ } }
    return { ...base, evidence: { bundleHash: record.value.bundleHash, environment: record.value.environment, outcome: record.value.outcome,
      canonicalBundle: bundle, canonical: bundle !== null }, notes: ['Environment and outcome are copied from the Evidence Bundle; MCP never upgrades them.'] };
  });
  if (ctx.principal.kind === 'mcp-oauth' && ctx.state && ctx.oauth) {
    registerApprovalTools(ctx, register);
    if (ctx.ui) {
      const meta = panelResourceMeta(ctx.oauth.origin), html = panelHtml({ origin: ctx.oauth.origin, inFrameProbeHosts: ctx.ui.inFrameProbeHosts });
      server.registerResource('flofi-approval-panel', PANEL_URI, { title: 'FloFi approval', description: 'The in-chat FloFi approval panel.', mimeType: PANEL_MIME, _meta: meta },
        async () => ({ contents: [{ uri: PANEL_URI, mimeType: PANEL_MIME, text: html, _meta: meta }] }));
    }
  }
  return server;
}

type Register = <S extends TSchema>(name: ToolName, title: string, description: string, schema: S, annotations: ToolAnnotations,
  run: (args: Static<S>) => Promise<Output> | Output, toolMeta?: Record<string, unknown>) => void;
const ApprovalId = Type.String({ pattern: '^apr_[a-z2-7]{26}$', description: 'The approvalId returned by request_user_approval.' });
const ApprovalSchemas = {
  request: Type.Object({ strategy: StrategyInputSchema, workflowHash: Hash }, strict),
  byId: Type.Object({ approvalId: ApprovalId }, strict),
};
/** BUILD-MCP-002: the bridge to the owner's own wallet in FloFi. Every result carries authority NONE. */
function registerApprovalTools(ctx: ToolContext, register: Register) {
  const deps = () => ({ config: ctx.oauth!, state: ctx.state!, runtime: ctx.runtime, policy: ctx.policy ?? DEFAULT_POLICY, now: new Date() });
  const principal = ctx.principal as McpOAuthPrincipal;
  const owned = async (approvalId: string) => await ctx.state!.handoffs.forAccount(approvalId, principal.accountId, new Date()) ?? failWith('APPROVAL_NOT_FOUND');
  const ui = ctx.ui ?? null, appOnly = { ui: { visibility: ['app'] } };

  register('request_user_approval', 'Request the owner\'s approval', 'Hand a composed strategy (with its workflowHash) to its owner for execution in FloFi. ' +
    'FloFi re-composes and re-checks it, then returns an approval link with authority NONE. Nothing is authorized, signed or sent: the owner must open FloFi, ' +
    'prove their wallet, run a fresh simulation, review the Strategy Manifest and sign with their own wallet. Show the user the approvalUrl (or the FloFi panel). ' +
    'Mainnet may be disabled by policy; general multi-step sequences are not executable yet.', ApprovalSchemas.request,
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, async args => {
    const result = await requestApproval(deps(), principal, args.strategy, args.workflowHash);
    if (!result.ok) return failWith(result.code, result.extra ?? {});
    return { ok: true, ...result.value, message: 'Nothing is authorized yet. Open the FloFi link to prove your wallet, re-simulate, review the Strategy Manifest ' +
      'and sign with your own wallet. The link expires soon and works once.' };
  }, ui ? { ui: { resourceUri: ui.resourceUri }, 'openai/outputTemplate': ui.resourceUri, 'openai/toolInvocation/invoking': 'Preparing approval…',
    'openai/toolInvocation/invoked': 'Approval ready' } : {});

  register('get_approval_status', 'Approval status', 'The status of an approval request this account created: PENDING, CLAIMED, APPLIED, EXPIRED, SUPERSEDED, ' +
    'REVOKED or STALE. It never reveals the wallet that claimed it and never authorizes anything.', ApprovalSchemas.byId, { ...pure, idempotentHint: false },
  async args => ({ ok: true, ...await approvalProgress(await owned(args.approvalId), ctx.runtime, ctx.state!.handoffs) }));

  register('open_approval_session', 'Open FloFi approval', 'App-only: a fresh, short-lived FloFi link for this approval (for the signing window or a wallet ' +
    'in-app browser). The link only shows the proposal; it authorizes nothing.', ApprovalSchemas.byId, { readOnlyHint: false, destructiveHint: false,
    idempotentHint: false, openWorldHint: false }, async args => {
    const secret = newCredential('handoff'), expiresAt = new Date(Date.now() + APPROVAL_SESSION_SECONDS * 1000);
    const h = await ctx.state!.handoffs.openSession(args.approvalId, principal.accountId, credentialDigest(ctx.oauth!.keys.handoff, secret), expiresAt, new Date());
    if (!h) return failWith('APPROVAL_NOT_FOUND');
    if (h.status !== 'PENDING' && h.status !== 'CLAIMED') return failWith(`APPROVAL_${h.status}`);
    const url = approvalUrl(ctx.oauth!, secret);
    return { ok: true, approvalId: h.handoffId, approvalUrl: url, expiresAt: expiresAt.toISOString(), authority: AUTHORITY_NONE,
      walletLinks: walletDeepLinks(url, ctx.oauth!.origin) };
  }, appOnly);

  register('get_execution_progress', 'Execution progress', 'App-only: the approval\'s state and, when its owner shares it, the status of the runs started from it.',
    ApprovalSchemas.byId, { ...pure, idempotentHint: false }, async args => ({ ok: true, ...await approvalProgress(await owned(args.approvalId), ctx.runtime, ctx.state!.handoffs) }), appOnly);
}
/** Mobile wallets open FloFi in their own in-app browser, where their provider is injected. The fragment stays inside the encoded URL. */
export function walletDeepLinks(url: string, origin: string) {
  return { phantom: `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(origin)}`,
    metamask: `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, '')}` };
}
