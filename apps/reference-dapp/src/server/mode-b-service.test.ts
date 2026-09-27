// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
import { createSwapNode } from '../domain/swap-authoring';
import { createForkRpc } from './fork-rpc';
import { createModeBService, type ModeBServerProfile } from './mode-b-service';
const pin = process.env.GRYLOO_MODE_B_SMOKE_PROFILE;
const fixture = () => ({ schemaVersion: '1.0.0' as const, workflowId: 'workflow-local', revision: 1,
  nodes: [createSwapNode('node-002', 'WETH_TO_USDC', '1', '100', createReviewContext({ registryId: referenceRegistry.registryId,
    capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry }))], resourceEdges: [] });
describe('Mode B local fork preparation', () => {
  it.skipIf(!pin)('simulates the exact installation and delegated swap before review', async () => {
    const profile = JSON.parse(readFileSync(pin!, 'utf8')) as ModeBServerProfile;
    const journalDir = mkdtempSync(join(tmpdir(), 'gryloo-mode-b-service-'));
    try {
      const service = createModeBService({ ...profile, journalDir }, createForkRpc({ url: profile.rpcUrl }));
      await service.boundary();
      const prepared = await service.prepare(fixture());
      expect(prepared.compiled.permissionHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(prepared.compiled.permission.simulationHash).toBe(prepared.simulationHash);
      expect(prepared.compiled.permission.cumulativeBudget).toBe(prepared.amountIn);
      // Roles is Safe-owned from deployment, so installation starts by enabling the module; nothing is granted before it.
      expect(prepared.compiled.installation.map(step => step.label)).toEqual(['Enable Roles module in Safe',
        'Scope Router02 target through Safe', 'Install exact scoped function through Safe', 'Set one-time non-refilling allowance through Safe',
        'Assign executor role through Safe', 'Approve finite Router02 token allowance from Safe']);
      const status = await service.status(prepared.executionId);
      expect([status.remainingBudget, status.moduleEnabled, status.executorEnabled, status.residualTokenAllowance]).toEqual(['0', false, false, '0']);
    } finally { rmSync(journalDir, { recursive: true, force: true }); }
  });
});
