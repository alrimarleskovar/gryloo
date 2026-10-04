// SPDX-License-Identifier: AGPL-3.0-only
import { createRouterBridgeNode, isRouterBridgeNode, readRouterBridgeNode, ROUTER_PAIRS, type RoutingProvider, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as profile } from '@defi-workflow-engine/action-registry';
import { formatTokenAmount, parseTokenAmount } from './jupiter-authoring';

/**
 * BUILD-ROUTER-001: chat and canvas author the same canonical `asset.bridge` node routed by the Cross-chain Router.
 * The owner chooses chains, token, amount, recipient (blank = the connected wallet, bound at Review), slippage and the
 * routing policy. The policy is intent (which providers may be asked, in which order); the route itself is chosen at
 * quote time and shown at Review — never silently afterwards.
 */
export type RouterRouting = 'AUTO' | 'LIFI' | 'ACROSS';
export type RouterBridgeInput = { source: 'Base'; destination: 'Arbitrum'; token: 'USDC'; amount: string;
  /** '' = the connected wallet. */ recipient: string; slippage: string; routing: RouterRouting };
export const ROUTER_ROUTING: Readonly<Record<RouterRouting, readonly RoutingProvider[]>> = Object.freeze({ AUTO: ['lifi', 'across'], LIFI: ['lifi'], ACROSS: ['across'] });
export const ROUTER_ROUTING_LABEL: Readonly<Record<RouterRouting, string>> = Object.freeze({
  AUTO: 'Automatic: LI.FI first, Across direct if LI.FI has no reconcilable route', LIFI: 'LI.FI only', ACROSS: 'Across direct only' });
export const ROUTER_DEFAULT_SLIPPAGE = String(profile.defaultSlippageBps);
const pair = ROUTER_PAIRS[0]!;
const routingOf = (providers: readonly string[]): RouterRouting | null =>
  (Object.keys(ROUTER_ROUTING) as RouterRouting[]).find(k => ROUTER_ROUTING[k].join() === providers.join()) ?? null;

export function createRouterNode(nodeId: string, input: RouterBridgeInput): SemanticWorkflow['nodes'][number] {
  if (input.source !== 'Base' || input.destination !== 'Arbitrum' || input.token !== 'USDC') throw new Error('ROUTER_PAIR_UNSUPPORTED');
  if (!Object.hasOwn(ROUTER_ROUTING, input.routing)) throw new Error('ROUTER_PROVIDER_POLICY_INVALID');
  if (!/^[1-9][0-9]{0,3}$/.test(input.slippage)) throw new Error('ROUTER_SLIPPAGE_OUT_OF_RANGE');
  const recipient = input.recipient.trim();
  if (recipient !== '' && !/^0x[0-9a-fA-F]{40}$/.test(recipient)) throw new Error('ROUTER_RECIPIENT_INVALID');
  return createRouterBridgeNode(nodeId, { sourceChain: pair.source.chainId, destinationChain: pair.destination.chainId, inputToken: pair.source.address,
    outputToken: pair.destination.address, amount: parseTokenAmount(input.amount.trim(), pair.source.decimals),
    recipient: recipient === '' ? 'CONNECTED_OWNER' : recipient.toLowerCase(), slippageBps: Number(input.slippage), providers: ROUTER_ROUTING[input.routing] });
}
export type RouterDetails = RouterBridgeInput & { units: string; recipientLabel: string };
export function routerDetails(node: SemanticWorkflow['nodes'][number] | { readonly actionType: string }): RouterDetails | null {
  if (!('adapterConstraints' in node) || !isRouterBridgeNode(node)) return null;
  try {
    const f = readRouterBridgeNode(node), routing = routingOf(f.providers);
    if (!routing) return null;
    return { source: 'Base', destination: 'Arbitrum', token: 'USDC', amount: formatTokenAmount(f.amount, pair.source.decimals), units: f.amount,
      recipient: f.recipient === 'CONNECTED_OWNER' ? '' : f.recipient, recipientLabel: f.recipient === 'CONNECTED_OWNER' ? 'your connected wallet' : f.recipient,
      slippage: String(f.slippageBps), routing };
  } catch { return null; }
}
/** Editing input that reproduces the node exactly. */
export const routerInputOf = (d: RouterDetails): RouterBridgeInput =>
  ({ source: d.source, destination: d.destination, token: d.token, amount: d.amount, recipient: d.recipient, slippage: d.slippage, routing: d.routing });
export const ROUTER_CHAT_PATTERN = /^bridge ([0-9]+(?:\.[0-9]+)?) USDC from Base to Arbitrum(?: (?:to|recipient) (0x[0-9a-fA-F]{40}))?(?: via (LI\.FI|LIFI|Across|auto))?(?: (?:with )?slippage ([0-9]+) bps)?$/i;
/** "Bridge 5 USDC from Base to Arbitrum [to 0x…] [via LI.FI|Across|auto] [slippage 50 bps]". */
export function parseRouterChat(text: string): RouterBridgeInput | null {
  const m = ROUTER_CHAT_PATTERN.exec(text.trim());
  if (!m) return null;
  const via = (m[3] ?? 'auto').toLowerCase();
  return { source: 'Base', destination: 'Arbitrum', token: 'USDC', amount: m[1]!, recipient: m[2]?.toLowerCase() ?? '', slippage: m[4] ?? ROUTER_DEFAULT_SLIPPAGE,
    routing: via === 'across' ? 'ACROSS' : via === 'auto' ? 'AUTO' : 'LIFI' };
}
