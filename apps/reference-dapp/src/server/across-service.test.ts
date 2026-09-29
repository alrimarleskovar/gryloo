// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAcrossWorkflow } from '../domain/across-authoring';
import { fixtureAcrossQuote } from './across-adapter';
import { createAcrossService } from './across-service';
import { hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
const OWNER = '0x1111111111111111111111111111111111111111';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
describe('durable Across recovery', () => {
  it('loads one uncertain deposit after restart and never prepares or submits another', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gryloo-across-test-')); dirs.push(dir);
    const make = () => createAcrossService(dir, async (owner, amount) => fixtureAcrossQuote(owner, amount, Date.now()));
    const first = make();
    let run = await first.quote(createAcrossWorkflow('workflow-local', 1, { amount: '1', slippageBps: '50' }), OWNER);
    expect(run.review.policyArtifact.providers).toEqual({ kind: 'FIXED', providerId: 'across.direct' });
    expect(run.review.manifestArtifact.providers).toEqual(run.review.policyArtifact.providers);
    expect(run.review.manifestHash).toBe(hashArtifactBytes('strategy-manifest',
      new TextEncoder().encode(JSON.stringify(run.review.manifestArtifact))));
    run = await first.authorize(run.executionId, run.review.manifestHash);
    run = await first.approve(run.executionId);
    run = await first.prepare(run.executionId);
    run = await first.submit(run.executionId, true);
    expect(run.state).toBe('DEPOSIT_UNKNOWN');
    const restarted = make();
    const loaded = await restarted.load(run.executionId);
    expect(loaded.state).toBe('DEPOSIT_UNKNOWN');
    await expect(restarted.submit(run.executionId, false)).rejects.toThrow();
    await expect(restarted.prepare(run.executionId)).rejects.toThrow();
    const found = await restarted.recheck(run.executionId);
    expect(found.state).toBe('DEPOSIT_SUBMITTED');
    expect(found.attempts.filter(item => item.stepId === 'across.deposit')).toHaveLength(1);
    expect((await restarted.list()).some(item => item.executionId === run.executionId)).toBe(true);
  });
});
