import {createAuthoredLending,lendingDetails,type LendingInput} from './lending-authoring';
// SPDX-License-Identifier: AGPL-3.0-only
import { createBaseSepoliaReviewContext, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import { actionKinds, type ActionKind } from './mock-actions';
import type { Workflow } from './initial-workflow';
import { SWAP_ACTION, directionLabel, parseHumanAmount, parseSlippage, swapDetails, type Direction } from './swap-authoring';
import { type LiquidityInput } from './liquidity-authoring';
import type { CompositionInput } from './composition-authoring';
import { BRIDGE_ACTION, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { bridgeDetails, parseBridgeAmount, type BridgeInput } from './bridge-authoring';
import type { BridgeSwapInput } from './bridge-swap-authoring';
import type { CrossChainLiquidityInput } from './cross-chain-liquidity';
import { liquidityDetails, parseTick } from '@defi-workflow-engine/reference-linter';

import { createAuthoredTransfer, transferDetails, type RobinhoodTransferInput } from './robinhood-transfer-authoring';
import { createAuthoredSupply, supplyDetails, createAuthoredBorrow, borrowDetails, createAuthoredRepay, repayDetails, createAuthoredWithdraw, withdrawDetails, type WithdrawInput, type SupplyInput } from './supply-authoring';
import { createSolanaSwapNode, parseSolanaSwapChat, solanaSwapDetails, solanaSwapLabels, type SolanaSwapInput } from './jupiter-authoring';
import { createSolanaLiquidityNode, parseSolanaLiquidityChat, solanaLiquidityDetails, type SolanaLiquidityInput } from './solana-liquidity-authoring';
import { createUniswapLiquidityNode, parseUniswapLiquidityChat, uniswapLiquidityDetails, type UniswapLiquidityInput } from './uniswap-liquidity-authoring';
import { createRouterNode, parseRouterChat, routerDetails, ROUTER_ROUTING_LABEL, type RouterBridgeInput } from './router-authoring';

type Base = { readonly baseRevision: number; readonly source: 'CHAT' | 'CANVAS' };
export type Command = Base & (
  | {readonly type:'AUTHOR_LENDING';readonly input:LendingInput}
  | { readonly type: 'ADD_RH_TRANSFER'; readonly input: RobinhoodTransferInput }
  | { readonly type: 'SET_RH_TRANSFER'; readonly nodeId: string; readonly input: RobinhoodTransferInput }
  | { readonly type: 'ADD_WITHDRAW'; readonly input: WithdrawInput }
  | { readonly type: 'SET_WITHDRAW'; readonly nodeId: string; readonly input: WithdrawInput }
  | { readonly type: 'ADD_REPAY'; readonly input: SupplyInput }
  | { readonly type: 'SET_REPAY'; readonly nodeId: string; readonly input: SupplyInput }
  | { readonly type: 'ADD_BORROW'; readonly input: SupplyInput }
  | { readonly type: 'SET_BORROW'; readonly nodeId: string; readonly input: SupplyInput }
  | { readonly type: 'ADD_SUPPLY'; readonly input: SupplyInput }
  | { readonly type: 'ADD_SOLANA_SWAP'; readonly input: SolanaSwapInput }
  | { readonly type: 'SET_SOLANA_SWAP'; readonly nodeId: string; readonly input: SolanaSwapInput }
  | { readonly type: 'ADD_SOLANA_LIQUIDITY'; readonly input: SolanaLiquidityInput }
  | { readonly type: 'SET_SOLANA_LIQUIDITY'; readonly nodeId: string; readonly input: SolanaLiquidityInput }
  | { readonly type: 'ADD_UNISWAP_LIQUIDITY'; readonly input: UniswapLiquidityInput }
  | { readonly type: 'SET_UNISWAP_LIQUIDITY'; readonly nodeId: string; readonly input: UniswapLiquidityInput }
  | { readonly type: 'ADD_ROUTER_BRIDGE'; readonly input: RouterBridgeInput }
  | { readonly type: 'SET_ROUTER_BRIDGE'; readonly nodeId: string; readonly input: RouterBridgeInput }
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
export const BRIDGE_HELP = 'Try “bridge 5 USDC from Base to Arbitrum”, “bridge 1 USDC from Base to Optimism slippage 50 bps”, “swap 2 USDC to WETH on Base slippage 50 bps”, “set node-002 amount 3”, “set node-002 slippage 100 bps”, “add read”, or “explain”. No model or network service is connected.';
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
  const lending=/^compose supply ([0-9]+(?:\.[0-9]+)?) USDC to Aave then borrow ([0-9]+(?:\.[0-9]+)?) USDC then swap borrowed USDC to WETH on Base Sepolia slippage ([0-9]+) bps(?: owner (0x[0-9a-fA-F]{40}))?$/i.exec(input);
  if(lending){const owner=lending[4]??defaultBeneficiary;if(!owner)throw Error('LENDING_OWNER_REQUIRED');const fields={supply:lending[1]!,borrow:lending[2]!,slippage:lending[3]!,owner};createAuthoredLending(workflow.workflowId,workflow.revision+1,fields);return {type:'AUTHOR_LENDING',input:fields,source:'CHAT',baseRevision:workflow.revision};}
  const withdraw = /^withdraw ([0-9]+(?:\.[0-9]+)?) USDC from Aave on Base Sepolia$/i.exec(input);
  if(withdraw){const fields:WithdrawInput={network:'Base Sepolia',asset:'USDC',amount:withdraw[1]!,recipient:'CONNECTED_OWNER'};createAuthoredWithdraw('node-preview',fields);return {type:'ADD_WITHDRAW',input:fields,source:'CHAT',baseRevision:workflow.revision};}
  const repay = /^repay ([0-9]+(?:\.[0-9]+)?) USDC to Aave on Base Sepolia(?: (?:beneficiary|on behalf of) (0x[0-9a-fA-F]{40}))?$/i.exec(input);
  if (repay) {
    const beneficiary=repay[2]??defaultBeneficiary;
    if(!beneficiary)throw new Error('REPAY_BENEFICIARY_REQUIRED');
    const fields:SupplyInput={network:'Base Sepolia',asset:'USDC',amount:repay[1]!,beneficiary};
    createAuthoredRepay('node-preview',fields);
    return {type:'ADD_REPAY',input:fields,source:'CHAT',baseRevision:workflow.revision};
  }
  const borrow = /^borrow ([0-9]+(?:\.[0-9]+)?) USDC from Aave on Base Sepolia(?: (?:beneficiary|on behalf of) (0x[0-9a-fA-F]{40}))?$/i.exec(input);
  if (borrow) {
    const beneficiary=borrow[2]??defaultBeneficiary;
    if(!beneficiary)throw new Error('BORROW_BENEFICIARY_REQUIRED');
    const fields:SupplyInput={network:'Base Sepolia',asset:'USDC',amount:borrow[1]!,beneficiary};
    createAuthoredBorrow('node-preview',fields);
    return {type:'ADD_BORROW',input:fields,source:'CHAT',baseRevision:workflow.revision};
  }
  const supply = /^supply ([0-9]+(?:\.[0-9]+)?) USDC to Aave on Base Sepolia(?: (?:beneficiary|on behalf of) (0x[0-9a-fA-F]{40}))?$/i.exec(input);
  if (supply) {
    const beneficiary = supply[2] ?? defaultBeneficiary;
    if (!beneficiary) throw new Error('SUPPLY_BENEFICIARY_REQUIRED');
    const fields: SupplyInput = { network: 'Base Sepolia', asset: 'USDC', amount: supply[1]!, beneficiary };
    createAuthoredSupply('node-preview', fields);
    return { type: 'ADD_SUPPLY', input: fields, source: 'CHAT', baseRevision: workflow.revision };
  }
  const router = parseRouterChat(input);
  if (router) { createRouterNode('node-preview', router); return { type: 'ADD_ROUTER_BRIDGE', input: router, source: 'CHAT', baseRevision: workflow.revision }; }
  const uniswapLiquidity = parseUniswapLiquidityChat(input);
  if (uniswapLiquidity) { createUniswapLiquidityNode('node-preview', uniswapLiquidity); return { type: 'ADD_UNISWAP_LIQUIDITY', input: uniswapLiquidity, source: 'CHAT', baseRevision: workflow.revision }; }
  const solanaLiquidity = parseSolanaLiquidityChat(input);
  if (solanaLiquidity) { createSolanaLiquidityNode('node-preview', solanaLiquidity); return { type: 'ADD_SOLANA_LIQUIDITY', input: solanaLiquidity, source: 'CHAT', baseRevision: workflow.revision }; }
  const solana = parseSolanaSwapChat(input);
  if (solana) { createSolanaSwapNode('node-preview', solana); return { type: 'ADD_SOLANA_SWAP', input: solana, source: 'CHAT', baseRevision: workflow.revision }; }
  const solanaEdit = /^set (node-\d+) (amount|slippage) (\S+?)(?: bps)?$/i.exec(input);
  const solanaNode = solanaEdit && workflow.nodes.find(n => n.nodeId === solanaEdit[1]);
  const solanaFields = solanaNode && solanaSwapDetails(solanaNode);
  if (solanaEdit && solanaFields) {
    const updated = { ...solanaFields, [solanaEdit[2]!.toLowerCase()]: solanaEdit[3]! };
    createSolanaSwapNode(solanaNode!.nodeId, updated);
    return { type: 'SET_SOLANA_SWAP', nodeId: solanaNode!.nodeId, input: updated, source: 'CHAT', baseRevision: workflow.revision };
  }
  const supplyEdit = /^set (node-\d+) amount (\S+)$/i.exec(input);
  if (supplyEdit) {
    const node = workflow.nodes.find(n => n.nodeId === supplyEdit[1]);
    const withdrawn=node&&withdrawDetails(node as Parameters<typeof withdrawDetails>[0]);
    if(withdrawn){const updated={...withdrawn,amount:supplyEdit[2]!};createAuthoredWithdraw(node!.nodeId,updated);return {type:'SET_WITHDRAW',nodeId:node!.nodeId,input:updated,source:'CHAT',baseRevision:workflow.revision};}
    const fields = node && (repayDetails(node as Parameters<typeof repayDetails>[0]) ?? borrowDetails(node as Parameters<typeof borrowDetails>[0]) ?? supplyDetails(node as Parameters<typeof supplyDetails>[0]));
    if (fields) { const updated = { ...fields, amount: supplyEdit[2]! }; (node!.actionType==='repay'?createAuthoredRepay:node!.actionType==='borrow'?createAuthoredBorrow:createAuthoredSupply)(node!.nodeId, updated);
      return { type: node!.actionType==='repay'?'SET_REPAY':node!.actionType==='borrow'?'SET_BORROW':'SET_SUPPLY', nodeId: node!.nodeId, input: updated, source: 'CHAT', baseRevision: workflow.revision }; }
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
    AUTHOR_LENDING:['input'], ADD_RH_TRANSFER: ['input'], SET_RH_TRANSFER: ['nodeId','input'], ADD_WITHDRAW: ['input'], SET_WITHDRAW: ['nodeId','input'], ADD_REPAY: ['input'], SET_REPAY: ['nodeId','input'], ADD_BORROW: ['input'], SET_BORROW: ['nodeId','input'], ADD_SUPPLY: ['input'], SET_SUPPLY: ['nodeId','input'], ADD_SOLANA_SWAP: ['input'], SET_SOLANA_SWAP: ['nodeId','input'], ADD_SOLANA_LIQUIDITY: ['input'], SET_SOLANA_LIQUIDITY: ['nodeId','input'], ADD_UNISWAP_LIQUIDITY: ['input'], SET_UNISWAP_LIQUIDITY: ['nodeId','input'], ADD_ROUTER_BRIDGE: ['input'], SET_ROUTER_BRIDGE: ['nodeId','input'], ADD: ['kind'], AUTHOR_CROSS_CHAIN_LIQUIDITY: ['input'], AUTHOR_BRIDGE_SWAP: ['input'], AUTHOR_ACROSS: ['input'], ADD_BRIDGE: ['input'], SET_BRIDGE: ['nodeId', 'input'], SET_AMOUNT: ['nodeId', 'amount'], LOCK: ['nodeId', 'locked'], AUTHOR_COMPOSITION: ['safe', 'input'], ADD_LIQUIDITY: ['input'], SET_LIQUIDITY: ['nodeId', 'input'],
    CONNECT: ['from', 'to'], DISCONNECT: ['from', 'to'], REMOVE: ['nodeId'], REMOVE_MANY: ['nodeIds'], ADD_SWAP: ['direction', 'amount', 'slippage'], ADD_TESTNET_SWAP: ['direction', 'amount', 'slippage'], ADD_COW_SWAP: ['direction', 'amount', 'slippage'],
    SET_SWAP_AMOUNT: ['nodeId', 'amount'], SET_SLIPPAGE: ['nodeId', 'slippage'],
  };
  if (typeof command.type !== 'string' || !fields[command.type]
      || (keys as string[]).sort().join() !== ['type', 'source', 'baseRevision', ...fields[command.type]!].sort().join()) return false;
  const id = (value: unknown) => typeof value === 'string' && /^node-\d{3,16}$/.test(value);
  switch (command.type) {
    case 'AUTHOR_LENDING': {try{createAuthoredLending('lending-preview',0,command.input as LendingInput);return true;}catch{return false;}}
    case 'ADD_RH_TRANSFER':
    case 'SET_RH_TRANSFER': {
      if(command.type==='SET_RH_TRANSFER'&&!id(command.nodeId))return false;
      const fields=command.input;
      if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.getPrototypeOf(fields)!==Object.prototype||Reflect.ownKeys(fields).sort().join()!==['network','asset','amount','recipient'].sort().join()||!Object.values(fields).every(v=>typeof v==='string'&&v.length<=40))return false;
      try{createAuthoredTransfer('node-preview',fields as RobinhoodTransferInput);return true;}catch{return false;}
    }
    case 'ADD_WITHDRAW':
    case 'SET_WITHDRAW': {
      if(command.type==='SET_WITHDRAW'&&!id(command.nodeId))return false;
      const fields=command.input;
      if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.getPrototypeOf(fields)!==Object.prototype||Reflect.ownKeys(fields).sort().join()!==['network','asset','amount','recipient'].sort().join()||!Object.values(fields).every(v=>typeof v==='string'&&v.length<=80))return false;
      try{createAuthoredWithdraw('node-preview',fields as WithdrawInput);return true;}catch{return false;}
    }
    case 'ADD_REPAY':
    case 'SET_REPAY':
    case 'ADD_BORROW':
    case 'SET_BORROW':
    case 'ADD_SUPPLY':
    case 'SET_SUPPLY': {
      if ((command.type === 'SET_SUPPLY'||command.type==='SET_BORROW'||command.type==='SET_REPAY') && !id(command.nodeId)) return false;
      const fields = command.input;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.getPrototypeOf(fields) !== Object.prototype ||
          Reflect.ownKeys(fields).sort().join() !== ['network','asset','amount','beneficiary'].sort().join() ||
          !Object.values(fields).every(v => typeof v === 'string' && v.length <= 80)) return false;
      try { (command.type==='ADD_REPAY'||command.type==='SET_REPAY'?createAuthoredRepay:command.type==='ADD_BORROW'||command.type==='SET_BORROW'?createAuthoredBorrow:createAuthoredSupply)('node-preview', fields as SupplyInput); return true; } catch { return false; }
    }
    case 'ADD_SOLANA_SWAP':
    case 'SET_SOLANA_SWAP': {
      if (command.type === 'SET_SOLANA_SWAP' && !id(command.nodeId)) return false;
      const fields = command.input;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.getPrototypeOf(fields) !== Object.prototype ||
          Reflect.ownKeys(fields).sort().join() !== ['network','from','to','amount','slippage'].sort().join() ||
          !Object.values(fields).every(v => typeof v === 'string' && v.length <= 40)) return false;
      try { createSolanaSwapNode('node-preview', fields as SolanaSwapInput); return true; } catch { return false; }
    }
    case 'ADD_SOLANA_LIQUIDITY':
    case 'SET_SOLANA_LIQUIDITY': {
      if (command.type === 'SET_SOLANA_LIQUIDITY' && !id(command.nodeId)) return false;
      const fields = command.input;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.getPrototypeOf(fields) !== Object.prototype ||
          Reflect.ownKeys(fields).sort().join() !== ['network','maxSol','maxDevUsdc','rangeUnit','lower','upper','slippage'].sort().join() ||
          !Object.values(fields).every(v => typeof v === 'string' && v.length <= 40)) return false;
      try { createSolanaLiquidityNode('node-preview', fields as SolanaLiquidityInput); return true; } catch { return false; }
    }
    case 'ADD_UNISWAP_LIQUIDITY':
    case 'SET_UNISWAP_LIQUIDITY': {
      if (command.type === 'SET_UNISWAP_LIQUIDITY' && !id(command.nodeId)) return false;
      const fields = command.input;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.getPrototypeOf(fields) !== Object.prototype ||
          Reflect.ownKeys(fields).sort().join() !== ['network','maxUsdc','maxWeth','rangeUnit','lower','upper','slippage'].sort().join() ||
          !Object.values(fields).every(v => typeof v === 'string' && v.length <= 40)) return false;
      try { createUniswapLiquidityNode('node-preview', fields as UniswapLiquidityInput); return true; } catch { return false; }
    }
    case 'ADD_ROUTER_BRIDGE':
    case 'SET_ROUTER_BRIDGE': {
      if (command.type === 'SET_ROUTER_BRIDGE' && !id(command.nodeId)) return false;
      const fields = command.input;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.getPrototypeOf(fields) !== Object.prototype ||
          Reflect.ownKeys(fields).sort().join() !== ['source','destination','token','amount','recipient','slippage','routing'].sort().join() ||
          !Object.values(fields).every(v => typeof v === 'string' && v.length <= 80)) return false;
      try { createRouterNode('node-preview', fields as RouterBridgeInput); return true; } catch { return false; }
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
  const lending=lendingDetails(workflow as SemanticWorkflow);
  if(lending)return `Revision ${workflow.revision}. Supply ${lending.supply} Aave USDC → HF ≥ 2.0 checkpoint → Borrow ${lending.borrow} Aave USDC → Swap exactly the borrowed Aave USDC to WETH on Base Sepolia; slippage ${lending.slippage} bps; owner ${lending.owner}. Debt remains after Swap.`;
  return `Revision ${workflow.revision}. ` + workflow.nodes.map(node => {
    const solana = solanaSwapDetails(node);
    if (solana) return `${node.nodeId}: Swap ${solana.amount} ${solana.from} to ${solana.to} on ${solana.network} via ${solanaSwapLabels(solana.network).provider}, ${solana.slippage} bps, quote required.`;
    const transfer=transferDetails(node as Parameters<typeof transferDetails>[0]);
    if(transfer)return `${node.nodeId}: Self-transfer ${transfer.amount} test ETH on ${transfer.network} to the connected owner; chain execution proof, not DeFi.`;
    const withdrawn=withdrawDetails(node as Parameters<typeof withdrawDetails>[0]);
    if(withdrawn)return `${node.nodeId}: Withdraw ${withdrawn.amount} USDC from Aave V3 on ${withdrawn.network}, recipient connected owner at Review.`;
    const repaid=repayDetails(node as Parameters<typeof repayDetails>[0]);
    if(repaid)return `${node.nodeId}: Repay ${repaid.amount} USDC to Aave V3 on ${repaid.network}, variable debt mode 2, onBehalfOf ${repaid.beneficiary}.`;
    const uni = uniswapLiquidityDetails(node);
    if (uni) return `${node.nodeId}: Concentrated liquidity on ${uni.network} via ${uni.provider}, up to ${uni.maxUsdc} USDC and ${uni.maxWeth} WETH, ${uni.lowerPrice}–${uni.upperPrice} USDC per WETH (ticks ${uni.tickLower} to ${uni.tickUpper}, fee 0.05%), ${uni.slippage} bps, simulation required.`;
    const orca = solanaLiquidityDetails(node);
    if (orca) return `${node.nodeId}: Concentrated liquidity on ${orca.network} via ${orca.provider}, up to ${orca.maxSol} SOL and ${orca.maxDevUsdc} devUSDC, ${orca.lowerPrice}–${orca.upperPrice} devUSDC per SOL (ticks ${orca.tickLower} to ${orca.tickUpper}), ${orca.slippage} bps, simulation required.`;
    const borrowed = borrowDetails(node as Parameters<typeof borrowDetails>[0]);
    if(borrowed)return `${node.nodeId}: Borrow ${borrowed.amount} USDC from Aave V3 on ${borrowed.network}, variable rate, borrower ${borrowed.beneficiary}.`;
    const supply = supplyDetails(node as Parameters<typeof supplyDetails>[0]);
    if (supply) return `${node.nodeId}: Supply ${supply.amount} USDC to Aave V3 on ${supply.network}, beneficiary ${supply.beneficiary}.`;
    const routed = routerDetails(node);
    if (routed) return `${node.nodeId}: Cross-chain bridge ${routed.amount} USDC from Base to Arbitrum, recipient ${routed.recipientLabel}, ${routed.slippage} bps, routing ${ROUTER_ROUTING_LABEL[routed.routing]}; quote, simulation and route review required.`;
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
