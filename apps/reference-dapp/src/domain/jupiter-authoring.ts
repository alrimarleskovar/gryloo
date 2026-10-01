// SPDX-License-Identifier: AGPL-3.0-only
import { createExactInputSwapNode, readExactInputSwap, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET, SOLANA_MAINNET_TOKENS, solanaSwapRuntime, solanaTokenOn, type SolanaDevnetTokenSymbol,
  type SolanaSwapRuntime, type SolanaTokenSymbol } from '@defi-workflow-engine/action-registry';

/**
 * Chat and canvas both author the canonical swap. The network selects the runtime below the IR:
 * Solana (mainnet-beta) through Jupiter, or Solana Devnet through Orca Whirlpools with valueless test tokens.
 */
export type SolanaNetwork = 'Solana' | 'Solana Devnet';
export type SolanaSwapSymbol = SolanaTokenSymbol | SolanaDevnetTokenSymbol;
export type SolanaSwapInput = { network: SolanaNetwork; from: SolanaSwapSymbol; to: SolanaSwapSymbol; amount: string; slippage: string };
export const solanaTokens = Object.keys(SOLANA_MAINNET_TOKENS) as SolanaTokenSymbol[];
const runtimeFor = (network: SolanaNetwork): SolanaSwapRuntime | null =>
  solanaSwapRuntime(network === 'Solana' ? JUPITER_SOLANA_MAINNET.chain : network === 'Solana Devnet' ? ORCA_WHIRLPOOLS_DEVNET.chain : '');
export function solanaTokensFor(network: SolanaNetwork): SolanaSwapSymbol[] { return Object.keys(runtimeFor(network)?.tokens ?? {}) as SolanaSwapSymbol[]; }
export function solanaTokenLabel(network: SolanaNetwork, symbol: string): string { return runtimeFor(network)?.tokens[symbol]?.label ?? symbol; }
export function solanaTokenMint(network: SolanaNetwork, symbol: string): string { return runtimeFor(network)?.tokens[symbol]?.mint ?? 'unsupported'; }
/** Honest, user-facing labels: Devnet never says Jupiter, mainnet always says real funds. */
export function solanaSwapLabels(network: SolanaNetwork): { network: string; provider: string; kind: string; testTokens: boolean } {
  return network === 'Solana Devnet' ? { network: 'Solana Devnet', provider: ORCA_WHIRLPOOLS_DEVNET.providerLabel, kind: 'SOLANA DEVNET · ORCA', testTokens: true }
    : { network: 'Solana', provider: 'Jupiter', kind: 'SOLANA · JUPITER', testTokens: false };
}
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
  const runtime = runtimeFor(input.network);
  if (!runtime) throw new Error('SOLANA_CLUSTER_UNSUPPORTED');
  const from = Object.hasOwn(runtime.tokens, input.from) ? runtime.tokens[input.from] : undefined, to = Object.hasOwn(runtime.tokens, input.to) ? runtime.tokens[input.to] : undefined;
  if (!from || !to) throw new Error('SOLANA_MINT_UNSUPPORTED');
  if (from === to) throw new Error('INVALID_ASSET_PAIR');
  if (!/^[1-9][0-9]{0,3}$/.test(input.slippage) || Number(input.slippage) > runtime.maximumSlippageBps) throw new Error('SOLANA_SLIPPAGE_OUT_OF_RANGE');
  const amount = parseTokenAmount(input.amount, from.decimals);
  if (BigInt(amount) > BigInt(from.maximumAmount)) throw new Error('AMOUNT_OUT_OF_RANGE');
  return createExactInputSwapNode(nodeId, { chain: runtime.chain, input: { chainId: runtime.chain, address: from.mint, decimals: from.decimals },
    output: { chainId: runtime.chain, address: to.mint, decimals: to.decimals }, amount, slippageBps: Number(input.slippage),
    protocols: [runtime.protocol], maximumAmount: from.maximumAmount });
}
export function solanaSwapDetails(node: SemanticWorkflow['nodes'][number] | { readonly actionType: string; readonly chainId: string }): SolanaSwapInput | null {
  if (node.actionType !== 'asset.swap.exact-input' || !node.chainId.startsWith('solana:')) return null;
  try {
    const fields = readExactInputSwap(node as SemanticWorkflow['nodes'][number]);
    const runtime = solanaSwapRuntime(fields.chain), from = solanaTokenOn(fields.chain, fields.input.address), to = solanaTokenOn(fields.chain, fields.output.address);
    if (!runtime || !from || !to) return null;
    return { network: runtime.network, from: from.symbol as SolanaSwapSymbol, to: to.symbol as SolanaSwapSymbol, amount: formatTokenAmount(fields.amount, from.decimals), slippage: String(fields.slippageBps) };
  } catch { return null; }
}
export const SOLANA_SWAP_PATTERN = /^swap ([0-9]+(?:\.[0-9]+)?) (test )?(SOL|USDC|USDT|devUSDC) (?:to|for) (test )?(SOL|USDC|USDT|devUSDC) on Solana( Devnet)?(?: (?:with )?slippage ([0-9]+) bps)?$/i;
/** "test"/devUSDC tokens exist only on Devnet; on mainnet they resolve to an unsupported token rather than to a real asset. */
export function parseSolanaSwapChat(text: string): SolanaSwapInput | null {
  const match = SOLANA_SWAP_PATTERN.exec(text.trim());
  if (!match) return null;
  const devnet = Boolean(match[6]);
  const token = (test: string | undefined, symbol: string): SolanaSwapSymbol => {
    const upper = symbol.toUpperCase();
    if (devnet) return upper === 'USDC' || upper === 'DEVUSDC' ? 'devUSDC' : upper as SolanaSwapSymbol;
    return test || upper === 'DEVUSDC' ? 'devUSDC' : upper as SolanaSwapSymbol;
  };
  return { network: devnet ? 'Solana Devnet' : 'Solana', from: token(match[2], match[3]!), to: token(match[4], match[5]!), amount: match[1]!, slippage: match[7] ?? '50' };
}
