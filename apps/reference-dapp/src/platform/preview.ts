// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the read-only simulation preview shared by every surface (moved from the MCP `simulate_strategy` handler
 * without change). It runs the existing flow's own simulation (`backend/preview.ts`) for exactly one composed step and returns
 * only the allowlisted projection (`projectSimulation`): nothing is persisted, signed or sent, and the result is never
 * authorizable.
 *
 * Simulations reach public chains and providers, so ONE per-instance concurrency cap protects them for MCP, the Developer API
 * and any later surface together (best effort, never a correctness rule). A surface may add its own budget (e.g. per account),
 * consulted after the busy check and before the slot is taken.
 */
import type { PreviewPlan, SimulationView } from '../mcp/simulation.ts';
import { previewPlan, projectSimulation } from '../mcp/simulation.ts';
import type { McpRuntime as EngineRuntime } from '../mcp/runtime.ts';
import type { Composition } from '../engine/strategy-engine';
import { refuse } from './refusal.ts';
import { composeSingleStep } from './strategy.ts';

export const MAX_CONCURRENT_SIMULATIONS = 2;
let activeSimulations = 0;
/** Simulations running in this instance right now (all surfaces). */
export const activeSimulationCount = () => activeSimulations;

export type PreviewRequest = { readonly strategy: unknown; readonly workflowHash: string; readonly simulationSubject: string };
export type PreviewOptions = { readonly budget?: () => Promise<boolean> };
export type SimulationPreview = { readonly composition: Composition; readonly plan: PreviewPlan; readonly view: SimulationView;
  /** The public account whose balances the preview read, or null when the flow reads none. Never an owner or an authorization. */
  readonly simulationSubject: string | null };

/**
 * Refusals: the composition's own code (with issues), `SIMULATE_ONE_STEP_AT_A_TIME`, the preview plan's code (e.g.
 * `SIMULATION_LOCAL_FORK_ONLY`), `SIMULATION_SUBJECT_INVALID`, `SIMULATION_BUSY`, `SIMULATION_RATE_LIMITED` (the caller's budget),
 * or the flow's own classified code.
 */
export async function simulatePreview(runtime: EngineRuntime, request: PreviewRequest, options: PreviewOptions = {}): Promise<SimulationPreview> {
  const c = composeSingleStep(request.strategy, request.workflowHash, 'SIMULATE_ONE_STEP_AT_A_TIME'), plan = previewPlan(c.strategy);
  if ('code' in plan) return refuse(plan.code);
  const evm = /^0x[0-9a-fA-F]{40}$/.test(request.simulationSubject);
  if (plan.subject === 'EVM' && !evm || plan.subject === 'SOLANA' && evm) return refuse('SIMULATION_SUBJECT_INVALID');
  if (activeSimulations >= MAX_CONCURRENT_SIMULATIONS) return refuse('SIMULATION_BUSY');
  if (options.budget && !await options.budget()) return refuse('SIMULATION_RATE_LIMITED');
  activeSimulations++;
  let preview;
  try {
    const subject = evm ? request.simulationSubject.toLowerCase() : request.simulationSubject;
    preview = await runtime.preview(plan.flow, plan.subject === 'NONE' ? [c.workflow] : [c.workflow, subject]);
  } finally { activeSimulations--; }
  if (!preview.ok) return refuse(preview.code);
  return { composition: c, plan, view: projectSimulation(plan.flow, preview.value), simulationSubject: plan.subject === 'NONE' ? null : request.simulationSubject };
}
