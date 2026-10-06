// SPDX-License-Identifier: AGPL-3.0-only
import { AAVE_V3_BASE_SEPOLIA, baseAssetRegistry, SOLANA_SWAP_RUNTIMES, UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY, ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY } from '@defi-workflow-engine/action-registry';
import { createBaseSepoliaReviewContext, createReviewContext, liquidityDetails } from '@defi-workflow-engine/reference-linter';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { classifyWalletEnvironment, type WalletEnvironment } from '../wallet/environment';
import type { Workflow } from './initial-workflow';
import { createSwapNode, swapDetails, formatHumanAmount } from './swap-authoring';
import { createSolanaSwapNode, solanaSwapDetails, type SolanaSwapInput } from './jupiter-authoring';
import { createUniswapLiquidityNode, uniswapLiquidityDetails } from './uniswap-liquidity-authoring';
import { createSolanaLiquidityNode, solanaLiquidityDetails } from './solana-liquidity-authoring';
import { createLiquidityNode } from './liquidity-authoring';
import { createAuthoredSupply, createAuthoredBorrow, createAuthoredRepay, createAuthoredWithdraw, supplyDetails, borrowDetails, repayDetails, withdrawDetails } from './supply-authoring';

export type CryptoAction = 'swap' | 'pool' | 'supply' | 'borrow' | 'repay' | 'withdraw';
/** One network for the entire action. Assets never carry separate network selections. */
export type CryptoSelection = { action: CryptoAction; network: string; from: string; to?: string };
export type CryptoSelections = Readonly<Record<string, CryptoSelection>>;
export type CryptoPickerProfile = { network: string; chain: string; provider: string; tokens: readonly string[]; pair?: readonly [string, string] };
const mainnetContext = createReviewContext({ registryId: 'reference.registry', capabilityId: 'swap.direct-transaction', actionId: 'asset.swap.exact-input', assets: baseAssetRegistry });
export function cryptoReviewContext(network: string) { return network === 'Base Sepolia' ? createBaseSepoliaReviewContext() : mainnetContext; }
const evm = [
  { network: 'Base', chain: baseAssetRegistry.USDC.asset.chainId, provider: 'Uniswap', tokens: ['USDC', 'WETH'] },
  { network: UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY.network, chain: UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY.chain, provider: 'Uniswap', tokens: ['USDC', 'WETH'] },
];
const swaps: readonly CryptoPickerProfile[] = [...evm, ...SOLANA_SWAP_RUNTIMES.map(runtime => ({ network: runtime.network, chain: runtime.chain, provider: runtime.providerLabel, tokens: Object.keys(runtime.tokens) }))];
const pools: readonly CryptoPickerProfile[] = [
  { ...evm[0]!, provider: 'Uniswap v3', pair: ['WETH', 'USDC'] },
  { ...evm[1]!, provider: 'Uniswap v3', pair: [UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY.token0.symbol, UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY.token1.symbol] },
  { network: ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY.network, chain: ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY.chain, provider: ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY.providerLabel,
    tokens: [ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY.token0.symbol, ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY.token1.symbol], pair: [ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY.token0.symbol, ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY.token1.symbol] },
];
const lending: readonly CryptoPickerProfile[] = [{ network: AAVE_V3_BASE_SEPOLIA.network, chain: AAVE_V3_BASE_SEPOLIA.chain, provider: 'Aave V3', tokens: [AAVE_V3_BASE_SEPOLIA.symbol] }];
export function cryptoProfiles(action: CryptoAction): readonly CryptoPickerProfile[] { return action === 'swap' ? swaps : action === 'pool' ? pools : lending; }
export function cryptoNetworks(action: CryptoAction, environment: WalletEnvironment) {
  return cryptoProfiles(action).filter(profile => environment !== 'unknown' && classifyWalletEnvironment(profile.chain) === environment);
}
export function cryptoProfile(selection: CryptoSelection) { return cryptoProfiles(selection.action).find(profile => profile.network === selection.network); }
export function validCryptoSelection(selection: CryptoSelection): boolean {
  if (!selection || !['swap', 'pool', 'supply', 'borrow', 'repay', 'withdraw'].includes(selection.action) || Object.keys(selection).some(key => !['action', 'network', 'from', 'to'].includes(key))) return false;
  const profile = cryptoProfile(selection);
  if (!profile?.tokens.includes(selection.from)) return false;
  if (selection.action === 'pool') return selection.from === profile.pair?.[0] && selection.to === profile.pair?.[1];
  return selection.action === 'swap' ? Boolean(selection.to && selection.to !== selection.from && profile.tokens.includes(selection.to)) : selection.to === undefined;
}
export function selectCryptoNetwork(action: CryptoAction, network: string, current?: CryptoSelection): CryptoSelection {
  const profile = cryptoProfiles(action).find(entry => entry.network === network);
  if (!profile) throw new Error('ACTION_NETWORK_UNSUPPORTED');
  const from = profile.pair?.[0] ?? (current && profile.tokens.includes(current.from) ? current.from : profile.tokens[0]!);
  const to = profile.pair?.[1] ?? (action === 'swap' ? current?.to && current.to !== from && profile.tokens.includes(current.to) ? current.to : profile.tokens.find(token => token !== from) : undefined);
  return { action, network, from, ...(to ? { to } : {}) };
}
export function cryptoTokenOptions(selection: CryptoSelection, side: 'source' | 'destination') {
  const profile = cryptoProfile(selection);
  return selection.action === 'pool' ? [side === 'source' ? profile?.pair?.[0] : profile?.pair?.[1]].filter((token): token is string => Boolean(token)) : profile?.tokens ?? [];
}
export function selectCryptoToken(selection: CryptoSelection, side: 'source' | 'destination', token: string): CryptoSelection {
  if (!cryptoTokenOptions(selection, side).includes(token)) throw new Error('ACTION_TOKEN_UNSUPPORTED');
  if (selection.action !== 'swap') return selection;
  const profile = cryptoProfile(selection)!;
  const next = side === 'source' ? { ...selection, from: token } : { ...selection, to: token };
  if (next.from === next.to) {
    if (side === 'source') next.to = selection.from !== token ? selection.from : profile.tokens.find(asset => asset !== token)!;
    else next.from = selection.to !== token ? selection.to! : profile.tokens.find(asset => asset !== token)!;
  }
  return next;
}
type Node = Workflow['nodes'][number];
export function cryptoSelectionOf(node: Node): CryptoSelection | null {
  const network = [...swaps, ...pools, ...lending].find(profile => profile.chain === node.chainId)?.network;
  if (!network) return null;
  if (node.actionType === 'asset.swap.exact-input') {
    const solana = solanaSwapDetails(node);
    const evmSwap = node.chainId.startsWith('eip155:') ? swapDetails(node, node.chainId === 'eip155:84532' ? createBaseSepoliaReviewContext() : mainnetContext) : null;
    return solana ? { action: 'swap', network, from: solana.from, to: solana.to } : evmSwap ? { action: 'swap', network, from: evmSwap.from, to: evmSwap.to } : null;
  }
  if (uniswapLiquidityDetails(node) || solanaLiquidityDetails(node) || node.actionType === 'asset.liquidity.uniswap-v3') return selectCryptoNetwork('pool', network);
  if (['supply', 'borrow', 'repay', 'withdraw'].includes(node.actionType) && node.chainId === AAVE_V3_BASE_SEPOLIA.chain) return selectCryptoNetwork(node.actionType as CryptoAction, network);
  return null;
}
export function canSelectCryptoAssets(node: Node, workflow: Workflow) {
  return Boolean(cryptoSelectionOf(node) && !node.lockedParameters.length && !node.dependencies.length && !node.inputs.some(input => input.kind === 'OUTPUT_REFERENCE') &&
    !workflow.resourceEdges.some(edge => edge.fromNodeId === node.nodeId || edge.toNodeId === node.nodeId) && !workflow.nodes.some(other => other.dependencies.includes(node.nodeId)));
}
export type CryptoActionInput = { selection: CryptoSelection; amount: string; secondAmount?: string; beneficiary?: string; slippage: string;
  rangeUnit?: 'PRICE' | 'TICK'; lower?: string; upper?: string };
