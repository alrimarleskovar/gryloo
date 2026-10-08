// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: ONE simulation concurrency cap for every surface. The platform's preview and the MCP `simulate_strategy` tool
 * draw from the same per-instance slots, so a second surface cannot double the load on public chains and providers. The platform
 * refuses with neutral codes; MCP keeps its historical ones. A caller's budget is consulted after the busy check and before a slot
 * is taken, and a slot is always released.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { composeStrategy, composeWorkflow } from '../engine/strategy-engine';
import { credential, gatewayEnv, session } from '../mcp/gateway.test-harness';
import type { McpRuntime } from '../mcp/runtime';
import { activeSimulationCount, MAX_CONCURRENT_SIMULATIONS, PlatformRefusal, simulatePreview } from './index.ts';

const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5', routing: 'auto' };
const SUBJECT = '0x' + 'a'.repeat(40);
const hashOf = (strategy: unknown) => { const c = composeStrategy(strategy); if (!c.ok) throw new Error(c.code); return c.workflowHash; };
const request = { strategy: BRIDGE, workflowHash: hashOf(BRIDGE), simulationSubject: SUBJECT };
const alice = { principal: 'dev-alice', token: credential() };
const env = gatewayEnv([alice]);

/** A runtime whose previews wait until released; every preview call is counted. */
function blockingRuntime() {
  let release: () => void = () => undefined, calls = 0;
  const gate = new Promise<void>(r => { release = r; });
  const runtime = { kind: 'embedded', mode: async () => 'live', preview: async () => { calls++; await gate; return { ok: false, code: 'PREVIEW_DONE' }; },
    run: async () => ({ ok: true, value: null }), journal: async () => ({ ok: true, value: null }), evidence: async () => ({ ok: true, value: null }) } as McpRuntime;
  return { runtime, release: () => release(), calls: () => calls };
}
const codeOf = async (work: Promise<unknown>) => { try { await work; return 'NO_REFUSAL'; } catch (error) { return error instanceof PlatformRefusal ? error.message : 'UNEXPECTED'; } };
const settle = () => new Promise(r => setTimeout(r, 25));
afterEach(() => expect(activeSimulationCount()).toBe(0));

describe('BUILD-DEVELOPER-001 shared simulation preview', () => {
  it('shares one cap between the platform and the MCP tool, in both directions', async () => {
    expect(MAX_CONCURRENT_SIMULATIONS).toBe(2);
    const first = blockingRuntime(), mcp = session({ env, token: alice.token, runtime: first.runtime });
    const held = [codeOf(simulatePreview(first.runtime, request)), codeOf(simulatePreview(first.runtime, request))];
    await settle();
    expect(activeSimulationCount()).toBe(2);
    expect((await mcp.callTool('simulate_strategy', request)).output).toEqual({ ok: false, code: 'MCP_SIMULATION_BUSY' });
    first.release();
    expect(await Promise.all(held)).toEqual(['PREVIEW_DONE', 'PREVIEW_DONE']);

    const second = blockingRuntime(), tool = session({ env, token: alice.token, runtime: second.runtime });
    const viaMcp = [tool.callTool('simulate_strategy', request), tool.callTool('simulate_strategy', request)];
    await settle();
    expect(await codeOf(simulatePreview(second.runtime, request))).toBe('SIMULATION_BUSY');
    second.release();
    expect((await Promise.all(viaMcp)).map(r => r.output)).toEqual([{ ok: false, code: 'PREVIEW_DONE' }, { ok: false, code: 'PREVIEW_DONE' }]);
    expect(second.calls()).toBe(2);
  });

  it('consults a budget after the busy check and before taking a slot; a refused budget runs nothing', async () => {
    const r = blockingRuntime(), budgetCalls: string[] = [];
    r.release();
    expect(await codeOf(simulatePreview(r.runtime, request, { budget: async () => { budgetCalls.push('denied'); return false; } }))).toBe('SIMULATION_RATE_LIMITED');
    expect([r.calls(), activeSimulationCount(), budgetCalls]).toEqual([0, 0, ['denied']]);

    const busy = blockingRuntime(), held = [codeOf(simulatePreview(busy.runtime, request)), codeOf(simulatePreview(busy.runtime, request))];
    await settle();
    expect(await codeOf(simulatePreview(busy.runtime, request, { budget: async () => { budgetCalls.push('consulted'); return true; } }))).toBe('SIMULATION_BUSY');
    expect(budgetCalls).toEqual(['denied']);
    busy.release();
    await Promise.all(held);
  });

  it('releases the slot when the flow refuses or throws, and refuses before any slot for invalid requests', async () => {
    const throwing = { ...blockingRuntime().runtime, preview: async () => { throw new Error('boom'); } } as McpRuntime;
    await expect(simulatePreview(throwing, request)).rejects.toThrow('boom');
    expect(activeSimulationCount()).toBe(0);
    const refusing = { ...throwing, preview: async () => ({ ok: false as const, code: 'FLOW_NOT_ENABLED' }) } as McpRuntime;
    expect(await codeOf(simulatePreview(refusing, request))).toBe('FLOW_NOT_ENABLED');
    expect(await codeOf(simulatePreview(refusing, { ...request, simulationSubject: 'So11111111111111111111111111111111111111112' }))).toBe('SIMULATION_SUBJECT_INVALID');
    expect(await codeOf(simulatePreview(refusing, { ...request, workflowHash: '0x' + '0'.repeat(64) }))).toBe('STRATEGY_WORKFLOW_HASH_MISMATCH');
    const twoSteps = { version: 2, steps: [BRIDGE, { action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '1' }] };
    const workflow = composeWorkflow(twoSteps);
    if (!workflow.ok) throw new Error(workflow.code);
    expect(await codeOf(simulatePreview(refusing, { strategy: twoSteps, workflowHash: workflow.workflowHash, simulationSubject: SUBJECT }))).toBe('SIMULATE_ONE_STEP_AT_A_TIME');
  });
});
