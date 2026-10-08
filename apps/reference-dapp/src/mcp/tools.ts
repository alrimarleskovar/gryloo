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
import { supportedAssets, supportedNetworks } from '../engine/capability-catalog';
import { compileSchema, MAX_WORKFLOW_STEPS, NETWORK_IDS, STRATEGY_ACTIONS, strategyInputIssues, StrategyInputSchema } from '../engine/strategy-spec';
import { approvalForRequester, approvalProgress, capabilityFacts, composeWorkflowOrRefuse, evidenceView, executionStatusView, findOwnedRun, MULTI_STEP_PLAN,
  openApprovalSession, PlatformRefusal, refuse, requestApproval, reviewWorkflow, simulatePreview, stepViews, validateStrategy, type ApprovalDeps,
  type ApprovalRequester } from '../platform/index.ts';
import { principalScopes, type McpOAuthPrincipal, type McpPrincipal } from './config.ts';
import { PANEL_MIME, PANEL_URI, panelHtml, panelResourceMeta } from './app/panel.ts';
import { MCP_HANDOFF_RULES, mcpApprovalLinkScheme } from './approval-profile.ts';
import { readHandoffPolicy, workflowPlan, type HandoffPolicy } from './execution.ts';
import type { McpScope, OAuthConfig } from './oauth/config.ts';
import type { McpState } from './oauth/state.ts';
import type { McpRuntime } from './runtime.ts';
import { assertSafeOutput, strategyFlow } from './simulation.ts';

/** BUILD-DEVELOPER-001: the deep links moved to the shared approval service; re-exported for existing importers. */
export { walletDeepLinks } from '../platform/index.ts';

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
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
// BUILD-DEVELOPER-001: the engine operations live in the shared platform (`src/platform`); this file is the MCP surface over them.
const failWith = (code: string, extra: Output = {}): never => refuse(code, extra);
/** BUILD-DEVELOPER-001: the platform reports its own limits neutrally; MCP keeps the codes its clients already know. */
const MCP_CODES: Readonly<Record<string, string>> = Object.freeze({ SIMULATION_BUSY: 'MCP_SIMULATION_BUSY', SIMULATION_RATE_LIMITED: 'MCP_SIMULATION_RATE_LIMITED',
  HANDOFF_RATE_LIMITED: 'MCP_HANDOFF_RATE_LIMITED', HANDOFF_PENDING_LIMIT: 'MCP_HANDOFF_LIMIT' });
const mcpCode = (code: string) => Object.hasOwn(MCP_CODES, code) ? MCP_CODES[code]! : code;
const AUTHORITY = 'NONE: this result authorizes nothing. Only the owner, in the FloFi app, can review the Strategy Manifest and sign with their own wallet.';

const DEFAULT_POLICY = readHandoffPolicy({});
/** BUILD-MCP-002: why this principal may read a run: an operator grant (static credential) or a wallet the account linked on FloFi. */
const accessBasis = (ctx: ToolContext) => ctx.principal.kind === 'mcp-oauth' ? 'ACCOUNT_LINKED_WALLET' : 'OPERATOR_GRANTED_WALLET';
/** BUILD-MCP-002: an approval handoff needs an OAuth account with the `flofi.approval` scope (a static credential has no account). */
const canRequestApproval = (ctx: ToolContext) => ctx.principal.kind === 'mcp-oauth' && ctx.principal.scopes.includes('flofi.approval') && Boolean(ctx.state);

