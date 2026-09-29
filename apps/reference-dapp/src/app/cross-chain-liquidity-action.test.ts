// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createCrossChainLiquidityWorkflow } from '../domain/cross-chain-liquidity';
import { buildMockCrossChainLiquidityScenario } from './cross-chain-liquidity-action';
const owner = '0x1111111111111111111111111111111111111111';
const base = { amount: '100', bridgeSlippageBps: '50', swapSlippageBps: '50',
  tickLower: '-200100', tickUpper: '-199900', recipient: owner, provider: 'lifi.rest' as const, noSwap: false };
describe('BUILD-011C-1 server-side MOCKED trace', () => {
  it('shows estimated and independently reconciled output before a partial swap and completed LP', async () => {
    const trace = await buildMockCrossChainLiquidityScenario(createCrossChainLiquidityWorkflow('workflow-local', 1, base));
    expect(trace.snapshots.map(s => s.stage)).toEqual(['SOURCE PREPARED', 'BRIDGE SUBMITTED',
      'DESTINATION RECONCILED', 'PREPARATION REVIEWED', 'SWAP RECONCILED', 'LIQUIDITY SUBMITTED', 'COMPLETED']);
    expect(trace.snapshots[1]?.actual).toBeNull();
    expect(trace.snapshots[2]?.actual).not.toBe(trace.estimatedBridgeUsdc);
    expect(trace.snapshots[3]?.swapInput).not.toBe(trace.snapshots[3]?.actual);
    expect(trace.snapshots.at(-1)?.lp).toBe('77');
    expect(trace.sourceManifestHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(trace.sourceManifestHash).not.toBe(trace.hashes.manifest);
    expect(trace.evidenceHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it.each(['SWAP_REVERT', 'MINT_REVERT', 'MINT_UNKNOWN_INCONCLUSIVE', 'POLICY_EXPIRED', 'ARTIFACT_STALE', 'LATE_BRIDGE_SETTLEMENT'] as const)(
    'exposes MOCKED partial evidence for %s', async failure => {
      const trace = await buildMockCrossChainLiquidityScenario(createCrossChainLiquidityWorkflow('workflow-local', 1, base), failure);
      expect(trace.snapshots.at(-1)?.stage).toMatch(/PARTIALLY COMPLETED|RECOVERY REQUIRED/);
      expect(trace.recovery?.workflowState).toBe('PARTIALLY_COMPLETED');
      expect(trace.recovery?.balances.usdc).not.toBeNull();
      expect(trace.recovery?.options.find(o => o.action === 'MANUAL')?.status).toBe('AVAILABLE');
      expect(trace.evidenceHash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  it('creates fresh artifacts and a distinct Manifest for stale destination preparation', async () => {
    const trace = await buildMockCrossChainLiquidityScenario(createCrossChainLiquidityWorkflow('workflow-local', 1, base), 'ARTIFACT_STALE');
    expect(trace.requote?.artifactSet).not.toBe(trace.hashes.artifactSet);
    expect(trace.requote?.simulation).not.toBe(trace.hashes.simulation);
    expect(trace.requote?.manifest).not.toBe(trace.hashes.manifest);
    expect(trace.requote?.review).toBe('REQUIRES_NEW_AUTHORIZATION');
  });
  it('reconciles an unknown mint to one LP position', async () => {
    const trace = await buildMockCrossChainLiquidityScenario(createCrossChainLiquidityWorkflow('workflow-local', 1, base),
      'MINT_UNKNOWN_CONFIRMED');
    expect(trace.snapshots.at(-2)?.stage).toBe('SUBMISSION RESULT UNKNOWN');
    expect(trace.snapshots.at(-1)?.lp).toBe('77');
    expect(trace.recovery).toBeNull();
  });
  it('keeps a one-sided no-swap path with zero destination swap gas', async () => {
    const trace = await buildMockCrossChainLiquidityScenario(createCrossChainLiquidityWorkflow('workflow-local', 1,
      { ...base, noSwap: true, provider: 'across.direct' }));
    expect(trace.snapshots).toHaveLength(6);
    expect(trace.snapshots.some(s => s.stage === 'SWAP RECONCILED')).toBe(false);
    expect(trace.destinationSwapGasEth).toBe('0.0');
    expect(trace.snapshots.at(-1)?.lp).toBe('77');
  });
});
