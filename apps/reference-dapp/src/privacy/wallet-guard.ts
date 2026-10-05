// SPDX-License-Identifier: AGPL-3.0-only
import type { SolanaSession } from '../wallet/solana-wallet';
type Events = { on(event: 'change', callback: (event: { accounts?: readonly { address: string }[]; chains?: readonly string[]; features?: unknown }) => void): () => void };
/** Latches any session change, including a change away and back. Guard every asynchronous boundary. */
export function guardPrivacyWallet(session: SolanaSession): { assertCurrent(): void; close(): void } {
  const wallet = session.wallet, owner = session.account.address;
  const events = wallet.features['standard:events'] as Events | undefined;
  const signingAvailable = () => typeof (wallet.features['solana:signMessage'] as { signMessage?: unknown } | undefined)?.signMessage === 'function' &&
    typeof (wallet.features['solana:signTransaction'] as { signTransaction?: unknown } | undefined)?.signTransaction === 'function';
  if (!events || typeof events.on !== 'function' || !signingAvailable() || !wallet.chains.includes('solana:mainnet') ||
      session.chain !== 'solana:mainnet' || !session.account.chains.includes('solana:mainnet') ||
      !session.account.features.includes('solana:signMessage') || !session.account.features.includes('solana:signTransaction'))
    throw new Error('CLOAK_OWNER_WALLET_UNSUPPORTED');
  let changed = false;
  const unsubscribe = events.on('change', event => { if (event.accounts || event.chains || event.features) changed = true; });
  return {
    assertCurrent() {
      const current = wallet.accounts[0];
      if (changed || session.wallet !== wallet || session.account.address !== owner || session.chain !== 'solana:mainnet' ||
          !signingAvailable() || wallet.accounts.length !== 1 || current?.address !== owner || !current?.chains.includes('solana:mainnet') ||
          !current.features.includes('solana:signMessage') || !current.features.includes('solana:signTransaction')) throw new Error('CLOAK_OWNER_CHANGED');
    },
    close: unsubscribe,
  };
}
