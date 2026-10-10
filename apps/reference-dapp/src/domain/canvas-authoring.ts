// SPDX-License-Identifier: AGPL-3.0-only
import type { Command } from './commands';

export const CANVAS_ACTIONS = ['swap', 'bridge', 'pool', 'supply', 'lending', 'borrow', 'repay', 'withdraw', 'transfer'] as const;
export type CanvasAction = (typeof CANVAS_ACTIONS)[number];

/** Authoring defaults only. Existing commands validate the IR and invalidate previous reviews. */
export function canvasAddCommand(action: CanvasAction, revision: number, owner: string | null, amount?: string): Command {
  const base = { source: 'CANVAS' as const, baseRevision: revision };
  if ((action === 'swap' || action === 'bridge' || action === 'supply' || action === 'borrow' || action === 'repay' || action === 'withdraw') && amount === undefined) throw new Error('Enter an amount to configure this action.');
  if (action === 'transfer') { if (amount === undefined) throw new Error('Enter an amount to configure this action.'); return { ...base, type: 'ADD_RH_TRANSFER', input: { network: 'Robinhood Chain Testnet', asset: 'ETH', amount, recipient: 'CONNECTED_OWNER' } }; }
  if (action === 'swap') return { ...base, type: 'ADD_SWAP', direction: 'USDC_TO_WETH', amount: amount!, slippage: '50' };
  if (action === 'bridge') return { ...base, type: 'ADD_ROUTER_BRIDGE', input: {
    source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: amount!, recipient: '', slippage: '50', routing: 'AUTO',
  } };
  if (action === 'pool') throw new Error('Configure the liquidity amounts before adding this action.');
  if (action === 'withdraw') return { ...base, type: 'ADD_WITHDRAW', input: {
    network: 'Base Sepolia', asset: 'USDC', amount: amount!, recipient: 'CONNECTED_OWNER',
  } };
  if (!owner) throw new Error('Connect your wallet to set the beneficiary before adding this action.');
  if (action === 'lending') return { ...base, type: 'AUTHOR_LENDING', input: { supply: '0.1', borrow: '0.01', slippage: '50', owner } };
  const input = { network: 'Base Sepolia' as const, asset: 'USDC' as const,
    amount: amount!, beneficiary: owner };
  return { ...base, type: action === 'supply' ? 'ADD_SUPPLY' : action === 'borrow' ? 'ADD_BORROW' : 'ADD_REPAY', input };
}
