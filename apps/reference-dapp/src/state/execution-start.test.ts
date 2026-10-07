// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExecutionStart } from './execution-start';
import { reviewOwner, reviewFixture } from '../test-utils/review-fixture';
const f = vi.hoisted(() => ({ stores: {} as Record<string, Record<string, unknown>> }));
vi.mock('./mode-a-store', () => ({ useModeA: () => f.stores.modeA }));
vi.mock('./mode-b-store', () => ({ useModeB: () => f.stores.modeB }));
vi.mock('./composition-store', () => ({ useComposition: () => f.stores.composition }));
vi.mock('./liquidity-store', () => ({ useLiquidity: () => f.stores.liquidity }));
vi.mock('./supply-store', () => ({ useSupply: () => f.stores.supply }));
vi.mock('./lending-store', () => ({ useLending: () => f.stores.lending }));
vi.mock('./router-store', () => ({ useRouter: () => f.stores.router }));
vi.mock('./public-testnet-store', () => ({ usePublicTestnet: () => f.stores.public }));
vi.mock('./jupiter-store', () => ({ useJupiter: () => f.stores.jupiter }));
vi.mock('./solana-liquidity-store', () => ({ useSolanaLiquidity: () => f.stores.solanaPool }));
vi.mock('./uniswap-liquidity-store', () => ({ useUniswapLiquidity: () => f.stores.uniswapPool }));
vi.mock('./robinhood-transfer-store', () => ({ useRobinhoodTransfer: () => f.stores.transfer }));

