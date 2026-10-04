// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-ROUTER-001 router service on MOCKED in-process Base/Arbitrum chains and loopback providers: no network, no key, no send path. */
import { appendFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { createFileExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { decodeLifiAcrossV4, decodeRouterApprove } from '@defi-workflow-engine/reference-compiler';
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as profile } from '@defi-workflow-engine/action-registry';
import { routeCommitment, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { editorReducer, initialEditor } from '../domain/editor';
import type { RouterBridgeInput } from '../domain/router-authoring';
import { createRouterHarness, ROUTER_MOCK_CODE_PINS, ROUTER_OWNER, ROUTER_RECIPIENT, type RouterHarness, type RouterHarnessOptions } from '../../e2e/router-harness';
import { createRouterService, routerNeedsObservation, validateRouterLog, type RouterRecord, type RouterService } from './router-service';

const SRC = profile.source;
function workflow(patch: Partial<RouterBridgeInput> = {}): SemanticWorkflow {
  const input: RouterBridgeInput = { source: 'Base', destination: 'Arbitrum', token: 'USDC', amount: '10', recipient: '', slippage: '50', routing: 'AUTO', ...patch };
  const result = editorReducer(initialEditor(), { type: 'ADD_ROUTER_BRIDGE', input, source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext());
  if (result.error) throw new Error(result.error);
  return structuredClone(result.workflow) as unknown as SemanticWorkflow;
}
async function setup(harness: RouterHarnessOptions = {}, options: { dir?: string; h?: RouterHarness; executionEnabled?: boolean } = {}) {
  const h = options.h ?? createRouterHarness(harness);
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), 'flofi-router-'));
  const service = createRouterService({ storage: createFileExecutionStorage(dir, 'ROUTER_BUSY'), sourceRpc: h.baseRpc, destinationRpc: h.arbitrumRpc, providers: h.providers,
    provenance: 'MOCKED', executionEnabled: options.executionEnabled ?? true, now: h.clock, mockedCodePins: ROUTER_MOCK_CODE_PINS });
  return { h, dir, service };
}
async function reviewed(s: RouterService, w = workflow()) { const run = await s.simulate(w, ROUTER_OWNER); return s.review(run.id, run.review.commitment, w); }
/** The browser's Execute click: begin → durable handoff → the owner's wallet → report the hash. */
async function execute(s: RouterService, h: RouterHarness, id: string, w: SemanticWorkflow, mode: { hold?: boolean } = {}) {
  const begun = await s.begin(id, ROUTER_OWNER, w);
  await s.handoff(id);
  const hash = h.wallet.send(begun.transaction, mode);
  await s.report(id, { kind: 'HASH', hash });
  return { begun, hash };
}
/** Approval, then the bridge deposit; returns the run once the source deposit is reconciled. */
async function deposit(s: RouterService, h: RouterHarness, id: string, w: SemanticWorkflow): Promise<RouterRecord> {
  const first = await execute(s, h, id, w);
  expect(first.begun.attempt.step).toBe('APPROVAL');
  await s.observe(id);
  const second = await execute(s, h, id, w);
  expect(second.begun.attempt.step).toBe('DEPOSIT');
  return s.observe(id);
}
async function until(s: RouterService, h: RouterHarness, id: string, phase: RouterRecord['phase'], seconds = 5, rounds = 20): Promise<RouterRecord> {
  let run = await s.load(id);
  for (let i = 0; i < rounds && run.phase !== phase; i++) { h.advance(seconds); run = await s.observe(id); }
  return run;
}

