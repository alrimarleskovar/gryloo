// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-AUTOMATION-002 × BUILD-EXECUTION-CONTINUITY-001 (PR #76): browser-held delegated requests bind to the shared wallets' semantic
 * authority epoch, never to a second identity model. These are a prepared Credential enrollment awaiting its wallet signature and an open
 * Authorization Review awaiting the passkey.
 *
 *   EVM     `useBuild009Wallet().revision` advances only on a genuine provider, account or chain transition and on disconnect. Passive
 *           `eth_accounts`/`eth_chainId` reads, duplicate wallet events and transaction-completion syncs keep it.
 *   Solana  the shared Wallet Standard session's wallet and address, counted monotonically so changing A → B → A never matches again.
 *
 * Persisted delegated authority (an active grant, a signed workflow authorization) is NOT bound to this epoch: it exists to act while the
 * owner is offline and ends only by revocation, expiry, exhausted scope or a workflow change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useJupiter } from '../state/jupiter-store';

export function useWalletAuthorityEpoch(): { readonly epoch: string; readonly read: () => string } {
  const evm = useBuild009Wallet(), solana = useJupiter();
  const solanaKey = solana.session ? `${solana.session.wallet.name}\n${solana.session.account.address}` : '';
  const [solanaEpoch, setSolanaEpoch] = useState({ key: solanaKey, n: 0 });
  // Derived from the previous render (React's documented pattern): every committed Solana identity change counts once, forever.
  const n = solanaEpoch.key === solanaKey ? solanaEpoch.n : solanaEpoch.n + 1;
  if (solanaEpoch.key !== solanaKey) setSolanaEpoch({ key: solanaKey, n });
  const epoch = `${evm.revision}:${n}`;
  const latest = useRef(epoch);
  useEffect(() => { latest.current = epoch; }, [epoch]);
  return { epoch, read: useCallback(() => latest.current, []) };
}
