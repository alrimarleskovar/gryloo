// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '../src/index.js';
import { MOCKED_CHAIN_PROFILE, mockedSwapOutputs, reviewMockedArtifactChain } from '../src/mocked-chain.js';
import { editorReducer, initialEditor, type EditorState } from '../../../apps/reference-dapp/src/domain/editor';
import { generateMockedChain } from '../../../apps/reference-dapp/src/domain/mock-artifacts';
import type { Command } from '../../../apps/reference-dapp/src/domain/commands';

const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const NOW = Date.parse('2026-09-24T12:00:10.000Z');
const WETH = 10n ** 18n, USDC = 10n ** 9n;

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
  ({ type: 'ADD_SWAP', direction, amount, slippage, source: 'CHAT', baseRevision });

afterEach(() => { vi.unstubAllGlobals(); });

describe('mocked arithmetic (R-2)', () => {
  it.each([
    ['USDC', 'WETH', '1', 0, '1000000000', '1000000000'],
    ['USDC', 'WETH', '1', 300, '1000000000', '970000000'],
    ['USDC', 'WETH', '2250000', 50, '2250000000000000', '2238750000000000'],
    ['USDC', 'WETH', '1000000000000', 0, '1000000000000000000000', '1000000000000000000000'],
    ['USDC', 'WETH', '1000000000000', 300, '1000000000000000000000', '970000000000000000000'],
    ['WETH', 'USDC', '999999999', 0, '0', '0'],
    ['WETH', 'USDC', '1000000000', 0, '1', '1'],
    ['WETH', 'USDC', '1000000000', 1, '1', '0'],
    ['WETH', 'USDC', '1999999999', 0, '1', '1'],
    ['WETH', 'USDC', '125000001000000000', 1, '125000001', '124987500'],
    ['WETH', 'USDC', '125000000000000000', 50, '125000000', '124375000'],
    ['WETH', 'USDC', '1000000000000000000000', 0, '1000000000000', '1000000000000'],
    ['WETH', 'USDC', '1000000000000000000000', 300, '1000000000000', '970000000000'],
  ] as const)('%s→%s %s units at %i bps', (from, to, amountIn, slippageBps, expected, minimum) => {
    expect(mockedSwapOutputs({ amountIn, from, to, slippageBps }, context)).toEqual({ expected, minimum, adverse: minimum });
  });

  it('satisfies the round-down floor properties for 1,000 seeded amounts per direction', () => {
    let seed = 0x5eed_003b;
    const random = () => { seed = (seed * 1_103_515_245 + 12_345) >>> 0; return seed; };
    for (const [from, to, cap] of [['USDC', 'WETH', 10n ** 12n], ['WETH', 'USDC', 10n ** 21n]] as const) {
      const rateIn = from === 'WETH' ? WETH : USDC, rateOut = to === 'WETH' ? WETH : USDC;
      for (let index = 0; index < 1000; index += 1) {
        const amount = 1n + ((BigInt(random()) << 64n | BigInt(random()) << 32n | BigInt(random())) % cap);
        const bps = random() % 301;
        const { expected, minimum, adverse } = mockedSwapOutputs({ amountIn: amount.toString(), from, to, slippageBps: bps }, context);
        const e = BigInt(expected), m = BigInt(minimum);
        expect(e * rateIn <= amount * rateOut && amount * rateOut < (e + 1n) * rateIn).toBe(true);
        expect(m * 10_000n <= e * BigInt(10_000 - bps) && e * BigInt(10_000 - bps) < (m + 1n) * 10_000n).toBe(true);
        expect(adverse).toBe(minimum);
      }
    }
  });

  it('never reaches the arithmetic with cap-plus-one, ineligible slippage or malformed input', () => {
    const valid = { amountIn: '1', from: 'USDC', to: 'WETH', slippageBps: 0 };
    for (const [input, code] of [
      [{ ...valid, amountIn: '1000000000001' }, 'AMOUNT_OUT_OF_RANGE'],
      [{ ...valid, from: 'WETH', to: 'USDC', amountIn: '1000000000000000000001' }, 'AMOUNT_OUT_OF_RANGE'],
      [{ ...valid, amountIn: '0' }, 'INVALID_AMOUNT'], [{ ...valid, amountIn: '01' }, 'INVALID_AMOUNT'],
      [{ ...valid, amountIn: '1.5' }, 'INVALID_AMOUNT'], [{ ...valid, amountIn: 1 }, 'INVALID_AMOUNT'],
      [{ ...valid, slippageBps: 301 }, 'SLIPPAGE_NOT_ELIGIBLE'], [{ ...valid, slippageBps: -1 }, 'SLIPPAGE_NOT_ELIGIBLE'],
      [{ ...valid, slippageBps: 1.5 }, 'SLIPPAGE_NOT_ELIGIBLE'], [{ ...valid, slippageBps: '50' }, 'SLIPPAGE_NOT_ELIGIBLE'],
      [{ ...valid, to: 'USDC' }, 'INVALID_ASSET_PAIR'], [{ ...valid, from: 'ETH' }, 'INVALID_ASSET_PAIR'],
      [{ ...valid, extra: true }, 'INVALID_ARITHMETIC_INPUT'],
    ] as const) expect(() => mockedSwapOutputs(input, context), JSON.stringify(input)).toThrow(code);
  });
});

