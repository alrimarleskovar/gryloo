// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createExactInputSwapNode, readExactInputSwap, hashArtifactBytes, EXACT_INPUT_SWAP_ACTION } from '../src/index.js';

const solana = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', base = 'eip155:84532';
const sol = { chain: solana, input: { chainId: solana, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  output: { chainId: solana, address: 'So11111111111111111111111111111111111111112', decimals: 9 }, amount: '10000000', slippageBps: 50, protocols: ['jupiter'], maximumAmount: '1000000000000' };
const evm = { chain: base, input: { chainId: base, address: '0x036cbd53842c5426634e7929541ec2318f3dcf7e', decimals: 6 },
  output: { chainId: base, address: '0x4200000000000000000000000000000000000006', decimals: 18 }, amount: '1000000', slippageBps: 50, protocols: ['uniswap'], maximumAmount: '1000000000' };
describe('canonical swap portability', () => {
  it('uses one action and one port shape on EVM and Solana', () => {
    const a = createExactInputSwapNode('node-002', evm), b = createExactInputSwapNode('node-002', sol);
    expect(a.actionType).toBe(EXACT_INPUT_SWAP_ACTION); expect(b.actionType).toBe(EXACT_INPUT_SWAP_ACTION);
    const shape = (n: typeof a) => ({ inputs: n.inputs.map(p => [p.name, p.kind]), outputs: n.expectedOutputs.map(o => o.outputId),
      constraints: n.userConstraints.map(c => c.kind), capabilities: n.requiredCapabilities, authorization: n.requiredAuthorizationClass });
    expect(shape(a)).toEqual(shape(b));
    expect(readExactInputSwap(a)).toEqual(evm); expect(readExactInputSwap(b)).toEqual(sol);
    for (const node of [a, b]) expect(hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify({ schemaVersion: '1.0.0', workflowId: 'w', revision: 1, nodes: [node], resourceEdges: [] })))).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it('rejects cross-chain assets, identical assets, invalid amounts and slippage', () => {
    expect(() => createExactInputSwapNode('n', { ...sol, output: { ...sol.output, chainId: base } })).toThrow('SWAP_FIELDS_INVALID');
    expect(() => createExactInputSwapNode('n', { ...sol, output: sol.input })).toThrow('SWAP_FIELDS_INVALID');
    for (const amount of ['0', '01', '1.5', '1000000000001']) expect(() => createExactInputSwapNode('n', { ...sol, amount })).toThrow('SWAP_FIELDS_INVALID');
    expect(() => createExactInputSwapNode('n', { ...sol, slippageBps: 10_001 })).toThrow('SWAP_FIELDS_INVALID');
  });
  it('rejects a node whose constraint disagrees with its input', () => {
    const node = createExactInputSwapNode('n', sol);
    node.userConstraints = [{ kind: 'MAXIMUM_INPUT', quantity: { asset: sol.input, amount: '1' } }, node.userConstraints[1]!];
    expect(() => readExactInputSwap(node)).toThrow('SWAP_PORTS_INVALID');
  });
});
