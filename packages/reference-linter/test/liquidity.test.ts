// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, liquidityDetails, parseTick, validateAuthoringWorkflow } from '../src/index.js';
import { initialWorkflow } from '../../../apps/reference-dapp/src/domain/initial-workflow';
import { createLiquidityNode } from '../../../apps/reference-dapp/src/domain/liquidity-authoring';
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
  actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const recipient = '0x1111111111111111111111111111111111111111';
const node = () => createLiquidityNode('node-002', { weth: '0.1', usdc: '200', minimumWeth: '0', minimumUsdc: '0', tickLower: '-100', tickUpper: '100', recipient }, context);
const workflow = () => ({ ...structuredClone(initialWorkflow()), revision: 1, nodes: [...structuredClone(initialWorkflow().nodes), node()] });
describe('BUILD-006 liquidity ingress', () => {
  it('uses one strict signed tick profile without changing frozen INTEGER', () => {
    expect(parseTick('tick:-100')).toBe(-100);
    for (const value of ['-100', 'tick:-0', 'tick:+100', 'tick:01', 'tick:887273', 'tick:abc']) expect(() => parseTick(value)).toThrow();
  });
  it('accepts only the isolated capability, assets, fee, range, recipient and max constraints', () => {
    const valid = workflow(); expect(validateAuthoringWorkflow(valid, context)).toBe(valid);
    expect(liquidityDetails(valid.nodes[1]!, context)?.amountUsdc).toBe('200000000');
    for (const mutate of [
      (n: ReturnType<typeof node>) => { n.requiredCapabilities[0] = 'swap.direct-transaction'; },
      (n: ReturnType<typeof node>) => { n.inputs[6] = { name: 'fee-tier', kind: 'INTEGER', value: 3000 }; },
      (n: ReturnType<typeof node>) => { n.inputs[4] = { name: 'tick-lower', kind: 'IDENTIFIER', value: 'tick:-99' }; },
      (n: ReturnType<typeof node>) => { n.inputs[7] = { name: 'recipient', kind: 'ACCOUNT', value: { chainId: 'eip155:1', address: '0x2222222222222222222222222222222222222222' } }; },
      (n: ReturnType<typeof node>) => { n.userConstraints[0] = { kind: 'MAXIMUM_INPUT', quantity: { asset: context.assets.WETH.asset, amount: '1' } }; },
      (n: ReturnType<typeof node>) => { n.expectedOutputs[0]!.minimumAmount = '0'; },
    ]) {
      const invalid = workflow(); mutate(invalid.nodes[1]!); expect(() => validateAuthoringWorkflow(invalid, context)).toThrow();
    }
  });
  it('refuses graph composition', () => {
    const invalid = workflow(); invalid.nodes[1]!.dependencies.push('node-001');
    expect(() => validateAuthoringWorkflow(invalid, context)).toThrow();
  });
});
