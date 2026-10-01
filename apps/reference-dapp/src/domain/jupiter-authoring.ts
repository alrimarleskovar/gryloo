// SPDX-License-Identifier: AGPL-3.0-only
import { createExactInputSwapNode, readExactInputSwap, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { JUPITER_SOLANA_MAINNET as profile, SOLANA_MAINNET_TOKENS, solanaTokenByMint, type SolanaTokenSymbol } from '@defi-workflow-engine/action-registry';

/** Chat and canvas both author the canonical swap; Solana only selects chain, mints and the Jupiter provider. */
export type SolanaSwapInput = { network: 'Solana'; from: SolanaTokenSymbol; to: SolanaTokenSymbol; amount: string; slippage: string };
export const solanaTokens = Object.keys(SOLANA_MAINNET_TOKENS) as SolanaTokenSymbol[];
export function parseTokenAmount(text: string, decimals: number): string {
  if (typeof text !== 'string' || text.length === 0 || text.length > 40 || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(text)) throw new Error('INVALID_AMOUNT');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw new Error('AMOUNT_PRECISION');
  const units = BigInt(whole! + fraction.padEnd(decimals, '0'));
  if (units < 1n) throw new Error('AMOUNT_OUT_OF_RANGE');
  return units.toString();
}
export function formatTokenAmount(units: string, decimals: number): string {
  if (!/^(0|[1-9][0-9]*)$/.test(units)) return '--';
  const padded = units.padStart(decimals + 1, '0'), fraction = padded.slice(-decimals).replace(/0+$/, '');
  return padded.slice(0, -decimals) + (fraction ? '.' + fraction : '');
}
export function createSolanaSwapNode(nodeId: string, input: SolanaSwapInput): SemanticWorkflow['nodes'][number] {
  const from = SOLANA_MAINNET_TOKENS[input.from], to = SOLANA_MAINNET_TOKENS[input.to];
  if (input.network !== 'Solana' || !from || !to) throw new Error('SOLANA_MINT_UNSUPPORTED');
  if (from === to) throw new Error('INVALID_ASSET_PAIR');
  if (!/^[1-9][0-9]{0,3}$/.test(input.slippage) || Number(input.slippage) > profile.maximumSlippageBps) throw new Error('SOLANA_SLIPPAGE_OUT_OF_RANGE');
  const amount = parseTokenAmount(input.amount, from.decimals);
  if (BigInt(amount) > BigInt(from.maximumAmount)) throw new Error('AMOUNT_OUT_OF_RANGE');
  return createExactInputSwapNode(nodeId, { chain: profile.chain, input: { chainId: profile.chain, address: from.mint, decimals: from.decimals },
    output: { chainId: profile.chain, address: to.mint, decimals: to.decimals }, amount, slippageBps: Number(input.slippage),
    protocols: [profile.protocol], maximumAmount: from.maximumAmount });
}
export function solanaSwapDetails(node: SemanticWorkflow['nodes'][number] | { readonly actionType: string; readonly chainId: string }): SolanaSwapInput | null {
  if (node.actionType !== 'asset.swap.exact-input' || !node.chainId.startsWith('solana:')) return null;
  try {
    const fields = readExactInputSwap(node as SemanticWorkflow['nodes'][number]);
    const from = solanaTokenByMint(fields.input.address), to = solanaTokenByMint(fields.output.address);
    if (!from || !to) return null;
    return { network: 'Solana', from: from.symbol, to: to.symbol, amount: formatTokenAmount(fields.amount, from.decimals), slippage: String(fields.slippageBps) };
  } catch { return null; }
}
export const SOLANA_SWAP_PATTERN = /^swap ([0-9]+(?:\.[0-9]+)?) (SOL|USDC|USDT) (?:to|for) (SOL|USDC|USDT) on Solana(?: (?:with )?slippage ([0-9]+) bps)?$/i;
export function parseSolanaSwapChat(text: string): SolanaSwapInput | null {
  const match = SOLANA_SWAP_PATTERN.exec(text.trim());
  if (!match) return null;
  return { network: 'Solana', from: match[2]!.toUpperCase() as SolanaTokenSymbol, to: match[3]!.toUpperCase() as SolanaTokenSymbol, amount: match[1]!, slippage: match[4] ?? '50' };
}
