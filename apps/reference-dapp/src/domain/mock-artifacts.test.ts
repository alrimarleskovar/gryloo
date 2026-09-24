// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor, type EditorState } from './editor';
import { generateMockedChain, generationEligibility } from './mock-artifacts';
import type { Command } from './commands';

const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const NOW = Date.parse('2026-09-24T12:00:10.000Z');
function authored(...commands: ((revision: number) => Command)[]): EditorState {
  let state = initialEditor();
  for (const make of commands) {
    const next = editorReducer(state, make(state.workflow.revision), context);
    if (next.error) throw new Error(next.error);
    state = next;
  }
  return state;
}
const swap = (direction: 'USDC_TO_WETH' | 'WETH_TO_USDC', amount: string, slippage: string) => (baseRevision: number): Command =>
  ({ type: 'ADD_SWAP', direction, amount, slippage, source: 'CANVAS', baseRevision });

afterEach(() => { vi.unstubAllGlobals(); });

describe('local mocked artifact generation', () => {
  it.each([['USDC_TO_WETH', '2.25', 'WETH', '2250000000000000', '2238750000000000'], ['WETH_TO_USDC', '0.125', 'USDC', '125000000', '124375000']] as const)(
    '%s builds one frozen, revision-bound, MOCKED chain', async (direction, amount, to, expected, minimum) => {
      const workflow = authored(swap(direction, amount, '50')).workflow;
      const { chain, review } = await generateMockedChain(workflow, context, { nowMs: NOW, generation: 1 });
      expect(review.status).toBe('CURRENT');
      expect(review.executable).toBe(false);
      expect(chain.quotes.map(quote => quote.artifactId)).toEqual(['MOCKED.quote.node-002.r1.g1']);
      expect(chain.artifactSet.artifactSetId).toBe('MOCKED.artifact-set.r1.g1');
      expect(chain.simulation.simulationId).toBe('MOCKED.simulation.r1.g1');
      expect(chain.simulation.semanticWorkflowRevision).toBe(1);
      expect(chain.quotes[0]!.outputBounds[0]!.expected).toEqual({ asset: context.assets[to].asset, amount: expected });
      expect(chain.simulation.outputs[0]!.minimum.amount).toBe(minimum);
      expect(chain.quotes[0]!.freshness).toEqual({ observedAt: '2026-09-24T12:00:10.000Z', expiresAt: '2026-09-24T12:01:10.000Z', maximumAgeSeconds: 60 });
      expect(Object.isFrozen(chain.simulation.outputs[0]!.expected.asset)).toBe(true);
    });

  it('creates one quote per swap node, none for mock nodes, and is deterministic', async () => {
    const workflow = authored(swap('WETH_TO_USDC', '1', '100'), swap('USDC_TO_WETH', '5', '0'), revision => ({ type: 'ADD', kind: 'condition', source: 'CANVAS', baseRevision: revision })).workflow;
    const first = await generateMockedChain(workflow, context, { nowMs: NOW, generation: 3 });
    const second = await generateMockedChain(workflow, context, { nowMs: NOW, generation: 3 });
    expect(first.chain.quotes.map(quote => quote.nodeId)).toEqual(['node-002', 'node-003']);
    expect(first.chain.simulation.uncertainty.at(-1)?.code).toBe('MOCK_NODES_EXCLUDED');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('reports eligibility reasons and refuses ineligible generation', async () => {
    expect(generationEligibility(initialEditor().workflow, context)).toEqual({ eligible: false, reason: 'Add a Base swap in Build before generating mocked artifacts.' });
    const blocked = authored(swap('USDC_TO_WETH', '2', '301')).workflow;
    const eligibility = generationEligibility(blocked, context);
    expect(eligibility.eligible).toBe(false);
    expect(!eligibility.eligible && eligibility.reason).toMatch(/^SLIPPAGE_ABOVE_REVIEW_LIMIT on node-002 blocks generation/);
    await expect(generateMockedChain(blocked, context, { nowMs: NOW, generation: 1 })).rejects.toThrow('GENERATION_NOT_ELIGIBLE');
    await expect(generateMockedChain(authored(swap('USDC_TO_WETH', '2', '1')).workflow, context, { nowMs: 1.5, generation: 1 })).rejects.toThrow('INVALID_GENERATION_INPUT');
  });

  it('builds nothing when the digest self-check fails (R-3)', async () => {
    const workflow = authored(swap('USDC_TO_WETH', '2', '50')).workflow;
    const digest = vi.fn(async () => new ArrayBuffer(32));
    vi.stubGlobal('crypto', { subtle: { digest } });
    await expect(generateMockedChain(workflow, context, { nowMs: NOW, generation: 1 })).rejects.toThrow('DIGEST_UNAVAILABLE');
    expect(digest).toHaveBeenCalledTimes(1);
  });
});
