// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { initialWorkflow, type Workflow } from './initial-workflow';
import {
  checkObservationAccess, initialObservationState, observationReducer, observationView, receiveObservation,
  type ObservationRecord,
} from './base-observation';

const workflow = initialWorkflow();
const context = createReviewContext({
  registryId: referenceRegistry.registryId,
  capabilityId: referenceRegistry.capabilities[0]!.id,
  actionId: referenceRegistry.actions[0]!.id,
  assets: baseAssetRegistry,
});
const record = (sourceWorkflow: Workflow = workflow): ObservationRecord => ({
  nodeId: 'node-002', sourceWorkflow,
  review: {
    nodeId: 'node-002', revision: sourceWorkflow.revision,
    observedAt: '2026-09-24T12:00:00.000Z', expiresAt: '2026-09-24T12:00:15.000Z',
    facts: {
      mode: 'RECORDED_REPLAY', providerHost: 'base-mainnet.g.alchemy.com', chainId: 8453,
      swap: { from: 'WETH', to: 'USDC', amountIn: '1000000000000000000' },
      block: { number: 1, hash: `0x${'ab'.repeat(32)}`, timestamp: 1790251200 },
      code: { usdc: 'a', weth: 'b', factory: 'c', quoter: 'd' },
      assets: { USDC: { decimals: 6, symbol: 'USDC' }, WETH: { decimals: 18, symbol: 'WETH' } },
      tiers: [
        { fee: 100, pool: null, status: 'NO_POOL', amountOut: null },
        { fee: 500, pool: '0x123', status: 'FULL_INPUT_NOT_PROVEN', amountOut: null },
        { fee: 3000, pool: '0x456', status: 'QUOTED', amountOut: '2500000000' },
        { fee: 10000, pool: '0x789', status: 'ZERO_OUTPUT', amountOut: null },
      ],
    },
  },
  observedAtMs: Date.parse('2026-09-24T12:00:00.000Z'),
  expiresAtMs: Date.parse('2026-09-24T12:00:15.000Z'),
  receivedAtMs: Date.parse('2026-09-24T12:00:01.000Z'), monotonicStartMs: 100,
}) as unknown as ObservationRecord;

describe('browser observation boundary', () => {
  it('rejects a failed server result without producing a record', async () => {
    await expect(receiveObservation({ ok: false, code: 'REPLAY_MISMATCH', message: 'No recording', requestsSent: 0 },
      { nodeId: 'node-002', sourceWorkflow: workflow, currentWorkflow: workflow, wallNowMs: 0, monotonicNowMs: 0 }, context))
      .rejects.toMatchObject({ code: 'REPLAY_MISMATCH', requestsSent: 0 });
    await expect(receiveObservation({ ok: true, artifact: '{', transcript: '{}' },
      { nodeId: 'node-002', sourceWorkflow: workflow, currentWorkflow: workflow, wallNowMs: 0, monotonicNowMs: 0 }, context))
      .rejects.toMatchObject({ code: 'DERIVATION_MISMATCH' });
  });

  it('keeps reads separate from the immutable workflow and ignores stale completions', () => {
    const before = JSON.stringify(workflow);
    const started = observationReducer(initialObservationState(), { type: 'READ_STARTED', nodeId: 'node-002', token: 1, workflow });
    expect(observationReducer(started, { type: 'READ_STARTED', nodeId: 'node-002', token: 2, workflow })).toBe(started);
    expect(observationReducer(started, { type: 'READ_FAILED', nodeId: 'node-002', token: 2, code: 'X', message: 'X' })).toBe(started);
    const current = observationReducer(started, { type: 'READ_SUCCEEDED', nodeId: 'node-002', token: 1, record: record(), currentWorkflow: workflow });
    expect(current['node-002']?.status).toBe('CURRENT');
    expect(JSON.stringify(workflow)).toBe(before);
    const edit = { ...workflow, revision: 1 } as Workflow;
    const retired = observationReducer(current, { type: 'REVISION_ACCEPTED', workflow: edit });
    expect(retired['node-002']).toMatchObject({ status: 'RETIRED', reason: 'SEMANTIC_EDIT', atRevision: 1 });
    const late = observationReducer(started, { type: 'READ_SUCCEEDED', nodeId: 'node-002', token: 1, record: record(), currentWorkflow: edit });
    expect(late['node-002']).toMatchObject({ status: 'RETIRED', reason: 'SEMANTIC_EDIT' });
  });

  it('rechecks wall time, monotonic time, and workflow identity on every access', () => {
    const current = { status: 'CURRENT', record: record() } as const;
    expect(checkObservationAccess(current, workflow, Date.parse('2026-09-24T12:00:02.000Z'), 200).ok).toBe(true);
    expect(checkObservationAccess(current, workflow, Date.parse('2026-09-24T12:00:15.000Z'), 200)).toMatchObject({ code: 'OBSERVATION_EXPIRED' });
    expect(checkObservationAccess(current, workflow, Date.parse('2026-09-24T12:00:02.000Z'), 99)).toMatchObject({ code: 'OBSERVATION_EXPIRED' });
    expect(checkObservationAccess(current, workflow, Date.parse('2026-09-24T12:00:02.000Z'), 14100)).toMatchObject({ code: 'OBSERVATION_EXPIRED' });
    expect(checkObservationAccess(current, { ...workflow }, Date.parse('2026-09-24T12:00:02.000Z'), 200)).toMatchObject({ code: 'OBSERVATION_STALE' });
    const expired = observationReducer({ 'node-002': current }, { type: 'ACCESS_CHECK', workflow,
      wallNowMs: Date.parse('2026-09-24T12:00:15.000Z'), monotonicNowMs: 200 });
    expect(expired['node-002']).toMatchObject({ status: 'RETIRED', reason: 'EXPIRED' });
  });

  it('never places withheld amounts in the view model', () => {
    const view = observationView(record(), context);
    expect(view.modeLabel).toBe('RECORDED REPLAY · NOT LIVE');
    expect(view.tiers.map(tier => tier.amount?.units ?? null)).toEqual([null, null, '2500000000', null]);
  });
});
