// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-MCP-002: chain-neutral wallet proof in the browser. EVM: the injected wallet signs the EIP-4361 sign-in message
 * (`personal_sign`). Solana: the chosen Wallet Standard wallet signs the Sign-In With Solana message (`solana:signMessage`). The
 * server verifies the signature and sets the HttpOnly session; the browser never holds a session token. Nothing here signs a
 * transaction or moves funds.
 */
import { useCallback, useEffect, useState } from 'react';
import { solanaSessionStatus, solanaSignIn, solanaSignInChallenge, walletSessionStatus, walletSignIn, walletSignInChallenge } from '../app/wallet-session-action';
import { injectedProvider } from '../wallet/eip1193';
import { connectSolanaWallet, signSolanaMessage, solanaWalletNames, type SolanaWalletChain } from '../wallet/solana-wallet';

export type Namespace = 'eip155' | 'solana';
const utf8Hex = (text: string) => '0x' + Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('');
function unwrap<T>(result: { ok: true; value: T } | { ok: false; code: string }): T { if (!result.ok) throw new Error(result.code); return result.value; }
const codeOf = (cause: unknown) => cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : 'WALLET_REQUEST_FAILED';

export function useWalletProof(namespace: Namespace | null, chain: SolanaWalletChain = 'solana:devnet') {
  const [proven, setProven] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solanaNames, setSolanaNames] = useState<string[]>([]);
  const refresh = useCallback(async () => {
    if (namespace === 'solana') setProven((await solanaSessionStatus())?.account ?? null);
    else if (namespace === 'eip155') setProven((await walletSessionStatus())?.account ?? null);
  }, [namespace]);
  useEffect(() => {
    void refresh();
    if (namespace !== 'solana') return undefined;
    const update = () => setSolanaNames(solanaWalletNames(chain));
    update(); const timer = setInterval(update, 1_000); return () => clearInterval(timer);
  }, [namespace, chain, refresh]);
  async function run(action: () => Promise<string>) {
    if (busy) return; setBusy(true); setError(null);
    try { setProven(await action()); } catch (cause) { setError(codeOf(cause)); } finally { setBusy(false); }
  }
  const proveEvm = () => run(async () => {
    const provider = injectedProvider(); if (!provider) throw new Error('EVM_WALLET_NOT_FOUND');
    const accounts = await provider.request({ method: 'eth_requestAccounts' }), chainId = await provider.request({ method: 'eth_chainId' });
    const account = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0].toLowerCase() : null;
    if (!account || typeof chainId !== 'string') throw new Error('EVM_WALLET_NOT_FOUND');
    const { message } = unwrap(await walletSignInChallenge(account, Number.parseInt(chainId, 16)));
    const signature = await provider.request({ method: 'personal_sign', params: [utf8Hex(message), account] });
    if (typeof signature !== 'string') throw new Error('WALLET_SIGNATURE_INVALID');
    return unwrap(await walletSignIn(account, Number.parseInt(chainId, 16), signature)).account;
  });
  const proveSolana = (name: string) => run(async () => {
    const session = await connectSolanaWallet(name, chain, 'WALLET');
    const { message } = unwrap(await solanaSignInChallenge(session.account.address));
    const signature = await signSolanaMessage(session, message, 'WALLET');
    return unwrap(await solanaSignIn(session.account.address, signature)).account;
  });
  return { proven, busy, error, solanaNames, proveEvm, proveSolana, refresh };
}

/** The proof buttons for one namespace, or the proven account. */
export function WalletProof({ namespace, proof }: { namespace: Namespace; proof: ReturnType<typeof useWalletProof> }) {
  if (proof.proven) return <p>Signed in as <code>{proof.proven}</code> ({namespace === 'solana' ? 'Solana' : 'Ethereum'}).</p>;
  if (namespace === 'eip155') return <div className="approval-actions"><button type="button" className="primary" disabled={proof.busy}
    onClick={() => void proof.proveEvm()}>Connect wallet and prove ownership</button></div>;
  return proof.solanaNames.length ? <div className="approval-actions">{proof.solanaNames.map(name => <button key={name} type="button" className="primary" disabled={proof.busy}
    onClick={() => void proof.proveSolana(name)}>Prove ownership with {name}</button>)}</div>
    : <p className="muted">No Solana wallet with message signing is available in this browser. Open this page in your wallet&apos;s browser, or install a wallet.</p>;
}
