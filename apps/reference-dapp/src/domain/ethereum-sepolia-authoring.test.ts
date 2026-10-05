// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-ETHEREUM-001: authoring Aave WBTC and the native transfer on Ethereum Sepolia, chat and canvas alike. */
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { readSupplyNode } from '@defi-workflow-engine/workflow-contracts';
import { AAVE_V3_ETHEREUM_SEPOLIA as eth } from '@defi-workflow-engine/action-registry';
import { commandIsValid, parseLocalCommand, summarize } from './commands';
import { editorReducer, initialEditor } from './editor';
import { createAuthoredBorrow, createAuthoredSupply, createAuthoredWithdraw, lendingAmountLabel, lendingView, parseLendingAmount, supplyDetails,
  withdrawDetails, type SupplyInput } from './supply-authoring';
import { createAuthoredTransfer, transferCardLabel, transferDetails } from './robinhood-transfer-authoring';
import { stepOfNode } from './workflow-steps';
import { createUniswapLiquidityNode } from './uniswap-liquidity-authoring';
import { simulationFlowOf, stepSentence, stepSummary } from './copilot-answers';

const context = createBaseSepoliaReviewContext(), owner = '0x1111111111111111111111111111111111111111';
const wbtc: SupplyInput = { network: 'Ethereum Sepolia', asset: 'WBTC', amount: '0.001', beneficiary: owner };

describe('Ethereum Sepolia Aave authoring', () => {
  it('authors the exact WBTC asset with 8 decimals on eip155:11155111', () => {
    const node = createAuthoredSupply('node-002', wbtc), fields = readSupplyNode(node);
    expect(fields).toEqual({ chain: 'eip155:11155111', asset: { chainId: 'eip155:11155111', address: eth.asset, decimals: 8 }, amount: '100000', beneficiary: owner });
    expect(supplyDetails(node)).toEqual(wbtc);
    expect(lendingAmountLabel(node)).toBe('0.001 WBTC · Ethereum Sepolia');
    expect(lendingView(node.chainId)).toMatchObject({ network: 'Ethereum Sepolia', asset: 'WBTC', decimals: 8, explorer: 'https://sepolia.etherscan.io', chainHex: '0xaa36a7', collateralBit: 0x80n });
    const withdraw = createAuthoredWithdraw('node-003', { network: 'Ethereum Sepolia', asset: 'WBTC', amount: '0.00000001', recipient: 'CONNECTED_OWNER' });
    expect(withdrawDetails(withdraw)).toMatchObject({ network: 'Ethereum Sepolia', asset: 'WBTC', amount: '0.00000001' });
  });
  it('never pairs a symbol with another network: no USDC on Ethereum Sepolia, no WBTC on Base Sepolia, no Mainnet', () => {
    expect(() => createAuthoredSupply('n', { ...wbtc, asset: 'USDC' })).toThrow('SUPPLY_DEPLOYMENT_UNSUPPORTED');
    expect(() => createAuthoredBorrow('n', { ...wbtc, network: 'Base Sepolia' })).toThrow('BORROW_DEPLOYMENT_UNSUPPORTED');
    expect(() => createAuthoredSupply('n', { ...wbtc, network: 'Ethereum Mainnet' as SupplyInput['network'] })).toThrow('SUPPLY_DEPLOYMENT_UNSUPPORTED');
    expect(() => createAuthoredSupply('n', { ...wbtc, network: 'Ethereum' as SupplyInput['network'] })).toThrow('SUPPLY_DEPLOYMENT_UNSUPPORTED');
  });
  it.each([['0.000000001', 8], ['1.0000001', 6], ['0', 8], ['-1', 8], ['1e2', 8]])('rejects %s at %i decimals', (value, decimals) =>
    expect(() => parseLendingAmount(value, decimals)).toThrow('SUPPLY_AMOUNT_INVALID'));
  it('parses the chat grammar for each Aave action on Ethereum Sepolia and keeps the canonical IR identical to the canvas', () => {
    const initial = initialEditor();
    const chat = parseLocalCommand('supply 0.001 WBTC to Aave on Ethereum Sepolia', initial.workflow, context, owner);
    expect(chat).toMatchObject({ type: 'ADD_SUPPLY', input: wbtc });
    expect(editorReducer(initial, chat, context)).toEqual(editorReducer(initial, { type: 'ADD_SUPPLY', input: wbtc, source: 'CANVAS', baseRevision: 0 }, context));
    expect(parseLocalCommand('Borrow 0.0001 wbtc from Aave on ethereum sepolia', initial.workflow, context, owner)).toMatchObject({ type: 'ADD_BORROW',
      input: { network: 'Ethereum Sepolia', asset: 'WBTC', amount: '0.0001' } });
    expect(parseLocalCommand('repay 0.00005 WBTC to Aave on Ethereum Sepolia', initial.workflow, context, owner)).toMatchObject({ type: 'ADD_REPAY' });
    expect(parseLocalCommand('withdraw 0.0005 WBTC from Aave on Ethereum Sepolia', initial.workflow, context, owner)).toMatchObject({ type: 'ADD_WITHDRAW',
      input: { network: 'Ethereum Sepolia', asset: 'WBTC', recipient: 'CONNECTED_OWNER' } });
    expect(commandIsValid(chat)).toBe(true);
    const added = editorReducer(initial, chat, context);
    expect(summarize(added.workflow)).toContain('Supply 0.001 WBTC to Aave V3 on Ethereum Sepolia');
    expect(stepOfNode(added.workflow, added.workflow.nodes.at(-1)!.nodeId, context)).toMatchObject({ network: 'Ethereum Sepolia', protocol: 'Aave V3', testFunds: true });
    const edited = editorReducer(added, parseLocalCommand('set node-002 amount 0.002', added.workflow, context), context);
    expect(supplyDetails(edited.workflow.nodes.at(-1)! as Parameters<typeof supplyDetails>[0])).toMatchObject({ network: 'Ethereum Sepolia', asset: 'WBTC', amount: '0.002' });
  });
  it('refuses mismatched or ambiguous chat networks instead of guessing', () => {
    const workflow = initialEditor().workflow;
    expect(() => parseLocalCommand('supply 1 USDC to Aave on Ethereum Sepolia', workflow, context, owner)).toThrow('SUPPLY_DEPLOYMENT_UNSUPPORTED');
    expect(() => parseLocalCommand('supply 1 WBTC to Aave on Base Sepolia', workflow, context, owner)).toThrow('SUPPLY_DEPLOYMENT_UNSUPPORTED');
    // "Ethereum" alone, or Mainnet, is never accepted as an Aave network.
    for (const text of ['supply 0.001 WBTC to Aave on Ethereum', 'supply 0.001 WBTC to Aave on Ethereum Mainnet', 'supply 0.001 WBTC to Aave on Sepolia'])
      expect(() => parseLocalCommand(text, workflow, context, owner)).toThrow();
    expect(commandIsValid({ type: 'ADD_SUPPLY', input: { ...wbtc, asset: 'USDC' }, source: 'CHAT', baseRevision: 0 })).toBe(false);
  });
});