beforeEach(() => {
  f.stores = Object.fromEntries(['modeA', 'modeB', 'composition', 'liquidity', 'supply', 'lending', 'router', 'public', 'jupiter', 'solanaPool', 'uniswapPool', 'transfer'].map(key => [key, { record: null, run: null, prepared: null, status: null, info: null, busy: false, retired: false, execute: vi.fn(), connect: vi.fn(), requests: [], verified: {} }]));
});
const wallet = () => reviewFixture().wallet;
describe('existing initial execution capabilities', () => {
  it.each(['supply', 'transfer', 'solana-swap', 'solana-pool'] as const)('binds %s only to its existing explicit Execute handler', kind => {
    const key = { supply: 'supply', transfer: 'transfer', 'solana-swap': 'jupiter', 'solana-pool': 'solanaPool' }[kind];
    const runtime = f.stores[key]!;
    runtime.record = { authorization: 'accepted', verdict: 'PENDING', attempts: [], attempt: null }; runtime.executionEnabled = true;
    const result = useExecutionStart(kind, wallet());
    expect(result.ready).toBe(true); expect(result.start).toBe(runtime.execute); expect(runtime.execute).not.toHaveBeenCalled();
    runtime.retired = true; expect(useExecutionStart(kind, wallet()).ready).toBe(false);
    runtime.retired = false; runtime.busy = true; expect(useExecutionStart(kind, wallet()).ready).toBe(false);
  });
  it('requires enabled execution and the signed-in owner session for a router run', () => {
    const runtime = f.stores.router!;
    runtime.record = { phase: 'AUTHORIZED', authorization: 'review', attempts: [], verdict: 'PENDING', review: { commitment: 'review', calls: [{ purpose: 'BRIDGE_DEPOSIT' }] } };
    runtime.executionEnabled = false; runtime.sessionReady = true;
    expect(useExecutionStart('router', wallet()).ready).toBe(false);
    runtime.executionEnabled = true; expect(useExecutionStart('router', wallet()).ready).toBe(true);
    runtime.sessionReady = false; expect(useExecutionStart('router', wallet()).ready).toBe(false);
  });
  it('blocks unresolved Supply requests and does not start another recorded request', () => {
    const runtime = f.stores.supply!;
    runtime.record = { authorization: 'accepted', verdict: 'PENDING', attempts: [{ reconciled: false }] };
    expect(useExecutionStart('supply', wallet())).toMatchObject({ ready: false, started: true });
    expect(runtime.execute).not.toHaveBeenCalled();
  });
  it('starts only the approval for a verified local swap and requires matching execution wallet', () => {
    const runtime = f.stores.modeA!; runtime.request = vi.fn(); runtime.reviewAccepted = true;
    runtime.info = { available: true }; runtime.verified = { 'step-approve': {}, 'step-swap': {} };
    const shared = { ...wallet(), chain: 'eip155:31337', environment: 'unknown' as const };
    expect(useExecutionStart('fork-swap', shared)).toMatchObject({ ready: false, connect: runtime.connect });
    runtime.wallet = { account: reviewOwner };
    const result = useExecutionStart('fork-swap', shared); expect(result.ready).toBe(true); expect(runtime.request).not.toHaveBeenCalled();
    result.start?.(); expect(runtime.request).toHaveBeenCalledWith('step-approve'); expect(runtime.request).toHaveBeenCalledOnce();
    shared.account = '0x2222222222222222222222222222222222222222';
    expect(useExecutionStart('fork-swap', shared).ready).toBe(false);
  });
  it('blocks disabled Solana execution and preserves the real-funds acknowledgement', () => {
    f.stores.jupiter!.record = { authorization: 'accepted', verdict: 'PENDING', provenance: 'PUBLIC_MAINNET' };
    f.stores.jupiter!.executionEnabled = false;
    expect(useExecutionStart('solana-swap', wallet())).toMatchObject({ ready: false, requiresMainnetAcknowledgement: true });
  });
  it('binds reviewed public swaps without fabricating an exact approval requirement', () => {
    const runtime = f.stores.public!;
    runtime.available = true; runtime.run = { reviewedManifestHash: 'hash', quote: { manifestHash: 'hash' }, attempts: [], outcome: null };
    const result = useExecutionStart('public', wallet()); expect(result.ready).toBe(true); expect(result.prompt).toContain('only if');
    runtime.recoveryOnly = true; expect(useExecutionStart('public', wallet()).ready).toBe(false);
  });
  it.each(['unavailable', 'across'] as const)('keeps %s preview paths fail-closed without a callable start', kind => {
    expect(useExecutionStart(kind, wallet())).toMatchObject({ ready: false, start: null });
  });
  it('requires an enabled pool runtime and a real remaining reviewed call', () => {
    const runtime = f.stores.uniswapPool!;
    runtime.record = { authorization: 'review', verdict: 'PENDING', attempts: [], review: { commitment: 'review', calls: [{ step: 'MINT' }] } };
    runtime.executionEnabled = true; expect(useExecutionStart('uniswap-pool', wallet()).ready).toBe(true);
    runtime.executionEnabled = false; expect(useExecutionStart('uniswap-pool', wallet()).ready).toBe(false);
    runtime.executionEnabled = true;
    (runtime.record as { attempts: unknown[] }).attempts = [{ step: 'MINT', state: 'CONFIRMED' }];
    expect(useExecutionStart('uniswap-pool', wallet())).toMatchObject({ ready: false, started: true });
  });
  it('uses the current lending calls and blocks any unresolved attempt', () => {
    const runtime = f.stores.lending!;
    runtime.record = { authorization: 'review', attempts: [], status: 'AUTHORIZED', reviews: [{ calls: [{ id: 'SUPPLY' }] }] };
    expect(useExecutionStart('lending', wallet()).ready).toBe(true);
    (runtime.record as { attempts: unknown[] }).attempts = [{ step: 'SUPPLY', reconciled: false, notSubmitted: false }];
    expect(useExecutionStart('lending', wallet())).toMatchObject({ ready: false, started: true });
  });
  it('uses the single reviewed pool request and refuses consumed authorization', () => {
    const runtime = f.stores.liquidity!;
    Object.assign(runtime, { info: { available: true }, verified: {}, reviewAccepted: true, wallet: { account: reviewOwner }, request: vi.fn(), consumed: false });
    const shared = { ...wallet(), chain: 'eip155:31337' };
    expect(useExecutionStart('fork-pool', shared)).toMatchObject({ ready: true, start: runtime.request });
    expect(runtime.request).not.toHaveBeenCalled(); runtime.consumed = true;
    expect(useExecutionStart('fork-pool', shared)).toMatchObject({ ready: false, started: true });
  });
  it.each(['delegated-swap', 'composition'] as const)('starts only the existing owner setup for %s and never automatically runs its worker', kind => {
    const runtime = f.stores[kind === 'delegated-swap' ? 'modeB' : 'composition']!;
    Object.assign(runtime, { info: { available: true }, wallet: { account: reviewOwner }, reviewed: true, installNext: vi.fn(), runWorker: vi.fn(), status: { prepared: {
      installationStart: 0, installation: [], compiled: { installation: [{}] }, executionHash: null, quoteExpiresAt: 9999999999,
    }, events: [] } });
    const result = useExecutionStart(kind, { ...wallet(), chain: 'eip155:31337' });
    expect(result.ready).toBe(true); expect(result.start).toBe(runtime.installNext);
    expect(runtime.installNext).not.toHaveBeenCalled(); expect(runtime.runWorker).not.toHaveBeenCalled();
    result.start?.(); expect(runtime.installNext).toHaveBeenCalledOnce(); expect(runtime.runWorker).not.toHaveBeenCalled();
    runtime.unknownSubmission = true; expect(useExecutionStart(kind, { ...wallet(), chain: 'eip155:31337' }).ready).toBe(false);
  });

});

