// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { EditorState } from './editor';
import type { Command } from './commands';
import { swapDetails } from './swap-authoring';

export function describeProposal(before: EditorState, after: EditorState, command: Command, context: ReviewContext): readonly string[] {
  if (after.error) return [after.error];
  const oldNode = 'nodeId' in command ? before.workflow.nodes.find(n => n.nodeId === command.nodeId) : undefined;
  const newNode = after.workflow.nodes.find(n => n.nodeId === ('nodeId' in command ? command.nodeId : `node-${String(before.workflow.revision + 2).padStart(3, '0')}`));
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