describe('Ethereum Sepolia native transfer authoring', () => {
  it('authors the self-transfer on chain 11155111 and labels it by network', () => {
    const node = createAuthoredTransfer('node-002', { network: 'Ethereum Sepolia', asset: 'ETH', amount: '0.000001', recipient: 'CONNECTED_OWNER' });
    expect(node.chainId).toBe('eip155:11155111');
    expect(transferDetails(node)).toEqual({ network: 'Ethereum Sepolia', asset: 'ETH', amount: '0.000001', recipient: 'CONNECTED_OWNER' });
    expect(transferCardLabel(node)).toBe('0.000001 ETH · Ethereum Sepolia');
    const robinhood = createAuthoredTransfer('node-002', { network: 'Robinhood Chain Testnet', asset: 'ETH', amount: '0.000001', recipient: 'CONNECTED_OWNER' });
    expect(transferCardLabel(robinhood)).toBe('0.000001 ETH · Robinhood Testnet');
  });
  it('refuses Mainnet and amounts above the 0.001 test-ETH cap', () => {
    expect(() => createAuthoredTransfer('n', { network: 'Ethereum Mainnet' as 'Ethereum Sepolia', asset: 'ETH', amount: '0.000001', recipient: 'CONNECTED_OWNER' }))
      .toThrow('TRANSFER_PROFILE_UNSUPPORTED');
    expect(() => createAuthoredTransfer('n', { network: 'Ethereum Sepolia', asset: 'ETH', amount: '0.0011', recipient: 'CONNECTED_OWNER' })).toThrow('TRANSFER_AMOUNT_INVALID');
    expect(commandIsValid({ type: 'ADD_RH_TRANSFER', input: { network: 'Ethereum Sepolia', asset: 'ETH', amount: '0.000001', recipient: 'CONNECTED_OWNER' },
      source: 'CANVAS', baseRevision: 0 })).toBe(true);
  });
});

describe('Copilot answers describe Ethereum Sepolia steps from their own IR fields', () => {
  const stepOf = (node: ReturnType<typeof createAuthoredSupply>) => stepOfNode({ ...initialEditor().workflow, nodes: [node] }, node.nodeId, context)!;
  it('names WBTC, Ethereum Sepolia and the 0.3% pool, never Base Sepolia USDC', () => {
    const supply = stepOf(createAuthoredSupply('node-002', wbtc));
    expect(stepSummary(supply, 'EN')).toBe('Supply 0.001 WBTC · Aave V3 · Ethereum Sepolia');
    expect(stepSentence(supply, 'EN')).toBe(`Supplies 0.001 WBTC to Aave V3 on Ethereum Sepolia for ${owner}.`);
    expect(stepSentence(supply, 'PT')).toContain('WBTC na Aave V3 na Ethereum Sepolia');
    const withdraw = stepOf(createAuthoredWithdraw('node-003', { network: 'Ethereum Sepolia', asset: 'WBTC', amount: '0.0005', recipient: 'CONNECTED_OWNER' }));
    expect(stepSentence(withdraw, 'EN')).toBe('Withdraws 0.0005 WBTC from Aave V3 on Ethereum Sepolia to your connected wallet.');
    const position = stepOf(createUniswapLiquidityNode('node-004', { network: 'Ethereum Sepolia', maxUsdc: '10', maxWeth: '0.005', rangeUnit: 'PRICE',
      lower: '2000', upper: '3000', slippage: '100' }));
    expect(stepSummary(position, 'EN')).toContain('Uniswap v3 · Ethereum Sepolia');
    expect(stepSentence(position, 'EN')).toContain('(Ethereum Sepolia, USDC/WETH 0.3%)');
    for (const step of [supply, withdraw, position]) expect(stepSentence(step, 'EN') + stepSummary(step, 'EN')).not.toMatch(/Base Sepolia|USDC to Aave|Mainnet/);
    expect(simulationFlowOf([supply])).toBe('SUPPLY');
    expect(simulationFlowOf([position])).toBe('UNISWAP');
  });
});
