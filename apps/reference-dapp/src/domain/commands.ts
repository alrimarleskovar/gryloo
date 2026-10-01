// SPDX-License-Identifier: AGPL-3.0-only
import { createBaseSepoliaReviewContext, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import { actionKinds, type ActionKind } from './mock-actions';
import type { Workflow } from './initial-workflow';
import { SWAP_ACTION, directionLabel, parseHumanAmount, parseSlippage, swapDetails, type Direction } from './swap-authoring';
import { type LiquidityInput } from './liquidity-authoring';
import type { CompositionInput } from './composition-authoring';
import { BRIDGE_ACTION } from '@defi-workflow-engine/workflow-contracts';
import { bridgeDetails, parseBridgeAmount, type BridgeInput } from './bridge-authoring';
import type { BridgeSwapInput } from './bridge-swap-authoring';
import type { CrossChainLiquidityInput } from './cross-chain-liquidity';
import { liquidityDetails, parseTick } from '@defi-workflow-engine/reference-linter';

import { createAuthoredSupply, supplyDetails, type SupplyInput } from './supply-authoring';

type Base = { readonly baseRevision: number; readonly source: 'CHAT' | 'CANVAS' };
export type Command = Base & (
  | { readonly type: 'ADD_SUPPLY'; readonly input: SupplyInput }
  | { readonly type: 'SET_SUPPLY'; readonly nodeId: string; readonly input: SupplyInput }
  | { readonly type: 'ADD'; readonly kind: ActionKind }
  | { readonly type: 'SET_AMOUNT'; readonly nodeId: string; readonly amount: string }
  | { readonly type: 'LOCK'; readonly nodeId: string; readonly locked: boolean }
  | { readonly type: 'CONNECT'; readonly from: string; readonly to: string }
  | { readonly type: 'DISCONNECT'; readonly from: string; readonly to: string }
  | { readonly type: 'REMOVE'; readonly nodeId: string }
  | { readonly type: 'REMOVE_MANY'; readonly nodeIds: readonly string[] }
  | { readonly type: 'ADD_SWAP'; readonly direction: Direction; readonly amount: string; readonly slippage: string }
  | { readonly type: 'ADD_TESTNET_SWAP'; readonly direction: Direction; readonly amount: string; readonly slippage: string }
  | { readonly type: 'ADD_COW_SWAP'; readonly direction: Direction; readonly amount: string; readonly slippage: string }
  | { readonly type: 'SET_SWAP_AMOUNT'; readonly nodeId: string; readonly amount: string }
  | { readonly type: 'SET_SLIPPAGE'; readonly nodeId: string; readonly slippage: string }
  | { readonly type: 'AUTHOR_COMPOSITION'; readonly safe: string; readonly input: CompositionInput }
  | { readonly type: 'ADD_BRIDGE'; readonly input: BridgeInput }
  | { readonly type: 'AUTHOR_BRIDGE_SWAP'; readonly input: BridgeSwapInput }
  | { readonly type: 'AUTHOR_ACROSS'; readonly input: BridgeInput }
  | { readonly type: 'AUTHOR_CROSS_CHAIN_LIQUIDITY'; readonly input: CrossChainLiquidityInput }
  | { readonly type: 'SET_BRIDGE'; readonly nodeId: string; readonly input: BridgeInput }
  | { readonly type: 'ADD_LIQUIDITY'; readonly input: LiquidityInput }
  | { readonly type: 'SET_LIQUIDITY'; readonly nodeId: string; readonly input: LiquidityInput }
);

export const HELP = 'Try “swap 2 USDC to WETH on Base slippage 50 bps”, “set node-002 amount 3”, “set node-002 slippage 100 bps”, “add read”, or “explain”. No model or network service is connected.';
export const BRIDGE_HELP = 'Try “bridge 1 USDC from Base to Optimism slippage 50 bps”, “swap 2 USDC to WETH on Base slippage 50 bps”, “set node-002 amount 3”, “set node-002 slippage 100 bps”, “add read”, or “explain”. No model or network service is connected.';
export function parseMockCommand(text: string, baseRevision: number): Command {
  const input = text.trim();
  const add = /^add (read|transform|condition)$/.exec(input);
  if (add) return { type: 'ADD', kind: add[1] as ActionKind, source: 'CHAT', baseRevision };
  const set = /^set (node-\d+) amount (0|[1-9][0-9]{0,77})$/.exec(input);
  if (set) return { type: 'SET_AMOUNT', nodeId: set[1]!, amount: set[2]!, source: 'CHAT', baseRevision };
  throw new Error(HELP);
}
export function parseLocalCommand(text: string, workflow: Workflow, context: ReviewContext, defaultBeneficiary?: string | null): Command {
  if (typeof text !== 'string' || text.length > 1024) throw new Error('INPUT_TOO_LARGE');
  const input = text.trim();
  const supply = /^supply ([0-9]+(?:\.[0-9]+)?) USDC to Aave on Base Sepolia(?: (?:beneficiary|on behalf of) (0x[0-9a-fA-F]{40}))?$/i.exec(input);
  if (supply) {
    const beneficiary = supply[2] ?? defaultBeneficiary;
    if (!beneficiary) throw new Error('SUPPLY_BENEFICIARY_REQUIRED');
    const fields: SupplyInput = { network: 'Base Sepolia', asset: 'USDC', amount: supply[1]!, beneficiary };
    createAuthoredSupply('node-preview', fields);
    return { type: 'ADD_SUPPLY', input: fields, source: 'CHAT', baseRevision: workflow.revision };
  }
  const supplyEdit = /^set (node-\d+) amount (\S+)$/i.exec(input);
  if (supplyEdit) {
    const node = workflow.nodes.find(n => n.nodeId === supplyEdit[1]);
    const fields = node && supplyDetails(node as Parameters<typeof supplyDetails>[0]);
    if (fields) { const updated = { ...fields, amount: supplyEdit[2]! }; createAuthoredSupply(node!.nodeId, updated);
      return { type: 'SET_SUPPLY', nodeId: node!.nodeId, input: updated, source: 'CHAT', baseRevision: workflow.revision }; }
  }
  const crossChain = /^bridge ([0-9]+(?:\.[0-9]+)?) USDC from Base to Arbitrum via (LI\.FI|Across) and create Uniswap liquidity ticks (-?[0-9]+) to (-?[0-9]+) recipient (0x[0-9a-fA-F]{40})(?: without swap)?$/i.exec(input);
  if (crossChain) {
    parseBridgeAmount(crossChain[1]!); parseTick(`tick:${crossChain[3]}`); parseTick(`tick:${crossChain[4]}`);
    return { type: 'AUTHOR_CROSS_CHAIN_LIQUIDITY', source: 'CHAT', baseRevision: workflow.revision,
      input: { amount: crossChain[1]!, bridgeSlippageBps: '50', swapSlippageBps: '50',
        tickLower: crossChain[3]!, tickUpper: crossChain[4]!, recipient: crossChain[5]!.toLowerCase(),
        provider: crossChain[2]!.toLowerCase() === 'across' ? 'across.direct' : 'lifi.rest',
        noSwap: / without swap$/i.test(input) } };
  }
  const bridgeSwap = /^compose bridge ([0-9]+(?:\.[0-9]+)?) USDC from Base to Arbitrum slippage ([0-9]+) bps then swap to WETH slippage ([0-9]+) bps$/i.exec(input);
  if (bridgeSwap) { parseBridgeAmount(bridgeSwap[1]!); parseSlippage(bridgeSwap[2]!); parseSlippage(bridgeSwap[3]!);
    return { type: 'AUTHOR_BRIDGE_SWAP', input: { amount: bridgeSwap[1]!, slippageBps: bridgeSwap[2]!, swapSlippageBps: bridgeSwap[3]! }, source: 'CHAT', baseRevision: workflow.revision }; }
  const bridge = /^(bridge|set (node-\d+) bridge) ([0-9]+(?:\.[0-9]+)?) USDC from Base to Optimism slippage ([0-9]+) bps$/i.exec(input);
  if (bridge) { parseBridgeAmount(bridge[3]!); parseSlippage(bridge[4]!);
    const value = { amount: bridge[3]!, slippageBps: bridge[4]! };
    return bridge[2] ? { type: 'SET_BRIDGE', nodeId: bridge[2], input: value, source: 'CHAT', baseRevision: workflow.revision }
      : { type: 'ADD_BRIDGE', input: value, source: 'CHAT', baseRevision: workflow.revision }; }
  const composition = /^compose swap ([0-9]+(?:\.[0-9]+)?) USDC to WETH slippage ([0-9]+) bps then mint maximum ([0-9]+(?:\.[0-9]+)?) WETH and ([0-9]+(?:\.[0-9]+)?) USDC minimum ([0-9]+(?:\.[0-9]+)?) WETH and ([0-9]+(?:\.[0-9]+)?) USDC ticks (-?[0-9]+) to (-?[0-9]+) safe (0x[0-9a-fA-F]{40})$/i.exec(input);
  if (composition) {
    parseHumanAmount(composition[1], 'USDC', context); parseSlippage(composition[2]);
    parseHumanAmount(composition[3], 'WETH', context); parseHumanAmount(composition[4], 'USDC', context);
    parseTick(`tick:${composition[7]}`); parseTick(`tick:${composition[8]}`);
    const safe = composition[9]!.toLowerCase();
    return { type: 'AUTHOR_COMPOSITION', safe, input: { swapUSDC: composition[1]!, slippageBps: composition[2]!,
      mint: { weth: composition[3]!, usdc: composition[4]!, minimumWeth: composition[5]!, minimumUsdc: composition[6]!,
        tickLower: composition[7]!, tickUpper: composition[8]!, recipient: safe } }, source: 'CHAT', baseRevision: workflow.revision };
  }
  const liquidity = /^(add liquidity|set (node-\d+) liquidity) ([0-9]+(?:\.[0-9]+)?) WETH and ([0-9]+(?:\.[0-9]+)?) USDC minimum ([0-9]+(?:\.[0-9]+)?) WETH and ([0-9]+(?:\.[0-9]+)?) USDC ticks (-?[0-9]+) to (-?[0-9]+) recipient (0x[0-9a-fA-F]{40})$/i.exec(input);
  if (liquidity) {
    parseHumanAmount(liquidity[3], 'WETH', context); parseHumanAmount(liquidity[4], 'USDC', context);
    parseTick(`tick:${liquidity[7]}`); parseTick(`tick:${liquidity[8]}`);
    const details: LiquidityInput = { weth: liquidity[3]!, usdc: liquidity[4]!, minimumWeth: liquidity[5]!, minimumUsdc: liquidity[6]!, tickLower: liquidity[7]!, tickUpper: liquidity[8]!, recipient: liquidity[9]!.toLowerCase() };
    return liquidity[2] ? { type: 'SET_LIQUIDITY', nodeId: liquidity[2], input: details, source: 'CHAT', baseRevision: workflow.revision }
      : { type: 'ADD_LIQUIDITY', input: details, source: 'CHAT', baseRevision: workflow.revision };
  }
  const swap = /^swap ([0-9]+(?:\.[0-9]+)?) (USDC|WETH) to (USDC|WETH) on (Base|Base Sepolia) slippage ([0-9]+) bps$/i.exec(input);
  if (swap) {
    const from = swap[2]!.toUpperCase(), to = swap[3]!.toUpperCase();
    if (from === to) throw new Error('INVALID_ASSET_PAIR');
    const direction: Direction = from === 'USDC' && to === 'WETH' ? 'USDC_TO_WETH' : from === 'WETH' && to === 'USDC' ? 'WETH_TO_USDC' : (() => { throw new Error('INVALID_ASSET_PAIR'); })();
    const testnet = swap[4]!.toLowerCase() === 'base sepolia';
    parseHumanAmount(swap[1], from as 'USDC' | 'WETH', testnet ? createBaseSepoliaReviewContext() : context);
    parseSlippage(swap[5]);
    return { type: testnet ? 'ADD_TESTNET_SWAP' : 'ADD_SWAP', direction, amount: swap[1]!, slippage: swap[5]!, source: 'CHAT', baseRevision: workflow.revision };
  }
  const amount = /^set (node-\d+) amount (\S+)$/i.exec(input);
  if (amount && workflow.nodes.find(n => n.nodeId === amount[1])?.actionType === SWAP_ACTION) {
    const node = workflow.nodes.find(n => n.nodeId === amount[1])!;
    const details = swapDetails(node, context);
    if (!details) throw new Error('INVALID_SWAP_NODE');
    parseHumanAmount(amount[2], details.from, context);
    return { type: 'SET_SWAP_AMOUNT', nodeId: amount[1]!, amount: amount[2]!, source: 'CHAT', baseRevision: workflow.revision };
  }
  const slippage = /^set (node-\d+) slippage (\S+) bps$/i.exec(input);
  if (slippage) {
    parseSlippage(slippage[2]);
    return { type: 'SET_SLIPPAGE', nodeId: slippage[1]!, slippage: slippage[2]!, source: 'CHAT', baseRevision: workflow.revision };
  }
  return parseMockCommand(input.toLowerCase(), workflow.revision);
}
export function commandIsValid(input: unknown): input is Command {
  try {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(input);
  if (keys.some(key => typeof key !== 'string' || (() => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return !descriptor || !descriptor.enumerable || !('value' in descriptor);
  })())) return false;
  const command = input as Record<string, unknown>;
  if (!Number.isSafeInteger(command.baseRevision) || (command.baseRevision as number) < 0
      || !['CHAT', 'CANVAS'].includes(command.source as string)) return false;
  const fields: Record<string, string[]> = {
    ADD_SUPPLY: ['input'], SET_SUPPLY: ['nodeId','input'], ADD: ['kind'], AUTHOR_CROSS_CHAIN_LIQUIDITY: ['input'], AUTHOR_BRIDGE_SWAP: ['input'], AUTHOR_ACROSS: ['input'], ADD_BRIDGE: ['input'], SET_BRIDGE: ['nodeId', 'input'], SET_AMOUNT: ['nodeId', 'amount'], LOCK: ['nodeId', 'locked'], AUTHOR_COMPOSITION: ['safe', 'input'], ADD_LIQUIDITY: ['input'], SET_LIQUIDITY: ['nodeId', 'input'],
    CONNECT: ['from', 'to'], DISCONNECT: ['from', 'to'], REMOVE: ['nodeId'], REMOVE_MANY: ['nodeIds'], ADD_SWAP: ['direction', 'amount', 'slippage'], ADD_TESTNET_SWAP: ['direction', 'amount', 'slippage'], ADD_COW_SWAP: ['direction', 'amount', 'slippage'],
    SET_SWAP_AMOUNT: ['nodeId', 'amount'], SET_SLIPPAGE: ['nodeId', 'slippage'],
  };
  if (typeof command.type !== 'string' || !fields[command.type]
      || (keys as string[]).sort().join() !== ['type', 'source', 'baseRevision', ...fields[command.type]!].sort().join()) return false;
  const id = (value: unknown) => typeof value === 'string' && /^node-\d{3,16}$/.test(value);
  switch (command.type) {
    case 'ADD_SUPPLY':
    case 'SET_SUPPLY': {
      if (command.type === 'SET_SUPPLY' && !id(command.nodeId)) return false;
      const fields = command.input;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.getPrototypeOf(fields) !== Object.prototype ||
          Reflect.ownKeys(fields).sort().join() !== ['network','asset','amount','beneficiary'].sort().join() ||
          !Object.values(fields).every(v => typeof v === 'string' && v.length <= 80)) return false;
      try { createAuthoredSupply('node-preview', fields as SupplyInput); return true; } catch { return false; }
    }
    case 'ADD': return actionKinds.includes(command.kind as ActionKind);
    case 'SET_AMOUNT': return id(command.nodeId) && typeof command.amount === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(command.amount);
    case 'LOCK': return id(command.nodeId) && typeof command.locked === 'boolean' && command.source === 'CANVAS';
    case 'CONNECT':
    case 'DISCONNECT': return id(command.from) && id(command.to);
    case 'REMOVE': return id(command.nodeId);
    case 'REMOVE_MANY': return command.source === 'CANVAS' && Array.isArray(command.nodeIds)
      && command.nodeIds.length > 0 && command.nodeIds.length <= 1024
      && command.nodeIds.every(id) && new Set(command.nodeIds).size === command.nodeIds.length;
    case 'AUTHOR_COMPOSITION': {
      if (typeof command.safe !== 'string' || !/^0x[0-9a-f]{40}$/.test(command.safe)) return false;
      const value = command.input;
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
          Reflect.ownKeys(value).sort().join() !== ['swapUSDC', 'slippageBps', 'mint'].sort().join()) return false;
      const v = value as Record<string, unknown>;
      if (typeof v.swapUSDC !== 'string' || v.swapUSDC.length > 80 || typeof v.slippageBps !== 'string' || v.slippageBps.length > 5) return false;
      const mint = v.mint;
      return !!mint && typeof mint === 'object' && !Array.isArray(mint) && Object.getPrototypeOf(mint) === Object.prototype &&
        Reflect.ownKeys(mint).sort().join() === ['weth', 'usdc', 'minimumWeth', 'minimumUsdc', 'tickLower', 'tickUpper', 'recipient'].sort().join() &&
        Object.values(mint).every(item => typeof item === 'string' && item.length <= 80);
    }
    case 'AUTHOR_CROSS_CHAIN_LIQUIDITY': {
      const value = command.input;
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
          Reflect.ownKeys(value).sort().join() !== ['amount','bridgeSlippageBps','swapSlippageBps','tickLower','tickUpper','recipient','provider','noSwap'].sort().join()) return false;
      const v = value as Record<string, unknown>;
      return ['amount','bridgeSlippageBps','swapSlippageBps','tickLower','tickUpper','recipient'].every(key => typeof v[key] === 'string' && (v[key] as string).length <= 80)
        && ['lifi.rest','across.direct'].includes(v.provider as string) && typeof v.noSwap === 'boolean';
    }
    case 'AUTHOR_BRIDGE_SWAP': {
      const value = command.input;
      return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
        && Reflect.ownKeys(value).sort().join() === ['amount','slippageBps','swapSlippageBps'].sort().join()
        && Object.values(value).every(item => typeof item === 'string' && item.length <= 40);
    }
    case 'AUTHOR_ACROSS':
    case 'ADD_BRIDGE':
    case 'SET_BRIDGE': {
      if (command.type === 'SET_BRIDGE' && !id(command.nodeId)) return false;
      const value = command.input;
      return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
        && Reflect.ownKeys(value).sort().join() === ['amount','slippageBps'].sort().join()
        && Object.values(value).every(item => typeof item === 'string' && item.length <= 40);
    }
    case 'ADD_LIQUIDITY':
    case 'SET_LIQUIDITY': {
      if (command.type === 'SET_LIQUIDITY' && !id(command.nodeId)) return false;
      const value = command.input;
      return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
        && Reflect.ownKeys(value).sort().join() === ['weth', 'usdc', 'minimumWeth', 'minimumUsdc', 'tickLower', 'tickUpper', 'recipient'].sort().join()
        && Object.values(value).every(item => typeof item === 'string' && item.length <= 80);
    }
    case 'ADD_SWAP':
    case 'ADD_TESTNET_SWAP':
    case 'ADD_COW_SWAP': return ['USDC_TO_WETH', 'WETH_TO_USDC'].includes(command.direction as string)
      && typeof command.amount === 'string' && command.amount.length <= 80
      && typeof command.slippage === 'string' && command.slippage.length <= 5;
    case 'SET_SWAP_AMOUNT': return id(command.nodeId) && typeof command.amount === 'string' && command.amount.length <= 80;
    case 'SET_SLIPPAGE': return id(command.nodeId) && typeof command.slippage === 'string' && command.slippage.length <= 5;
    default: return id(command.nodeId);
  }
  } catch { return false; }
}
export function amountOf(node: Workflow['nodes'][number]): string {
  const input = node.inputs.find(p => p.name === (node.actionType === SWAP_ACTION || node.actionType === BRIDGE_ACTION ? 'amount-in' : 'amount'));
  return input?.kind === 'QUANTITY' ? input.value.amount : '';
}
export function summarize(workflow: Workflow, context?: ReviewContext): string {
  return `Revision ${workflow.revision}. ` + workflow.nodes.map(node => {
    const supply = supplyDetails(node as Parameters<typeof supplyDetails>[0]);
    if (supply) return `${node.nodeId}: Supply ${supply.amount} USDC to Aave V3 on ${supply.network}, beneficiary ${supply.beneficiary}.`;
    const bridge = bridgeDetails(node);
    if (bridge) return `${node.nodeId}: Base to ${node.expectedOutputs[0]?.asset.chainId === 'eip155:42161' ? 'Arbitrum' : 'Optimism'} USDC bridge, ${bridge.amount} USDC, ${bridge.slippageBps} bps, unquoted.`;
    const position = context && liquidityDetails(node, context);
    if (position) return `${node.nodeId}: Uniswap v3 Base WETH/USDC position, ${position.amountWeth} WETH units and ${position.amountUsdc} USDC units maximum, minimums ${position.minimumWeth} WETH and ${position.minimumUsdc} USDC units, ticks ${position.tickLower} to ${position.tickUpper}, recipient ${position.recipient}.`;
    const details = context && swapDetails(node, context);
    if (details) return `${node.nodeId}: ${directionLabel(details.from === 'USDC' ? 'USDC_TO_WETH' : 'WETH_TO_USDC')}, ${details.amount} ${details.from}, ${details.slippage} bps, unquoted on Base.`;
    return `${node.nodeId}: ${node.actionType}, ${amountOf(node)} sample units on ${node.chainId}`
      + `${node.lockedParameters.length ? ', amount locked' : ''}`
      + `${node.dependencies.length ? ', after ' + node.dependencies.join(', ') : ''}.`;
  }).join(' ');
}
