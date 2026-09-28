// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCompositionService, type CompositionServerProfile } from './composition-service';
import { createForkRpc } from './fork-rpc';
import { createCompositionWorkflow } from '../domain/composition-authoring';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext } from '@defi-workflow-engine/reference-linter';
const path = process.env.GRYLOO_COMPOSITION_SMOKE_PROFILE;
const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id,
  actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
describe('BUILD-007 composition service on local closed fork', () => {
  it.skipIf(!path)('prepares a two-node artifact chain and finite permission from one source block', async () => {
    const profile = JSON.parse(readFileSync(path!, 'utf8')) as CompositionServerProfile;
    const real = createForkRpc({ url: profile.rpcUrl });
    const call: typeof real = async (method, params = []) => {
      if (method === 'eth_call' && (params[0] as { to?: string })?.to === '0x3d4e44eb1374240ce5f1b871ab261cd16335b76a')
        return '0x' + (160_000_000_000_000_000n).toString(16).padStart(64, '0');
      if (method === 'eth_simulateV1') {
        const count = ((params[0] as { blockStateCalls: { calls: unknown[] }[] }).blockStateCalls[0]?.calls.length ?? 0);
        return [{ calls: Array.from({ length: count }, () => ({ status: '0x1', gasUsed: '0x10000' })) }];
      }
      return real(method, params);
    };
    const service = createCompositionService(profile, call);
    const pool = await service.poolState(await service.atHead());
    const center = Math.floor(pool.tick / 10) * 10;
    const workflow = createCompositionWorkflow('build-007-test', 1, profile.safe,
      { swapUSDC: '400', slippageBps: '100', mint: { weth: '0.1', usdc: '200', minimumWeth: '0.000001', minimumUsdc: '0.001',
        tickLower: String(center - 100), tickUpper: String(center + 100), recipient: profile.safe } }, context);
    const prepared = await service.prepare(workflow);
    expect(prepared.compiled.permission.recipient).toBe(profile.safe);
    expect(prepared.artifacts.hashes.manifestHash).toMatch(/^0x[0-9a-f]{64}$/);
  }, 120_000);
});
