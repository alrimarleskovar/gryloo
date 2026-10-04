// SPDX-License-Identifier: AGPL-3.0-only
import { createRouterBridgeNode, isRouterBridgeNode, readRouterBridgeNode, routerPair, ROUTER_PAIRS, type RoutingProvider, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM, CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA, type RouterProfile } from '@defi-workflow-engine/action-registry';
import { formatTokenAmount, parseTokenAmount } from './jupiter-authoring';

/**
 * BUILD-ROUTER-001: chat and canvas author the same canonical `asset.bridge` node routed by the Cross-chain Router.
 * The owner chooses chains, token, amount, recipient (blank = the connected wallet, bound at Review), slippage and the
 * routing policy. The policy is intent (which providers may be asked, in which order); the route itself is chosen at
 * quote time and shown at Review — never silently afterwards.
 * BUILD-JOURNEY-001: the chain pair also selects the network — Base → Arbitrum One (real funds) or Base Sepolia →
 * Arbitrum Sepolia (test USDC, the permissionless journey).
 */
export type RouterRouting = 'AUTO' | 'LIFI' | 'ACROSS';
export type RouterSource = 'Base' | 'Base Sepolia';
export type RouterDestination = 'Arbitrum' | 'Arbitrum Sepolia';
export type RouterNetwork = 'mainnet' | 'testnet';
export type RouterBridgeInput = { source: RouterSource; destination: RouterDestination; token: 'USDC'; amount: string;
  /** '' = the connected wallet. */ recipient: string; slippage: string; routing: RouterRouting };
export const ROUTER_ROUTING: Readonly<Record<RouterRouting, readonly RoutingProvider[]>> = Object.freeze({ AUTO: ['lifi', 'across'], LIFI: ['lifi'], ACROSS: ['across'] });
export const ROUTER_ROUTING_LABEL: Readonly<Record<RouterRouting, string>> = Object.freeze({
  AUTO: 'Automatic: LI.FI first, Across direct if LI.FI has no reconcilable route', LIFI: 'LI.FI only', ACROSS: 'Across direct only' });
export const ROUTER_DEFAULT_SLIPPAGE = String(CROSSCHAIN_ROUTER_BASE_ARBITRUM.defaultSlippageBps);
/** One entry per supported network: its labels, its canonical pair and its deployment profile. */
export const ROUTER_NETWORK_OPTIONS = Object.freeze({
  mainnet: Object.freeze({ source: 'Base' as const, destination: 'Arbitrum' as const, sourceLabel: 'Base', destinationLabel: 'Arbitrum One', pair: ROUTER_PAIRS[0]!,
    profile: CROSSCHAIN_ROUTER_BASE_ARBITRUM, funds: 'Real funds: Base mainnet and Arbitrum One.' }),
  testnet: Object.freeze({ source: 'Base Sepolia' as const, destination: 'Arbitrum Sepolia' as const, sourceLabel: 'Base Sepolia', destinationLabel: 'Arbitrum Sepolia',
    pair: ROUTER_PAIRS[1]!, profile: CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA, funds: 'Test USDC on public testnets: Base Sepolia and Arbitrum Sepolia. No real funds.' }),
}) satisfies Readonly<Record<RouterNetwork, { source: RouterSource; destination: RouterDestination; sourceLabel: string; destinationLabel: string;
  pair: (typeof ROUTER_PAIRS)[number]; profile: RouterProfile; funds: string }>>;
export function routerNetworkOfInput(input: Pick<RouterBridgeInput, 'source' | 'destination'>): RouterNetwork | null {
  return (Object.keys(ROUTER_NETWORK_OPTIONS) as RouterNetwork[]).find(n => ROUTER_NETWORK_OPTIONS[n].source === input.source &&
    ROUTER_NETWORK_OPTIONS[n].destination === input.destination) ?? null;
}
const routingOf = (providers: readonly string[]): RouterRouting | null =>
  (Object.keys(ROUTER_ROUTING) as RouterRouting[]).find(k => ROUTER_ROUTING[k].join() === providers.join()) ?? null;

