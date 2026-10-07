// SPDX-License-Identifier: AGPL-3.0-only
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createBaseSepoliaReviewContext, createReviewContext, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import { parseLocalCommand, type Command } from './commands';
import { editorReducer, initialEditor } from './editor';
import type { Workflow } from './initial-workflow';

/** Test-only fixtures for the Copilot and workflow-step tests: real exact-grammar commands applied by the real reducer. */
export const TEST_WALLET = '0x1111111111111111111111111111111111111111';
export const OTHER_ADDRESS = '0x2222222222222222222222222222222222222222';
export const BASE_CONTEXT = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id,
  actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry });
/** The same context choice as the workflow store: Base Sepolia once a Base Sepolia swap exists. */
export const contextFor = (workflow: Workflow): ReviewContext =>
  workflow.nodes.some(node => node.actionType === 'asset.swap.exact-input' && node.chainId === 'eip155:84532') ? createBaseSepoliaReviewContext() : BASE_CONTEXT;
export function applyCommand(workflow: Workflow, command: Command): Workflow {
  const next = editorReducer({ workflow, error: null }, command, contextFor(workflow));
  if (next.error) throw new Error(next.error);
  return next.workflow;
}
/** Applies exact chat commands in order, as a user typing them and clicking Apply each time. */
export function buildWorkflow(sentences: readonly string[], wallet: string | null = TEST_WALLET): Workflow {
  return sentences.reduce((workflow, sentence) => applyCommand(workflow, parseLocalCommand(sentence, workflow, contextFor(workflow), wallet)), initialEditor().workflow);
}
export const FIXTURE = Object.freeze({
  supply: 'supply 5 USDC to Aave on Base Sepolia',
  borrow: 'borrow 2 USDC from Aave on Base Sepolia',
  repay: 'repay 1 USDC to Aave on Base Sepolia',
  withdraw: 'withdraw 3 USDC from Aave on Base Sepolia',
  baseSwap: 'swap 2 USDC to WETH on Base slippage 50 bps',
  baseSwap2: 'swap 3 USDC to WETH on Base slippage 50 bps',
  testnetSwap: 'swap 3 USDC to WETH on Base Sepolia slippage 50 bps',
  testnetSwap2: 'swap 4 USDC to WETH on Base Sepolia slippage 50 bps',
  solanaSwap: 'swap 1 SOL to USDC on Solana slippage 50 bps',
  devnetSwap: 'swap 1 SOL to devUSDC on Solana Devnet slippage 50 bps',
  bridge: 'bridge 1 USDC from Base Sepolia to Arbitrum Sepolia via auto slippage 50 bps',
  mainnetBridge: 'bridge 10 USDC from Base to Arbitrum via auto slippage 50 bps',
  uniswap: 'add liquidity 100 USDC and 0.05 WETH from 2000 to 4000 USDC per WETH on Base Sepolia slippage 100 bps',
  orca: 'add liquidity 1 SOL and 100 devUSDC ticks -1024 to 1024 on Solana Devnet slippage 100 bps',
  lending: 'compose supply 10 USDC to Aave then borrow 4 USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps',
});
