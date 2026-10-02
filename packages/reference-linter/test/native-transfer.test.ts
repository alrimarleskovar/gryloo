// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createNativeTransferNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createBaseSepoliaReviewContext, validateAuthoringWorkflow } from '../src/index.js';

const node = (chain = 'eip155:46630', amount = '1000000000000', id = 'node-002') => createNativeTransferNode(id, { chain, amount, recipient: 'CONNECTED_OWNER' });
const workflow = (...nodes: SemanticWorkflow['nodes']): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'rh', revision: 0, nodes, resourceEdges: [] });
describe('RH-DEMO-001 authoring validation', () => {
  it('accepts one isolated Robinhood Testnet self-transfer', () => {
    expect(validateAuthoringWorkflow(workflow(node()), createBaseSepoliaReviewContext()).nodes).toHaveLength(1);
  });
  it('refuses other networks, oversize values and composition', () => {
    const context = createBaseSepoliaReviewContext();
    expect(() => validateAuthoringWorkflow(workflow(node('eip155:4663')), context)).toThrow('TRANSFER_NETWORK_UNSUPPORTED');
    expect(() => validateAuthoringWorkflow(workflow(node('eip155:84532')), context)).toThrow('TRANSFER_NETWORK_UNSUPPORTED');
    expect(() => validateAuthoringWorkflow(workflow(node('eip155:46630', '1000000000000001')), context)).toThrow('TRANSFER_AMOUNT_OUT_OF_RANGE');
    expect(() => validateAuthoringWorkflow(workflow(node(), node(undefined, undefined, 'node-003')), context)).toThrow('TRANSFER_ISOLATED_ONLY');
  });
});
