// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: one canonical, composable example strategy per supported action and network. They document the contract
 * and are what `capability-catalog.ts` composes to derive each row's capabilities from the real IR and registry. The
 * placeholder account is a valid non-zero address used only to compose; it is never simulated or shown as a recipient.
 */
import type { StrategySpec } from './strategy-spec';

const EXAMPLE_ACCOUNT = '0x0000000000000000000000000000000000000001';
export const STRATEGY_EXAMPLES: readonly { readonly id: string; readonly strategy: StrategySpec }[] = Object.freeze([
  { id: 'bridge-base-sepolia-arbitrum-sepolia', strategy: { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5', routing: 'auto' } },
  { id: 'bridge-base-arbitrum-one', strategy: { action: 'bridge', sourceNetwork: 'base', destinationNetwork: 'arbitrum-one', asset: 'USDC', amount: '5', routing: 'auto' } },
  { id: 'swap-base', strategy: { action: 'swap', network: 'base', inputAsset: 'USDC', outputAsset: 'WETH', amount: '2', slippageBps: 50 } },
  { id: 'swap-base-sepolia', strategy: { action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '1', slippageBps: 50 } },
  { id: 'swap-ethereum-sepolia', strategy: { action: 'swap', network: 'ethereum-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '1', slippageBps: 50 } },
  { id: 'swap-solana', strategy: { action: 'swap', network: 'solana', inputAsset: 'USDC', outputAsset: 'SOL', amount: '1', slippageBps: 50 } },
  { id: 'swap-solana-devnet', strategy: { action: 'swap', network: 'solana-devnet', inputAsset: 'devUSDC', outputAsset: 'SOL', amount: '1', slippageBps: 50 } },
  ...(['supply', 'borrow', 'repay'] as const).flatMap(action => [
    { id: `${action}-base-sepolia`, strategy: { action, network: 'base-sepolia', asset: 'USDC', amount: '1', beneficiary: EXAMPLE_ACCOUNT } as StrategySpec },
    { id: `${action}-ethereum-sepolia`, strategy: { action, network: 'ethereum-sepolia', asset: 'WBTC', amount: '0.001', beneficiary: EXAMPLE_ACCOUNT } as StrategySpec }]),
  { id: 'withdraw-base-sepolia', strategy: { action: 'withdraw', network: 'base-sepolia', asset: 'USDC', amount: '1' } },
  { id: 'withdraw-ethereum-sepolia', strategy: { action: 'withdraw', network: 'ethereum-sepolia', asset: 'WBTC', amount: '0.001' } },
  { id: 'add-liquidity-base-sepolia', strategy: { action: 'add_liquidity', network: 'base-sepolia', maxAmounts: { USDC: '10', WETH: '0.005' },
    range: { unit: 'tick', lower: '189960', upper: '200040' } } },
  { id: 'add-liquidity-ethereum-sepolia', strategy: { action: 'add_liquidity', network: 'ethereum-sepolia', maxAmounts: { USDC: '10', WETH: '0.005' },
    range: { unit: 'tick', lower: '189960', upper: '200040' } } },
  { id: 'add-liquidity-solana-devnet', strategy: { action: 'add_liquidity', network: 'solana-devnet', maxAmounts: { SOL: '0.01', devUSDC: '0.3' },
    range: { unit: 'tick', lower: '-29952', upper: '-25600' } } },
  { id: 'lending-composition-base-sepolia', strategy: { action: 'lending_composition', network: 'base-sepolia', asset: 'USDC', supplyAmount: '10', borrowAmount: '2',
    outputAsset: 'WETH', owner: EXAMPLE_ACCOUNT } },
]);