describe('BUILD-ROUTER-001 Quote → Simulation → Review → route-bound Manifest', () => {
  it('exposes provider, steps, amounts, fees, gas, duration, approvals, recipient and expiry, with quote, simulation and observation kept distinct', async () => {
    const { service } = await setup(), w = workflow();
    const run = await service.simulate(w, ROUTER_OWNER), r = run.review;
    expect(run.phase).toBe('PREPARED');
    expect(r.selection).toMatchObject({ policy: 'PREFERENCE_ORDER', selected: 'lifi' });
    expect(r.selection.considered.map(c => [c.provider, c.outcome])).toEqual([['lifi', 'SELECTED'], ['across', 'AVAILABLE']]);
    expect(r.route).toMatchObject({ routingProvider: 'lifi', underlyingProtocol: 'across', inputAmount: '10000000', recipient: ROUTER_OWNER });
    expect(r.route.steps.map(s => `${s.kind}:${s.protocol}`)).toEqual(['FEE_COLLECTION:lifi-fee', 'BRIDGE:across']);
    expect(BigInt(r.route.feeTotal)).toBe(BigInt(r.route.inputAmount) - BigInt(r.route.minimumOutput));
    expect(r.quote).toMatchObject({ provenance: 'PROVIDER_QUOTE', provider: 'lifi', estimatedDurationSeconds: 2 });
    expect(r.simulation).toMatchObject({ provenance: 'TRANSACTION_SIMULATION', method: 'eth_simulateV1', chainId: 8453,
      notSimulated: ['DESTINATION_FILL', 'RELAYER_BEHAVIOUR', 'ORIGIN_REFUND'], ownerDebit: '10000000' });
    expect(r.simulation.deposit).toMatchObject({ recipient: ROUTER_OWNER, depositor: ROUTER_OWNER, outputAmount: r.route.minimumOutput, destinationChainId: 42161 });
    expect(r.observation.provenance).toBe('CHAIN_OBSERVATION');
    expect(r.approvals).toEqual([{ token: SRC.usdc, spender: SRC.lifiDiamond, amount: '10000000', currentAllowance: '0', required: true }]);
    expect(decodeRouterApprove(r.calls[0]!.data)).toEqual({ spender: SRC.lifiDiamond, amount: 10_000_000n });
    expect(r.calls.map(c => c.purpose)).toEqual(['APPROVAL', 'BRIDGE_DEPOSIT']);
    expect(Number(r.fees.gasLimitTotal)).toBeGreaterThan(0);
    expect(Date.parse(r.expiresAt)).toBeLessThanOrEqual(Date.parse(r.route.quote.expiresAt));
    expect(Date.parse(r.expiresAt) - Date.parse(r.observedAt)).toBeLessThanOrEqual(profile.reviewTtlSeconds * 1000);
    // The Manifest binds the exact route: route commitment in the quote artifact, FIXED provider in policy and Manifest.
    expect(r.routeCommitment).toBe(routeCommitment(r.route));
    expect(r.artifacts.quote.normalizedValues.find(v => v.name === 'route-commitment')?.value).toBe(r.routeCommitment);
    expect(r.artifacts.manifest.providers).toEqual({ kind: 'FIXED', providerId: 'lifi:across' });
    expect(r.artifacts.manifest.artifactSetHash).toBe(r.artifacts.hashes.artifactSet);
  });
  it('binds an explicit recipient and honors the routing policy', async () => {
    const { service } = await setup();
    const run = await service.simulate(workflow({ recipient: ROUTER_RECIPIENT, routing: 'ACROSS' }), ROUTER_OWNER);
    expect(run.review).toMatchObject({ recipient: ROUTER_RECIPIENT, recipientKind: 'EXPLICIT', selection: { selected: 'across' } });
    expect(run.review.selection.considered.map(c => c.provider)).toEqual(['across']);
    expect(run.review.simulation.deposit.recipient).toBe(ROUTER_RECIPIENT);
    expect(run.review.approvals[0]!.spender).toBe(SRC.spokePool);
  });
  it('quote-time fallback is explicit in the Review: unavailable or unreconcilable LI.FI selects Across and says why', async () => {
    const down = await setup(); down.h.controls.lifi = 'down';
    const a = await down.service.simulate(workflow(), ROUTER_OWNER);
    expect(a.review.selection.considered).toMatchObject([{ provider: 'lifi', outcome: 'UNAVAILABLE', code: 'ROUTER_PROVIDER_HTTP_503' }, { provider: 'across', outcome: 'SELECTED' }]);
    const stargate = await setup(); stargate.h.controls.lifi = 'stargate';
    const b = await stargate.service.simulate(workflow(), ROUTER_OWNER);
    expect(b.review.selection.considered[0]).toMatchObject({ provider: 'lifi', outcome: 'REFUSED', code: 'LIFI_UNDERLYING_PROTOCOL_NOT_RECONCILABLE' });
    expect(b.review.route.routingProvider).toBe('across');
    const only = await setup(); only.h.controls.lifi = 'stargate';
    await expect(only.service.simulate(workflow({ routing: 'LIFI' }), ROUTER_OWNER)).rejects.toThrow('ROUTER_NO_EXECUTABLE_ROUTE');
  });
  it('fails closed on insufficient balance, missing simulation and unexpected contracts', async () => {
    await expect((await setup({ usdc: 1_000_000n })).service.simulate(workflow(), ROUTER_OWNER)).rejects.toThrow('ROUTER_INSUFFICIENT_USDC');
    await expect((await setup({ simulateV1: false })).service.simulate(workflow(), ROUTER_OWNER)).rejects.toThrow('ROUTER_SIMULATION_UNAVAILABLE');
    const h = createRouterHarness(), dir = await mkdtemp(join(tmpdir(), 'flofi-router-'));
    const strict = createRouterService({ storage: createFileExecutionStorage(dir, 'ROUTER_BUSY'), sourceRpc: h.baseRpc, destinationRpc: h.arbitrumRpc, providers: h.providers,
      provenance: 'MOCKED', executionEnabled: true, now: h.clock });
    await expect(strict.simulate(workflow(), ROUTER_OWNER)).rejects.toThrow('ROUTER_UNEXPECTED_CONTRACT');
    expect(() => createRouterService({ storage: createFileExecutionStorage(dir, 'ROUTER_BUSY'), sourceRpc: h.baseRpc, destinationRpc: h.arbitrumRpc, providers: h.providers,
      provenance: 'PUBLIC_MAINNET', mockedCodePins: ROUTER_MOCK_CODE_PINS })).toThrow('ROUTER_CODE_PINS_MOCKED_ONLY');
  });
});

