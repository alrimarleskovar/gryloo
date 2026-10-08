// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { CONCENTRATED_LIQUIDITY_ACTION, createConcentratedLiquidityNode, hashArtifactBytes, readConcentratedLiquidity, type ConcentratedLiquidityFields,
  type ConcentratedLiquidityNode } from '../src/index.js';

const devnet = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', base = 'eip155:8453';
const orca: ConcentratedLiquidityFields = { chain: devnet, token0: { chainId: devnet, address: 'So11111111111111111111111111111111111111112', decimals: 9 },
  token1: { chainId: devnet, address: 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k', decimals: 6 }, amount0Max: '10000000', amount1Max: '300000', amount0Min: '0', amount1Min: '0',
  tickLower: -39104, tickUpper: -36992, feeTier: 2000, slippageBps: 100, protocols: ['orca-whirlpools'], recipient: null,
  positionAsset: { chainId: devnet, address: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', decimals: 0 } };
/** The exact BUILD-006 node shape (apps/reference-dapp createLiquidityNode), reproduced without the app. */
const weth = { chainId: base, address: '0x4200000000000000000000000000000000000006', decimals: 18 }, usdc = { chainId: base, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6 };
const uniswap: ConcentratedLiquidityNode = { nodeId: 'node-002', actionType: 'asset.liquidity.uniswap-v3', actionSchemaVersion: '1.0.0', chainId: base,
  requiredCapabilities: ['liquidity.position-direct'], adapterConstraints: { adapters: [], protocols: ['uniswap-v3'] },
  inputs: [{ name: 'amount0-max', kind: 'QUANTITY', value: { asset: weth, amount: '100000000000000000' } }, { name: 'amount1-max', kind: 'QUANTITY', value: { asset: usdc, amount: '200000000' } },
    { name: 'amount0-min', kind: 'QUANTITY', value: { asset: weth, amount: '0' } }, { name: 'amount1-min', kind: 'QUANTITY', value: { asset: usdc, amount: '0' } },
    { name: 'tick-lower', kind: 'IDENTIFIER', value: 'tick:-100' }, { name: 'tick-upper', kind: 'IDENTIFIER', value: 'tick:100' }, { name: 'fee-tier', kind: 'INTEGER', value: 500 },
    { name: 'recipient', kind: 'ACCOUNT', value: { chainId: base, address: '0x1111111111111111111111111111111111111111' } }],
  expectedOutputs: [{ outputId: 'position-nft', asset: { chainId: base, address: '0x03a520b32c04bf3beef7beb72e919cf822ed34f1', decimals: 0 }, minimumAmount: '1' }],
  dependencies: [], userConstraints: [{ kind: 'MAXIMUM_INPUT', quantity: { asset: weth, amount: '100000000000000000' } }, { kind: 'MAXIMUM_INPUT', quantity: { asset: usdc, amount: '200000000' } }],
  failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A', lockedParameters: [], editableBounds: [] };
const hash = (node: ConcentratedLiquidityNode) => hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify({ schemaVersion: '1.0.0', workflowId: 'w', revision: 1, nodes: [node], resourceEdges: [] })));
describe('canonical concentrated-liquidity semantics', () => {
  it('accepts a locked parameter equal to its input in any key order and rejects any different value', () => {
    const amount = uniswap.inputs[0]!, fee = uniswap.inputs[6]!;
    const reordered = { value: { amount: '100000000000000000', asset: { decimals: 18, address: weth.address, chainId: base } }, kind: 'QUANTITY', name: 'amount0-max' };
    expect(hash({ ...uniswap, lockedParameters: [reordered, { value: 500, name: 'fee-tier', kind: 'INTEGER' }] } as never)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => hash({ ...uniswap, lockedParameters: [{ ...fee, value: 501 }] } as never)).toThrow('locked parameter value differs from input');
    expect(() => hash({ ...uniswap, lockedParameters: [{ ...amount, value: { ...reordered.value, amount: '1' } }] } as never)).toThrow('locked parameter value differs from input');
  });
  it('round-trips the neutral action and produces a schema-valid semantic workflow', () => {
    const node = createConcentratedLiquidityNode('node-002', orca);
    expect(node.actionType).toBe(CONCENTRATED_LIQUIDITY_ACTION);
    expect(readConcentratedLiquidity(node)).toEqual(orca);
    expect(createConcentratedLiquidityNode('node-002', readConcentratedLiquidity(node))).toEqual(node);
    expect(hash(node)).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it('reads the accepted BUILD-006 Uniswap v3 spelling with the same ports, without changing its bytes', () => {
    const before = JSON.stringify(uniswap), fields = readConcentratedLiquidity(uniswap);
    expect(JSON.stringify(uniswap)).toBe(before);
    expect(fields).toMatchObject({ chain: base, amount1Max: '200000000', tickLower: -100, tickUpper: 100, feeTier: 500, slippageBps: null, protocols: ['uniswap-v3'],
      recipient: { chainId: base, address: '0x1111111111111111111111111111111111111111' } });
    const neutral = createConcentratedLiquidityNode('node-002', orca);
    const shape = (n: ConcentratedLiquidityNode) => ({ maxima: n.inputs.filter(p => p.name.endsWith('-max') || p.name.endsWith('-min')).map(p => [p.name, p.kind]),
      range: n.inputs.filter(p => p.name.startsWith('tick-') || p.name === 'fee-tier').map(p => [p.name, p.kind]), outputs: n.expectedOutputs.map(o => o.outputId),
      capabilities: n.requiredCapabilities, authorization: n.requiredAuthorizationClass, failure: n.failurePolicy });
    expect(shape(neutral)).toEqual(shape(uniswap));
  });
  it('rejects zero maxima, minimum above maximum, inverted ranges, missing slippage and explicit recipients on the neutral action', () => {
    expect(() => createConcentratedLiquidityNode('n', { ...orca, amount0Max: '0', amount1Max: '0' })).toThrow('LIQUIDITY_FIELDS_INVALID');
    expect(() => createConcentratedLiquidityNode('n', { ...orca, amount1Min: '300001' })).toThrow('LIQUIDITY_FIELDS_INVALID');
    expect(() => createConcentratedLiquidityNode('n', { ...orca, tickLower: -36992, tickUpper: -39104 })).toThrow('LIQUIDITY_FIELDS_INVALID');
    expect(() => createConcentratedLiquidityNode('n', { ...orca, slippageBps: null })).toThrow('LIQUIDITY_FIELDS_INVALID');
    expect(() => createConcentratedLiquidityNode('n', { ...orca, recipient: { chainId: devnet, address: 'x' } })).toThrow('LIQUIDITY_FIELDS_INVALID');
    expect(() => createConcentratedLiquidityNode('n', { ...orca, token1: { ...orca.token1, chainId: base } })).toThrow('LIQUIDITY_FIELDS_INVALID');
  });
  it('rejects a node whose constraints disagree with its ports', () => {
    const node = createConcentratedLiquidityNode('n', orca);
    node.userConstraints[0] = { kind: 'MAXIMUM_INPUT', quantity: { asset: orca.token0, amount: '1' } };
    expect(() => readConcentratedLiquidity(node)).toThrow('LIQUIDITY_PORTS_INVALID');
    const extra = createConcentratedLiquidityNode('n', orca);
    extra.inputs.push({ name: 'recipient', kind: 'ACCOUNT', value: { chainId: devnet, address: 'x' } });
    expect(() => readConcentratedLiquidity(extra)).toThrow('LIQUIDITY_PORTS_INVALID');
  });
});
