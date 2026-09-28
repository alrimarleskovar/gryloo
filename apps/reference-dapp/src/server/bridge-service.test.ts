import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridgeNode } from '../domain/bridge-authoring';
import { normalizeLifiQuote } from './lifi-adapter';
import { rawQuote } from './lifi-adapter.test';
import { createBridgeService } from './bridge-service';
const owner = '0x' + '1'.repeat(40);
const workflow = { schemaVersion: '1.0.0' as const, workflowId: 'workflow-local', revision: 1,
  nodes: [createBridgeNode('node-002', { amount: '1', slippageBps: '50' })], resourceEdges: [] };
const provider = async () => normalizeLifiQuote(rawQuote(), owner, '1000000', 50, Date.now());
describe('durable mocked bridge service', () => {
  it('runs one reviewed route through source, bridge and independent destination reconciliation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gryloo-bridge-test-'));
    try {
      const service = createBridgeService(directory, provider);
      let run = await service.quote(workflow, owner);
      expect(run.compiled.manifest.spendLimits[0]?.maximumAmount).toBe('1000000');
      expect(run.compiled.plan.segments[0]?.steps).toHaveLength(2);
      run = await service.authorize(run.executionId, run.compiled.hashes.manifest);
      run = await service.approve(run.executionId);
      expect(run.attempts[0]?.state).toBe('CONFIRMED');
      run = await service.submit(run.executionId);
      expect(run.bridgeJournal.events.at(-1)?.state).toBe('SOURCE_SUBMITTED');
      run = await service.confirmSource(run.executionId);
      run = await service.progress(run.executionId);
      run = await service.confirmDestination(run.executionId);
      expect(run.bridgeJournal.events.at(-1)?.state).toBe('DESTINATION_CONFIRMED');
      expect(run.evidence).toBeNull();
      run = await service.reconcile(run.executionId);
      expect(run.bridgeJournal.events.at(-1)?.state).toBe('RECONCILED');
      expect(run.evidence?.bundle.environment).toBe('MOCKED');
      expect(run.evidence?.bundle.outcome).toBe('RECONCILED');
      const restarted = createBridgeService(directory, provider);
      expect((await restarted.load(run.executionId)).evidence?.hash).toBe(run.evidence?.hash);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 20_000);
  it('survives restart after uncertain source submission and never submits a second attempt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gryloo-bridge-recovery-'));
    try {
      const first = createBridgeService(directory, provider);
      let run = await first.quote(workflow, owner, 'uncertain');
      run = await first.authorize(run.executionId, run.compiled.hashes.manifest);
      run = await first.approve(run.executionId);
      run = await first.submit(run.executionId);
      expect(run.bridgeJournal.events.at(-1)?.state).toBe('UNKNOWN');
      const restarted = createBridgeService(directory, provider);
      await expect(restarted.submit(run.executionId)).rejects.toThrow();
      run = await restarted.recheck(run.executionId);
      expect(run.bridgeJournal.events.at(-1)?.state).toBe('SOURCE_SUBMITTED');
      expect(run.attempts.filter(x => x.stepId === 'bridge.step.source')).toHaveLength(1);
      run = await restarted.confirmSource(run.executionId);
      run = await restarted.progress(run.executionId);
      run = await restarted.confirmDestination(run.executionId);
      run = await restarted.reconcile(run.executionId);
      expect(run.evidence?.bundle.environment).toBe('MOCKED');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 20_000);
});
