// SPDX-License-Identifier: AGPL-3.0-only
import type { Command } from './commands';

export const CANVAS_ACTIONS = ['swap', 'bridge', 'pool', 'supply', 'lending', 'borrow', 'repay', 'withdraw'] as const;
export type CanvasAction = (typeof CANVAS_ACTIONS)[number];

/** Authoring defaults only. Existing commands validate the IR and invalidate previous reviews. */
export function canvasAddCommand(action: CanvasAction, revision: number, owner: string | null): Command {
  const base = { source: 'CANVAS' as const, baseRevision: revision };
  if (action === 'swap') return { ...base, type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: '1', slippage: '50' };
  if (action === 'bridge') return { ...base, type: 'ADD_ROUTER_BRIDGE', input: {
    source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '1', recipient: '', slippage: '50', routing: 'AUTO',
  } };
  if (action === 'pool') return { ...base, type: 'ADD_UNISWAP_LIQUIDITY', input: {
    network: 'Base Sepolia', maxUsdc: '1', maxWeth: '0.0001', rangeUnit: 'TICK', lower: '-887270', upper: '887270', slippage: '50',
  } };
  if (action === 'withdraw') return { ...base, type: 'ADD_WITHDRAW', input: {
    network: 'Base Sepolia', asset: 'USDC', amount: '0.1', recipient: 'CONNECTED_OWNER',
  } };
  if (!owner) throw new Error('Connect your wallet to set the beneficiary before adding this action.');
  if (action === 'lending') return { ...base, type: 'AUTHOR_LENDING', input: { supply: '0.1', borrow: '0.01', slippage: '50', owner } };
  const input = { network: 'Base Sepolia' as const, asset: 'USDC' as const,
    amount: action === 'supply' ? '1' : action === 'borrow' ? '0.01' : '0.005', beneficiary: owner };
  return { ...base, type: action === 'supply' ? 'ADD_SUPPLY' : action === 'borrow' ? 'ADD_BORROW' : 'ADD_REPAY', input };
}
