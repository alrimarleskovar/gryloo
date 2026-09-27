// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import { actionKinds, type ActionKind } from './mock-actions';
import type { Workflow } from './initial-workflow';
import { SWAP_ACTION, directionLabel, parseHumanAmount, parseSlippage, swapDetails, type Direction } from './swap-authoring';

type Base = { readonly baseRevision: number; readonly source: 'CHAT' | 'CANVAS' };
export type Command = Base & (
  | { readonly type: 'ADD'; readonly kind: ActionKind }
  | { readonly type: 'SET_AMOUNT'; readonly nodeId: string; readonly amount: string }
  | { readonly type: 'LOCK'; readonly nodeId: string; readonly locked: boolean }
  | { readonly type: 'CONNECT'; readonly from: string; readonly to: string }
  | { readonly type: 'REMOVE'; readonly nodeId: string }
  | { readonly type: 'ADD_SWAP'; readonly direction: Direction; readonly amount: string; readonly slippage: string }
  | { readonly type: 'ADD_COW_SWAP'; readonly direction: Direction; readonly amount: string; readonly slippage: string }
  | { readonly type: 'SET_SWAP_AMOUNT'; readonly nodeId: string; readonly amount: string }
  | { readonly type: 'SET_SLIPPAGE'; readonly nodeId: string; readonly slippage: string }
);

export const HELP = 'Try “swap 2 USDC to WETH on Base slippage 50 bps”, “set node-002 amount 3”, “set node-002 slippage 100 bps”, “add read”, or “explain”. No model or network service is connected.';
export function parseMockCommand(text: string, baseRevision: number): Command {
  const input = text.trim();
  const add = /^add (read|transform|condition)$/.exec(input);
  if (add) return { type: 'ADD', kind: add[1] as ActionKind, source: 'CHAT', baseRevision };
  const set = /^set (node-\d+) amount (0|[1-9][0-9]{0,77})$/.exec(input);
  if (set) return { type: 'SET_AMOUNT', nodeId: set[1]!, amount: set[2]!, source: 'CHAT', baseRevision };
  throw new Error(HELP);
}
export function parseLocalCommand(text: string, workflow: Workflow, context: ReviewContext): Command {
  if (typeof text !== 'string' || text.length > 1024) throw new Error('INPUT_TOO_LARGE');
  const input = text.trim();
  const swap = /^swap ([0-9]+(?:\.[0-9]+)?) (USDC|WETH) to (USDC|WETH) on Base slippage ([0-9]+) bps$/i.exec(input);
  if (swap) {
    const from = swap[2]!.toUpperCase(), to = swap[3]!.toUpperCase();
    if (from === to) throw new Error('INVALID_ASSET_PAIR');
    const direction: Direction = from === 'USDC' && to === 'WETH' ? 'USDC_TO_WETH' : from === 'WETH' && to === 'USDC' ? 'WETH_TO_USDC' : (() => { throw new Error('INVALID_ASSET_PAIR'); })();
    parseHumanAmount(swap[1], from as 'USDC' | 'WETH', context);
    parseSlippage(swap[4]);
    return { type: 'ADD_SWAP', direction, amount: swap[1]!, slippage: swap[4]!, source: 'CHAT', baseRevision: workflow.revision };
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
    ADD: ['kind'], SET_AMOUNT: ['nodeId', 'amount'], LOCK: ['nodeId', 'locked'],
    CONNECT: ['from', 'to'], REMOVE: ['nodeId'], ADD_SWAP: ['direction', 'amount', 'slippage'], ADD_COW_SWAP: ['direction', 'amount', 'slippage'],
    SET_SWAP_AMOUNT: ['nodeId', 'amount'], SET_SLIPPAGE: ['nodeId', 'slippage'],
  };
  if (typeof command.type !== 'string' || !fields[command.type]
      || (keys as string[]).sort().join() !== ['type', 'source', 'baseRevision', ...fields[command.type]!].sort().join()) return false;
  const id = (value: unknown) => typeof value === 'string' && /^node-\d{3,16}$/.test(value);
  switch (command.type) {
    case 'ADD': return actionKinds.includes(command.kind as ActionKind);
    case 'SET_AMOUNT': return id(command.nodeId) && typeof command.amount === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(command.amount);
    case 'LOCK': return id(command.nodeId) && typeof command.locked === 'boolean' && command.source === 'CANVAS';
    case 'CONNECT': return id(command.from) && id(command.to);
    case 'REMOVE': return id(command.nodeId);
    case 'ADD_SWAP':
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
  const input = node.inputs.find(p => p.name === (node.actionType === SWAP_ACTION ? 'amount-in' : 'amount'));
  return input?.kind === 'QUANTITY' ? input.value.amount : '';
}
export function summarize(workflow: Workflow, context?: ReviewContext): string {
  return `Revision ${workflow.revision}. ` + workflow.nodes.map(node => {
    const details = context && swapDetails(node, context);
    if (details) return `${node.nodeId}: ${directionLabel(details.from === 'USDC' ? 'USDC_TO_WETH' : 'WETH_TO_USDC')}, ${details.amount} ${details.from}, ${details.slippage} bps, unquoted on Base.`;
    return `${node.nodeId}: ${node.actionType}, ${amountOf(node)} sample units on ${node.chainId}`
      + `${node.lockedParameters.length ? ', amount locked' : ''}`
      + `${node.dependencies.length ? ', after ' + node.dependencies.join(', ') : ''}.`;
  }).join(' ');
}
