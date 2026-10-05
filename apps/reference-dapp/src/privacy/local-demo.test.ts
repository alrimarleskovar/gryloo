// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createSolanaSwapNode } from '../domain/jupiter-authoring';
import { assertCloakFinancialExecutionAvailable } from './cloak-adapter';
import { createPrivacyDemoStore, PrivacyDemoRun, PRIVACY_DEMO_LABEL } from './local-demo';
import * as lifecycle from './local-execution';
import type { VaultBackend } from './vault';

const now = Date.parse('2026-10-05T12:00:00Z');
const workflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'workflow-privacy-demo', revision: 1, resourceEdges: [],
  nodes: [createSolanaSwapNode('node-demo', { network: 'Solana', from: 'SOL', to: 'USDC', amount: '0.02', slippage: '50', privacy: 'cloak' })] };
async function authorized(run: PrivacyDemoRun) {
  await run.act('review', workflow, null, now); const manifest = await run.act('manifest', workflow, null, now);
  return run.act('authorize', workflow, manifest.reviewDigest, now);
}
afterEach(() => vi.restoreAllMocks());
describe('product demo uses the existing LOCAL lifecycle only', () => {
  it('uses deterministic synthetic commitments and existing calculated output bounds, without unlocking production', async () => {
    const a = await PrivacyDemoRun.create(workflow, now), b = await PrivacyDemoRun.create(workflow, now);
    const first = await a.snapshot(), second = await b.snapshot();
    expect(first.label).toBe(PRIVACY_DEMO_LABEL);
    expect(first.review).toMatchObject({ environment: 'LOCAL', evidence: 'MOCKED', expectedOutput: '2985000', minimumOutput: '2970075', privateChange: '10000000' });
    expect(first.review.route.inputCommitments).toEqual(second.review.route.inputCommitments);
    expect(first.review.route.changeCommitment).toBe(second.review.route.changeCommitment);
    expect(() => assertCloakFinancialExecutionAvailable()).toThrow('CLOAK_VERIFIED_EXECUTION_BOUNDARY_UNAVAILABLE');
  });
  it('executes/restarts/reconciles through existing engine and encrypted storage with zero network or wallet signatures', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('NO_NETWORK'); });
    const execute = vi.spyOn(lifecycle, 'executeCloakLocal'), recover = vi.spyOn(lifecycle, 'recoverCloakLocal');
    const run = await PrivacyDemoRun.create(workflow, now); await authorized(run);
    const executed = await run.act('execute', workflow, null, now);
    expect(executed).toMatchObject({ phase: 'EXECUTED', submissions: 1, signatureRequests: 0, checkpoints: { prepared: true, intent: true, handoff: true, submitted: true, reconciled: true } });
    const recovered = await run.act('recover', workflow, null, now + 120_000);
    expect(recovered).toMatchObject({ phase: 'RECOVERED', submissions: 1, signatureRequests: 0, restarts: 1, outcome: { environment: 'LOCAL', evidence: 'MOCKED', state: 'RECONCILED' },
      evidence: { evidence: 'MOCKED', verdict: { verdict: 'RECONCILED' }, chain: { inputNullifiersSpent: true, settlement: 'SWAPPED', outputAmount: '2985000' } } });
    expect(execute).toHaveBeenCalledTimes(1); expect(recover).toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    expect(JSON.stringify(recovered)).not.toMatch(/inputNotes|outputNotes|privateKey|viewingKeyNk|noteSalt|blinding|passphrase|rawResult/);
    expect(() => assertCloakFinancialExecutionAvailable()).toThrow();
  });
  it('requires ordered review, Manifest and exact acknowledgment; rejects an edited workflow', async () => {
    const run = await PrivacyDemoRun.create(workflow, now);
    await expect(run.act('execute', workflow, null, now)).rejects.toThrow('AUTHORIZATION_MISMATCH');
    await expect(run.act('authorize', workflow, 'fake', now)).rejects.toThrow('REVIEW_SEQUENCE_REQUIRED');
    await run.act('review', workflow, null, now); await run.act('manifest', workflow, null, now);
    await expect(run.act('authorize', workflow, 'wrong', now)).rejects.toThrow('AUTHORIZATION_MISMATCH');
    const edited = structuredClone(workflow); edited.revision++;
    await expect(run.act('authorize', edited, (await run.snapshot()).reviewDigest, now)).rejects.toThrow('REVIEW_INVALIDATED');
    expect((await run.snapshot()).submissions).toBe(0);
  });
  it('refuses public fallback and altered route/amount/privacy after review', async () => {
    const publicWorkflow = structuredClone(workflow); publicWorkflow.nodes = [createSolanaSwapNode('node-demo', { network: 'Solana', from: 'SOL', to: 'USDC', amount: '0.02', slippage: '50' })];
    await expect(PrivacyDemoRun.create(publicWorkflow, now)).rejects.toThrow();
    for (const field of ['amountIn', 'recipientAta', 'feeLamports'] as const) {
      const run = await PrivacyDemoRun.create(workflow, now); await authorized(run); run.review.route[field] = '2';
      await expect(run.act('execute', workflow, null, now)).rejects.toThrow();
    }
    const run = await PrivacyDemoRun.create(workflow, now); await authorized(run); run.review.workflow.nodes[0]!.requiredCapabilities.pop();
    await expect(run.act('execute', workflow, null, now)).rejects.toThrow('REVIEW_INVALIDATED');
  });
  it('rejects duplicate/replay before and after restart; recovery never submits again', async () => {
    const run = await PrivacyDemoRun.create(workflow, now); await authorized(run); await run.act('execute', workflow, null, now);
    await expect(run.act('execute', workflow, null, now)).rejects.toThrow('CLOAK_LOCAL_REPLAY');
    await run.act('recover', workflow, null, now);
    await expect(run.act('execute', workflow, null, now)).rejects.toThrow('CLOAK_LOCAL_REPLAY');
    const twice = await run.act('recover', workflow, null, now);
    expect(twice).toMatchObject({ submissions: 1, restarts: 2, outcome: { state: 'RECONCILED' } });
  });
  it('fails closed on corrupt persisted checkpoint after execution, rather than reconstructing expected success', async () => {
    const real = createPrivacyDemoStore(); let corrupt = false;
    const backend: VaultBackend = { ...real, get: async k => corrupt && k.endsWith(':execution.prepared') ? 'corrupt' : real.get(k) };
    const run = await PrivacyDemoRun.create(workflow, now, backend); await authorized(run); await run.act('execute', workflow, null, now); corrupt = true;
    await expect(run.act('recover', workflow, null, now)).rejects.toThrow('PRIVACY_STATE_UNREADABLE');
  });
  it('preserves encryption, atomic reservation conflicts and inspection-only recovery after uncertain submission', async () => {
    const real = createPrivacyDemoStore(), encrypted: string[] = []; let denyIntent = false;
    const backend: VaultBackend = { get: real.get, putNew: async (k, v) => { encrypted.push(v); await real.putNew(k, v); },
      putManyNew: async entries => { if (denyIntent) throw new Error('PRIVACY_RESERVATION_CONFLICT'); encrypted.push(...entries.map(e => e.value)); await real.putManyNew!(entries); } };
    const run = await PrivacyDemoRun.create(workflow, now, backend); await authorized(run); denyIntent = true;
    await expect(run.act('execute', workflow, null, now)).rejects.toThrow('RESERVATION_CONFLICT');
    await expect(run.act('execute', workflow, null, now)).rejects.toThrow('CLOAK_LOCAL_REPLAY');
    const recovered = await run.act('recover', workflow, null, now);
    expect(recovered).toMatchObject({ submissions: 0, outcome: { state: 'READY_FOR_REVIEW' } });
    expect(encrypted.join('')).not.toMatch(/inputNotes|privateKey|viewingKeyNk|noteSalt|blinding/);
    expect(encrypted.every(v => ['flofi.cloak-vault.v1', 'flofi.cloak-execution-v1'].includes(JSON.parse(v).format))).toBe(true);
  });
  it('honors original review expiry and actual reconciliation mismatch', async () => {
    const expired = await PrivacyDemoRun.create(workflow, now);
    await expect(expired.act('review', workflow, null, now + 60_000)).rejects.toThrow('ROUTE_INVALID');
    const inspect = lifecycle.CloakLocalLedger.prototype.inspect;
    vi.spyOn(lifecycle.CloakLocalLedger.prototype, 'inspect').mockImplementation(async function (this: lifecycle.CloakLocalLedger, id) {
      const observed = await inspect.call(this, id); if (observed) observed.chain.outputAmount = '1'; return observed;
    });
    const mismatch = await PrivacyDemoRun.create(workflow, now); await authorized(mismatch);
    const result = await mismatch.act('execute', workflow, null, now);
    expect(result).toMatchObject({ phase: 'RECOVERY_REQUIRED', outcome: { state: 'RECOVERY_REQUIRED' }, evidence: null });
    expect(result.outcome?.reconciliation?.verdict).toBe('DIVERGENT');
  });
});
