// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: capability discovery facts for every supported action × network on this deployment, shared by every
 * surface (moved from the MCP `get_capabilities` handler without change). Code support comes from the execution capability
 * registry on each canonical example; deployment enablement from the runtime; policy from the caller's handoff policy;
 * demonstrated evidence is reported, never a gate. What a surface offers on top (MCP's tool flags, a developer API's operations)
 * is that surface's own projection.
 */
import type { FlowName } from '../../backend/flows.ts';
import { codeCapabilities, type CodeCapability } from '../engine/capability-catalog';
import type { NetworkId, StrategyAction } from '../engine/strategy-spec';
import { evaluateGates, type ExecutionPlan, type Gates, type HandoffPolicy } from '../mcp/execution.ts';
import type { McpRuntime as EngineRuntime } from '../mcp/runtime.ts';
import { previewPlan, strategyFlow } from '../mcp/simulation.ts';
import { composeSingleStep } from './strategy.ts';

/** One mode/info lookup per flow per call. */
export function memoizedRuntime(runtime: EngineRuntime): EngineRuntime {
  const modes = new Map<string, ReturnType<EngineRuntime['mode']>>(), infos = new Map<string, ReturnType<NonNullable<EngineRuntime['info']>>>();
  return { ...runtime, mode: flow => { if (!modes.has(flow)) modes.set(flow, runtime.mode(flow)); return modes.get(flow)!; },
    info: flow => { if (!infos.has(flow)) infos.set(flow, runtime.info?.(flow) ?? Promise.resolve(null)); return infos.get(flow)!; } };
}

export type CapabilityFact = {
  readonly row: CodeCapability;
  /** The flow whose enablement governs this row (even when it cannot be previewed), and its mode here (`null` when unknowable). */
  readonly flow: FlowName | null; readonly mode: Awaited<ReturnType<EngineRuntime['mode']>>;
  /** Whether a read-only simulation preview can run for this row on this deployment, and why not. */
  readonly previewable: boolean; readonly previewUnavailableReason: string | null;
  readonly gates: Gates & { readonly plan: ExecutionPlan };
};
export type CapabilityFilter = { readonly network?: NetworkId | undefined; readonly action?: StrategyAction | undefined };

/** The four facts and the preview availability of every capability row matching `filter` (rows in registry order). */
export async function capabilityFacts(runtime: EngineRuntime, policy: HandoffPolicy, filter: CapabilityFilter = {}): Promise<readonly CapabilityFact[]> {
  const rows = codeCapabilities().filter(r => (!filter.network || r.network === filter.network || r.destinationNetwork === filter.network) && (!filter.action || r.action === filter.action));
  const memo = memoizedRuntime(runtime), cloud = runtime.kind === 'remote' || runtime.kind === 'embedded';
  return Promise.all(rows.map(async row => {
    const plan = previewPlan(row.example), flow = strategyFlow(row.example), mode = flow ? await memo.mode(flow) : null;
    const previewable = 'flow' in plan && cloud && (mode === 'live' || mode === 'harness');
    const composition = composeSingleStep(row.example, undefined, 'CAPABILITY_EXAMPLE_INVALID'), gates = await evaluateGates(composition, memo, policy);
    const previewUnavailableReason = previewable ? null : 'code' in plan ? plan.code
      : !cloud ? (runtime.kind === 'local' ? 'MCP_CLOUD_RUNTIME_REQUIRED' : 'CLOUD_RUNTIME_NOT_CONFIGURED') : 'FLOW_NOT_ENABLED_IN_DEPLOYMENT';
    return { row, flow, mode, previewable, previewUnavailableReason, gates };
  }));
}