describe('BUILD-ROUTER-001 authorization invalidation (ROUTE_CHANGED and friends)', () => {
  it('fee increase after Review: ROUTE_CHANGED clears the authorization; the old Review cannot be re-accepted; a new quote and Review are required', async () => {
    const { service, h } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    h.controls.feeBump = 5_000n;
    await expect(service.begin(run.id, ROUTER_OWNER, w)).rejects.toThrow('ROUTE_CHANGED');
    const after = await service.load(run.id);
    expect(after).toMatchObject({ phase: 'PREPARED', authorization: null, requote: true, error: 'ROUTE_CHANGED' });
    expect(after.routeChanges).toEqual(['FEES_OUT_OF_BOUNDS', 'MINIMUM_OUTPUT_DECREASED']);
    expect(after.attempts).toHaveLength(0);
    await expect(service.review(run.id, run.review.commitment, w)).rejects.toThrow('ROUTER_REQUOTE_REQUIRED');
    const refreshed = await service.refresh(run.id);
    expect(refreshed.review.commitment).not.toBe(run.review.commitment);
    expect(refreshed.review.artifacts.hashes.manifest).not.toBe(run.review.artifacts.hashes.manifest);
    await service.review(run.id, refreshed.review.commitment, w);
    expect((await service.begin(run.id, ROUTER_OWNER, w)).attempt.step).toBe('APPROVAL');
    expect(h.counters.sends).toBe(0);
  });
  it('public provider fallback after Review is never used: LI.FI now routing via another bridge is ROUTE_CHANGED, not a silent switch', async () => {
    const { service, h } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    h.controls.lifi = 'stargate';
    const acrossQuotes = h.counters.quotes.across;
    await expect(service.begin(run.id, ROUTER_OWNER, w)).rejects.toThrow('ROUTE_CHANGED');
    expect((await service.load(run.id)).routeChanges).toEqual(['PROTOCOL_CHANGED']);
    expect(h.counters.quotes.across).toBe(acrossQuotes);
    expect(h.counters.sends).toBe(0);
  });
  it('route-step change after Review (LI.FI drops its fee step) is ROUTE_CHANGED', async () => {
    const { service, h } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    h.controls.lifi = 'noFeeStep';
    await expect(service.begin(run.id, ROUTER_OWNER, w)).rejects.toThrow('ROUTE_CHANGED');
    expect((await service.load(run.id)).routeChanges).toContain('STEPS_CHANGED');
  });
  it('recipient or amount change in the IR invalidates; the reviewed workflow is the only one that can begin', async () => {
    const { service } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    for (const changed of [workflow({ recipient: ROUTER_RECIPIENT }), workflow({ amount: '11' })])
      await expect(service.begin(run.id, ROUTER_OWNER, changed)).rejects.toThrow('ROUTER_SEMANTIC_REVISION_CHANGED');
    expect((await service.invalidate(run.id))).toMatchObject({ phase: 'PREPARED', authorization: null, error: 'ROUTER_SEMANTIC_EDIT_REQUIRES_REVIEW' });
  });
  it('quote expiry, wallet/account change, provider outage and disabled execution fail closed', async () => {
    const { service, h } = await setup(), w = workflow();
    const run = await reviewed(service, w);
    await expect(service.begin(run.id, '0x' + '9'.repeat(40), w)).rejects.toThrow('ROUTER_WRONG_OWNER');
    h.controls.lifi = 'down';
    await expect(service.begin(run.id, ROUTER_OWNER, w)).rejects.toThrow('ROUTER_ROUTE_REVALIDATION_UNAVAILABLE');
    expect((await service.load(run.id)).phase).toBe('AUTHORIZED');
    h.controls.lifi = 'ok';
    h.advance(profile.reviewTtlSeconds + 1);
    await expect(service.begin(run.id, ROUTER_OWNER, w)).rejects.toThrow('ROUTER_REVIEW_EXPIRED');
    expect(await service.load(run.id)).toMatchObject({ phase: 'PREPARED', authorization: null, requote: true });
    const disabled = await setup({}, { executionEnabled: false });
    const other = await reviewed(disabled.service, w);
    await expect(disabled.service.begin(other.id, ROUTER_OWNER, w)).rejects.toThrow('ROUTER_EXECUTION_NOT_ENABLED');
  });
  it('a changed Review commitment, or a tampered stored route, is refused', async () => {
    const { service, dir } = await setup(), w = workflow();
    const run = await service.simulate(w, ROUTER_OWNER);
    await expect(service.review(run.id, '0x' + '0'.repeat(64), w)).rejects.toThrow('ROUTER_REVIEW_CHANGED');
    const file = join(dir, run.id + '.jsonl'), tampered = JSON.parse((await readFile(file, 'utf8')).trim()) as RouterRecord;
    const forged = { ...tampered, review: { ...tampered.review, route: { ...tampered.review.route, recipient: ROUTER_RECIPIENT } } };
    await appendFile(file, JSON.stringify(forged) + '\n');
    await expect(service.load(run.id)).rejects.toThrow('ROUTER_STORE_CORRUPT');
    expect(() => validateRouterLog(new TextEncoder().encode(JSON.stringify(forged) + '\n'))).toThrow('ROUTER_STORE_CORRUPT');
  });
});

