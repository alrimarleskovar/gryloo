// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { readRouterBridgeNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { commandIsValid, parseLocalCommand, summarize, type Command } from './commands';
import { editorReducer, initialEditor } from './editor';
import { createRouterNode, parseRouterChat, routerDetails, routerInputOf, type RouterBridgeInput } from './router-authoring';

const context = createBaseSepoliaReviewContext();
const canvasInput: RouterBridgeInput = { source: 'Base', destination: 'Arbitrum', token: 'USDC', amount: '5', recipient: '0x6666666666666666666666666666666666666666',
  slippage: '50', routing: 'LIFI' };
const apply = (command: Command) => { const r = editorReducer(initialEditor(), command, context); if (r.error) throw new Error(r.error); return r.workflow as unknown as SemanticWorkflow; };

describe('BUILD-ROUTER-001 Guided Chat / Canvas authoring', () => {
  it('chat and canvas produce the identical canonical IR', () => {
    const chat = parseLocalCommand('Bridge 5 USDC from Base to Arbitrum to 0x6666666666666666666666666666666666666666 via LI.FI slippage 50 bps', initialEditor().workflow, context);
    expect(chat).toEqual({ type: 'ADD_ROUTER_BRIDGE', input: canvasInput, source: 'CHAT', baseRevision: 0 });
    const fromChat = apply(chat), fromCanvas = apply({ type: 'ADD_ROUTER_BRIDGE', input: canvasInput, source: 'CANVAS', baseRevision: 0 });
    expect(fromChat).toEqual(fromCanvas);
    expect(fromChat.nodes).toHaveLength(1);
    expect(readRouterBridgeNode(fromChat.nodes[0]!)).toMatchObject({ amount: '5000000', recipient: canvasInput.recipient, slippageBps: 50, providers: ['lifi'] });
    expect(summarize(fromChat)).toContain('Cross-chain bridge 5 USDC from Base to Arbitrum');
  });
  it('defaults: connected wallet, automatic routing and default slippage', () => {
    expect(parseRouterChat('bridge 1.25 USDC from Base to Arbitrum')).toEqual({ source: 'Base', destination: 'Arbitrum', token: 'USDC', amount: '1.25', recipient: '',
      slippage: '50', routing: 'AUTO' });
    const w = apply({ type: 'ADD_ROUTER_BRIDGE', input: parseRouterChat('bridge 1.25 USDC from Base to Arbitrum via Across')!, source: 'CHAT', baseRevision: 0 });
    expect(readRouterBridgeNode(w.nodes[0]!)).toMatchObject({ recipient: 'CONNECTED_OWNER', providers: ['across'] });
  });
  it('edits round-trip and an identical edit is a no-op; changing recipient or amount is a new revision', () => {
    const w = apply({ type: 'ADD_ROUTER_BRIDGE', input: canvasInput, source: 'CANVAS', baseRevision: 0 });
    const node = w.nodes[0]!, details = routerDetails(node)!;
    expect(routerInputOf(details)).toEqual(canvasInput);
    const same = editorReducer({ workflow: w, error: null }, { type: 'SET_ROUTER_BRIDGE', nodeId: node.nodeId, input: canvasInput, source: 'CANVAS', baseRevision: w.revision }, context);
    expect(same.workflow).toBe(w);
    const changed = editorReducer({ workflow: w, error: null }, { type: 'SET_ROUTER_BRIDGE', nodeId: node.nodeId, input: { ...canvasInput, recipient: '' }, source: 'CANVAS',
      baseRevision: w.revision }, context);
    expect(changed.workflow.revision).toBe(w.revision + 1);
    expect(routerDetails(changed.workflow.nodes[0]!)!.recipient).toBe('');
  });
  it('rejects malformed commands and inputs outside the supported pair and bounds', () => {
    expect(commandIsValid({ type: 'ADD_ROUTER_BRIDGE', input: { ...canvasInput, extra: 'x' }, source: 'CANVAS', baseRevision: 0 })).toBe(false);
    expect(commandIsValid({ type: 'ADD_ROUTER_BRIDGE', input: { ...canvasInput, amount: '1000' }, source: 'CANVAS', baseRevision: 0 })).toBe(false);
    expect(() => createRouterNode('n', { ...canvasInput, destination: 'Optimism' as 'Arbitrum' })).toThrow('ROUTER_PAIR_UNSUPPORTED');
    expect(() => createRouterNode('n', { ...canvasInput, recipient: '0x123' })).toThrow('ROUTER_RECIPIENT_INVALID');
    expect(() => createRouterNode('n', { ...canvasInput, slippage: '301' })).toThrow('ROUTER_SLIPPAGE_OUT_OF_RANGE');
    expect(() => createRouterNode('n', { ...canvasInput, routing: 'STARGATE' as 'AUTO' })).toThrow('ROUTER_PROVIDER_POLICY_INVALID');
    expect(parseRouterChat('bridge 5 USDC from Base to Optimism')).toBeNull();
  });
});
