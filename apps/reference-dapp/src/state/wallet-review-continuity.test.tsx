// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Build009WalletProvider, useBuild009Wallet } from './build009-wallet-store';
import { useReviewAuthorization } from './review-authorization';
import { HookHarness } from '../test-utils/hook-harness';
import { reviewFixture, reviewNow, reviewOwner, reviewSpender } from '../test-utils/review-fixture';
import { projectReview } from '../domain/review-presentation';
import { canContinueExecution } from '../domain/execution-presentation';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as routerProfile } from '@defi-workflow-engine/action-registry';
import { createRouterHarness } from '../../e2e/router-harness';
import { createRouterService } from '../server/router-service';
import { createRouterNode } from '../domain/router-authoring';
import { createAuthoredLending } from '../domain/lending-authoring';
import { createLendingHarness, OWNER } from '../../e2e/lending-harness.mjs';
import { createLendingCompositionService } from '../server/lending-composition-service';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await import('../test-utils/hook-harness')).hookMocks }));
const f = vi.hoisted(() => ({ supply: {} as Record<string, unknown>, router: {} as Record<string, unknown>, lending: {} as Record<string, unknown>, kind: 'supply' as 'supply' | 'router' | 'lending', restorationEpoch: 0 }));
vi.mock('./workflow-store', () => ({ useWorkflow: () => ({ restorationEpoch: f.restorationEpoch }) }));
vi.mock('./capability-store', () => ({ useExecutionEnvironment: () => ({ walletKind: 'evm', walletEnvironment: 'testnet' }) }));
vi.mock('./supply-store', () => ({ useSupply: () => f.supply }));
vi.mock('./mode-a-store', () => ({ useModeA: () => ({}) }));
vi.mock('./mode-b-store', () => ({ useModeB: () => ({}) }));
vi.mock('./composition-store', () => ({ useComposition: () => ({}) }));
vi.mock('./liquidity-store', () => ({ useLiquidity: () => ({}) }));
vi.mock('./lending-store', () => ({ useLending: () => f.lending }));
vi.mock('./router-store', () => ({ useRouter: () => f.router }));
vi.mock('./public-testnet-store', () => ({ usePublicTestnet: () => ({}) }));
vi.mock('./jupiter-store', () => ({ useJupiter: () => ({}) }));
vi.mock('./solana-liquidity-store', () => ({ useSolanaLiquidity: () => ({}) }));
vi.mock('./uniswap-liquidity-store', () => ({ useUniswapLiquidity: () => ({}) }));
vi.mock('./robinhood-transfer-store', () => ({ useRobinhoodTransfer: () => ({}) }));
vi.mock('./across-store', () => ({ useAcross: () => ({}) }));
vi.mock('../components/wallet-selector', async () => {
  const { evmWalletEntries } = await import('../wallet/evm-discovery');
  return { useWalletSelector: () => ({ choose: async () => evmWalletEntries()[0]?.choice ?? null }) };
});
function provider() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const state = { account: reviewOwner, chain: '0x14a34' };
  return { state, request: vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? state.chain : [state.account]),
    on(event: string, listener: (...args: unknown[]) => void) { const set = listeners.get(event) ?? new Set(); set.add(listener); listeners.set(event, set); },
    removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
    emit(event: string, ...args: unknown[]) { for (const listener of listeners.get(event) ?? []) listener(...args); } };
}
let host: HookHarness, source: ReturnType<typeof provider>, target: EventTarget;
let wallet: ReturnType<typeof useBuild009Wallet>, binding: ReturnType<typeof useReviewAuthorization>;
let fixture: ReturnType<typeof reviewFixture>;
function Probe() { wallet = useBuild009Wallet(); binding = useReviewAuthorization(f.kind); return null; }
const read = () => host.render(() => renderToStaticMarkup(<Build009WalletProvider><Probe/></Build009WalletProvider>));
async function settle() { await Promise.resolve(); await Promise.resolve(); read(); }
function accept() {
  fixture = reviewFixture();
  f.supply = { busy: false, retired: false, review: vi.fn(), record: { id: 'simulation-one', authorization: 'commitment-one', attempts: [], verdict: 'PENDING',
    review: { manifest: fixture.manifest, policy: fixture.policy, commitment: 'commitment-one', asset: reviewSpender, chain: 'eip155:84532', transactions: [] } } };
  read();
}
const review = (now = reviewNow) => projectReview(fixture.workflow, fixture.context, fixture.source, binding.authorization, binding.wallet, now);
beforeEach(async () => {
  f.supply = {}; f.router = {}; f.lending = {}; f.kind = 'supply'; f.restorationEpoch = 0;
  host = new HookHarness(); source = provider();
  target = Object.assign(new EventTarget(), { ethereum: source, setTimeout, clearTimeout }); vi.stubGlobal('window', target);
  read(); await settle(); accept(); expect(review().bindingValid).toBe(true);
});
afterEach(() => { host.unmount(); vi.unstubAllGlobals(); });

