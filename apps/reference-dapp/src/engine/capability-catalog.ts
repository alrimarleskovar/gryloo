// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: discovery derived from the canonical profiles and registries — never a hand-written claim.
 *
 *  - networks and assets: the router pairs, Aave lending profiles, swap review contexts, Uniswap/Orca liquidity profiles and
 *    Solana token registries that authoring itself uses;
 *  - capabilities: each supported action × network composes its canonical example through the real reducer, then the
 *    execution capability registry is resolved on that exact IR. "Supported by code" is the registry's verdict; demonstrated
 *    evidence is the registry's ceiling (often none). Deployment enablement is added by the caller from the runtime.
 */
import { AAVE_V3_LENDING_PROFILES, executionCapabilityRegistry, LENDING_BASE_SEPOLIA, ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY, resolveNodeCapability,
  resolveWorkflowCapability, SOLANA_DEVNET_CHAIN, SOLANA_DEVNET_TOKENS, SOLANA_MAINNET_CHAIN, SOLANA_MAINNET_TOKENS, UNISWAP_LIQUIDITY_PROFILES,
  type CapabilityDimension, type EvidenceMaturity, type ExecutionEnvironment } from '@defi-workflow-engine/action-registry';
import { createBaseSepoliaReviewContext, createEthereumSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { ROUTER_PAIRS } from '@defi-workflow-engine/workflow-contracts';
import { composeStrategy, dappReviewContext, NETWORKS, strategyNetwork } from './strategy-engine';
import { STRATEGY_EXAMPLES } from './strategy-examples';
import { NETWORK_IDS, type NetworkId, type StrategyAction, type StrategySpec } from './strategy-spec';

/** CAIP-2 identity of each network, read from the registries that serve it. */
export const NETWORK_CHAINS: Readonly<Record<NetworkId, string>> = Object.freeze({
  'base': ROUTER_PAIRS[0]!.source.chainId, 'arbitrum-one': ROUTER_PAIRS[0]!.destination.chainId,
  'base-sepolia': ROUTER_PAIRS[1]!.source.chainId, 'arbitrum-sepolia': ROUTER_PAIRS[1]!.destination.chainId,
  'ethereum-sepolia': AAVE_V3_LENDING_PROFILES.find(p => p.network === 'Ethereum Sepolia')!.chain,
  'solana': SOLANA_MAINNET_CHAIN, 'solana-devnet': SOLANA_DEVNET_CHAIN,
});
const networkOfChain = (chain: string): NetworkId | null => NETWORK_IDS.find(id => NETWORK_CHAINS[id] === chain) ?? null;
const actionsOn = (network: NetworkId): StrategyAction[] => [...new Set(STRATEGY_EXAMPLES.filter(e => strategyNetwork(e.strategy) === network ||
  e.strategy.action === 'bridge' && e.strategy.destinationNetwork === network).map(e => e.strategy.action))];

export type NetworkInfo = { readonly id: NetworkId; readonly name: string; readonly chainId: string; readonly class: 'MAINNET' | 'TESTNET' | 'DEVNET';
  readonly funds: 'REAL_FUNDS' | 'TEST_FUNDS'; readonly actions: readonly StrategyAction[] };
export function supportedNetworks(): readonly NetworkInfo[] {
  return NETWORK_IDS.map(id => ({ id, name: NETWORKS[id].label, chainId: NETWORK_CHAINS[id], class: NETWORKS[id].class,
    funds: NETWORKS[id].class === 'MAINNET' ? 'REAL_FUNDS' : 'TEST_FUNDS', actions: actionsOn(id) }));
}

export type AssetInfo = { readonly network: NetworkId; readonly chainId: string; readonly symbol: string; readonly address: string; readonly decimals: number;
  readonly actions: readonly StrategyAction[]; readonly sources: readonly string[] };
type Entry = { chain: string; symbol: string; address: string; decimals: number; action: StrategyAction; source: string };
function assetEntries(): Entry[] {
  const out: Entry[] = [];
  for (const pair of ROUTER_PAIRS) for (const t of [pair.source, pair.destination])
    out.push({ chain: t.chainId, symbol: t.symbol, address: t.address, decimals: t.decimals, action: 'bridge', source: `crosschain-router:${pair.id}` });
  for (const p of AAVE_V3_LENDING_PROFILES) for (const action of ['supply', 'borrow', 'repay', 'withdraw'] as const)
    out.push({ chain: p.chain, symbol: p.symbol, address: p.asset, decimals: p.decimals, action, source: `aave-v3:${p.network}` });
  for (const [label, context] of [['Base', dappReviewContext()], ['Base Sepolia', createBaseSepoliaReviewContext()], ['Ethereum Sepolia', createEthereumSepoliaReviewContext()]] as const)
    for (const symbol of ['USDC', 'WETH'] as const) {
      const a = context.assets[symbol].asset as { chainId: string; address: string; decimals: number };
      out.push({ chain: a.chainId, symbol, address: a.address, decimals: a.decimals, action: 'swap', source: `uniswap-v3-swap:${label}` });
    }
  for (const p of UNISWAP_LIQUIDITY_PROFILES) for (const t of [p.token0, p.token1])
    out.push({ chain: p.chain, symbol: t.symbol, address: t.address, decimals: t.decimals, action: 'add_liquidity', source: `uniswap-v3-liquidity:${p.network}` });
  for (const [chain, tokens, source] of [[SOLANA_MAINNET_CHAIN, SOLANA_MAINNET_TOKENS, 'jupiter:Solana'], [SOLANA_DEVNET_CHAIN, SOLANA_DEVNET_TOKENS, 'orca-whirlpools:Solana Devnet']] as const)
    for (const t of Object.values(tokens) as { symbol: string; mint: string; decimals: number }[])
      out.push({ chain, symbol: t.symbol, address: t.mint, decimals: t.decimals, action: 'swap', source });
  for (const t of [ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY.token0, ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY.token1])
    out.push({ chain: ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY.chain, symbol: t.symbol, address: t.mint, decimals: t.decimals, action: 'add_liquidity', source: 'orca-whirlpools-liquidity:Solana Devnet' });
  const aave = AAVE_V3_LENDING_PROFILES.find(p => p.network === 'Base Sepolia')!;
  out.push({ chain: aave.chain, symbol: aave.symbol, address: aave.asset, decimals: aave.decimals, action: 'lending_composition', source: 'lending-composition:Base Sepolia' });
  out.push({ chain: aave.chain, symbol: 'WETH', address: LENDING_BASE_SEPOLIA.weth, decimals: 18, action: 'lending_composition', source: 'lending-composition:Base Sepolia' });
  return out;
}
/** Every asset a strategy can name, grouped by chain and address (one symbol can be two tokens on one network). */
export function supportedAssets(network?: NetworkId): readonly AssetInfo[] {
  const merged = new Map<string, { network: NetworkId; chainId: string; symbol: string; address: string; decimals: number; actions: Set<StrategyAction>; sources: Set<string> }>();
  for (const e of assetEntries()) {
    const id = networkOfChain(e.chain);
    if (!id || (network && id !== network)) continue;
    const key = `${e.chain}\0${e.address}`, item = merged.get(key) ?? { network: id, chainId: e.chain, symbol: e.symbol, address: e.address, decimals: e.decimals, actions: new Set(), sources: new Set() };
    item.actions.add(e.action); item.sources.add(e.source); merged.set(key, item);
  }
  return [...merged.values()].map(a => ({ network: a.network, chainId: a.chainId, symbol: a.symbol, address: a.address, decimals: a.decimals,
    actions: [...a.actions].sort(), sources: [...a.sources].sort() })).sort((a, b) => NETWORK_IDS.indexOf(a.network) - NETWORK_IDS.indexOf(b.network) || a.symbol.localeCompare(b.symbol));
}

export type CodeCapability = {
  readonly action: StrategyAction; readonly network: NetworkId; readonly destinationNetwork: NetworkId | null; readonly example: StrategySpec;
  readonly funds: 'REAL_FUNDS' | 'TEST_FUNDS'; readonly actionTypes: readonly string[]; readonly adapters: readonly string[];
  /** The registry's verdict for this network's public environment (PUBLIC_TESTNET or MAINNET). */
  readonly publicEnvironment: ExecutionEnvironment;
  readonly supportedByCode: Readonly<Record<CapabilityDimension, boolean>>;
  /** Owner-wallet execution implemented in code for that environment; a code fact, not a demonstration. */
  readonly ownerWalletExecutionImplemented: boolean;
  /** Highest evidence the registry records as demonstrated for this exact path; null = none demonstrated. */
  readonly demonstratedEvidence: EvidenceMaturity | null;
  /** Every registry environment the action's adapter declares on this chain (e.g. a mainnet path that is local-fork only). */
  readonly registryEnvironments: readonly ExecutionEnvironment[];
};
/** Code capabilities for each supported action × network, from the registry resolved on the composed IR. */
export function codeCapabilities(): readonly CodeCapability[] {
  return STRATEGY_EXAMPLES.map(({ strategy }) => {
    const composed = composeStrategy(strategy);
    if (!composed.ok) throw new Error('CAPABILITY_EXAMPLE_INVALID');
    const network = strategyNetwork(strategy), environment = NETWORKS[network].environment;
    const financial = composed.workflow.nodes.filter(n => !n.actionType.startsWith('mock-'));
    const resolved = resolveWorkflowCapability(composed.workflow, { environment, runtime: {} });
    const nodes = financial.map(node => resolveNodeCapability(node, { environment }));
    const adapters = [...new Set(nodes.map(n => n.adapterId).filter((id): id is string => id !== null))];
    const environments = [...new Set(executionCapabilityRegistry.filter(row => financial.some(n => n.actionType === row.actionType && n.chainId === row.chainId) &&
      adapters.includes(row.adapterId)).map(row => row.environment))];
    return { action: strategy.action, network, destinationNetwork: strategy.action === 'bridge' ? strategy.destinationNetwork : null, example: strategy,
      funds: composed.fundsClass, actionTypes: [...new Set(financial.map(n => n.actionType))], adapters, publicEnvironment: environment,
      supportedByCode: resolved.capabilities, ownerWalletExecutionImplemented: resolved.executionSupported,
      demonstratedEvidence: resolved.executionSupported ? resolved.evidenceCeiling : null, registryEnvironments: environments };
  });
}
