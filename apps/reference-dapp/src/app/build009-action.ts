// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { baseAssetRegistry } from '@defi-workflow-engine/action-registry';
import { validateAuthoringWorkflow } from '@defi-workflow-engine/reference-linter';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { requestBuild009Quote } from '../server/build009-lifi';
const context = { registryId: 'reference.registry' as const, capabilityId: 'swap.direct-transaction' as const,
  actionId: 'asset.swap.exact-input' as const, assets: baseAssetRegistry };
export async function build009BridgeQuote(workflow: SemanticWorkflow, owner: string) {
  const valid = validateAuthoringWorkflow(workflow, context);
  if (valid.nodes.length !== 2 || !/^0x[0-9a-fA-F]{40}$/.test(owner)) throw new Error('BUILD009_REQUEST_INVALID');
  const bridge = valid.nodes[0]!;
  const input = bridge.inputs.find(i => i.name === 'amount-in');
  const slip = bridge.userConstraints.find(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
  if (input?.kind !== 'QUANTITY' || slip?.kind !== 'MAXIMUM_SLIPPAGE_BPS') throw new Error('BUILD009_REQUEST_INVALID');
  return requestBuild009Quote('bridge', owner.toLowerCase(), input.value.amount, slip.maximumBps);
}
export async function build009DestinationQuote(workflow: SemanticWorkflow, owner: string, received: string) {
  const valid = validateAuthoringWorkflow(workflow, context);
  if (valid.nodes.length !== 2 || !/^0x[0-9a-fA-F]{40}$/.test(owner) || !/^[1-9][0-9]*$/.test(received))
    throw new Error('BUILD009_REQUEST_INVALID');
  const slip = valid.nodes[1]!.userConstraints.find(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
  if (slip?.kind !== 'MAXIMUM_SLIPPAGE_BPS') throw new Error('BUILD009_REQUEST_INVALID');
  return requestBuild009Quote('swap', owner.toLowerCase(), received, slip.maximumBps);
}
