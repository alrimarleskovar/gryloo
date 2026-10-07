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
import { composeBound, reviewComposition, type Composition } from '../engine/strategy-engine';
import { compileSchema, NETWORK_IDS, STRATEGY_ACTIONS, strategySpecIssues, StrategySpecSchema, type StrategySpec } from '../engine/strategy-spec';
import type { McpPrincipal } from './config.ts';
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
    return [...all.filter(i => !inStrategy(i)), ...strategySpecIssues(strategy).map(i => ({ path: '/strategy' + (i.path === '/' ? '' : i.path), rule: i.rule }))];
  };
  return { '~standard': { version: 1, vendor: 'flofi',
    validate: value => compiled.check(value) ? { value: value as T } : { issues: issuesOf(value).map(i => ({ message: `${i.path} ${i.rule}`, path: i.path.split('/').filter(Boolean) })) },
    jsonSchema: { input: () => json, output: () => json } } };
}
const strict = { additionalProperties: false } as const;
const Hash = Type.String({ pattern: '^0x[0-9a-f]{64}$', description: 'The workflowHash returned by compose_strategy.' });
const ExecutionId = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$', description: 'A FloFi execution (run) id. It is a lookup key, not an access grant.' });
const NetworkFilter = Type.Union(NETWORK_IDS.map(n => Type.Literal(n)), { description: 'Network identifier.' });
const Schemas = {
  none: Type.Object({}, strict),
  assets: Type.Object({ network: Type.Optional(NetworkFilter) }, strict),
  capabilities: Type.Object({ network: Type.Optional(NetworkFilter), action: Type.Optional(Type.Union(STRATEGY_ACTIONS.map(a => Type.Literal(a)))) }, strict),
  compose: Type.Object({ strategy: StrategySpecSchema }, strict),
  bound: Type.Object({ strategy: StrategySpecSchema, workflowHash: Type.Optional(Hash) }, strict),
  simulate: Type.Object({ strategy: StrategySpecSchema, workflowHash: Hash,
    simulationSubject: Type.String({ pattern: '^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$',
      description: 'The account whose PUBLIC balances and allowances the read-only simulation uses (EVM address or Solana public key). It is not authenticated, ' +
        'not an owner and grants nothing; nothing is stored for it.' }) }, strict),
  status: Type.Object({ executionId: ExecutionId, journalAfter: Type.Optional(Type.Integer({ minimum: -1, maximum: 2_147_483_647 })),
    journalLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }, strict),
  evidence: Type.Object({ executionId: ExecutionId }, strict),
};

export type ToolEvent = { readonly tool: string; readonly outcome: string; readonly durationMs: number };
export type ToolContext = { readonly principal: McpPrincipal; readonly runtime: McpRuntime; readonly onTool?: (event: ToolEvent) => void; readonly now?: () => number };
type Output = Record<string, unknown>;
class ToolFailure extends Error {}
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const failWith = (code: string, extra: Output = {}): never => { throw Object.assign(new ToolFailure(code), { extra }); };
const AUTHORITY = 'NONE: this result authorizes nothing. Only the owner, in the FloFi app, can review the Strategy Manifest and sign with their own wallet.';

/** Simulations reach public chains and providers: a small per-instance cap protects them (best effort, never a correctness rule). */
const MAX_CONCURRENT_SIMULATIONS = 2;
let activeSimulations = 0;

