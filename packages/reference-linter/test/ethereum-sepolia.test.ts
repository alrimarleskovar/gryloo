// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createBorrowNode, createNativeTransferNode, createSupplyNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_BASE_SEPOLIA as base, AAVE_V3_ETHEREUM_SEPOLIA as eth } from '@defi-workflow-engine/action-registry';
import { createBaseSepoliaReviewContext, validateAuthoringWorkflow } from '../src/index.js';

const owner = '0x1111111111111111111111111111111111111111', context = createBaseSepoliaReviewContext();
const flow = (node: SemanticWorkflow['nodes'][number]): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'eth', revision: 0, nodes: [node], resourceEdges: [] });
const wbtc = { chainId: eth.chain, address: eth.asset, decimals: 8 };

describe('BUILD-ETHEREUM-001 authoring validation', () => {
  it('accepts the Ethereum Sepolia WBTC profile for Supply and Borrow', () => {
    expect(() => validateAuthoringWorkflow(flow(createSupplyNode('s', { chain: eth.chain, asset: wbtc, amount: '100000', beneficiary: owner })), context)).not.toThrow();
    expect(() => validateAuthoringWorkflow(flow(createBorrowNode('b', { chain: eth.chain, asset: wbtc, amount: '1000', beneficiary: owner, interestRateMode: 2 })), context)).not.toThrow();
  });
  it('rejects another network asset, wrong decimals and unregistered chains', () => {
    const cases = [
      { chain: eth.chain, asset: { chainId: eth.chain, address: base.asset, decimals: 6 } },
      { chain: eth.chain, asset: { ...wbtc, decimals: 6 } },
      { chain: base.chain, asset: { ...wbtc, chainId: base.chain } },
      { chain: 'eip155:1', asset: { ...wbtc, chainId: 'eip155:1' } },
    ];
    for (const { chain, asset } of cases)
      expect(() => validateAuthoringWorkflow(flow(createSupplyNode('s', { chain, asset, amount: '1', beneficiary: owner })), context)).toThrow('SUPPLY_DEPLOYMENT_UNSUPPORTED');
  });
  it('accepts the native transfer on Ethereum Sepolia and refuses Mainnet and amounts above the test cap', () => {
    const transfer = (chain: string, amount = '1000000000000') => flow(createNativeTransferNode('t', { chain, amount, recipient: 'CONNECTED_OWNER' }));
    expect(() => validateAuthoringWorkflow(transfer(eth.chain), context)).not.toThrow();
    expect(() => validateAuthoringWorkflow(transfer('eip155:1'), context)).toThrow('TRANSFER_NETWORK_UNSUPPORTED');
    expect(() => validateAuthoringWorkflow(transfer(eth.chain, '1000000000000001'), context)).toThrow('TRANSFER_AMOUNT_OUT_OF_RANGE');
  });
});