describe('next requests never repeat a recorded submission', () => {
  it('only continues a public swap after a confirmed approval and never retries rejection or uncertainty', () => {
    const runtime = f.stores.public!;
    for (const state of ['PENDING', 'UNKNOWN', 'REJECTED', 'CONFIRMED']) {
      Object.assign(runtime, { available: true, run: { reviewedManifestHash: 'hash', quote: { manifestHash: 'hash' }, attempts: [{ step: 'approval', state }], outcome: null } });
      expect(useExecutionStart('public', wallet()).next).toBe(state === 'CONFIRMED' ? runtime.execute : null);
    }
    (runtime.run as { attempts: unknown[] }).attempts.push({ step: 'swap', state: 'REJECTED' });
    expect(useExecutionStart('public', wallet()).next).toBeNull(); expect(runtime.execute).not.toHaveBeenCalled();
  });
  it('only continues Supply from an actually reconciled approval, never from a recorded Supply', () => {
    const runtime = f.stores.supply!;
    runtime.record = { authorization: 'accepted', verdict: 'PENDING', attempts: [{ step: 'APPROVAL', reconciled: true }] };
    expect(useExecutionStart('supply', wallet()).next).toBe(runtime.execute);
    (runtime.record as { attempts: unknown[] }).attempts.push({ step: 'SUPPLY', reconciled: true });
    expect(useExecutionStart('supply', wallet()).next).toBeNull(); expect(runtime.execute).not.toHaveBeenCalled();
  });
  it('selects the swap rather than repeating a confirmed Mode A approval', () => {
    const runtime = f.stores.modeA!;
    Object.assign(runtime, { request: vi.fn(), reviewAccepted: true, info: { available: true }, verified: { 'step-approve': {}, 'step-swap': {} }, wallet: { account: reviewOwner }, execution: { attempts: [{ stepId: 'step-approve', state: 'CONFIRMED' }], observations: [] } });
    const next = useExecutionStart('fork-swap', { ...wallet(), chain: 'eip155:31337' }).next;
    expect(runtime.request).not.toHaveBeenCalled(); next?.(); expect(runtime.request).toHaveBeenCalledWith('step-swap');
    (runtime.execution as { attempts: unknown[] }).attempts.push({ stepId: 'step-swap', state: 'SUBMISSION_RESULT_UNKNOWN' });
    expect(useExecutionStart('fork-swap', { ...wallet(), chain: 'eip155:31337' }).next).toBeNull();
  });
});

describe('existing composition safe continuation', () => {
  it('only offers the guarded worker for a known recorded transaction and never for unresolved submission', () => {
    const s = f.stores.composition!;
    Object.assign(s, { info: { available: true }, wallet: { account: reviewOwner }, reviewed: true, runWorker: vi.fn(), installNext: vi.fn(), status: { prepared: { executionId: 'composition', compiled: { installation: [] }, installation: [] }, events: [{ level: 'ATTEMPT', step: 'SWAP', state: 'PENDING', transactionHash: '0x' + 'a'.repeat(64) }] } });
    const shared = { ...wallet(), chain: 'eip155:31337' };
    expect(useExecutionStart('composition', shared)).toMatchObject({ next: s.runWorker, nextLabel: 'Verify and continue' });
    expect(s.runWorker).not.toHaveBeenCalled();
    (s.status as { events: { state: string }[] }).events[0]!.state = 'INCONCLUSIVE';
    expect(useExecutionStart('composition', shared).next).toBeNull();
    (s.status as { events: { state: string }[] }).events[0]!.state = 'RECONCILED'; s.recoveryOnly = true;
    expect(useExecutionStart('composition', shared).next).toBeNull();
    s.recoveryOnly = false; expect(useExecutionStart('composition', { ...shared, account: null }).next).toBeNull();
    expect(s.runWorker).not.toHaveBeenCalled();
  });
});

it('preserves composition wallet setup and first worker start before any business attempt exists', () => {
  const s = f.stores.composition!;
  Object.assign(s, { info: { available: true }, wallet: { account: reviewOwner }, reviewed: true, runWorker: vi.fn(), installNext: vi.fn(), status: { prepared: { executionId: 'composition', compiled: { installation: [{}, {}] }, installation: [{ index: 0, hash: '0x' + 'a'.repeat(64) }] }, events: [] } });
  const wallet = { ...reviewFixture().wallet, chain: 'eip155:31337' };
  expect(useExecutionStart('composition', wallet)).toMatchObject({ started: true, next: s.installNext, nextLabel: 'Continue wallet setup' });
  (s.status as { prepared: { installation: unknown[] } }).prepared.installation.push({ index: 1, hash: '0x' + 'b'.repeat(64) });
  expect(useExecutionStart('composition', wallet)).toMatchObject({ started: true, next: s.runWorker, nextLabel: 'Start authorized execution' });
  expect(s.installNext).not.toHaveBeenCalled(); expect(s.runWorker).not.toHaveBeenCalled();
});
