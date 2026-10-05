// SPDX-License-Identifier: AGPL-3.0-only
/** Connection-only Phantom inspection. No signature, sign-in, send or network-switch request. */
import { connectSolanaWallet, solanaWallets, type SolanaSession } from '../wallet/solana-wallet';
import { guardPrivacyWallet } from './wallet-guard';
import { ownerDepositReadRpc } from './owner-proof-rpc';
import { CLOAK_RUNTIME } from './cloak-adapter';

export function detectProofPhantom() {
  const injected = typeof window === 'undefined' ? undefined : window as unknown as {
    phantom?: { solana?: { isPhantom?: boolean } }; solana?: { isPhantom?: boolean };
  };
  return { walletStandard: solanaWallets('solana:mainnet').filter(w => w.name === 'Phantom').length,
    injected: injected?.phantom?.solana?.isPhantom === true || injected?.solana?.isPhantom === true };
}
export type OwnerProofWalletCheck = { session: SolanaSession; owner: string; network: 'solana:mainnet';
  genesisHash: string; assertCurrent(): void; close(): void };
type Events = { on(event: 'change', callback: (event: { accounts?: unknown; chains?: unknown; features?: unknown }) => void): () => void };
export async function connectProofPhantom(owner: string, invalidate: () => void): Promise<OwnerProofWalletCheck> {
  // Explicit name selection never falls back to another injected wallet. Connection alone is permitted while finance is disabled.
  const session = await connectSolanaWallet('Phantom', 'solana:mainnet', 'CLOAK_DEPOSIT');
  if (session.account.address !== owner) throw new Error('CLOAK_DEPOSIT_OWNER_CHANGED');
  const guard = guardPrivacyWallet(session);
  const events = session.wallet.features['standard:events'] as Events;
  const off = events.on('change', e => { if (e.accounts !== undefined || e.chains !== undefined || e.features !== undefined) invalidate(); });
  let closed = false;
  const close = () => { if (!closed) { closed = true; off(); guard.close(); } };
  try {
    guard.assertCurrent();
    const genesisHash = await ownerDepositReadRpc().getGenesisHash().send();
    if (genesisHash !== CLOAK_RUNTIME.genesisHash) throw new Error('CLOAK_RPC_GENESIS_CHANGED');
    guard.assertCurrent();
    return { session, owner, network: 'solana:mainnet', genesisHash, close,
      assertCurrent() { if (closed || session.account.address !== owner) throw new Error('CLOAK_OWNER_CHANGED'); guard.assertCurrent(); } };
  } catch (error) { close(); throw error; }
}
