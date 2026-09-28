import { describe, expect, it } from 'vitest';
import { createBridgeNode } from '../../../apps/reference-dapp/src/domain/bridge-authoring.js';
import { normalizeLifiQuote } from '../../../apps/reference-dapp/src/server/lifi-adapter.js';
import { rawQuote } from '../../../apps/reference-dapp/src/server/lifi-adapter.test.js';
import { compileBridge } from '@defi-workflow-engine/reference-compiler';
import { reconcileBridgeDestination } from '../src/bridge.js';
const owner = '0x' + '1'.repeat(40), sourceHash = '0x' + 'a'.repeat(64), destinationHash = '0x' + 'b'.repeat(64);
describe('bridge destination reconciliation', () => {
  it('needs matching chain, recipient, receipt and sufficient destination delta', () => {
    const workflow = { schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 1,
      nodes: [createBridgeNode('node-002', { amount: '1', slippageBps: '50' })], resourceEdges: [] };
    const quote = normalizeLifiQuote(rawQuote(), owner, '1000000', 50, Date.now());
    const compiled = compileBridge(workflow, quote, Date.now());
    const observation = { source: { chainId: 8453 as const, transactionHash: sourceHash, status: 1 as const },
      destination: { chainId: 10 as const, transactionHash: destinationHash, status: 1 as const,
        token: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', recipient: owner,
        balanceBefore: '10', balanceAfter: '995010' } };
    expect(reconcileBridgeDestination(quote, compiled, sourceHash, destinationHash, observation).outcome).toBe('RECONCILED');
    expect(reconcileBridgeDestination(quote, compiled, sourceHash, destinationHash,
      { ...observation, destination: { ...observation.destination, recipient: '0x' + '2'.repeat(40) } }).outcome).toBe('INCONCLUSIVE');
    expect(reconcileBridgeDestination(quote, compiled, sourceHash, destinationHash,
      { ...observation, destination: { ...observation.destination, balanceAfter: '994000' } }).outcome).toBe('INCONCLUSIVE');
  });
});
