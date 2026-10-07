// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeApprove, toHex } from '@defi-workflow-engine/reference-compiler';
import { reviewFixture, reviewOwner, reviewSpender } from '../test-utils/review-fixture';
import { useReviewAuthorization } from './review-authorization';

const f = vi.hoisted(() => ({ stores: {} as Record<string, Record<string, unknown>>, state: undefined as unknown }));
// A minimal hook runner keeps the shell's binding state across wallet events.
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => {
  if (f.state === undefined) f.state = initial;
  return [f.state, (value: unknown) => { f.state = value; }];
} }));
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
vi.mock('./across-store', () => ({ useAcross: () => f.stores.across }));
vi.mock('./build009-wallet-store', () => ({ useBuild009Wallet: () => f.stores.wallet }));
vi.mock('./capability-store', () => ({ useExecutionEnvironment: () => f.stores.environment }));
beforeEach(() => {
  f.state = undefined;
  f.stores = Object.fromEntries(['modeA', 'modeB', 'composition', 'liquidity', 'supply', 'lending', 'router', 'public', 'jupiter', 'solanaPool', 'uniswapPool', 'transfer', 'across'].map(key => [key, { record: null, run: null, prepared: null, status: null, info: null, busy: false, retired: false }]));
  f.stores.wallet = { account: reviewOwner, chainId: '0x14a34' };
  f.stores.environment = { walletKind: 'evm', walletEnvironment: 'testnet', walletChain: '0x14a34' };
});
function supply() {
  const fixture = reviewFixture(), asset = fixture.context.assets.USDC.asset;
  if (!('address' in asset)) throw Error('fixture');
  f.stores.supply = { record: { id: 'review-one', authorization: null, attempts: [], verdict: 'PENDING', review: {
    ...fixture, manifest: fixture.manifest, policy: fixture.policy, commitment: 'review-one', asset: asset.address, chain: asset.chainId,
    transactions: [{ to: asset.address, data: toHex(encodeApprove(reviewSpender, 100000000n)) }],
  } }, busy: false, retired: false, review: vi.fn(), execute: vi.fn() };
  return fixture;
}
describe('shared wallet and existing Review capability', () => {
  it('uses the existing store Review callback, actual wallet and shared environment without exposing Execute', () => {
    supply(); const result = useReviewAuthorization('supply');
    expect(result.authorization.approve).toBe(f.stores.supply!.review);
    expect(result.authorization).not.toHaveProperty('execute'); expect(result.authorization.ready).toBe(true);
    expect(result.wallet).toEqual({ account: reviewOwner, chain: 'eip155:84532', environment: 'testnet', changed: false });
    expect(result.authorization.approvals).toMatchObject([{ amount: '100000000', kind: 'exact', spender: reviewSpender }]);
  });
  it('latches a wallet change across stage navigation and switching back until a fresh simulation binding exists', () => {
    supply(); useReviewAuthorization('supply');
    f.stores.wallet!.account = reviewSpender;
    expect(useReviewAuthorization('supply').wallet).toMatchObject({ account: reviewSpender, changed: true });
    f.stores.wallet!.account = reviewOwner;
    expect(useReviewAuthorization('supply').wallet.changed).toBe(true);
    (f.stores.supply!.record as { id: string }).id = 'fresh-simulation';
    expect(useReviewAuthorization('supply').wallet.changed).toBe(false);
  });
  it('latches a signing-provider change for the same address and chain (MetaMask → Rabby needs a fresh Review)', () => {
    f.stores.wallet!.provider = { key: 'io.metamask', name: 'MetaMask', icon: null };
    supply(); expect(useReviewAuthorization('supply').wallet.changed).toBe(false);
    f.stores.wallet!.provider = { key: 'io.rabby', name: 'Rabby Wallet', icon: null };
    expect(useReviewAuthorization('supply').wallet).toMatchObject({ account: reviewOwner, chain: 'eip155:84532', changed: true });
    f.stores.wallet!.provider = { key: 'io.metamask', name: 'MetaMask', icon: null };
    expect(useReviewAuthorization('supply').wallet.changed).toBe(true);
  });
  it('reflects chain changes and never infers Mainnet for an unknown chain', () => {
    supply(); useReviewAuthorization('supply');
    f.stores.wallet!.chainId = '0xa4b1'; f.stores.environment!.walletEnvironment = 'mainnet';
    expect(useReviewAuthorization('supply').wallet).toMatchObject({ chain: 'eip155:42161', environment: 'mainnet', changed: true });
    f.stores.wallet!.chainId = '0xdead'; f.stores.environment!.walletEnvironment = 'unknown';
    expect(useReviewAuthorization('supply').wallet).toMatchObject({ chain: null, environment: 'unknown', changed: true });
  });
  it('uses the connected Solana session and ignores changes to an inactive EVM wallet', () => {
    f.stores.environment = { walletKind: 'solana', walletEnvironment: 'testnet', walletChain: 'solana:devnet' };
    f.stores.jupiter!.session = { account: { address: 'solanaConnectedAccount' }, chain: 'solana:devnet' };
    expect(useReviewAuthorization('unavailable').wallet).toMatchObject({ account: 'solanaConnectedAccount', chain: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', environment: 'testnet' });
    f.stores.wallet!.chainId = '0x2105';
    expect(useReviewAuthorization('unavailable').wallet.changed).toBe(false);
  });
  it('normalizes a Solana wallet chain while preserving network-change invalidation', () => {
    f.stores.environment = { walletKind: 'solana', walletEnvironment: 'mainnet', walletChain: 'solana:mainnet' };
    f.stores.jupiter!.session = { account: { address: 'solanaConnectedAccount' }, chain: 'solana:mainnet' };
    expect(useReviewAuthorization('unavailable').wallet).toMatchObject({ chain: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', changed: false });
    f.stores.environment!.walletChain = 'solana:devnet';
    expect(useReviewAuthorization('unavailable').wallet).toMatchObject({ chain: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', changed: true });
    f.stores.environment!.walletChain = 'solana:mainnet';
    expect(useReviewAuthorization('unavailable').wallet.changed).toBe(true);
    f.stores.environment!.walletChain = 'solana:unknown';
    expect(useReviewAuthorization('unavailable').wallet).toMatchObject({ chain: null, changed: true });
  });
  it('does not infer readiness for a retired Review, busy store or a workflow with no supported Review handler', () => {
    supply(); f.stores.supply!.retired = true; expect(useReviewAuthorization('supply').authorization.ready).toBe(false);
    f.stores.supply!.retired = false; f.stores.supply!.busy = true; expect(useReviewAuthorization('supply').authorization.ready).toBe(false);
    expect(useReviewAuthorization('unavailable').authorization).toMatchObject({ ready: false, approve: null });
  });
});
