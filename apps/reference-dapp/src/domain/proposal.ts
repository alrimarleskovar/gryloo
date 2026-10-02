import { supplyDetails, borrowDetails, repayDetails } from './supply-authoring';
import { solanaSwapDetails, solanaSwapLabels, solanaTokenMint } from './jupiter-authoring';
// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { EditorState } from './editor';
import type { Command } from './commands';
import { swapDetails } from './swap-authoring';
import { bridgeDetails } from './bridge-authoring';
import { liquidityDetails } from '@defi-workflow-engine/reference-linter';
import { solanaLiquidityDetails } from './solana-liquidity-authoring';

export function describeProposal(before: EditorState, after: EditorState, command: Command, context: ReviewContext): readonly string[] {
  if (after.error) return [after.error];
  if (command.type === 'AUTHOR_CROSS_CHAIN_LIQUIDITY') return Object.freeze([
    `Revision ${before.workflow.revision} → ${after.workflow.revision}`,
    `Base USDC → Arbitrum USDC via ${command.input.provider} → pool preparation${command.input.noSwap ? '' : ' → destination WETH swap'} → Uniswap v3 liquidity`,
    `Bridge ${command.input.amount} USDC; ticks ${command.input.tickLower} to ${command.input.tickUpper}; recipient ${command.input.recipient}`,
    'Actual Arbitrum amount and swap output must be reconciled before downstream execution. Each material change needs fresh review.',
    'The workflow is non-atomic. Arbitrum ETH gas must already be available in the destination wallet.',
  ]);
  if (command.type === 'AUTHOR_ACROSS') return Object.freeze([
    `Revision ${before.workflow.revision} → ${after.workflow.revision}`,
    `Direct Across Base → Arbitrum USDC bridge for ${command.input.amount} USDC`,
    'A fresh Across quote, fixed-provider review and simulated lifecycle are required.',
  ]);
  if (command.type === 'AUTHOR_BRIDGE_SWAP') return Object.freeze([
    `Revision ${before.workflow.revision} → ${after.workflow.revision}`,
    'Base USDC → Arbitrum USDC LI.FI bridge → Arbitrum WETH swap',
    `Bridge ${command.input.amount} USDC; bridge slippage ${command.input.slippageBps} bps; swap slippage ${command.input.swapSlippageBps} bps`,
    'The destination swap waits for MOCKED destination reconciliation and a fresh quote of the actual received amount.',
  ]);
  if (command.type === 'AUTHOR_COMPOSITION') return Object.freeze([
    `Revision ${before.workflow.revision} → ${after.workflow.revision}`,
    `Base USDC → WETH swap then WETH/USDC 0.05% Uniswap v3 mint in Safe ${command.safe}`,
    `Swap ${command.input.swapUSDC} USDC; slippage ${command.input.slippageBps} bps`,
    `Mint caps ${command.input.mint.weth} WETH and ${command.input.mint.usdc} USDC; minimums ${command.input.mint.minimumWeth} WETH and ${command.input.mint.minimumUsdc} USDC`,
    `Ticks ${command.input.mint.tickLower} to ${command.input.mint.tickUpper}; one typed WETH output dependency`,
    'Material edit invalidates prior quotes, simulation, policy, manifest, permission and attempts.',
  ]);
  const oldNode = 'nodeId' in command ? before.workflow.nodes.find(n => n.nodeId === command.nodeId) : undefined;
  const newNode = after.workflow.nodes.find(n => n.nodeId === ('nodeId' in command ? command.nodeId : `node-${String(before.workflow.revision + 2).padStart(3, '0')}`));
  const bridge = newNode && bridgeDetails(newNode);
  if (bridge) return Object.freeze([`Revision ${before.workflow.revision} → ${after.workflow.revision}`,
    `Node ${newNode?.nodeId}: Base → Optimism USDC bridge`,
    `Input ${bridge.amount} USDC; slippage ${bridge.slippageBps} bps`,
    'Recipient is the connected owner. A fresh live LI.FI quote and Manifest review are required.' ]);
  const oldLiquidity = oldNode && liquidityDetails(oldNode, context);
  const newLiquidity = newNode && liquidityDetails(newNode, context);
  if (newLiquidity) return Object.freeze([
    `Revision ${before.workflow.revision} → ${after.workflow.revision}`,
    `Node ${newNode?.nodeId}: isolated Base WETH/USDC Uniswap v3 position`,
    `WETH maximum: ${oldLiquidity?.amountWeth ?? 'none'} → ${newLiquidity.amountWeth} native units`,
    `USDC maximum: ${oldLiquidity?.amountUsdc ?? 'none'} → ${newLiquidity.amountUsdc} native units`,
    `Minimums: ${oldLiquidity?.minimumWeth ?? 'none'} WETH / ${oldLiquidity?.minimumUsdc ?? 'none'} USDC → ${newLiquidity.minimumWeth} WETH / ${newLiquidity.minimumUsdc} USDC native units`,
    `Ticks: ${oldLiquidity?.tickLower ?? 'none'}–${oldLiquidity?.tickUpper ?? 'none'} → ${newLiquidity.tickLower}–${newLiquidity.tickUpper}`,
    `Fee tier: ${newLiquidity.fee}; recipient: ${newLiquidity.recipient}`,
    'Pool state and position outcome are unobserved. Every liquidity wallet operation needs separate exact Mode A review.',
  ]);
  const oldSupply = oldNode && (repayDetails(oldNode as Parameters<typeof repayDetails>[0]) ?? borrowDetails(oldNode as Parameters<typeof borrowDetails>[0]) ?? supplyDetails(oldNode as Parameters<typeof supplyDetails>[0]));
  const newSupply = newNode && (repayDetails(newNode as Parameters<typeof repayDetails>[0]) ?? borrowDetails(newNode as Parameters<typeof borrowDetails>[0]) ?? supplyDetails(newNode as Parameters<typeof supplyDetails>[0]));
  if (newSupply) return Object.freeze([`Revision ${before.workflow.revision} → ${after.workflow.revision}`,
    `${newNode?.actionType==='repay'?'Repay to':newNode?.actionType==='borrow'?'Borrow from':'Supply to'} Aave V3 on ${newSupply.network}`, `Amount: ${oldSupply?.amount ?? 'none'} → ${newSupply.amount} USDC`,
    `Beneficiary: ${oldSupply?.beneficiary ?? 'none'} → ${newSupply.beneficiary}`, 'Changes require fresh simulation and execution review.']);
  const oldPosition = oldNode && solanaLiquidityDetails(oldNode), newPosition = newNode && solanaLiquidityDetails(newNode);
  if (newPosition) return Object.freeze([`Revision ${before.workflow.revision} → ${after.workflow.revision}`,
    `Node ${newNode?.nodeId}: Concentrated liquidity on ${newPosition.network} via ${newPosition.provider} (Devnet SOL / devUSDC test pool)`,
    `Maximum inputs: ${oldPosition ? `${oldPosition.maxSol} SOL + ${oldPosition.maxDevUsdc} devUSDC` : 'none'} → ${newPosition.maxSol} SOL + ${newPosition.maxDevUsdc} devUSDC`,
    `Range: ${oldPosition ? `${oldPosition.lowerPrice}–${oldPosition.upperPrice}` : 'none'} → ${newPosition.lowerPrice}–${newPosition.upperPrice} devUSDC per SOL (ticks ${newPosition.tickLower} to ${newPosition.tickUpper}, aligned to spacing 64)`,
    `Slippage: ${oldPosition?.slippage ?? 'none'} → ${newPosition.slippage} bps; position owner: your connected wallet`,
    'Maxima are limits, not amounts to spend. A read-only simulation computes the actual deposit; every position transaction needs its own exact review and wallet signature. Valueless Devnet test tokens.']);
  const oldSolana = oldNode && solanaSwapDetails(oldNode), newSolana = newNode && solanaSwapDetails(newNode);
  if (newSolana) { const labels = solanaSwapLabels(newSolana.network); return Object.freeze([`Revision ${before.workflow.revision} → ${after.workflow.revision}`,
    `Node ${newNode?.nodeId}: Swap ${newSolana.from} → ${newSolana.to} on ${labels.network} via ${labels.provider}`,
    `Input: ${oldSolana ? `${oldSolana.amount} ${oldSolana.from}` : 'none'} → ${newSolana.amount} ${newSolana.from}`,
    `Slippage: ${oldSolana?.slippage ?? 'none'} → ${newSolana.slippage} bps`,
    `Mints: ${solanaTokenMint(newSolana.network, newSolana.from)} → ${solanaTokenMint(newSolana.network, newSolana.to)}`,
    labels.testTokens ? 'A fresh Orca Devnet quote, read-only simulation and exact transaction review are required. Valueless Devnet test tokens; nothing executes automatically.'
      : 'A fresh Jupiter quote, read-only simulation and exact transaction review are required. Real mainnet funds; nothing executes automatically.']); }
  const oldSwap = oldNode && swapDetails(oldNode, context);
  const newSwap = newNode && swapDetails(newNode, context);
  if (newSwap) return Object.freeze([
    `Revision ${before.workflow.revision} → ${after.workflow.revision}`,
    `Node ${newNode?.nodeId}: ${newSwap.from} → ${newSwap.to} on Base`,
    `Input: ${oldSwap?.amount ?? 'none'} → ${newSwap.amount} ${newSwap.from} (${oldSwap?.units ?? 'none'} → ${newSwap.units} native units)`,
    `Slippage: ${oldSwap?.slippage ?? 'none'} → ${newSwap.slippage ?? 'missing'} bps`,
    `Assets: ${JSON.stringify(context.assets[newSwap.from].asset)} → ${JSON.stringify(context.assets[newSwap.to].asset)}`,
    `Amount lock: ${Boolean(oldNode?.lockedParameters.length)} → ${Boolean(newNode?.lockedParameters.length)}`,
    command.type === 'ADD_COW_SWAP' ? 'Minimum output: 0 unquoted; local CoW signed-intent review follows in Simulate' : 'Minimum output: 0 unquoted; execution unavailable',
  ]);
  return Object.freeze([`Revision ${before.workflow.revision} → ${after.workflow.revision}`, `Edit: ${command.type}`]);
}
