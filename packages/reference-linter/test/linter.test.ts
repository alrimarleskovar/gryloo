// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, lintWorkflow } from '../src/index.js';
import { initialWorkflow } from '../../../apps/reference-dapp/src/domain/initial-workflow';
import { createSwapNode } from '../../../apps/reference-dapp/src/domain/swap-authoring';

const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const make = (bps: number) => ({ ...initialWorkflow(), nodes: [...initialWorkflow().nodes, createSwapNode('node-002', 'USDC_TO_WETH', '2', String(bps), context)] });

describe('deterministic swap review', () => {
  it.each([[0, 'ZERO_SLIPPAGE'], [1, null], [100, null], [101, 'ELEVATED_SLIPPAGE'], [300, 'ELEVATED_SLIPPAGE'], [301, 'SLIPPAGE_ABOVE_REVIEW_LIMIT'], [10000, 'SLIPPAGE_ABOVE_REVIEW_LIMIT']] as const)('%i bps', (bps, code) => {
    const result = lintWorkflow(make(bps), context);
    expect(result.findings.some(f => f.code === code)).toBe(code !== null);
    expect(result.findings.some(f => f.code === 'UNQUOTED_EXECUTION_UNAVAILABLE')).toBe(true);
    expect(result.executable).toBe(false);
    expect(result.enforcement).toBe('NOT_ENFORCED');
  });
  it('blocks missing or duplicated slippage and never changes input', () => {
    for (const constraints of [[], [{ kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: 50 }, { kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: 50 }]]) {
      const workflow = structuredClone(make(50));
      workflow.nodes[1]!.userConstraints = [workflow.nodes[1]!.userConstraints[0]!, ...constraints] as never;
      const before = JSON.stringify(workflow);
      const one = lintWorkflow(workflow, context), two = lintWorkflow(workflow, context);
      expect(one).toEqual(two);
      expect(one.findings.map(f => f.code)).toContain('SLIPPAGE_REQUIRED_ONCE');
      expect(JSON.stringify(workflow)).toBe(before);
    }
  });
});
