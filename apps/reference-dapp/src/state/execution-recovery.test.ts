// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExecutionLifecycle } from './execution-lifecycle';
import { reviewFixture, reviewOwner } from '../test-utils/review-fixture';
const f = vi.hoisted(() => ({ stores: {} as Record<string, Record<string, unknown>>, workflow: {} as unknown, context: {} as unknown }));
vi.mock('./workflow-store', () => ({ useWorkflow: () => ({ state: { workflow: f.workflow }, context: f.context }) }));
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
vi.mock('./cow-store', () => ({ useCow: () => f.stores.cow }));
beforeEach(() => {
  const fixture = reviewFixture(); f.workflow = fixture.workflow; f.context = fixture.context;
  f.stores = Object.fromEntries(['modeA', 'modeB', 'composition', 'liquidity', 'supply', 'lending', 'router', 'public', 'jupiter', 'solanaPool', 'uniswapPool', 'transfer', 'cow'].map(key => [key, { record: null, run: null, execution: null, prepared: null, status: null, busy: false, requests: [], observe: vi.fn(), reconcile: vi.fn(), recoverKnown: vi.fn(), recoverUnknown: vi.fn(), refresh: vi.fn(), track: vi.fn(), execute: vi.fn(), request: vi.fn(), runWorker: vi.fn() }]));
});
const hash = '0x' + 'a'.repeat(64);
describe('recovery uses existing observation callbacks without sending', () => {
  it('restores and observes a Supply request with unknown hash, without calling execute', () => {
    const fixture = reviewFixture(), s = f.stores.supply!;
    Object.assign(s, { recovered: true, record: { id: 'supply', provenance: 'PUBLIC_TESTNET', review: { workflow: fixture.workflow, account: reviewOwner, chain: 'eip155:84532' }, attempts: [{ step: 'SUPPLY', state: 'SUBMISSION_RESULT_UNKNOWN', transactionHash: null }] } });
    const view = useExecutionLifecycle('supply', fixture.wallet);
    expect(view.started).toBe(true); expect(view.restored).toBe(true); expect(view.recovery.check).toBe(s.observe);
    expect(s.observe).not.toHaveBeenCalled(); view.recovery.check?.(); expect(s.observe).toHaveBeenCalledOnce(); expect(s.execute).not.toHaveBeenCalled();
  });
  it('does not offer an impossible check for a public swap with no submitted hash', () => {
    const fixture = reviewFixture(), s = f.stores.public!;
    Object.assign(s, { ...fixture.source.state, run: { ...('run' in fixture.source.state ? fixture.source.state.run : {}), attempts: [{ step: 'swap', state: 'UNKNOWN', txHash: null }] } });
    expect(useExecutionLifecycle('public', fixture.wallet).recovery.check).toBeNull(); expect(s.execute).not.toHaveBeenCalled();
  });
  it('uses local pool exact-payload discovery, never the wallet request path', () => {
    const s = f.stores.liquidity!; Object.assign(s, { recoveryOnly: true, prepared: { executionId: 'pool', owner: reviewOwner }, status: { journal: { attempts: [{ state: 'SUBMISSION_RESULT_UNKNOWN' }] }, transactionHash: null } });
    const view = useExecutionLifecycle('fork-pool', { ...reviewFixture().wallet, chain: 'eip155:31337' });
    expect(view.recovery.check).toBe(s.recoverUnknown); expect(s.recoverUnknown).not.toHaveBeenCalled(); view.recovery.check?.(); expect(s.request).not.toHaveBeenCalled();
  });
  it('reconciles the existing delegated transaction instead of running its worker again', () => {
    const s = f.stores.modeB!; Object.assign(s, { recoveryOnly: true, status: { prepared: { executionId: 'worker', compiled: { installation: [], permission: { owner: reviewOwner } }, installation: [], installationStart: 0, executionHash: hash, reconciliation: null } } });
    const view = useExecutionLifecycle('delegated-swap', { ...reviewFixture().wallet, chain: 'eip155:31337' });
    expect(view.recovery.check).toBe(s.reconcile); view.recovery.check?.(); expect(s.runWorker).not.toHaveBeenCalled();
  });
  it('uses only known-receipt recovery for reviewed composition uncertainty and falls back to recorded status on restart', () => {
    const s = f.stores.composition!; Object.assign(s, { reviewed: true, retired: false, recoveryOnly: false, status: { prepared: { executionId: 'composition', compiled: { installation: [], permission: { owner: reviewOwner } }, installation: [] }, events: [{ level: 'ATTEMPT', step: 'SWAP', state: 'INCONCLUSIVE', transactionHash: hash }] } });
    const wallet = { ...reviewFixture().wallet, chain: 'eip155:31337' };
    expect(useExecutionLifecycle('composition', wallet).recovery.check).toBe(s.recoverKnown);
    expect(s.recoverKnown).not.toHaveBeenCalled(); s.recoveryOnly = true;
    expect(useExecutionLifecycle('composition', wallet).recovery.check).toBe(s.refresh); expect(s.runWorker).not.toHaveBeenCalled();
  });
  it('preserves signed order tracking and settlement verification, with no new signing or posting', () => {
    const s = f.stores.cow!; Object.assign(s, { recoveryOnly: true, execution: { record: { executionId: 'cow', postingAttemptId: 'post', postCount: 1, state: 'OPEN', quote: { chainId: 'eip155:31337', owner: reviewOwner } } } });
    const wallet = { ...reviewFixture().wallet, chain: 'eip155:31337' };
    expect(useExecutionLifecycle('unavailable', wallet).recovery.check).toBe(s.track);
    (s.execution as { record: { state: string } }).record.state = 'RECONCILIATION_REQUIRED';
    expect(useExecutionLifecycle('unavailable', wallet).recovery.check).toBe(s.reconcile); expect(s.execute).not.toHaveBeenCalled();
  });
});