describe('real shared wallet → accepted Review authority', () => {
  it('preserves accepted Review across passive rereads and duplicate account/chain events', async () => {
    const revision = wallet.revision;
    for (let i = 0; i < 3; i++) {
      await wallet.session(); read(); expect(review().bindingValid).toBe(true);
      source.emit('connect'); await settle(); expect(review().bindingValid).toBe(true);
      source.emit('accountsChanged', [reviewOwner]); read(); expect(review().bindingValid).toBe(true);
      await settle(); source.emit('chainChanged', '0x14a34'); read(); expect(review().bindingValid).toBe(true);
    }
    expect(wallet.revision).toBe(revision);
    expect(source.request.mock.calls.every(([request]) => ['eth_accounts', 'eth_chainId'].includes(request.method))).toBe(true);
  });
  it('preserves consumed Review binding for explicit next-request eligibility after synchronization', async () => {
    (f.supply.record as { attempts: unknown[] }).attempts.push({ reconciled: true }); read();
    expect(binding.authorization.ready).toBe(false); expect(review().bindingValid).toBe(true);
    source.emit('accountsChanged', [reviewOwner]); source.emit('chainChanged', '0x14a34'); await settle();
    const next = vi.fn();
    expect(canContinueExecution({ ...fixture, ...binding, execution: { started: true, ready: true, start: null, next, expiresAt: null, prompt: null, requiresMainnetAcknowledgement: false } }, reviewNow)).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });
  it('preserves authority when discovery names the same provider and account/chain spelling is normalized', async () => {
    const revision = wallet.revision;
    target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: source, info: { rdns: 'io.metamask', name: 'MetaMask' } } }));
    source.emit('chainChanged', '0x014A34'); await settle();
    expect(wallet.provider?.key).toBe('io.metamask'); expect(wallet.revision).toBe(revision); expect(review().bindingValid).toBe(true);
  });
  it('invalidates a new provider object even when both providers announce the same display key', async () => {
    target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: source, info: { rdns: 'io.metamask' } } }));
    await settle(); const revision = wallet.revision;
    const replacement = provider();
    target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: replacement, info: { rdns: 'io.metamask' } } }));
    const { evmWalletEntries } = await import('../wallet/evm-discovery');
    await wallet.connectWith(evmWalletEntries().find(entry => entry.provider === replacement)!.choice.id); await settle();
    expect(wallet).toMatchObject({ account: reviewOwner, chainId: '0x14a34', provider: { key: 'io.metamask' } });
    expect(wallet.revision).toBeGreaterThan(revision); expect(review().bindingValid).toBe(false);
  });
  it.each(['account', 'chain', 'provider', 'disconnect', 'reset'] as const)('irreversibly invalidates %s transitions even when the round trip is batched before render', async change => {
    const revision = wallet.revision;
    if (change === 'account') { source.emit('accountsChanged', [reviewSpender]); source.emit('accountsChanged', [reviewOwner]); }
    if (change === 'chain') { source.emit('chainChanged', '0x1'); source.emit('chainChanged', '0x14a34'); }
    if (change === 'provider') {
      const replacement = provider();
      target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: replacement, info: { rdns: 'io.metamask' } } }));
      const { evmWalletEntries } = await import('../wallet/evm-discovery');
      await wallet.connectWith(evmWalletEntries().find(entry => entry.provider === replacement)!.choice.id);
    }
    if (change === 'disconnect') { source.emit('disconnect'); source.emit('connect'); }
    if (change === 'reset') { wallet.reset(); await wallet.connect(); }
    await settle();
    expect(wallet).toMatchObject({ account: reviewOwner, chainId: '0x14a34' }); expect(wallet.revision).toBeGreaterThan(revision);
    expect(review().bindingValid).toBe(false); expect(binding.wallet.changed).toBe(true);
    await wallet.session(); await settle(); expect(review().bindingValid).toBe(false);
    (f.supply.record as { id: string }).id = 'fresh-simulation'; read(); expect(review().bindingValid).toBe(true);
  });
  it('does not renew workflow restoration or expiry through passive synchronization', async () => {
    f.restorationEpoch++; read(); source.emit('connect'); await settle(); expect(review().bindingValid).toBe(false);
    (f.supply.record as { id: string }).id = 'fresh-simulation'; read(); expect(review().bindingValid).toBe(true);
    expect(review(reviewNow + 120_001).bindingValid).toBe(false);
  });

  // Exercise the existing protocol harnesses honestly as MOCKED. Their service
  // authority and the real shared-wallet binding are checked together; this does
  // not grant mocked evidence permission to execute through the product UI.
  it('router/testnet harness continues approval → deposit under the same shared wallet authority without replay after recovery', async () => {
    const h = createRouterHarness({ profile: routerProfile, owner: reviewOwner });
    const dir = await mkdtemp(join(tmpdir(), 'continuity-router-'));
    const input = { storage: createFileExecutionStorage(dir, 'ROUTER_BUSY'), sourceRpc: h.baseRpc, destinationRpc: h.arbitrumRpc,
      providers: h.providers, provenance: 'MOCKED' as const, executionEnabled: true, now: h.clock, mockedCodePins: h.codePins, profile: routerProfile };
    const service = createRouterService(input);
    const workflow: SemanticWorkflow = { schemaVersion: '1.0.0', workflowId: 'continuity-bridge', revision: 0, resourceEdges: [],
      nodes: [createRouterNode('bridge', { source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '1', recipient: '', slippage: '50', routing: 'AUTO' })] };
    let record = await service.simulate(workflow, reviewOwner);
    record = await service.review(record.id, record.review.commitment, workflow);
    f.kind = 'router'; f.router = { record }; read();
    expect(binding.authorization.accepted).toBe(true); expect(binding.wallet.changed).toBe(false);
    const revision = wallet.revision, key = binding.authorization.key;
    const first = await service.begin(record.id, reviewOwner, workflow); await service.handoff(record.id);
    await service.report(record.id, { kind: 'HASH', hash: h.wallet.send(first.transaction) });
    record = await service.observe(record.id); f.router.record = record; read();
    expect(record.attempts.at(-1)).toMatchObject({ step: 'APPROVAL', state: 'CONFIRMED', reconciled: true });
    source.emit('connect'); source.emit('accountsChanged', [reviewOwner]); source.emit('chainChanged', '0x14a34'); await settle();
    expect(binding.wallet.changed).toBe(false); expect(binding.authorization).toMatchObject({ key, accepted: true }); expect(wallet.revision).toBe(revision);
    const recovered = createRouterService(input);
    for (let i = 0; i < 2; i++) await recovered.observe(record.id);
    expect(h.counters.sends).toBe(1); expect((await recovered.load(record.id)).attempts).toHaveLength(1);
    const second = await recovered.begin(record.id, reviewOwner, workflow);
    expect(second.record.attempts.at(-1)?.step).toBe('DEPOSIT'); expect(h.counters.sends).toBe(1);
    await expect(recovered.begin(record.id, reviewOwner, workflow)).rejects.toThrow('ROUTER_ATTEMPT_ACTIVE_OBSERVE_EXISTING');
    await recovered.handoff(record.id); await recovered.report(record.id, { kind: 'HASH', hash: h.wallet.send(second.transaction) });
    for (let i = 0; i < 20; i++) { h.advance(5); record = await recovered.observe(record.id); if (record.phase === 'RECONCILED') break; }
    expect(record).toMatchObject({ phase: 'RECONCILED', evidence: { evidenceClass: 'MOCKED', bundle: { environment: 'MOCKED', outcome: 'RECONCILED' } } });
    expect(h.counters.sends).toBe(2);
  });

  it('Aave lending harness keeps the shared Review through five explicit requests and never repeats a confirmed step', async () => {
    source.state.account = OWNER; source.emit('accountsChanged', [OWNER]); await settle();
    const model = createLendingHarness(), dir = await mkdtemp(join(tmpdir(), 'continuity-lending-'));
    const input = { rpc: model.rpc, journalDir: dir, provenance: 'MOCKED' as const };
    const service = createLendingCompositionService(input);
    const workflow = createAuthoredLending('continuity-lending', 0, { supply: '0.1', borrow: '0.01', slippage: '50', owner: OWNER });
    let record = await service.simulate(workflow, OWNER); record = await service.review(record.id, record.reviews[0]!.commitment, workflow);
    f.kind = 'lending'; f.lending = { record }; read();
    const revision = wallet.revision, key = binding.authorization.key;
    for (const [index, step] of ['POOL_APPROVAL', 'SUPPLY', 'BORROW', 'ROUTER_APPROVAL', 'SWAP'].entries()) {
      expect(binding.authorization).toMatchObject({ key, accepted: true }); expect(binding.wallet.changed).toBe(false);
      const recovered = createLendingCompositionService(input), begin = await recovered.begin(record.id, OWNER, workflow);
      expect(begin.record.attempts.at(-1)?.step).toBe(step); expect(model.transactions).toHaveLength(index);
      await expect(recovered.begin(record.id, OWNER, workflow)).rejects.toThrow();
      await recovered.handoff(record.id, begin.attemptId);
      const hash = await model.rpc('MOCK_submit', [begin.transaction]) as string;
      await recovered.report(record.id, begin.attemptId, { kind: 'HASH', hash }); record = await recovered.observe(record.id);
      expect(record.attempts.at(-1)).toMatchObject({ step, state: 'CONFIRMED', reconciled: true });
      f.lending.record = record; read(); source.emit('connect'); source.emit('accountsChanged', [OWNER]); source.emit('chainChanged', '0x14a34'); await settle();
      await recovered.observe(record.id); expect(model.transactions).toHaveLength(index + 1); expect(wallet.revision).toBe(revision);
    }
    expect(binding.wallet.changed).toBe(false);
    expect(record).toMatchObject({ status: 'COMPLETED', evidence: { bundle: { environment: 'MOCKED', outcome: 'RECONCILED' } } });
    expect(model.transactions).toHaveLength(5);
  });
});
