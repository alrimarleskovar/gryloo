// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the FloFi platform — the one engine service every surface (FloFi Web's server side, MCP, the Developer
 * API, channels) calls. One execution truth: the same composition, canonical IR and hash, review, four facts, simulation preview,
 * approval handoff, owner-scoped status and evidence for all of them. Surfaces add only their own transport, authentication and
 * output wording; they never re-implement any of this.
 *
 * Non-MCP code imports this module only. Some shared modules still physically live under `src/mcp/` (they predate the platform
 * and move here once BUILD-MCP-002 has merged); they are re-exported below under neutral names so that move is invisible to
 * consumers. Nothing here signs, submits or holds a key.
 */
export * from './refusal.ts';
export * from './strategy.ts';
export * from './capabilities.ts';
export * from './preview.ts';
export * from './executions.ts';
export * from './approvals.ts';
export { ENGINE_VERSION, evaluateGates, evaluateWorkflowGates, executionPlan, handoffFindings, policyGate, workflowPlan, type ExecutionPlan, type Gates,
  type HandoffPolicy, type PlanStep } from '../mcp/execution.ts';
export { assertSafeOutput, previewPlan, projectSimulation, strategyFlow, type PreviewPlan, type SimulationView } from '../mcp/simulation.ts';
export { deploymentRuntime as deploymentEngineRuntime, embeddedMcpRuntime as embeddedEngineRuntime, type EvidenceRecord, type McpRuntime as EngineRuntime,
  type Result } from '../mcp/runtime.ts';
export type { HandoffRecord, HandoffStatus, HandoffStore, WalletRef } from '../mcp/handoff/store.ts';
export { credentialDigest, credentialOf, newCredential, newId } from '../mcp/oauth/crypto.ts';
