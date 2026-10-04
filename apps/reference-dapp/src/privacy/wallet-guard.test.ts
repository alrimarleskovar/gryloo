// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest';
import { guardPrivacyWallet } from './wallet-guard';
import type { SolanaSession } from '../wallet/solana-wallet';
it('latches owner changes away and back instead of accepting a matching final address', () => {
  let change: (e: { accounts?: { address: string }[] }) => void = () => undefined;
  const unsubscribe = vi.fn();
  const account = { address: 'owner', chains: ['solana:mainnet'], features: ['solana:signMessage', 'solana:signTransaction'] };
  const session: SolanaSession = { chain: 'solana:mainnet', account, wallet: { name: 'owner wallet', chains: ['solana:mainnet'], accounts: [account],
    features: { 'solana:signMessage': { signMessage: vi.fn() }, 'solana:signTransaction': { signTransaction: vi.fn() },
      'standard:events': { on: (event: string, callback: typeof change) => { expect(event).toBe('change'); change = callback; return unsubscribe; } } } } };
  const guard = guardPrivacyWallet(session); guard.assertCurrent();
  change({ accounts: [{ address: 'other' }] }); change({ accounts: [{ address: 'owner' }] });
  expect(() => guard.assertCurrent()).toThrow('CLOAK_OWNER_CHANGED'); guard.close(); expect(unsubscribe).toHaveBeenCalledOnce();
});
it('refuses wallets without both signing features and a change subscription', () => {
  const session = { chain: 'solana:mainnet', account: { chains: ['solana:mainnet'], features: ['solana:signTransaction'] }, wallet: { features: {} } };
  expect(() => guardPrivacyWallet(session as unknown as SolanaSession)).toThrow('CLOAK_OWNER_WALLET_UNSUPPORTED');
});
it('binds the original owner even if a wallet mutates account data without an event', () => {
  const account = { address: 'owner', chains: ['solana:mainnet'], features: ['solana:signMessage', 'solana:signTransaction'] };
  const session: SolanaSession = { chain: 'solana:mainnet', account, wallet: { name: 'owner wallet', chains: ['solana:mainnet'], accounts: [account],
    features: { 'solana:signMessage': { signMessage: vi.fn() }, 'solana:signTransaction': { signTransaction: vi.fn() },
      'standard:events': { on: () => () => undefined } } } };
  const guard = guardPrivacyWallet(session); account.address = 'other';
  expect(() => guard.assertCurrent()).toThrow('CLOAK_OWNER_CHANGED'); guard.close();
});
