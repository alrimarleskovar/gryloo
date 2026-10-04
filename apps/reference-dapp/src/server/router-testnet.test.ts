// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-JOURNEY-001: the canonical Router on the testnet profile (Base Sepolia → Arbitrum Sepolia) for arbitrary external wallets,
 * on the same MOCKED in-process chains as BUILD-ROUTER-001 (parameterized, not a second runtime). No network, no key, no send path.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { createFileExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as MAINNET, CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { editorReducer, initialEditor } from '../domain/editor';
import type { RouterBridgeInput } from '../domain/router-authoring';
import { createRouterHarness, ROUTER_MOCK_CODE_PINS, type RouterHarness, type RouterHarnessOptions } from '../../e2e/router-harness';
import { createTestWallet } from '../../e2e/test-wallet';
import { createRouterService, routerEvidenceClass, validateRouterLog, type RouterRecord, type RouterService } from './router-service';
import { routerTestnetMode, routerTestnetRuntime } from './router-runtime';

function workflow(patch: Partial<RouterBridgeInput> = {}): SemanticWorkflow {
  const input: RouterBridgeInput = { source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '1', recipient: '', slippage: '50', routing: 'AUTO', ...patch };
  const result = editorReducer(initialEditor(), { type: 'ADD_ROUTER_BRIDGE', input, source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext());
  if (result.error) throw new Error(result.error);
  return structuredClone(result.workflow) as unknown as SemanticWorkflow;
}
async function setup(options: RouterHarnessOptions = {}) {
  const owner = options.owner ?? createTestWallet().address;
  const h = createRouterHarness({ profile: TESTNET, ...options, owner });
  const dir = await mkdtemp(join(tmpdir(), 'flofi-router-testnet-'));
  const service = createRouterService({ storage: createFileExecutionStorage(dir, 'ROUTER_BUSY'), sourceRpc: h.baseRpc, destinationRpc: h.arbitrumRpc, providers: h.providers,
    provenance: 'MOCKED', executionEnabled: true, now: h.clock, mockedCodePins: h.codePins, profile: TESTNET });
  return { h, dir, service, owner: h.owner };
}
async function execute(s: RouterService, h: RouterHarness, owner: string, id: string, w: SemanticWorkflow, mode: { hold?: boolean } = {}) {
  const begun = await s.begin(id, owner, w);
  await s.handoff(id);
  const hash = h.wallet.send(begun.transaction, mode);
  await s.report(id, { kind: 'HASH', hash });
  return { begun, hash };
}
async function until(s: RouterService, h: RouterHarness, id: string, phase: RouterRecord['phase'], rounds = 20): Promise<RouterRecord> {
  let run = await s.load(id);
  for (let i = 0; i < rounds && run.phase !== phase; i++) { h.advance(5); run = await s.observe(id); }
  return run;
}

describe('BUILD-JOURNEY-001 testnet Router for arbitrary wallets', () => {
  it('a fresh random wallet completes Quote → Simulation → Review → approval → deposit → fill → RECONCILED on the testnet chains', async () => {
    const { h, service, owner } = await setup(), w = workflow();
    const run = await service.simulate(w, owner);
    expect(run.owner).toBe(owner);
    expect(run.review.intent).toMatchObject({ sourceChain: 'eip155:84532', destinationChain: 'eip155:421614', amount: '1000000' });
    expect(run.review.simulation).toMatchObject({ chainId: 84532, deposit: { destinationChainId: 421614, depositor: owner, recipient: owner } });
    expect(run.review.approvals[0]).toMatchObject({ token: TESTNET.source.usdc, spender: TESTNET.source.lifiDiamond, amount: '1000000', required: true });
    expect(run.review.route.bridge).toMatchObject({ originSpokePool: TESTNET.source.spokePool, destinationSpokePool: TESTNET.destination.spokePool });
    await service.review(run.id, run.review.commitment, w);
    const approval = await execute(service, h, owner, run.id, w);
    expect(approval.begun.transaction).toMatchObject({ chainId: '0x14a34', from: owner, to: TESTNET.source.usdc, value: '0x0' });
    await service.observe(run.id);
    const deposit = await execute(service, h, owner, run.id, w);
    expect(deposit.begun.transaction).toMatchObject({ chainId: '0x14a34', from: owner, to: TESTNET.source.lifiDiamond });
    const done = await until(service, h, run.id, 'RECONCILED');
    expect(done).toMatchObject({ phase: 'RECONCILED', verdict: 'RECONCILED' });
    expect(done.evidence).toMatchObject({ evidenceClass: 'MOCKED', bundle: { environment: 'MOCKED', outcome: 'RECONCILED' } });
    expect(done.evidence!.transactions.map(t => [t.chain, t.step])).toEqual([['eip155:84532', 'APPROVAL'], ['eip155:84532', 'DEPOSIT'], ['eip155:421614', 'FILL']]);
    expect(done.evidence!.transactions.every(t => t.explorer.startsWith(t.chain === 'eip155:84532' ? 'https://sepolia.basescan.org/tx/' : 'https://sepolia.arbiscan.io/tx/'))).toBe(true);
    expect(h.counters.sends).toBe(2);
  });
  it('binds each run to its own wallet: two wallets, two runs, no owner substitution', async () => {
    const other = createTestWallet().address, { h, service, owner } = await setup({ wallets: [other] }), w = workflow({ routing: 'ACROSS' });
    const mine = await service.simulate(w, owner), theirs = await service.simulate(w, other);
    expect([mine.owner, theirs.owner]).toEqual([owner, other]);
    expect(theirs.review.route.depositor).toBe(other);
    await service.review(mine.id, mine.review.commitment, w);
    await expect(service.begin(mine.id, other, w)).rejects.toThrow('ROUTER_WRONG_OWNER');
    expect(h.counters.sends).toBe(0);
  });
  it('a wallet account change after Review clears the authorization; nothing can be begun until a fresh Review', async () => {
    const { service, owner } = await setup(), w = workflow();
    const run = await service.simulate(w, owner);
    await service.review(run.id, run.review.commitment, w);
    const cleared = await service.invalidate(run.id, 'WALLET_CHANGED');
    expect(cleared).toMatchObject({ phase: 'PREPARED', authorization: null, error: 'ROUTER_WALLET_CHANGED_REVIEW_REQUIRED' });
    await expect(service.begin(run.id, owner, w)).rejects.toThrow('ROUTER_REVIEW_REQUIRED');
    await expect(service.invalidate(run.id, 'SOMETHING' as 'WALLET_CHANGED')).rejects.toThrow('ROUTER_INVALIDATION_REASON_INVALID');
    expect((await service.review(run.id, run.review.commitment, w)).phase).toBe('AUTHORIZED');
  });
  it('a material workflow mutation after Review (amount, recipient, slippage, providers) is never executed; a route change clears the authorization', async () => {
    const { h, service, owner } = await setup(), w = workflow();
    const run = await service.simulate(w, owner);
    await service.review(run.id, run.review.commitment, w);
    for (const patch of [{ amount: '2' }, { recipient: createTestWallet().address }, { slippage: '60' }, { routing: 'ACROSS' as const }])
      await expect(service.begin(run.id, owner, workflow(patch))).rejects.toThrow('ROUTER_SEMANTIC_REVISION_CHANGED');
    h.controls.feeBump = 500n;
    await expect(service.begin(run.id, owner, w)).rejects.toThrow('ROUTE_CHANGED');
    expect(await service.load(run.id)).toMatchObject({ phase: 'PREPARED', authorization: null, requote: true });
    expect(h.counters.sends).toBe(0);
  });
  it('an ambiguous submission is observed, never resent, and rediscovered once it lands; a second attempt is refused meanwhile', async () => {
    const { h, service, owner } = await setup(), w = workflow({ routing: 'ACROSS' });
    const run = await service.simulate(w, owner);
    await service.review(run.id, run.review.commitment, w);
    const begun = await service.begin(run.id, owner, w);
    await service.handoff(run.id);
    h.wallet.send(begun.transaction, { hold: true });                         // reaches the mempool; the browser loses the answer
    expect((await service.report(run.id, { kind: 'UNKNOWN', code: 'ROUTER_SUBMISSION_UNKNOWN' })).attempts.at(-1)!.state).toBe('SUBMISSION_RESULT_UNKNOWN');
    await expect(service.begin(run.id, owner, w)).rejects.toThrow('ROUTER_ATTEMPT_ACTIVE_OBSERVE_EXISTING');
    expect((await service.observe(run.id)).error).toBe('ROUTER_TRANSACTION_NOT_OBSERVED');
    h.wallet.mine();
    const found = await service.observe(run.id);
    expect(found.attempts.at(-1)).toMatchObject({ step: 'APPROVAL', state: 'CONFIRMED', reconciled: true });
    expect(h.counters.sends).toBe(1);
  });
  it('one unresolved deposit per wallet across runs, and a deposit that is never filled is reconciled as a verified refund', async () => {
    const { h, service, owner } = await setup({ autoFillSeconds: null }), w = workflow({ routing: 'ACROSS' });
    const first = await service.simulate(w, owner), second = await service.simulate(w, owner);
    for (const run of [first, second]) await service.review(run.id, run.review.commitment, w);
    await execute(service, h, owner, first.id, w); await service.observe(first.id);
    const begun = await service.begin(first.id, owner, w);
    await service.handoff(first.id);                                         // the deposit request is with the wallet
    await expect(service.begin(second.id, owner, w)).rejects.toThrow('ROUTER_OWNER_DEPOSIT_IN_FLIGHT');
    await service.report(first.id, { kind: 'HASH', hash: h.wallet.send(begun.transaction) });
    expect((await service.observe(first.id)).phase).toBe('SOURCE_CONFIRMED');
    h.advance(7_300);
    const recovery = await until(service, h, first.id, 'RECOVERY_REQUIRED');
    expect(recovery).toMatchObject({ phase: 'RECOVERY_REQUIRED', error: 'ROUTER_FILL_DEADLINE_PASSED_REFUND_EXPECTED' });
    h.relayer.refund();
    const refunded = await service.observe(first.id);
    expect(refunded).toMatchObject({ phase: 'REFUNDED', verdict: 'REFUNDED', refund: { amount: '1000000', recipient: owner }, evidence: null });
  });
  it('each service serves exactly one network: workflows, logs and provenance never cross', async () => {
    const { service, owner, dir } = await setup(), w = workflow();
    const mainnetWorkflow = workflow({ source: 'Base', destination: 'Arbitrum' });
    await expect(service.simulate(mainnetWorkflow, owner)).rejects.toThrow('ROUTER_NETWORK_MISMATCH');
    const mh = createRouterHarness({ owner });
    const mainnet = createRouterService({ storage: createFileExecutionStorage(dir, 'ROUTER_BUSY'), sourceRpc: mh.baseRpc, destinationRpc: mh.arbitrumRpc, providers: mh.providers,
      provenance: 'MOCKED', executionEnabled: true, now: mh.clock, mockedCodePins: ROUTER_MOCK_CODE_PINS });
    await expect(mainnet.simulate(w, owner)).rejects.toThrow('ROUTER_NETWORK_MISMATCH');
    const run = await service.simulate(w, owner);
    await expect(mainnet.load(run.id)).rejects.toThrow('ROUTER_STORE_CORRUPT');   // a testnet log is never readable as mainnet
    const bytes = await readFile(join(dir, run.id + '.jsonl'));
    expect(() => validateRouterLog(bytes, TESTNET)).not.toThrow();
    expect(() => validateRouterLog(bytes, MAINNET)).toThrow('ROUTER_STORE_CORRUPT');
    const relabelled = Buffer.from(bytes.toString('utf8').replaceAll('"provenance":"MOCKED"', '"provenance":"PUBLIC_MAINNET"'));
    expect(() => validateRouterLog(relabelled, TESTNET)).toThrow('ROUTER_STORE_CORRUPT');
    const publicTestnet = Buffer.from(bytes.toString('utf8').replaceAll('"provenance":"MOCKED"', '"provenance":"PUBLIC_TESTNET"'));
    expect(() => validateRouterLog(publicTestnet, TESTNET)).not.toThrow();
    await writeFile(join(dir, 'x.jsonl'), relabelled);
    for (const [provenance, profile] of [['PUBLIC_TESTNET', MAINNET], ['PUBLIC_MAINNET', TESTNET]] as const)
      expect(() => createRouterService({ storage: createFileExecutionStorage(dir, 'ROUTER_BUSY'), sourceRpc: mh.baseRpc, destinationRpc: mh.arbitrumRpc, providers: mh.providers,
        provenance, profile })).toThrow('ROUTER_PROVENANCE_INVALID');
    expect(() => createRouterService({ storage: createFileExecutionStorage(dir, 'ROUTER_BUSY'), sourceRpc: mh.baseRpc, destinationRpc: mh.arbitrumRpc, providers: mh.providers,
      provenance: 'PUBLIC_TESTNET', profile: TESTNET, mockedCodePins: ROUTER_MOCK_CODE_PINS })).toThrow('ROUTER_CODE_PINS_MOCKED_ONLY');
    expect([routerEvidenceClass('PUBLIC_TESTNET'), routerEvidenceClass('PUBLIC_MAINNET'), routerEvidenceClass('MOCKED')]).toEqual(['TESTNET_EXECUTED', 'MAINNET_EXECUTED', 'MOCKED']);
  });
  it('testnet runtime: explicit gate, public testnet endpoints, owner execution on unless disabled, harness only on loopback', () => {
    expect([routerTestnetMode({}), routerTestnetMode({ GRYLOO_ROUTER_TESTNET: 'live' }), routerTestnetMode({ GRYLOO_ROUTER_TESTNET: 'live', GRYLOO_ROUTER_TESTNET_HARNESS: 'MOCKED_LOOPBACK_ONLY' }),
      routerTestnetMode({ GRYLOO_ROUTER: 'live' })]).toEqual(['off', 'live', 'harness', 'off']);
    const live = routerTestnetRuntime('live', {});
    expect(live).toMatchObject({ provenance: 'PUBLIC_TESTNET', executionEnabled: true, profile: TESTNET });
    expect(live.mockedCodePins).toBeUndefined();
    expect(routerTestnetRuntime('live', { GRYLOO_ROUTER_TESTNET_EXECUTION: 'DISABLED' }).executionEnabled).toBe(false);
    expect(() => routerTestnetRuntime('live', { GRYLOO_BASE_SEPOLIA_RPC_URL: 'http://insecure.example' })).toThrow('ROUTER_RPC_CONFIGURATION_INVALID');
    expect(routerTestnetRuntime('harness', {})).toMatchObject({ provenance: 'MOCKED', profile: TESTNET });
  });
});