export function createRouterNode(nodeId: string, input: RouterBridgeInput): SemanticWorkflow['nodes'][number] {
  const network = routerNetworkOfInput(input);
  if (!network || input.token !== 'USDC') throw new Error('ROUTER_PAIR_UNSUPPORTED');
  const pair = ROUTER_NETWORK_OPTIONS[network].pair;
  if (!Object.hasOwn(ROUTER_ROUTING, input.routing)) throw new Error('ROUTER_PROVIDER_POLICY_INVALID');
  if (!/^[1-9][0-9]{0,3}$/.test(input.slippage)) throw new Error('ROUTER_SLIPPAGE_OUT_OF_RANGE');
  const recipient = input.recipient.trim();
  if (recipient !== '' && !/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error('ROUTER_RECIPIENT_INVALID');
  return createRouterBridgeNode(nodeId, { sourceChain: pair.source.chainId, destinationChain: pair.destination.chainId, inputToken: pair.source.address,
    outputToken: pair.destination.address, amount: parseTokenAmount(input.amount.trim(), pair.source.decimals),
    recipient: recipient === '' ? 'CONNECTED_OWNER' : recipient.toLowerCase(), slippageBps: Number(input.slippage), providers: ROUTER_ROUTING[input.routing] });
}
export type RouterDetails = RouterBridgeInput & { units: string; recipientLabel: string; network: RouterNetwork };
export function routerDetails(node: SemanticWorkflow['nodes'][number] | { readonly actionType: string }): RouterDetails | null {
  if (!('adapterConstraints' in node) || !isRouterBridgeNode(node)) return null;
  try {
    const f = readRouterBridgeNode(node), routing = routingOf(f.providers), pair = routerPair(f.sourceChain, f.inputToken, f.destinationChain, f.outputToken);
    const network = (Object.keys(ROUTER_NETWORK_OPTIONS) as RouterNetwork[]).find(n => ROUTER_NETWORK_OPTIONS[n].pair.id === pair?.id);
    if (!routing || !pair || !network) return null;
    const option = ROUTER_NETWORK_OPTIONS[network];
    return { source: option.source, destination: option.destination, token: 'USDC', amount: formatTokenAmount(f.amount, pair.source.decimals), units: f.amount,
      recipient: f.recipient === 'CONNECTED_OWNER' ? '' : f.recipient, recipientLabel: f.recipient === 'CONNECTED_OWNER' ? 'your connected wallet' : f.recipient,
      slippage: String(f.slippageBps), routing, network };
  } catch { return null; }
}
/** The router network of a workflow's bridge node, or null when the workflow has none. */
export function routerNetworkOf(workflow: { readonly nodes: readonly (SemanticWorkflow['nodes'][number] | { readonly actionType: string })[] }): RouterNetwork | null {
  for (const node of workflow.nodes) { const details = routerDetails(node); if (details) return details.network; }
  return null;
}
/** Editing input that reproduces the node exactly. */
export const routerInputOf = (d: RouterDetails): RouterBridgeInput =>
  ({ source: d.source, destination: d.destination, token: d.token, amount: d.amount, recipient: d.recipient, slippage: d.slippage, routing: d.routing });
export const ROUTER_CHAT_PATTERN = /^bridge ([0-9]+(?:\.[0-9]+)?) USDC from (Base Sepolia|Base) to (Arbitrum Sepolia|Arbitrum)(?: (?:to|recipient) (0x[0-9a-fA-F]{40}))?(?: via (LI\.FI|LIFI|Across|auto))?(?: (?:with )?slippage ([0-9]+) bps)?$/i;
/** "Bridge 5 USDC from Base [Sepolia] to Arbitrum [Sepolia] [to 0x…] [via LI.FI|Across|auto] [slippage 50 bps]". Mixed networks are refused. */
export function parseRouterChat(text: string): RouterBridgeInput | null {
  const m = ROUTER_CHAT_PATTERN.exec(text.trim());
  if (!m) return null;
  const testnet = /sepolia/i.test(m[2]!);
  if (testnet !== /sepolia/i.test(m[3]!)) return null;
  const via = (m[5] ?? 'auto').toLowerCase();
  return { source: testnet ? 'Base Sepolia' : 'Base', destination: testnet ? 'Arbitrum Sepolia' : 'Arbitrum', token: 'USDC', amount: m[1]!,
    recipient: m[4]?.toLowerCase() ?? '', slippage: m[6] ?? ROUTER_DEFAULT_SLIPPAGE, routing: via === 'across' ? 'ACROSS' : via === 'auto' ? 'AUTO' : 'LIFI' };
}
