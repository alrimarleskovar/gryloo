// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { invalidationFor } from '@defi-workflow-engine/workflow-contracts';
import { INVALIDATION_V1, VALIDITY_MS, chainReducer, chainStatus, checkChainAccess, initialChainState, requireCurrentChain, type ChainRecord, type ChainState } from './artifact-chain';
import { editorReducer, initialEditor } from './editor';
import { generateMockedChain } from './mock-artifacts';

const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const NOW = Date.parse('2026-09-24T12:00:10.000Z');
const MONO = 5_000;
const authored = editorReducer(initialEditor(), { type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '2', slippage: '50', source: 'CHAT', baseRevision: 0 }, context).workflow;
const edited = editorReducer({ workflow: authored, error: null }, { type: 'SET_SLIPPAGE', nodeId: 'node-002', slippage: '60', source: 'CHAT', baseRevision: 1 }, context).workflow;

async function record(generation = 1): Promise<ChainRecord> {
  const { chain, review } = await generateMockedChain(authored, context, { nowMs: NOW, generation });
  return { chain, review, sourceWorkflow: authored, generation, observedAtMs: NOW, expiresAtMs: NOW + VALIDITY_MS, monotonicStartMs: MONO };
}
async function current(): Promise<ChainState> {
  const started = chainReducer(initialChainState(), { type: 'GENERATE_STARTED', workflow: authored, generation: 1 });
  return chainReducer(started, { type: 'GENERATE_SUCCEEDED', record: await record(), currentWorkflow: authored });
}

describe('mocked chain transitions', () => {
  it('moves EMPTY → GENERATING → CURRENT and ignores duplicate or mismatched events', async () => {
    const empty = initialChainState();
    expect(chainStatus(empty)).toBe('EMPTY');
    const started = chainReducer(empty, { type: 'GENERATE_STARTED', workflow: authored, generation: 1 });
    expect(chainStatus(started)).toBe('GENERATING');
    expect(chainReducer(started, { type: 'GENERATE_STARTED', workflow: authored, generation: 2 })).toBe(started);
    expect(chainReducer(started, { type: 'GENERATE_SUCCEEDED', record: await record(9), currentWorkflow: authored })).toBe(started);
    const done = chainReducer(started, { type: 'GENERATE_SUCCEEDED', record: await record(), currentWorkflow: authored });
    expect(chainStatus(done)).toBe('CURRENT');
  });

  it('discards a completion for a superseded revision (race)', async () => {
    const started = chainReducer(initialChainState(), { type: 'GENERATE_STARTED', workflow: authored, generation: 1 });
    const raced = chainReducer(started, { type: 'GENERATE_SUCCEEDED', record: await record(), currentWorkflow: edited });
    expect(raced.record).toBeNull();
    expect(chainStatus(raced)).toBe('EMPTY');
    expect(raced.notice).toBe('GENERATION_DISCARDED_SUPERSEDED_REVISION');
    const withPrior = { ...(await current()), pending: { workflow: authored, generation: 2 } };
    const racedAgain = chainReducer(withPrior, { type: 'GENERATE_SUCCEEDED', record: await record(2), currentWorkflow: edited });
    expect(chainStatus(racedAgain)).toBe('INVALIDATED');
  });

  it('invalidates on an accepted semantic edit only', async () => {
    const state = await current();
    expect(chainReducer(state, { type: 'REVISION_ACCEPTED', workflow: authored })).toBe(state);
    const invalidated = chainReducer(state, { type: 'REVISION_ACCEPTED', workflow: edited });
    expect(chainStatus(invalidated)).toBe('INVALIDATED');
    expect(invalidated.retired).toEqual({ reason: 'SEMANTIC_EDIT', atRevision: 2 });
    const expired = chainReducer(state, { type: 'ACCESS_CHECK', workflow: authored, wallNowMs: NOW + VALIDITY_MS, monotonicNowMs: MONO });
    expect(chainStatus(expired)).toBe('EXPIRED');
    expect(chainStatus(chainReducer(expired, { type: 'REVISION_ACCEPTED', workflow: edited }))).toBe('INVALIDATED');
  });

  it('withdraws every chain when generation or the self-check fails', async () => {
    const pending = chainReducer(await current(), { type: 'GENERATE_STARTED', workflow: authored, generation: 2 });
    expect(chainReducer(pending, { type: 'GENERATE_FAILED', code: 'DIGEST_UNAVAILABLE', generation: 1 })).toBe(pending);
    const failed = chainReducer(pending, { type: 'GENERATE_FAILED', code: 'DIGEST_UNAVAILABLE', generation: 2 });
    expect(chainStatus(failed)).toBe('REJECTED');
    expect(failed.record).toBeNull();
    expect(checkChainAccess(failed, authored, NOW, MONO)).toEqual({ ok: false, code: 'ARTIFACTS_UNAVAILABLE' });
  });
});

describe('access guard (R-5, R-7)', () => {
  it('binds content to the exact revision and IR object', async () => {
    const state = await current();
    expect(checkChainAccess(state, authored, NOW, MONO).ok).toBe(true);
    expect(checkChainAccess(state, edited, NOW, MONO)).toEqual({ ok: false, code: 'ARTIFACTS_STALE' });
    const sameRevisionOtherObject = structuredClone(authored);
    expect(checkChainAccess(state, sameRevisionOtherObject, NOW, MONO)).toEqual({ ok: false, code: 'ARTIFACTS_STALE' });
    expect(() => requireCurrentChain(state, edited, NOW, MONO)).toThrow('ARTIFACTS_STALE');
  });

  it('expires by wall clock, backwards wall clock or monotonic time, whichever comes first', async () => {
    const state = await current();
    const at = (wall: number, mono: number) => checkChainAccess(state, authored, wall, mono);
    expect(at(NOW + VALIDITY_MS - 1, MONO + VALIDITY_MS - 1).ok).toBe(true);
    expect(at(NOW + VALIDITY_MS, MONO)).toEqual({ ok: false, code: 'ARTIFACTS_EXPIRED' });
    expect(at(NOW - 1, MONO)).toEqual({ ok: false, code: 'ARTIFACTS_EXPIRED' });
    expect(at(NOW, MONO + VALIDITY_MS)).toEqual({ ok: false, code: 'ARTIFACTS_EXPIRED' });
    expect(at(NOW, MONO - 1)).toEqual({ ok: false, code: 'ARTIFACTS_EXPIRED' });
    expect(at(Number.NaN, MONO)).toEqual({ ok: false, code: 'ARTIFACTS_EXPIRED' });
    expect(() => requireCurrentChain(state, authored, NOW + VALIDITY_MS, MONO)).toThrow('ARTIFACTS_EXPIRED');
    const persisted = chainReducer(state, { type: 'ACCESS_CHECK', workflow: authored, wallNowMs: NOW, monotonicNowMs: MONO + VALIDITY_MS });
    expect(chainStatus(persisted)).toBe('EXPIRED');
    expect(checkChainAccess(persisted, authored, NOW, MONO)).toEqual({ ok: false, code: 'ARTIFACTS_EXPIRED' });
    expect(chainReducer(state, { type: 'ACCESS_CHECK', workflow: authored, wallNowMs: NOW, monotonicNowMs: MONO })).toBe(state);
  });

  it('mirrors the frozen invalidation matrix', () => {
    for (const change of ['SEMANTIC_EDIT', 'QUOTE_REFRESH', 'ARTIFACT_EXPIRED'] as const) expect([...INVALIDATION_V1[change]]).toEqual([...invalidationFor(change)]);
  });
});