async function fixture(...commands: ((revision: number) => Command)[]) {
  const state = authored(...(commands.length ? commands : [swap('USDC_TO_WETH', '2.25', '50')]));
  const generated = await generateMockedChain(state.workflow, context, { nowMs: NOW, generation: 1 });
  return { workflow: state.workflow, chain: generated.chain, review: generated.review };
}
const clone = <T>(value: T): T => structuredClone(value) as T;
type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('mocked chain review (R-5)', () => {
  it('accepts a generated chain as CURRENT, non-executable and MOCKED', async () => {
    const { workflow, chain, review } = await fixture();
    const again = await reviewMockedArtifactChain({ chain, sourceWorkflow: workflow, currentWorkflow: workflow, nowMs: NOW }, context);
    expect(again).toEqual(review);
    expect(again).toMatchObject({ status: 'CURRENT', environment: 'MOCKED', executable: false, authorization: 'NONE', enforcement: 'NOT_ENFORCED', revision: 1, generation: 1 });
    expect(again.findings.map(finding => finding.code)).toEqual(['MOCKED_ARTIFACTS_NOT_EXECUTABLE']);
    expect(Object.isFrozen(again) && Object.isFrozen(chain) && Object.isFrozen(chain.quotes[0]!.normalizedValues)).toBe(true);
  });

  it('rejects each tampered or incorrectly linked chain with its code', async () => {
    const { workflow, chain } = await fixture();
    const account = { chainId: 'eip155:8453', address: '0x000000000000000000000000000000000000dead' };
    const quantity = { asset: { chainId: 'eip155:8453', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 }, amount: '1' };
    const other = '0x' + 'ab'.repeat(32);
    const cases: [string, (c: Mutable) => unknown][] = [
      ['MALFORMED_ARTIFACT_CHAIN', c => { c.executable = true; }],
      ['MALFORMED_ARTIFACT_CHAIN', c => { c.quotes = []; }],
      ['INVALID_QUOTE_STATE_ARTIFACT', c => { c.quotes[0].environment = 'MOCKED'; }],
      ['INVALID_ARTIFACT_SET', c => { c.artifactSet.extra = 1; }],
      ['INVALID_SIMULATION_BUNDLE', c => { c.simulation.freshness.maximumAgeSeconds = -1; }],
      ['MOCK_MARKER_REQUIRED', c => { c.quotes[0].normalizedValues[0].value = 'LIVE'; }],
      ['MOCK_MARKER_REQUIRED', c => { c.quotes[0].normalizedValues.shift(); }],
      ['MOCK_MARKER_REQUIRED', c => { c.quotes[0].chainPosition.height = 12345; }],
      ['MOCK_MARKER_REQUIRED', c => { c.quotes[0].uncertainty = []; }],
      ['MOCK_MARKER_REQUIRED', c => { c.simulation.uncertainty.pop(); }],
      ['MOCK_MARKER_REQUIRED', c => { c.simulation.unsupportedAssumptions = ['Live market simulation.']; }],
      ['LIVE_SOURCE_NOT_APPROVED', c => { c.quotes[0].sourceId = 'router.api'; }],
      ['LIVE_SOURCE_NOT_APPROVED', c => { c.quotes[0].adapter.id = 'uniswap.v4'; }],
      ['LIVE_SOURCE_NOT_APPROVED', c => { c.quotes[0].providerReference = { kind: 'ROUTE', id: 'route-1' }; }],
      ['LIVE_SOURCE_NOT_APPROVED', c => { c.simulation.adapters = [{ id: 'uniswap.v4', version: '1.0.0' }]; }],
      ['AUTHORITY_FIELDS_FORBIDDEN', c => { c.quotes[0].proposedSpenders = [account]; }],
      ['AUTHORITY_FIELDS_FORBIDDEN', c => { c.quotes[0].proposedRecipients = [account]; }],
      ['AUTHORITY_FIELDS_FORBIDDEN', c => { c.quotes[0].proposedContracts = [{ ...account, version: '1' }]; }],
      ['AUTHORITY_FIELDS_FORBIDDEN', c => { c.simulation.contracts = [{ ...account, version: '1' }]; }],
      ['UNMODELED_VALUE_FORBIDDEN', c => { c.quotes[0].fees = [quantity]; }],
      ['UNMODELED_VALUE_FORBIDDEN', c => { c.quotes[0].gas = [quantity]; }],
      ['ASSET_MISMATCH', c => { c.quotes[0].chainId = 'eip155:1'; }],
      ['ASSET_MISMATCH', c => { c.quotes[0].outputBounds[0].expected.asset = quantity.asset; }],
      ['OUTPUT_MISMATCH', c => { c.quotes[0].outputBounds[0].expected.amount = '9999999999999999999'; }],
      ['OUTPUT_MISMATCH', c => { c.quotes[0].normalizedValues[2].value.amount = '9'; }],
      ['OUTPUT_MISMATCH', c => { c.quotes[0].normalizedValues[4].value.amount = '2000000000'; }],
      ['OUTPUT_MISMATCH', c => { c.simulation.outputs[0].minimum.amount = '1'; }],
      ['NODE_COVERAGE_MISMATCH', c => { c.quotes[0].nodeId = 'node-001'; }],
      ['NODE_COVERAGE_MISMATCH', c => { c.quotes = [c.quotes[0], c.quotes[0]]; }],
      ['NODE_COVERAGE_MISMATCH', c => { c.artifactSet.artifactSetId = 'MOCKED.artifact-set.r1.g2'; }],
      ['NODE_COVERAGE_MISMATCH', c => { c.artifactSet.artifacts[0].artifactId = 'MOCKED.quote.node-002.r1.g9'; }],
      ['REVISION_LINK_MISMATCH', c => { c.simulation.semanticWorkflowRevision = 0; }],
      ['REVISION_LINK_MISMATCH', c => { c.simulation.simulationId = 'MOCKED.simulation.r0.g1'; }],
      ['FRESHNESS_INVALID', c => { c.quotes[0].retrievedAt = '2026-09-24T12:00:11.000Z'; }],
      ['FRESHNESS_INVALID', c => { for (const f of [c.quotes[0].freshness, c.simulation.freshness]) f.expiresAt = '2026-09-24T12:01:11.000Z'; }],
      ['FRESHNESS_INVALID', c => { for (const f of [c.quotes[0].freshness, c.simulation.freshness]) f.maximumAgeSeconds = 61; }],
      ['UNSUPPORTED_PROPAGATION', c => { c.simulation.propagatedOutputs = [{ fromNodeId: 'node-002', outputId: 'amount-out', toNodeId: 'node-001', inputName: 'amount', quantity }]; }],
      ['FAILURE_PATH_MISMATCH', c => { c.simulation.failurePaths[0].blockedNodeIds = ['node-001']; }],
      ['FAILURE_PATH_MISMATCH', c => { c.simulation.failurePaths[0].residualAssets[0].amount = '1'; }],
      ['HASH_LINK_MISMATCH', c => { c.quotes[0].semanticWorkflowHash = other; }],
      ['HASH_LINK_MISMATCH', c => { c.quotes[0].rawResponseHash = other; }],
      ['HASH_LINK_MISMATCH', c => { c.artifactSet.artifacts[0].artifactHash = other; }],
      ['HASH_LINK_MISMATCH', c => { c.artifactSet.semanticWorkflowHash = other; }],
      ['HASH_LINK_MISMATCH', c => { c.simulation.artifactSetHash = other; }],
      ['HASH_LINK_MISMATCH', c => { c.simulation.semanticWorkflowHash = other; }],
    ];
    for (const [code, mutate] of cases) {
      const tampered = clone(chain) as Mutable;
      mutate(tampered);
      const before = JSON.stringify(tampered);
      await expect(reviewMockedArtifactChain({ chain: tampered, sourceWorkflow: workflow, currentWorkflow: workflow, nowMs: NOW }, context), code).rejects.toThrow(code);
      expect(JSON.stringify(tampered)).toBe(before);
    }
  });

  it('rejects malformed review input and ineligible source workflows', async () => {
    const { workflow, chain } = await fixture();
    for (const input of [null, { chain, sourceWorkflow: workflow, currentWorkflow: workflow }, { chain, sourceWorkflow: workflow, currentWorkflow: workflow, nowMs: 1.5 }]) {
      await expect(reviewMockedArtifactChain(input, context)).rejects.toThrow('MALFORMED_ARTIFACT_CHAIN');
    }
    const blocked = authored(swap('USDC_TO_WETH', '2.25', '301')).workflow;
    await expect(reviewMockedArtifactChain({ chain, sourceWorkflow: blocked, currentWorkflow: blocked, nowMs: NOW }, context)).rejects.toThrow('SOURCE_WORKFLOW_NOT_ELIGIBLE');
    await expect(reviewMockedArtifactChain({ chain, sourceWorkflow: workflow, currentWorkflow: workflow, nowMs: NOW }, { ...context, registryId: 'other' })).rejects.toThrow('INVALID_REVIEW_CONTEXT');
  });

  it('reports stale, expired, backwards-clock and zero-output chains as blocking findings', async () => {
    const { workflow, chain } = await fixture();
    const edited = editorReducer({ workflow, error: null }, { type: 'SET_SWAP_AMOUNT', nodeId: 'node-002', amount: '3', source: 'CHAT', baseRevision: 1 }, context).workflow;
    const review = (currentWorkflow: unknown, nowMs: number) => reviewMockedArtifactChain({ chain, sourceWorkflow: workflow, currentWorkflow, nowMs }, context);
    expect((await review(edited, NOW)).status).toBe('INVALIDATED');
    expect((await review(edited, NOW)).findings.map(finding => finding.code)).toContain('ARTIFACTS_INVALIDATED_BY_SEMANTIC_EDIT');
    expect((await review(workflow, NOW + 59_999)).status).toBe('CURRENT');
    expect((await review(workflow, NOW + 60_000)).status).toBe('EXPIRED');
    expect((await review(workflow, NOW - 1)).findings.map(finding => finding.code)).toContain('ARTIFACTS_EXPIRED');
    for (const [amount, slippage] of [['0.000000000999999999', '0'], ['0.000000001', '1']] as const) {
      const zero = await fixture(swap('WETH_TO_USDC', amount, slippage));
      expect(zero.review.findings.map(finding => finding.code)).toEqual(['MOCKED_ARTIFACTS_NOT_EXECUTABLE', 'MOCKED_OUTPUT_ZERO']);
    }
  });

  it('keeps MOCKED provenance inside every artifact (R-6)', async () => {
    const { chain } = await fixture(swap('USDC_TO_WETH', '2', '50'), swap('WETH_TO_USDC', '1', '100'));
    for (const artifact of [...chain.quotes, chain.artifactSet, chain.simulation]) expect(JSON.stringify(artifact)).toMatch(/"MOCKED\./);
    expect(chain.quotes.map(quote => quote.normalizedValues[0])).toEqual(chain.quotes.map(() => ({ name: 'evidence-environment', kind: 'IDENTIFIER', value: 'MOCKED' })));
    expect(chain.simulation.uncertainty.map(entry => entry.code)).toEqual([...MOCKED_CHAIN_PROFILE.quoteUncertainty.map(entry => entry.code), 'MOCK_NODES_EXCLUDED']);
  });

  it('fails closed with DIGEST_UNAVAILABLE when the self-check fails', async () => {
    const { workflow, chain } = await fixture();
    vi.stubGlobal('crypto', { subtle: { digest: async () => new ArrayBuffer(32) } });
    await expect(reviewMockedArtifactChain({ chain, sourceWorkflow: workflow, currentWorkflow: workflow, nowMs: NOW }, context)).rejects.toThrow('DIGEST_UNAVAILABLE');
  });
});