export function createCryptoActionNode(id: string, input: CryptoActionInput): SemanticWorkflow['nodes'][number] {
  const { selection: selection, amount, slippage } = input;
  if (!validCryptoSelection(selection)) throw new Error('ACTION_ASSETS_UNSUPPORTED');
  if (selection.action === 'swap') {
    if (selection.network === 'Solana' || selection.network === 'Solana Devnet') return createSolanaSwapNode(id, { network: selection.network, from: selection.from, to: selection.to, amount, slippage } as SolanaSwapInput);
    return createSwapNode(id, selection.from === 'USDC' ? 'USDC_TO_WETH' : 'WETH_TO_USDC', amount, slippage, selection.network === 'Base Sepolia' ? createBaseSepoliaReviewContext() : mainnetContext);
  }
  if (selection.action === 'pool') {
    const range = { rangeUnit: input.rangeUnit ?? 'TICK', lower: input.lower ?? (selection.network === 'Solana Devnet' ? '-443584' : '-887270'), upper: input.upper ?? (selection.network === 'Solana Devnet' ? '443584' : '887270'), slippage };
    if (selection.network === 'Solana Devnet') return createSolanaLiquidityNode(id, { ...range, network: 'Solana Devnet', maxSol: amount, maxDevUsdc: input.secondAmount ?? '0' });
    if (selection.network === 'Base Sepolia') return createUniswapLiquidityNode(id, { ...range, network: 'Base Sepolia', maxUsdc: amount, maxWeth: input.secondAmount ?? '0' });
    if (range.rangeUnit !== 'TICK') throw new Error('LIQUIDITY_RANGE_INVALID');
    return createLiquidityNode(id, { weth: amount, usdc: input.secondAmount ?? '0', tickLower: range.lower, tickUpper: range.upper, recipient: input.beneficiary ?? '', minimumWeth: '0', minimumUsdc: '0' }, mainnetContext);
  }
  const lendingInput = { network: 'Base Sepolia' as const, asset: 'USDC' as const, amount, beneficiary: input.beneficiary ?? '' };
  return selection.action === 'supply' ? createAuthoredSupply(id, lendingInput) : selection.action === 'borrow' ? createAuthoredBorrow(id, lendingInput) : selection.action === 'repay' ? createAuthoredRepay(id, lendingInput) : createAuthoredWithdraw(id, { network: 'Base Sepolia', asset: 'USDC', amount, recipient: 'CONNECTED_OWNER' });
}
export function cryptoInputOf(node: Node): CryptoActionInput | null {
  const selection = cryptoSelectionOf(node);
  if (!selection) return null;
  const solana = solanaSwapDetails(node), uni = uniswapLiquidityDetails(node), orca = solanaLiquidityDetails(node);
  const evmSwap = selection.action === 'swap' && !solana ? swapDetails(node, node.chainId === 'eip155:84532' ? createBaseSepoliaReviewContext() : mainnetContext) : null;
  if (solana || evmSwap) return { selection, amount: (solana ?? evmSwap)!.amount, slippage: solana?.slippage ?? String(evmSwap!.slippage ?? 50) };
  if (uni || orca) return { selection, amount: uni?.maxUsdc ?? orca!.maxSol, secondAmount: uni?.maxWeth ?? orca!.maxDevUsdc, rangeUnit: 'TICK', lower: String((uni ?? orca)!.tickLower), upper: String((uni ?? orca)!.tickUpper), slippage: (uni ?? orca)!.slippage };
  if (selection.action === 'pool') {
    const details = liquidityDetails(node, mainnetContext);
    return details ? { selection, amount: formatHumanAmount(details.amountWeth, 'WETH', mainnetContext), secondAmount: formatHumanAmount(details.amountUsdc, 'USDC', mainnetContext), rangeUnit: 'TICK', lower: String(details.tickLower), upper: String(details.tickUpper), beneficiary: details.recipient, slippage: '50' } : null;
  }
  const lending = supplyDetails(node as SemanticWorkflow['nodes'][number]) ?? borrowDetails(node as SemanticWorkflow['nodes'][number]) ?? repayDetails(node as SemanticWorkflow['nodes'][number]) ?? withdrawDetails(node as SemanticWorkflow['nodes'][number]);
  return lending ? { selection, amount: lending.amount, slippage: '50', ...('beneficiary' in lending ? { beneficiary: lending.beneficiary } : {}) } : null;
}
