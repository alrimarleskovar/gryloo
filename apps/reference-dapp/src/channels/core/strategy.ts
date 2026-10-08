// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: from the channel's pending proposal to the canonical strategy every FloFi surface shares.
 *
 * A channel proposal is the same authoring `Command` FloFi's own chat produces (the exact grammar, or the Copilot through the exact
 * grammar), authored against the editor's initial state. It becomes a StrategySpec (v1) by the inverse of the engine's own mapping,
 * and that spec is composed by the shared platform (`composeWorkflowOrRefuse`). The parity guard then requires the platform to
 * reproduce the very same command — so the canonical IR and workflow hash are exactly what MCP, the Developer API and FloFi's chat
 * produce for it. Any difference fails closed (`CHANNEL_STRATEGY_PARITY_FAILED`): nothing is handed off.
 *
 * Addresses are compared case-insensitively, because the canonical strategy stores them lower-cased. An address the user typed is
 * only strategy input: it becomes the handoff's intended wallet, which FloFi checks against a PROVEN wallet at claim time.
 */
import type { Command } from '../../domain/commands';
import type { WorkflowStep } from '../../domain/workflow-steps';
import type { NetworkId, StrategySpec } from '../../engine/strategy-spec';
import { composeWorkflowOrRefuse, PlatformRefusal, type WalletRef } from '../../platform/index.ts';

const LENDING_NETWORK: Readonly<Record<string, NetworkId>> = { 'Base Sepolia': 'base-sepolia', 'Ethereum Sepolia': 'ethereum-sepolia' };
const SWAP_NETWORK: Readonly<Record<string, NetworkId>> = { ADD_SWAP: 'base', ADD_TESTNET_SWAP: 'base-sepolia', ADD_ETHEREUM_SEPOLIA_SWAP: 'ethereum-sepolia' };
const ROUTING = { AUTO: 'auto', LIFI: 'lifi', ACROSS: 'across' } as const;
const bps = (value: string) => /^(0|[1-9][0-9]{0,4})$/.test(value) ? Number(value) : NaN;

/** The StrategySpec (v1) an authoring command expresses, or null for anything that is not one of the Copilot's authoring commands. */
export function strategyOfCommand(command: Command): StrategySpec | null {
  const c = command as Command & Record<string, unknown>;
  switch (command.type) {
    case 'ADD_SWAP': case 'ADD_TESTNET_SWAP': case 'ADD_ETHEREUM_SEPOLIA_SWAP': {
      const usdcIn = c.direction === 'USDC_TO_WETH';
      return { version: 1, action: 'swap', network: SWAP_NETWORK[command.type]!, inputAsset: usdcIn ? 'USDC' : 'WETH', outputAsset: usdcIn ? 'WETH' : 'USDC',
        amount: String(c.amount), slippageBps: bps(String(c.slippage)) } as StrategySpec;
    }
    case 'ADD_SOLANA_SWAP': {
      const i = c.input as { network: string; from: string; to: string; amount: string; slippage: string };
      return { version: 1, action: 'swap', network: i.network === 'Solana' ? 'solana' : 'solana-devnet', inputAsset: i.from, outputAsset: i.to, amount: i.amount,
        slippageBps: bps(i.slippage) } as StrategySpec;
    }
    case 'ADD_ROUTER_BRIDGE': {
      const i = c.input as { source: string; destination: string; amount: string; recipient: string; slippage: string; routing: keyof typeof ROUTING };
      return { version: 1, action: 'bridge', sourceNetwork: i.source === 'Base' ? 'base' : 'base-sepolia', destinationNetwork: i.destination === 'Arbitrum' ? 'arbitrum-one'
        : 'arbitrum-sepolia', asset: 'USDC', amount: i.amount, routing: ROUTING[i.routing], slippageBps: bps(i.slippage), ...i.recipient ? { recipient: i.recipient } : {} } as StrategySpec;
    }
    case 'ADD_SUPPLY': case 'ADD_BORROW': case 'ADD_REPAY': {
      const i = c.input as { network: string; asset: string; amount: string; beneficiary: string };
      return { version: 1, action: command.type === 'ADD_SUPPLY' ? 'supply' : command.type === 'ADD_BORROW' ? 'borrow' : 'repay', network: LENDING_NETWORK[i.network],
        asset: i.asset, amount: i.amount, beneficiary: i.beneficiary } as StrategySpec;
    }
    case 'ADD_WITHDRAW': {
      const i = c.input as { network: string; asset: string; amount: string };
      return { version: 1, action: 'withdraw', network: LENDING_NETWORK[i.network], asset: i.asset, amount: i.amount } as StrategySpec;
    }
    case 'ADD_UNISWAP_LIQUIDITY': {
      const i = c.input as { network: string; maxUsdc: string; maxWeth: string; rangeUnit: 'PRICE' | 'TICK'; lower: string; upper: string; slippage: string };
      return { version: 1, action: 'add_liquidity', network: LENDING_NETWORK[i.network], maxAmounts: { USDC: i.maxUsdc, WETH: i.maxWeth },
        range: { unit: i.rangeUnit === 'PRICE' ? 'price' : 'tick', lower: i.lower, upper: i.upper }, slippageBps: bps(i.slippage) } as StrategySpec;
    }
    case 'ADD_SOLANA_LIQUIDITY': {
      const i = c.input as { maxSol: string; maxDevUsdc: string; rangeUnit: 'PRICE' | 'TICK'; lower: string; upper: string; slippage: string };
      return { version: 1, action: 'add_liquidity', network: 'solana-devnet', maxAmounts: { SOL: i.maxSol, devUSDC: i.maxDevUsdc },
        range: { unit: i.rangeUnit === 'PRICE' ? 'price' : 'tick', lower: i.lower, upper: i.upper }, slippageBps: bps(i.slippage) } as StrategySpec;
    }
    case 'AUTHOR_LENDING': {
      const i = c.input as { supply: string; borrow: string; slippage: string; owner: string };
      return { version: 1, action: 'lending_composition', network: 'base-sepolia', asset: 'USDC', supplyAmount: i.supply, borrowAmount: i.borrow, outputAsset: 'WETH',
        slippageBps: bps(i.slippage), owner: i.owner } as StrategySpec;
    }
    default: return null;
  }
}

