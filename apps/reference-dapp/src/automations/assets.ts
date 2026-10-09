// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: what FloFi can OBSERVE versus what it can EXECUTE — two separate facts.
 *
 * Observation (read-only USD prices): ETH, BTC, SOL — when the deployment's price source serves them.
 * Execution (the action an automation proposes): FloFi's existing swap flows only, expressed as canonical StrategySpecs:
 *
 *   ETH   USDC ⇄ WETH on Base Sepolia and Ethereum Sepolia (Uniswap v3). Base mainnet composes, but current main has no owner-execution
 *         flow for it (the gates answer OWNER_EXECUTION_NOT_IMPLEMENTED) and mainnet is disabled by policy by default
 *   SOL   devUSDC ⇄ SOL on Solana Devnet (Orca); USDC ⇄ SOL on Solana mainnet (Jupiter) exists in code, disabled by policy by default
 *   BTC   none: FloFi has no BTC/WBTC/cbBTC swap route (WBTC is Aave-only on Ethereum Sepolia) → BTC_EXECUTION_ROUTE_UNAVAILABLE
 *
 * Nothing is ever substituted: a BTC purchase is refused, never mapped to WETH or another asset. A future BTC route is one more row
 * here (and its flow); the scheduler, triggers and approvals are action-agnostic.
 */
import type { NetworkId, StrategySpec } from '../engine/strategy-spec';
import type { ObservedAsset } from './trigger.ts';

export type Side = 'BUY' | 'SELL';
export type SwapNetwork = Extract<StrategySpec, { action: 'swap' }>['network'];
type Route = { readonly network: SwapNetwork; readonly quote: 'USDC' | 'devUSDC'; readonly base: 'WETH' | 'SOL' };
export const EXECUTION_ROUTES: Readonly<Record<ObservedAsset, readonly Route[]>> = Object.freeze({
  ETH: [{ network: 'base-sepolia', quote: 'USDC', base: 'WETH' }, { network: 'ethereum-sepolia', quote: 'USDC', base: 'WETH' },
    { network: 'base', quote: 'USDC', base: 'WETH' }],
  SOL: [{ network: 'solana-devnet', quote: 'devUSDC', base: 'SOL' }, { network: 'solana', quote: 'USDC', base: 'SOL' }],
  BTC: [],
});
export type RouteAction = { readonly asset: ObservedAsset; readonly side: Side; readonly network: NetworkId; readonly amount: string; readonly slippageBps: number };

/** The canonical swap a route action names, or a closed refusal code. A BUY spends the quote asset; a SELL spends the base asset. */
export function routeStrategy(action: RouteAction): { readonly ok: true; readonly strategy: StrategySpec } | { readonly ok: false; readonly code: string } {
  const routes = EXECUTION_ROUTES[action.asset];
  if (!routes) return { ok: false, code: 'AUTOMATION_ASSET_UNSUPPORTED' };
  if (!routes.length) return { ok: false, code: `${action.asset}_EXECUTION_ROUTE_UNAVAILABLE` };
  const route = routes.find(r => r.network === action.network);
  if (!route) return { ok: false, code: 'AUTOMATION_ROUTE_NETWORK_UNSUPPORTED' };
  if (action.side !== 'BUY' && action.side !== 'SELL') return { ok: false, code: 'AUTOMATION_ACTION_INVALID' };
  const [inputAsset, outputAsset] = action.side === 'BUY' ? [route.quote, route.base] : [route.base, route.quote];
  return { ok: true, strategy: { version: 1, action: 'swap', network: route.network, inputAsset, outputAsset, amount: action.amount, slippageBps: action.slippageBps } };
}

/** What an automation's action spends per execution: the input asset and exact amount of its swap; other actions are not automatable yet. */
export function spendOf(strategy: StrategySpec): { readonly asset: string; readonly amount: string } | null {
  return strategy.action === 'swap' ? { asset: strategy.inputAsset, amount: strategy.amount } : null;
}
/** The observed asset a swap's base asset corresponds to (WETH → ETH), for display and consistency checks. */
export function observedAssetOf(strategy: StrategySpec): ObservedAsset | null {
  if (strategy.action !== 'swap') return null;
  const assets = [strategy.inputAsset, strategy.outputAsset];
  return assets.includes('WETH') ? 'ETH' : assets.includes('SOL') ? 'SOL' : null;
}
/** Which side of the market a swap is, relative to its observed asset. */
export function sideOf(strategy: StrategySpec): Side | null {
  const asset = observedAssetOf(strategy);
  if (!asset || strategy.action !== 'swap') return null;
  return strategy.outputAsset === (asset === 'ETH' ? 'WETH' : 'SOL') ? 'BUY' : 'SELL';
}