/** BUILD-MCP-002: an OAuth account's hourly simulation budget (on top of the platform's shared per-instance concurrency cap). */
export const SIMULATIONS_PER_ACCOUNT_HOUR = 30;

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
        outcome = error instanceof Error && CODE.test(error.message) ? mcpCode(error.message) : 'MCP_INTERNAL_ERROR';
        const body = { ok: false, code: outcome, ...error instanceof PlatformRefusal ? error.extra : {} };
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
    const approvals = canRequestApproval(ctx);
    return { ok: true, runtime: ctx.runtime.kind, mcpExecution: 'NOT_AVAILABLE', ownerExecution: 'IN_FLOFI_WITH_THE_OWNER_WALLET_ONLY',
      stepLists: { contract: 'strategy version 2: {version: 2, steps: [...]}', maxSteps: MAX_WORKFLOW_STEPS, oneStep: 'identical to version 1 (same strategy, same hash)',
        executableToday: ['every one-action path whose row below can be handed off', 'supply → borrow → swap on base-sepolia (the lending composition)'],
        otherSequences: 'MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED: composed, reviewed and previewed per step; executed by the sequential runner once available' },
      capabilities: (await capabilityFacts(ctx.runtime, ctx.policy ?? DEFAULT_POLICY, { network: args.network, action: args.action })).map(({ row: r, flow, mode, previewable,
        previewUnavailableReason, gates }) => {
        return { action: r.action, network: r.network, destinationNetwork: r.destinationNetwork, funds: r.funds, actionTypes: r.actionTypes, adapters: r.adapters,
          supportedByCode: { publicEnvironment: r.publicEnvironment, dimensions: r.supportedByCode, ownerWalletExecutionImplemented: r.ownerWalletExecutionImplemented,
            registryEnvironments: r.registryEnvironments, execute: gates.supportedByCode.execute, executionPlan: gates.plan.kind, steps: gates.plan.steps.length,
            reason: gates.supportedByCode.reason },
          enabledByDeployment: gates.enabledByDeployment, enabledByPolicy: gates.enabledByPolicy,
          demonstratedEvidence: r.demonstratedEvidence ?? 'NONE_DEMONSTRATED',
          deployment: { flow, mode: mode ?? 'UNKNOWN_IN_LOCAL_RUNTIME', enabled: mode === 'live' || mode === 'harness', mockedHarness: mode === 'harness' },
          mcp: { compose: true, validate: true, review: true, simulate: previewable, simulateUnavailableReason: previewUnavailableReason, execute: false,
            approvalHandoff: approvals && gates.handoff.allowed, approvalHandoffUnavailableReason: !approvals ? 'MCP_ACCOUNT_REQUIRED' : gates.handoff.reason },
          example: r.example };
      }) };
  });

  register('compose_strategy', 'Compose strategy', 'Deterministically turn structured intent into FloFi\'s canonical Semantic Workflow IR (revision 1), using the same ' +
    'authoring rules as the FloFi app. Unsupported or ambiguous input is refused with a code, never guessed. Keep `strategy` (normalized) and `workflowHash` for ' +
    'validate/simulate/review. The model must not invent addresses: use only values the user gave. A multi-step workflow is `{version: 2, steps: [...]}` ' +
    '(one step is the same as version 1); each step keeps its own IR and hash.', Schemas.compose, pure, args => {
    const w = composeWorkflowOrRefuse(args.strategy, undefined);
    if (w.steps.length === 1) {
      const c = w.steps[0]!, plan = workflowPlan(w);
      return { ok: true, strategy: c.strategy, workflowHash: c.workflowHash, revision: c.workflow.revision, fundsClass: c.fundsClass, workflow: c.workflow,
        steps: stepViews(c), explanation: c.explanation, summary: c.summary, notes: c.notes, authority: AUTHORITY, stepCount: 1,
        executionPlan: { kind: plan.kind, reason: plan.reason },
        nextSteps: ['validate_strategy or review_strategy with this strategy and workflowHash', 'simulate_strategy for a read-only preview (optional)',
          'request_user_approval to hand it to its owner in FloFi (when available); nothing executes from MCP.'] };
    }
    return { ok: true, strategy: w.strategy, workflowHash: w.workflowHash, fundsClass: w.fundsClass, stepCount: w.steps.length, executionPlan: MULTI_STEP_PLAN,
      workflowSteps: w.steps.map((c, index) => ({ index, action: c.strategy.action, strategy: c.strategy, workflowHash: c.workflowHash, revision: c.workflow.revision,
        fundsClass: c.fundsClass, workflow: c.workflow, steps: stepViews(c), summary: c.summary, explanation: c.explanation })),
      notes: w.notes, authority: AUTHORITY,
      nextSteps: ['review_strategy for every step\'s findings', 'simulate_strategy one step at a time (pass that step as a version 1 strategy)',
        'Executing a general sequence is not available yet (MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED).'] };
  });

  register('validate_strategy', 'Validate strategy', 'Check a strategy against FloFi\'s authoring rules (networks, assets, amounts, limits) and, when given, the workflowHash ' +
    'from compose_strategy (a mismatch means the strategy changed or FloFi\'s rules changed: compose again).', Schemas.bound, pure, args => {
    return { ok: true, ...validateStrategy(args.strategy, args.workflowHash) };
  });

  register('review_strategy', 'Review strategy', 'FloFi\'s deterministic Strategy Review: linter findings, capability blockers for the network\'s public environment and ' +
    'strategy warnings, as BLOCK / WARNING / INFORMATION. It explains; it never approves or authorizes.', Schemas.bound, { ...pure, idempotentHint: false }, async args => {
    const w = composeWorkflowOrRefuse(args.strategy, args.workflowHash), reviewed = reviewWorkflow(w);
    if (w.steps.length > 1) {
      return { ok: true, workflowHash: w.workflowHash, reviewKind: 'DETERMINISTIC_STRATEGY_REVIEW', authority: AUTHORITY, stepCount: w.steps.length,
        summary: reviewed.summary, executionPlan: MULTI_STEP_PLAN, workflowSteps: reviewed.steps,
        nextSteps: ['Each step is reviewed, simulated and signed on its own in FloFi; a general sequence cannot be executed yet.'] };
    }
    const c = w.steps[0]!, review = reviewed.steps[0]!, flow = strategyFlow(c.strategy);
    const mode = flow ? await ctx.runtime.mode(flow) : null;
    return { ok: true, workflowHash: c.workflowHash, reviewKind: 'DETERMINISTIC_STRATEGY_REVIEW', authority: AUTHORITY, environment: review.environment,
      summary: review.summary,
      findings: review.findings, capability: review.capability,
      deployment: { flow, mode: mode ?? 'UNKNOWN_IN_LOCAL_RUNTIME' },
      nextSteps: ['A fresh simulation (simulate_strategy previews it; the FloFi app runs the authoritative one).',
        'The owner reviews the route-bound Strategy Manifest in the FloFi app and signs with their own wallet. MCP cannot do either.'] };
  });

  register('simulate_strategy', 'Simulate strategy (read-only preview)', 'Run FloFi\'s own simulation for this exact workflow — live quotes, chain reads and transaction ' +
    'simulation where the flow supports it — as a read-only preview. Nothing is stored, nothing is signed or sent, and the result cannot be authorized. ' +
    '`simulationSubject` is only the account whose public balances the simulation reads. Calldata and transactions are never returned.',
  Schemas.simulate, { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true }, async args => {
    // BUILD-MCP-002: an OAuth account also has an hourly simulation budget (they reach public chains and providers).
    const account = ctx.principal.kind === 'mcp-oauth' ? ctx.principal.accountId : null, state = ctx.state;
    const { composition: c, plan, view, simulationSubject } = await simulatePreview(ctx.runtime, args, account && state
      ? { budget: () => state.oauth.allow(`simulate:account:${account}`, SIMULATIONS_PER_ACCOUNT_HOUR, 3_600, new Date()) } : {});
    return { ok: true, workflowHash: c.workflowHash, flow: plan.flow, kind: view.kind, provenance: view.provenance, observedAt: view.observedAt, expiresAt: view.expiresAt,
      simulationSubject, subjectRole: 'SIMULATION_SUBJECT_ONLY_NOT_AN_OWNER_OR_AUTHORIZATION',
      preview: true, persisted: false, authorizable: false, evidenceLevel: view.provenance === 'MOCKED' ? 'MOCKED_SIMULATION_PREVIEW' : 'SIMULATION_PREVIEW_NOT_EXECUTION',
      facts: view.facts, canonicalArtifacts: view.canonicalArtifacts, authority: AUTHORITY,
      notes: ['Amounts are integer native units of the named tokens.', 'Quotes and state expire; the FloFi app re-simulates before any Review.',
        'A simulation is evidence of what would happen at the observed block, not a guarantee and not an execution.'] };
  });

  register('get_execution_status', 'Execution status', 'Status, attempts and journal page of one FloFi execution, read from FloFi\'s durable state. Visible only when its ' +
    'owner wallet is one the deployment owner granted to this MCP credential; otherwise it is reported as not found.', Schemas.status, { ...pure, idempotentHint: false }, async args => {
    const found = await findOwnedRun(ctx.runtime, ctx.principal.wallets, args.executionId);
    return { ok: true, ...await executionStatusView(ctx.runtime, found, args.executionId, accessBasis(ctx), { after: args.journalAfter, limit: args.journalLimit }),
      notes: ['FloFi\'s canonical durable state; a partner or agent display is only a projection of it.'] };
  });

  register('get_evidence', 'Execution evidence', 'The reconciled Evidence Bundle of one FloFi execution with its own environment (MOCKED, TESTNET_EXECUTED, …) and outcome, ' +
    'exactly as FloFi recorded them. Owner-scoped like get_execution_status.', Schemas.evidence, { ...pure, idempotentHint: false }, async args => {
    const found = await findOwnedRun(ctx.runtime, ctx.principal.wallets, args.executionId);
    const view = await evidenceView(ctx.runtime, found, args.executionId, accessBasis(ctx));
    return view.evidence ? { ok: true, ...view, notes: ['Environment and outcome are copied from the Evidence Bundle; MCP never upgrades them.'] } : { ok: true, ...view };
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
  const oauth = ctx.oauth!, state = ctx.state!, principal = ctx.principal as McpOAuthPrincipal;
  // BUILD-DEVELOPER-001: the shared approval service sees an MCP account as one requester kind among others, with MCP's own link
  // scheme (the `flofi_hs_` links) and rules.
  const requester: ApprovalRequester = { kind: 'MCP_ACCOUNT', ref: principal.accountId, grantId: principal.id, clientId: principal.clientId, displayName: principal.clientName };
  const deps = (): ApprovalDeps => ({ origin: oauth.origin, scheme: mcpApprovalLinkScheme(oauth), handoffs: state.handoffs,
    allow: (bucket, limit, windowSeconds, now) => state.oauth.allow(bucket, limit, windowSeconds, now), runtime: ctx.runtime, policy: ctx.policy ?? DEFAULT_POLICY,
    rules: MCP_HANDOFF_RULES, now: new Date() });
  const owned = (approvalId: string) => approvalForRequester(state.handoffs, requester, approvalId, new Date());
  const ui = ctx.ui ?? null, appOnly = { ui: { visibility: ['app'] } };

  register('request_user_approval', 'Request the owner\'s approval', 'Hand a composed strategy (with its workflowHash) to its owner for execution in FloFi. ' +
    'FloFi re-composes and re-checks it, then returns an approval link with authority NONE. Nothing is authorized, signed or sent: the owner must open FloFi, ' +
    'prove their wallet, run a fresh simulation, review the Strategy Manifest and sign with their own wallet. Show the user the approvalUrl (or the FloFi panel). ' +
    'Mainnet may be disabled by policy; general multi-step sequences are not executable yet.', ApprovalSchemas.request,
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, async args => {
    const result = await requestApproval(deps(), requester, args.strategy, args.workflowHash);
    if (!result.ok) return failWith(result.code, result.extra ?? {});
    return { ok: true, ...result.value, message: 'Nothing is authorized yet. Open the FloFi link to prove your wallet, re-simulate, review the Strategy Manifest ' +
      'and sign with your own wallet. The link expires soon and works once.' };
  }, ui ? { ui: { resourceUri: ui.resourceUri }, 'openai/outputTemplate': ui.resourceUri, 'openai/toolInvocation/invoking': 'Preparing approval…',
    'openai/toolInvocation/invoked': 'Approval ready' } : {});

  register('get_approval_status', 'Approval status', 'The status of an approval request this account created: PENDING, CLAIMED, APPLIED, EXPIRED, SUPERSEDED, ' +
    'REVOKED or STALE. It never reveals the wallet that claimed it and never authorizes anything.', ApprovalSchemas.byId, { ...pure, idempotentHint: false },
  async args => ({ ok: true, ...await approvalProgress(await owned(args.approvalId), ctx.runtime, state.handoffs) }));

  register('open_approval_session', 'Open FloFi approval', 'App-only: a fresh, short-lived FloFi link for this approval (for the signing window or a wallet ' +
    'in-app browser). The link only shows the proposal; it authorizes nothing.', ApprovalSchemas.byId, { readOnlyHint: false, destructiveHint: false,
    idempotentHint: false, openWorldHint: false }, async args => ({ ok: true, ...await openApprovalSession(deps(), requester, args.approvalId) }), appOnly);

  register('get_execution_progress', 'Execution progress', 'App-only: the approval\'s state and, when its owner shares it, the status of the runs started from it.',
    ApprovalSchemas.byId, { ...pure, idempotentHint: false }, async args => ({ ok: true, ...await approvalProgress(await owned(args.approvalId), ctx.runtime, state.handoffs) }), appOnly);
}
