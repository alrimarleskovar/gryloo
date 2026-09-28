import { describe, expect, it } from 'vitest';
import { createBridgeNode } from '../../../apps/reference-dapp/src/domain/bridge-authoring.js';
import { normalizeLifiQuote } from '../../../apps/reference-dapp/src/server/lifi-adapter.js';
import { rawQuote } from '../../../apps/reference-dapp/src/server/lifi-adapter.test.js';
import { compileBridge, verifyBridgeReview } from '../src/bridge.js';
const owner = '0x' + '1'.repeat(40);
describe('bridge compiler', () => {
  it('binds selected route, exact approval, source payload and both chains to the Manifest', () => {
    const workflow = { schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 1,
      nodes: [createBridgeNode('node-002', { amount: '1', slippageBps: '50' })], resourceEdges: [] };
    const quote = normalizeLifiQuote(rawQuote(), owner, '1000000', 50, Date.now());
    const compiled = compileBridge(workflow, quote, Date.now());
    expect(compiled.manifest.spendLimits[0]?.maximumAmount).toBe('1000000');
    expect(compiled.policy.allowlists.chains).toEqual(['eip155:8453', 'eip155:10']);
    expect(compiled.policy.allowlists.protocols).toContain('across');
    expect(compiled.plan.segments[0]?.steps).toHaveLength(2);
    expect(compiled.approval.data.startsWith('0x095ea7b3')).toBe(true);
    expect(() => verifyBridgeReview(compiled, quote, Date.parse(quote.expiresAt) + 1)).toThrow();
  });
});
