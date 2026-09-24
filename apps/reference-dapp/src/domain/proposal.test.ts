// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from './editor';
import { describeProposal } from './proposal';
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
it('shows explicit direction, native units, slippage and unquoted state', () => {
  const before = initialEditor();
  const command = { type: 'ADD_SWAP', direction: 'WETH_TO_USDC', amount: '0.1', slippage: '101', source: 'CHAT', baseRevision: 0 } as const;
  const after = editorReducer(before, command, context);
  const diff = describeProposal(before, after, command, context).join('\n');
  expect(diff).toContain('WETH → USDC');
  expect(diff).toContain('100000000000000000');
  expect(diff).toContain('101 bps');
  expect(diff).toContain('unquoted');
});
