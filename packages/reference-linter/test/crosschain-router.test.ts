// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createRouterBridgeNode, type RouterBridgeFields } from '@defi-workflow-engine/workflow-contracts';
import { createReviewContext, lintWorkflow, validateAuthoringWorkflow, validateRouterBridgeWorkflow } from '../src/index.js';
import { createBridgeNode } from '../../../apps/reference-dapp/src/domain/bridge-authoring.js';

const context = createReviewContext({ registryId: referenceRegistry.registryId,
  capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const fields: RouterBridgeFields = { sourceChain: 'eip155:8453', destinationChain: 'eip155:42161', inputToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  outputToken: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', amount: '2500000', recipient: '0x3333333333333333333333333333333333333333', slippageBps: 50, providers: ['lifi', 'across'] };
const wf = (nodes: unknown[], resourceEdges: unknown[] = []) => ({ schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 3, nodes, resourceEdges });

describe('BUILD-ROUTER-001 router linter', () => {
  it('accepts the isolated canonical router node and requires a route review', () => {
    const node = createRouterBridgeNode('node-004', fields);
    expect(validateAuthoringWorkflow(wf([node]), context)).toBeTruthy();
    expect(validateRouterBridgeWorkflow(wf([node]) as never)).toEqual({ ...fields, nodeId: 'node-004' });
    expect(lintWorkflow(wf([node]), context).findings.map(f => f.code)).toEqual(['ROUTER_ROUTE_REQUIRED']);
  });
  it('refuses composition, edits outside the canonical declaration and destination substitution', () => {
    const node = createRouterBridgeNode('node-004', fields);
    expect(() => validateAuthoringWorkflow(wf([node, createRouterBridgeNode('node-005', fields)]), context)).toThrow('ROUTER_ISOLATED_ONLY');
    expect(() => validateAuthoringWorkflow(wf([{ ...node, dependencies: ['node-001'] }]), context)).toThrow();
    expect(() => validateAuthoringWorkflow(wf([{ ...node, requiredAuthorizationClass: 'MODE_B' }]), context)).toThrow('ROUTER_DECLARATION_INVALID');
    const owned = createRouterBridgeNode('node-004', { ...fields, recipient: 'CONNECTED_OWNER' });
    const optimism = { ...owned, inputs: owned.inputs.map(p => p.name === 'asset-out' ? { ...p, value: { chainId: 'eip155:10', address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', decimals: 6 } } : p),
      expectedOutputs: [{ outputId: 'amount-out', asset: { chainId: 'eip155:10', address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', decimals: 6 }, minimumAmount: '0' }] };
    expect(() => validateAuthoringWorkflow(wf([optimism]), context)).toThrow('ROUTER_PAIR_UNSUPPORTED');
    const minimum = { ...node, expectedOutputs: [{ ...node.expectedOutputs[0]!, minimumAmount: '1' }] };
    expect(() => validateAuthoringWorkflow(wf([minimum]), context)).toThrow('ROUTER_DECLARATION_INVALID');
  });
  it('leaves the BUILD-008 LI.FI bridge declaration on its own validator', () => {
    const legacy = createBridgeNode('node-002', { amount: '1', slippageBps: '50' });
    expect(validateAuthoringWorkflow(wf([legacy]), context)).toBeTruthy();
    expect(lintWorkflow(wf([legacy]), context).findings.map(f => f.code)).toEqual(['BRIDGE_QUOTE_REQUIRED']);
  });
});