describe('BUILD-ROUTER-001 asynchronous execution and destination reconciliation', () => {
  it('LI.FI route: approval → deposit → in flight → destination observed → reconciled only at safe heads, with evidence', async () => {
    const { service, h } = await setup(), w = workflow(), run = await reviewed(service, w);
    const confirmed = await deposit(service, h, run.id, w);
    expect(confirmed.phase).toBe('SOURCE_CONFIRMED');
    expect(confirmed.authorization).toBeNull();
    expect(confirmed.source).toMatchObject({ depositor: ROUTER_OWNER, recipient: ROUTER_OWNER, inputAmount: '9975000', outputAmount: confirmed.review.route.minimumOutput, safe: false });
    expect(decodeLifiAcrossV4(confirmed.attempts[1]!.tx.data).bridgeData.receiver).toBe(ROUTER_OWNER);
    expect(routerNeedsObservation(confirmed)).toBe(true);
    const observed = await until(service, h, run.id, 'DESTINATION_OBSERVED', 3);
    expect(observed.destination).toMatchObject({ recipient: ROUTER_OWNER, outputAmount: confirmed.review.route.minimumOutput, discoveredBy: 'PROVIDER_HINT', safe: false });
    expect(observed.verdict).toBe('PENDING');
    const done = await until(service, h, run.id, 'RECONCILED', 5);
    expect(done).toMatchObject({ phase: 'RECONCILED', verdict: 'RECONCILED' });
    expect(done.evidence).toMatchObject({ evidenceClass: 'MOCKED', reconciliation: 'RECONCILED', recipient: ROUTER_OWNER,
      route: { provider: 'lifi', underlyingProtocol: 'across', routeCommitment: run.review.routeCommitment, manifestHash: run.review.artifacts.hashes.manifest } });
    expect(done.evidence!.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED', manifestHash: run.review.artifacts.hashes.manifest });
    expect(done.evidence!.transactions.map(t => t.step)).toEqual(['APPROVAL', 'DEPOSIT', 'FILL']);
    expect(h.counters.sends).toBe(2);
    expect(routerNeedsObservation(done)).toBe(false);
  });
  it('Across direct route reconciles the same way and pays no integrator fee', async () => {
    const { service, h } = await setup(), w = workflow({ routing: 'ACROSS', recipient: ROUTER_RECIPIENT }), run = await reviewed(service, w);
    expect(run.review.route.fees.some(f => f.kind === 'INTEGRATOR')).toBe(false);
    await deposit(service, h, run.id, w);
    const done = await until(service, h, run.id, 'RECONCILED', 5);
    expect(done.destination).toMatchObject({ recipient: ROUTER_RECIPIENT });
    expect(h.arbUsdc[ROUTER_RECIPIENT]).toBe(BigInt(run.review.route.minimumOutput));
  });
  it('source confirmed but destination absent is never success; waiting does not grow the log; a delayed fill later reconciles', async () => {
    const { service, h, dir } = await setup({ autoFillSeconds: null }), w = workflow(), run = await reviewed(service, w);
    await deposit(service, h, run.id, w);
    const waiting = await until(service, h, run.id, 'RECONCILED', 10, 6);
    expect(waiting).toMatchObject({ phase: 'IN_FLIGHT', verdict: 'PENDING', destination: null, error: 'ROUTER_DESTINATION_PENDING' });
    expect(waiting.source!.safe).toBe(true);
    const lines = async () => (await readFile(join(dir, run.id + '.jsonl'), 'utf8')).trimEnd().split('\n').length;
    const before = await lines();
    for (let i = 0; i < 10; i++) { h.advance(30); await service.observe(run.id); }
    expect(await lines()).toBe(before);
    h.relayer.fill();
    const done = await until(service, h, run.id, 'RECONCILED', 5);
    expect(done.phase).toBe('RECONCILED');
  });
  it('an API status string is never proof: a lying hint is rejected and the chain scan finds the real fill; an outage does not block', async () => {
    const lying = await setup(); lying.h.controls.hint = 'lying';
    const w = workflow(), a = await reviewed(lying.service, w);
    await deposit(lying.service, lying.h, a.id, w);
    const found = await until(lying.service, lying.h, a.id, 'DESTINATION_OBSERVED', 3);
    expect(found.destination).toMatchObject({ discoveredBy: 'LOG_SCAN' });
    expect(found.destination!.transactionHash).not.toBe('0x' + 'ab'.repeat(32));
    const down = await setup(); down.h.controls.hint = 'down';
    const b = await reviewed(down.service, w);
    await deposit(down.service, down.h, b.id, w);
    expect((await until(down.service, down.h, b.id, 'RECONCILED', 5)).destination!.discoveredBy).toBe('LOG_SCAN');
  });
  it('a fill to another recipient or below the reviewed minimum freezes the run for attention', async () => {
    for (const mode of ['wrongRecipient', 'belowMinimum'] as const) {
      const { service, h } = await setup(); h.controls.fillMode = mode;
      const w = workflow(), run = await reviewed(service, w);
      await deposit(service, h, run.id, w);
      const frozen = await until(service, h, run.id, 'RECONCILIATION_REQUIRED', 3);
      expect(frozen).toMatchObject({ phase: 'RECONCILIATION_REQUIRED', verdict: 'DIVERGENT', evidence: null });
      expect(frozen.error).toBe(mode === 'wrongRecipient' ? 'ROUTER_FILL_RECIPIENT_MISMATCH' : 'ROUTER_FILL_BELOW_MINIMUM');
    }
  });
  it('no fill before the fill deadline → RECOVERY_REQUIRED → a verified origin refund → REFUNDED (not success)', async () => {
    const { service, h } = await setup({ autoFillSeconds: null }), w = workflow(), run = await reviewed(service, w);
    const confirmed = await deposit(service, h, run.id, w);
    h.advance(confirmed.source!.fillDeadline - Math.floor(h.nowMs() / 1000) + 60);
    const recovery = await until(service, h, run.id, 'RECOVERY_REQUIRED', 1, 40);
    expect(recovery).toMatchObject({ phase: 'RECOVERY_REQUIRED', verdict: 'PENDING', error: 'ROUTER_FILL_DEADLINE_PASSED_REFUND_EXPECTED' });
    h.relayer.refund();
    const refunded = await service.observe(run.id);
    expect(refunded).toMatchObject({ phase: 'REFUNDED', verdict: 'REFUNDED', evidence: null, refund: { recipient: ROUTER_OWNER, amount: confirmed.source!.inputAmount } });
  });
  it('a reverted or never-executed deposit is FAILED with no funds moved, and the run cannot be resubmitted', async () => {
    const { service, h } = await setup(), w = workflow(), run = await reviewed(service, w);
    await execute(service, h, run.id, w); await service.observe(run.id);
    const begun = await service.begin(run.id, ROUTER_OWNER, w);
    await service.handoff(run.id);
    h.wallet.cancel();
    const failed = await service.observe(run.id);
    expect(failed).toMatchObject({ phase: 'FAILED', verdict: 'FAILED', error: 'ROUTER_NONCE_CONSUMED_BY_DIFFERENT_TRANSACTION' });
    expect(failed.attempts.at(-1)).toMatchObject({ attemptId: begun.attempt.attemptId, state: 'NOT_FOUND' });
    await expect(service.begin(run.id, ROUTER_OWNER, w)).rejects.toThrow('ROUTER_DEPOSIT_ALREADY_CONFIRMED');
    await expect(service.refresh(run.id)).rejects.toThrow('ROUTER_REFRESH_NOT_ALLOWED');
  });
});

describe('BUILD-ROUTER-001 recovery after restart and ambiguous submissions', () => {
  it('restart: a fresh service instance on the same storage continues from durable state alone', async () => {
    const first = await setup(), w = workflow(), run = await reviewed(first.service, w);
    await deposit(first.service, first.h, run.id, w);
    const second = await setup({}, { dir: first.dir, h: first.h });
    expect((await second.service.load(run.id)).phase).toBe('SOURCE_CONFIRMED');
    expect((await until(second.service, first.h, run.id, 'RECONCILED', 5)).phase).toBe('RECONCILED');
    expect(first.h.counters.sends).toBe(2);
  });
  it('browser lost after the wallet call (no hash reported): nonce discovery finds the deposit after restart; nothing is resent', async () => {
    const first = await setup(), w = workflow(), run = await reviewed(first.service, w);
    await execute(first.service, first.h, run.id, w); await first.service.observe(run.id);
    const begun = await first.service.begin(run.id, ROUTER_OWNER, w);
    await first.service.handoff(run.id);
    first.h.wallet.send(begun.transaction);
    const second = await setup({}, { dir: first.dir, h: first.h });
    const recovered = await second.service.observe(run.id);
    expect(recovered.phase).toBe('SOURCE_CONFIRMED');
    expect(recovered.attempts.at(-1)!.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.h.counters.sends).toBe(2);
  });
  it('ambiguous submission: never resent in this run; a queued request blocks new preparations', async () => {
    const { service, h } = await setup(), w = workflow(), run = await reviewed(service, w);
    await execute(service, h, run.id, w); await service.observe(run.id);
    const begun = await service.begin(run.id, ROUTER_OWNER, w);
    await service.handoff(run.id);
    h.wallet.send(begun.transaction, { hold: true });
    const unknown = await service.report(run.id, { kind: 'UNKNOWN', code: 'ROUTER_SUBMISSION_UNKNOWN' });
    expect(unknown).toMatchObject({ phase: 'SOURCE_SUBMITTED' });
    expect(unknown.attempts.at(-1)!.state).toBe('SUBMISSION_RESULT_UNKNOWN');
    await expect(service.begin(run.id, ROUTER_OWNER, w)).rejects.toThrow('ROUTER_ATTEMPT_ACTIVE_OBSERVE_EXISTING');
    await expect(service.refresh(run.id)).rejects.toThrow('ROUTER_REFRESH_NOT_ALLOWED');
    expect((await service.observe(run.id)).error).toBe('ROUTER_TRANSACTION_NOT_OBSERVED');
    const other = await reviewed(service, w);
    await expect(service.begin(other.id, ROUTER_OWNER, w)).rejects.toThrow('ROUTER_PENDING_TRANSACTION');
    h.wallet.mine();
    expect((await service.observe(run.id)).phase).toBe('SOURCE_CONFIRMED');
    expect(h.counters.sends).toBe(2);
  });
  it('ambiguous submission without a visible pending transaction (e.g. a relayed request): no second deposit by any run of the owner until resolved', async () => {
    const { service, h } = await setup(), w = workflow(), run = await reviewed(service, w);
    await execute(service, h, run.id, w); await service.observe(run.id);
    await service.begin(run.id, ROUTER_OWNER, w);
    await service.handoff(run.id);
    await service.report(run.id, { kind: 'UNKNOWN', code: 'ROUTER_SUBMISSION_UNKNOWN' });
    const other = await reviewed(service, w);
    expect(other.review.approvals[0]!.required).toBe(false);
    await expect(service.begin(other.id, ROUTER_OWNER, w)).rejects.toThrow('ROUTER_OWNER_DEPOSIT_IN_FLIGHT');
    // Once the SpokePool quote window has passed with the owner's nonce unconsumed, the request can no longer move funds.
    h.advance(run.review.deadlines.depositMustLandBy - Math.floor(h.nowMs() / 1000) + 10);
    expect(await service.observe(run.id)).toMatchObject({ phase: 'FAILED', verdict: 'FAILED', error: 'ROUTER_SUBMISSION_EXPIRED_NOT_EXECUTED' });
    const again = await service.simulate(w, ROUTER_OWNER);
    await service.review(again.id, again.review.commitment, w);
    expect((await service.begin(again.id, ROUTER_OWNER, w)).attempt.step).toBe('DEPOSIT');
    expect(h.counters.sends).toBe(1);
  });
  it('relayed deposit whose hash was lost (owner nonce unchanged): found by its on-chain Across identity, never declared NOT_FOUND, never resent', async () => {
    const { service, h } = await setup({ delegatedOwner: true }), w = workflow(), run = await reviewed(service, w);
    const approval = await service.begin(run.id, ROUTER_OWNER, w);
    await service.handoff(run.id);
    await service.report(run.id, { kind: 'HASH', hash: h.wallet.sendRelayed(approval.transaction) });
    expect((await service.observe(run.id)).attempts[0]).toMatchObject({ state: 'CONFIRMED', receipt: { submissionKind: 'DELEGATED_SINGLE' } });
    const begun = await service.begin(run.id, ROUTER_OWNER, w);
    expect(begun.attempt.nonce).toBe(approval.attempt.nonce);
    await service.handoff(run.id);
    h.wallet.sendRelayed(begun.transaction);
    await service.report(run.id, { kind: 'UNKNOWN', code: 'ROUTER_SUBMISSION_UNKNOWN' });
    // Even past the quote window, the deposit that did land is found by its FundsDeposited log.
    h.advance(run.review.deadlines.depositMustLandBy - Math.floor(h.nowMs() / 1000) + 10);
    const found = await service.observe(run.id);
    expect(found.verdict).toBe('PENDING');
    expect(found.source).toMatchObject({ depositor: ROUTER_OWNER, recipient: ROUTER_OWNER });
    expect(found.attempts.at(-1)).toMatchObject({ state: 'CONFIRMED', receipt: { submissionKind: 'DELEGATED_SINGLE' } });
    expect(h.counters.sends).toBe(2);
  });
  it('a guard entry whose attempt was never persisted (never handed to a wallet) does not block the owner forever', async () => {
    const { service, h, dir } = await setup(), w = workflow(), first = await reviewed(service, w);
    await execute(service, h, first.id, w); await service.observe(first.id);
    await writeFile(join(dir, `${ROUTER_OWNER}-deposit.xroute-guard`), JSON.stringify({ runId: first.id, attemptId: first.id + '.deposit.9' }) + '\n');
    const other = await reviewed(service, w);
    expect((await service.begin(other.id, ROUTER_OWNER, w)).attempt.step).toBe('DEPOSIT');
    await expect(service.begin(first.id, ROUTER_OWNER, w)).rejects.toThrow('ROUTER_OWNER_DEPOSIT_IN_FLIGHT');
  });
  it('a proven wallet refusal returns to Review; a repeated or divergent hash report is handled without resending', async () => {
    const { service, h } = await setup(), w = workflow(), run = await reviewed(service, w);
    await service.begin(run.id, ROUTER_OWNER, w);
    await service.handoff(run.id);
    const cancelled = await service.walletFailure(run.id, { invoked: true, calls: [{ method: 'eth_sendTransaction', submission: true, error: { code: 4001 } }],
      code: 'ROUTER_REJECTED', rejectionCode: 4001 });
    expect(cancelled).toMatchObject({ phase: 'PREPARED', authorization: null });
    expect(cancelled.attempts[0]!.state).toBe('CANCELLED');
    await service.review(run.id, run.review.commitment, w);
    const { hash } = await execute(service, h, run.id, w);
    await expect(service.report(run.id, { kind: 'HASH', hash })).resolves.toBeTruthy();
    await expect(service.report(run.id, { kind: 'HASH', hash: '0x' + '1'.repeat(64) })).rejects.toThrow('ROUTER_HASH_DIVERGENT');
    await expect(service.walletFailure(run.id, { invoked: true, calls: [{ method: 'eth_sendTransaction', submission: true, error: { code: -32000 } }], code: 'ROUTER_SUBMISSION_UNKNOWN' }))
      .rejects.toThrow('ROUTER_DIAGNOSTIC_NOT_PRE_SUBMISSION');
  });
  it('a PREPARED attempt observed after the browser stopped is cancelled, never sent', async () => {
    const { service, h } = await setup(), w = workflow(), run = await reviewed(service, w);
    await service.begin(run.id, ROUTER_OWNER, w);
    const observed = await service.observe(run.id);
    expect(observed.attempts[0]!.state).toBe('CANCELLED');
    expect(observed.phase).toBe('PREPARED');
    expect(h.counters.sends).toBe(0);
  });
  it('malformed or corrupted storage fails closed', async () => {
    const { service, dir } = await setup(), run = await service.simulate(workflow(), ROUTER_OWNER);
    await writeFile(join(dir, run.id + '.jsonl'), '{"format":"flofi.router-run.v1"}\n');
    await expect(service.load(run.id)).rejects.toThrow('ROUTER_STORE_CORRUPT');
    await expect(service.observe(run.id)).rejects.toThrow('ROUTER_STORE_CORRUPT');
  });
});
