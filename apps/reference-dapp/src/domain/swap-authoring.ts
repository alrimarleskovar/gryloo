// SPDX-License-Identifier: AGPL-3.0-only
import type { Workflow } from './initial-workflow';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createReviewContext, type ReviewContext, type Symbol } from '@defi-workflow-engine/reference-linter';

export type Direction = 'USDC_TO_WETH' | 'WETH_TO_USDC';
export const directions = ['USDC_TO_WETH', 'WETH_TO_USDC'] as const;
export const SWAP_ACTION = 'asset.swap.exact-input';
export function inputSymbol(direction: Direction): Symbol { return direction === 'USDC_TO_WETH' ? 'USDC' : 'WETH'; }
export function outputSymbol(direction: Direction): Symbol { return direction === 'USDC_TO_WETH' ? 'WETH' : 'USDC'; }
export function directionLabel(direction: Direction): string { return direction === 'USDC_TO_WETH' ? 'USDC → WETH' : 'WETH → USDC'; }

/** Authoring uses exact decimal strings; no float, rounding or exponent path. */
export function parseHumanAmount(text: unknown, symbol: Symbol, context: ReviewContext): string {
  if (symbol !== 'USDC' && symbol !== 'WETH') throw new Error('INVALID_ASSET');
  if (typeof text !== 'string' || text.length === 0 || text.length > 80
      || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(text)) throw new Error('INVALID_AMOUNT');
  const trusted = createReviewContext(context);
  const decimals = trusted.assets[symbol].asset.decimals;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals || whole === undefined) throw new Error('AMOUNT_PRECISION');
  const units = BigInt(whole + fraction.padEnd(decimals, '0'));
  if (units < 1n || units > BigInt(trusted.assets[symbol].maximumAmountUnits)
      || units > (1n << 256n) - 1n) throw new Error('AMOUNT_OUT_OF_RANGE');
  return units.toString();
}
export function formatHumanAmount(units: string, symbol: Symbol, context: ReviewContext): string {
  if (!/^(0|[1-9][0-9]*)$/.test(units)) return '--';
  const decimals = context.assets[symbol].asset.decimals;
  const padded = units.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fractional = padded.slice(-decimals).replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : whole;
}
export function parseSlippage(text: unknown): number {
  if (typeof text !== 'string' || text.length === 0 || text.length > 5 || !/^(0|[1-9][0-9]*)$/.test(text)) throw new Error('INVALID_SLIPPAGE');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > 10_000) throw new Error('INVALID_SLIPPAGE');
  return value;
}

export function createSwapNode(nodeId: string, direction: Direction, humanAmount: string, slippageText: string, context: ReviewContext, provider: 'uniswap' | 'cow' = 'uniswap'): SemanticWorkflow['nodes'][number] {
  if (!directions.includes(direction)) throw new Error('INVALID_DIRECTION');
  const trusted = createReviewContext(context);
  const from = inputSymbol(direction), to = outputSymbol(direction);
  const input = trusted.assets[from].asset, output = trusted.assets[to].asset;
  const amount = parseHumanAmount(humanAmount, from, trusted);
  const slippage = parseSlippage(slippageText);
  return {
    nodeId, actionType: SWAP_ACTION, actionSchemaVersion: '1.0.0', chainId: 'eip155:8453',
    requiredCapabilities: ['swap.direct-transaction'],
    adapterConstraints: { adapters: [], protocols: provider === 'cow' ? ['uniswap', 'cow-protocol'] : ['uniswap'] },
    inputs: [
      { name: 'amount-in', kind: 'QUANTITY', value: { asset: { ...input }, amount } },
      { name: 'asset-out', kind: 'ASSET', value: { ...output } },
    ],
    expectedOutputs: [{ outputId: 'amount-out', asset: { ...output }, minimumAmount: '0' }],
    dependencies: [],
    userConstraints: [
      { kind: 'MAXIMUM_INPUT', quantity: { asset: { ...input }, amount } },
      { kind: 'MAXIMUM_SLIPPAGE_BPS', maximumBps: slippage },
    ],
    failurePolicy: 'ABORT', requiredAuthorizationClass: 'MODE_A',
    lockedParameters: [],
    editableBounds: [{ parameterName: 'amount-in', asset: { ...input }, minimumAmount: '1', maximumAmount: trusted.assets[from].maximumAmountUnits }],
  };
}
export function swapDetails(node: Workflow['nodes'][number], context: ReviewContext) {
  if (node.actionType !== SWAP_ACTION) return null;
  const amount = node.inputs.find(p => p.name === 'amount-in');
  const out = node.inputs.find(p => p.name === 'asset-out');
  if (amount?.kind !== 'QUANTITY' || out?.kind !== 'ASSET') return null;
  const sameAsset = (asset: typeof amount.value.asset, symbol: Symbol) => {
    const known = context.assets[symbol].asset;
    return 'address' in asset && 'address' in known && asset.chainId === known.chainId
      && asset.address === known.address && asset.decimals === known.decimals;
  };
  const from = (['USDC', 'WETH'] as const).find(symbol => sameAsset(amount.value.asset, symbol));
  const to = (['USDC', 'WETH'] as const).find(symbol => sameAsset(out.value, symbol));
  if (!from || !to) return null;
  const slip = node.userConstraints.find(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
  return { from, to, units: amount.value.amount, amount: formatHumanAmount(amount.value.amount, from, context), slippage: slip?.kind === 'MAXIMUM_SLIPPAGE_BPS' ? slip.maximumBps : null };
}