function composed(strategy: StrategySpec, workflowHash: string | undefined): Composition {
  const result = composeBound(strategy, workflowHash);
  return result.ok ? result : failWith(result.code, { issues: result.issues });
}
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
  const register = <S extends TSchema>(name: (typeof MCP_TOOL_NAMES)[number], title: string, description: string, schema: S, annotations: ToolAnnotations,
    run: (args: Static<S>) => Promise<Output> | Output) => {
    server.registerTool(name, { title, description, inputSchema: standard<Static<S>>(schema), annotations: { title, ...annotations } }, async (args: Static<S>): Promise<CallToolResult> => {
      const started = now();
      let result: CallToolResult, outcome = 'OK';
      try {
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
  const pure = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

  register('get_supported_networks', 'Supported networks', 'Networks FloFi can author strategies for, with CAIP-2 ids, mainnet/testnet/devnet class and the actions available. ' +
    'Derived from FloFi\'s registries.', Schemas.none, pure, () => ({ ok: true, networks: supportedNetworks() }));

  register('get_supported_assets', 'Supported assets', 'Assets a strategy may name, per network, with the exact token address or mint, decimals and the actions that use ' +
    'each. One symbol can be two different tokens on one network (e.g. Base Sepolia Aave USDC vs Circle test USDC).', Schemas.assets, pure,
  args => ({ ok: true, assets: supportedAssets(args.network) }));

  register('get_capabilities', 'Capabilities', 'For each action × network: what FloFi code supports (from the execution capability registry on the composed IR), the evidence ' +
    'it has actually demonstrated, whether this deployment enables it, and what this MCP server can do (compose, validate, review, preview — never execute).',
  Schemas.capabilities, { ...pure, idempotentHint: false }, async args => {
    const rows = codeCapabilities().filter(r => (!args.network || r.network === args.network || r.destinationNetwork === args.network) && (!args.action || r.action === args.action));
    const flows = [...new Set(rows.map(r => strategyFlow(r.example)).filter((f): f is NonNullable<typeof f> => f !== null))];
    const modes = new Map(await Promise.all(flows.map(async flow => [flow, await ctx.runtime.mode(flow)] as const)));
    const cloud = ctx.runtime.kind === 'remote' || ctx.runtime.kind === 'embedded';
    return { ok: true, runtime: ctx.runtime.kind, mcpExecution: 'NOT_AVAILABLE', capabilities: rows.map(r => {
      const plan = previewPlan(r.example), flow = strategyFlow(r.example), mode = flow ? modes.get(flow) ?? null : null;
      const previewable = 'flow' in plan && cloud && (mode === 'live' || mode === 'harness');
      return { action: r.action, network: r.network, destinationNetwork: r.destinationNetwork, funds: r.funds, actionTypes: r.actionTypes, adapters: r.adapters,
        supportedByCode: { publicEnvironment: r.publicEnvironment, dimensions: r.supportedByCode, ownerWalletExecutionImplemented: r.ownerWalletExecutionImplemented,
          registryEnvironments: r.registryEnvironments },
        demonstratedEvidence: r.demonstratedEvidence ?? 'NONE_DEMONSTRATED',
        deployment: { flow, mode: mode ?? 'UNKNOWN_IN_LOCAL_RUNTIME', enabled: mode === 'live' || mode === 'harness', mockedHarness: mode === 'harness' },
        mcp: { compose: true, validate: true, review: true, simulate: previewable, simulateUnavailableReason: previewable ? null : 'code' in plan ? plan.code
          : !cloud ? (ctx.runtime.kind === 'local' ? 'MCP_CLOUD_RUNTIME_REQUIRED' : 'CLOUD_RUNTIME_NOT_CONFIGURED') : 'FLOW_NOT_ENABLED_IN_DEPLOYMENT', execute: false },
        example: r.example };
    }) };
  });

  register('compose_strategy', 'Compose strategy', 'Deterministically turn structured intent into FloFi\'s canonical Semantic Workflow IR (revision 1), using the same ' +
    'authoring rules as the FloFi app. Unsupported or ambiguous input is refused with a code, never guessed. Keep `strategy` (normalized) and `workflowHash` for ' +
    'validate/simulate/review. The model must not invent addresses: use only values the user gave.', Schemas.compose, pure, args => {
    const c = composed(args.strategy, undefined);
    return { ok: true, strategy: c.strategy, workflowHash: c.workflowHash, revision: c.workflow.revision, fundsClass: c.fundsClass, workflow: c.workflow,
      steps: stepsOf(c), explanation: c.explanation, summary: c.summary, notes: c.notes, authority: AUTHORITY,
      nextSteps: ['validate_strategy or review_strategy with this strategy and workflowHash', 'simulate_strategy for a read-only preview (optional)',
        'The owner opens the FloFi app to simulate, review and sign; nothing executes from MCP.'] };
  });

  register('validate_strategy', 'Validate strategy', 'Check a strategy against FloFi\'s authoring rules (networks, assets, amounts, limits) and, when given, the workflowHash ' +
    'from compose_strategy (a mismatch means the strategy changed or FloFi\'s rules changed: compose again).', Schemas.bound, pure, args => {
    const result = composeBound(args.strategy, args.workflowHash);
    if (!result.ok) return { ok: true, valid: false, code: result.code, issues: result.issues };
    const review = reviewComposition(result);
    return { ok: true, valid: true, workflowHash: result.workflowHash, fundsClass: result.fundsClass, notes: result.notes,
      reviewSummary: { block: review.findings.filter(f => f.level === 'BLOCK').length, warning: review.findings.filter(f => f.level === 'WARNING').length } };
  });

  register('review_strategy', 'Review strategy', 'FloFi\'s deterministic Strategy Review: linter findings, capability blockers for the network\'s public environment and ' +
    'strategy warnings, as BLOCK / WARNING / INFORMATION. It explains; it never approves or authorizes.', Schemas.bound, { ...pure, idempotentHint: false }, async args => {
    const c = composed(args.strategy, args.workflowHash), review = reviewComposition(c), flow = strategyFlow(c.strategy);
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
    const c = composed(args.strategy, args.workflowHash), plan = previewPlan(c.strategy);
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
    return { ok: true, executionId: run.runId, flow: run.flow, status: run.status, provenance: run.provenance, owner, accessBasis: 'OPERATOR_GRANTED_WALLET',
      ...pickRow(run, ['errorCode', 'needsObservation', 'attentionRequired', 'hasEvidence', 'createdAt', 'updatedAt']),
      attempts: (Array.isArray(run.attempts) ? run.attempts : []).slice(0, 64).map(a => pickRow(a, ['attemptId', 'step', 'state', 'transactionHash', 'reconciled', 'preparedAtBlock', 'updatedAt'])),
      journal: { items: (page.value?.items ?? []).map(e => pickRow(e, ['sequence', 'entryHash', 'level', 'entityId', 'attemptId', 'fromState', 'toState', 'recordedAt'])),
        next: page.value?.next ?? null },
      notes: ['FloFi\'s canonical durable state; a partner or agent display is only a projection of it.'] };
  });

  register('get_evidence', 'Execution evidence', 'The reconciled Evidence Bundle of one FloFi execution with its own environment (MOCKED, TESTNET_EXECUTED, …) and outcome, ' +
    'exactly as FloFi recorded them. Owner-scoped like get_execution_status.', Schemas.evidence, { ...pure, idempotentHint: false }, async args => {
    const { run, owner } = await ownedRun(ctx, args.executionId);
    const base = { ok: true, executionId: run.runId, flow: run.flow, provenance: run.provenance, status: run.status, owner, accessBasis: 'OPERATOR_GRANTED_WALLET' };
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
  return server;
}
