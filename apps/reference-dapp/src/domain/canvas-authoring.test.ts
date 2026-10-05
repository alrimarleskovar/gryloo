// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { readSupplyNode, readBorrowNode, readRepayNode, readWithdrawNode } from '@defi-workflow-engine/workflow-contracts';
import { canvasAddCommand } from './canvas-authoring';
import { editorReducer, initialEditor } from './editor';
import { workflowShellContext } from './product-shell';
import { lendingCanvasEdges } from './lending-authoring';

const owner = '0x1111111111111111111111111111111111111111';
const context = createBaseSepoliaReviewContext();
describe('canvas authoring through existing canonical commands', () => {
  it.each(['supply', 'borrow', 'repay', 'withdraw'] as const)('adds %s as an owner-bound canonical node and keeps connection guards', action => {
    const before = initialEditor();
    const after = editorReducer(before, canvasAddCommand(action, before.workflow.revision, owner), context);
    expect(after.error).toBeNull();
    const node = after.workflow.nodes.find(node => node.actionType === action)!;
    expect(node.chainId).toBe('eip155:84532');
    const fields = (action === 'supply' ? readSupplyNode : action === 'borrow' ? readBorrowNode : action === 'repay' ? readRepayNode : readWithdrawNode)(node as Parameters<typeof readSupplyNode>[0]);
    expect(fields.amount).toMatch(/^[1-9][0-9]*$/);
    if ('beneficiary' in fields) expect(fields.beneficiary).toBe(owner);
    if ('recipient' in fields) expect(fields.recipient).toBe('CONNECTED_OWNER');
    expect(workflowShellContext(after.workflow)).toMatchObject({ actionCount: 1, chains: ['Base Sepolia'] });
    const rejected = editorReducer(after, { type: 'CONNECT', from: 'node-001', to: node.nodeId, source: 'CANVAS', baseRevision: after.workflow.revision }, context);
    expect(rejected.error).toBe('ISOLATED_ACTION_EDGE_UNSUPPORTED');
    expect(rejected.workflow).toBe(after.workflow);
  });

  it.each(['supply', 'borrow', 'repay', 'lending'] as const)('requires a real beneficiary for %s without inventing an address', action => {
    expect(() => canvasAddCommand(action, 0, null, '1')).toThrow('Connect your wallet');
  });

  it.each(['bridge', 'pool'] as const)('%s produces a canonical action rather than a placeholder', action => {
    const result = editorReducer(initialEditor(), canvasAddCommand(action, 0, null, '1'), context);
    expect(result.error).toBeNull();
    const nodes = result.workflow.nodes.filter(node => !node.actionType.startsWith('mock-'));
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.actionType).toBe(action === 'bridge' ? 'asset.bridge' : 'asset.liquidity.concentrated');
  });

  it('preserves the existing linked Supply → Borrow → Swap composition and checkpoint', () => {
    const result = editorReducer(initialEditor(), canvasAddCommand('lending', 0, owner), context);
    expect(result.error).toBeNull();
    expect(result.workflow.nodes.map(node => node.actionType)).toEqual(['supply', 'borrow', 'asset.swap.exact-input']);
    expect(lendingCanvasEdges(result.workflow)).toHaveLength(2);
    expect(result.workflow.resourceEdges).toHaveLength(1);
  });
});