/** A structure with keys sorted and EVM addresses lower-cased: what "the same command" means for the parity guard. */
function canonical(value: unknown): unknown {
  if (typeof value === 'string') return /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical((value as Record<string, unknown>)[k])]));
  return value;
}
export const sameCommand = (a: Command, b: Command) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** The one address a strategy names (beneficiary, owner or recipient): the wallet that alone may claim its handoff. */
export function intendedWalletOf(spec: StrategySpec): WalletRef | null {
  const s = spec as StrategySpec & { beneficiary?: string; owner?: string; recipient?: string };
  const address = s.action === 'lending_composition' ? s.owner : s.action === 'bridge' ? s.recipient : s.action === 'supply' || s.action === 'borrow' || s.action === 'repay'
    ? s.beneficiary : undefined;
  return address ? { namespace: 'eip155', address: address.toLowerCase() } : null;
}

export type ChannelStrategy = { readonly ok: true; readonly spec: StrategySpec; readonly workflowHash: string; readonly command: Command; readonly summary: string;
  readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS'; readonly notes: readonly string[]; readonly intendedWallet: WalletRef | null;
  /** The financial steps of the canonical IR (the editor's authoring-only template is not a step). */
  readonly steps: readonly WorkflowStep[] };
/** The canonical strategy of a pending authoring command, composed by the shared platform and checked for parity; or a closed code. */
export function canonicalStrategy(command: Command): ChannelStrategy | { readonly ok: false; readonly code: string } {
  const spec = strategyOfCommand(command);
  if (!spec) return { ok: false, code: 'CHANNEL_COMMAND_NOT_AUTHORING' };
  let workflow;
  try { workflow = composeWorkflowOrRefuse(spec, undefined); }
  catch (cause) { return { ok: false, code: cause instanceof PlatformRefusal ? cause.message : 'CHANNEL_STRATEGY_PARITY_FAILED' }; }
  const step = workflow.steps.length === 1 ? workflow.steps[0]! : null;
  if (!step || !sameCommand(step.command, command)) return { ok: false, code: 'CHANNEL_STRATEGY_PARITY_FAILED' };
  return { ok: true, spec: workflow.strategy as StrategySpec, workflowHash: workflow.workflowHash, command: step.command, summary: step.summary,
    fundsClass: workflow.fundsClass, notes: workflow.notes, intendedWallet: intendedWalletOf(workflow.strategy as StrategySpec),
    steps: step.steps.filter(s => s.kind !== 'TEMPLATE') };
}
