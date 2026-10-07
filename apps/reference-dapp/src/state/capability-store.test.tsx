// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExecutionEnvironment } from './capability-store';

const fixture = vi.hoisted(() => ({
  wallet: { account: null as string | null, chainId: null as string | null },
  jupiter: { session: null as { chain: string; account: { chains: string[] } } | null, recovered: false, record: null },
  nodes: [] as { chainId: string; actionType: string }[], forkPrepared: false,
}));
vi.mock('./build009-wallet-store', () => ({ useBuild009Wallet: () => fixture.wallet }));
vi.mock('./jupiter-store', () => ({ useJupiter: () => fixture.jupiter }));
vi.mock('./workflow-store', () => ({ useWorkflow: () => ({ state: { workflow: { nodes: fixture.nodes } } }) }));
vi.mock('./mode-a-store', () => ({ useModeA: () => ({ prepared: fixture.forkPrepared }) }));
vi.mock('./mode-b-store', () => ({ useModeB: () => ({}) }));
vi.mock('./composition-store', () => ({ useComposition: () => ({}) }));
vi.mock('./liquidity-store', () => ({ useLiquidity: () => ({}) }));
vi.mock('./cow-store', () => ({ useCow: () => ({}) }));
vi.mock('./public-testnet-store', () => ({ usePublicTestnet: () => ({}) }));
vi.mock('./lending-store', () => ({ useLending: () => ({}) }));
vi.mock('./supply-store', () => ({ useSupply: () => ({}) }));
vi.mock('./robinhood-transfer-store', () => ({ useRobinhoodTransfer: () => ({}) }));
vi.mock('./solana-liquidity-store', () => ({ useSolanaLiquidity: () => ({}) }));

function readSource() {
  let source!: ReturnType<typeof useExecutionEnvironment>;
  function Probe() { source = useExecutionEnvironment(); return null; }
  renderToStaticMarkup(createElement(Probe));
  return source;
}
beforeEach(() => {
  fixture.wallet = { account: null, chainId: null }; fixture.jupiter.session = null;
  fixture.nodes = []; fixture.forkPrepared = false;
});
describe('shared reactive wallet environment source', () => {
  it('follows wallet changes rather than a workflow network or independent manual preference', () => {
    fixture.nodes = [{ chainId: 'eip155:84532', actionType: 'supply' }];
    fixture.wallet = { account: 'connected', chainId: '0x2105' };
    expect(readSource()).toMatchObject({ walletEnvironment: 'mainnet', environment: 'MAINNET' });
    fixture.wallet.chainId = '0x66eee';
    expect(readSource()).toMatchObject({ walletEnvironment: 'testnet', environment: 'PUBLIC_TESTNET' });
    expect(readSource()).not.toHaveProperty('selectEnvironment');
  });
  it('never classifies a disconnected, stale or unsupported EVM network as public mainnet', () => {
    fixture.wallet.chainId = '0x2105';
    expect(readSource().walletEnvironment).toBe('unknown');
    fixture.wallet.account = 'connected'; fixture.wallet.chainId = '0x89';
    expect(readSource()).toMatchObject({ walletEnvironment: 'unknown', environment: 'MOCK' });
    fixture.forkPrepared = true;
    expect(readSource()).toMatchObject({ walletEnvironment: 'unknown', environment: 'LOCAL_FORK' });
  });
  it('uses the connected Solana session cluster, even when the authored cluster differs', () => {
    fixture.nodes = [{ chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', actionType: 'asset.swap.exact-input' }];
    expect(readSource().walletEnvironment).toBe('unknown');
    fixture.jupiter.session = { chain: 'solana:devnet', account: { chains: ['solana:devnet', 'solana:mainnet'] } };
    expect(readSource()).toMatchObject({ walletEnvironment: 'testnet', environment: 'PUBLIC_TESTNET', walletKind: 'solana' });
    fixture.jupiter.session.chain = 'solana:mainnet';
    expect(readSource()).toMatchObject({ walletEnvironment: 'mainnet', environment: 'MAINNET' });
    fixture.jupiter.session.account.chains = [];
    expect(readSource().walletEnvironment).toBe('unknown');
  });
  it('uses the active Solana session when both wallet families are connected', () => {
    fixture.wallet = { account: 'connected', chainId: '0x2105' };
    fixture.nodes = [{ chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', actionType: 'asset.swap.exact-input' }];
    fixture.jupiter.session = { chain: 'solana:devnet', account: { chains: ['solana:devnet'] } };
    expect(readSource().walletEnvironment).toBe('testnet');
  });
});
