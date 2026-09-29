// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export const BASE_HEX = '0x2105';
export const ARBITRUM_HEX = '0xa4b1';
export const BASE_SEPOLIA_HEX = '0x14a34';
type Chain = typeof BASE_HEX | typeof ARBITRUM_HEX | typeof BASE_SEPOLIA_HEX;
export type WalletSession = { readonly account: string; readonly chainId: string };
type Provider = { request(input: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void };
type Wallet = { readonly available: boolean; readonly account: string | null; readonly chainId: string | null;
  readonly error: string | null; readonly revision: number; readonly busy: boolean;
  session(): Promise<WalletSession | null>; connect(): Promise<WalletSession | null>; switchTo(chain: Chain): Promise<void>; reset(): void };
const Context = createContext<Wallet | null>(null);
const validAccount = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
export function injected(): Provider | null {
  if (typeof window === 'undefined') return null;
  const value = (window as Window & { ethereum?: unknown }).ethereum;
  return value && typeof (value as Provider).request === 'function' ? value as Provider : null;
}
export function chainName(id: string | null): string {
  if (!id) return 'Unknown';
  if (id.toLowerCase() === BASE_HEX) return 'Base (8453)';
  if (id.toLowerCase() === ARBITRUM_HEX) return 'Arbitrum (42161)';
  if (id.toLowerCase() === BASE_SEPOLIA_HEX) return 'Base Sepolia';
  return `Other chain (${id})`;
}
export function Build009WalletProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!error) return; const timer = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(timer); }, [error]);
  const connected = useRef(false);
  const generation = useRef(0);
  const invalidate = () => setRevision(n => n + 1);
  useEffect(() => {
    const provider = injected();
    setAvailable(Boolean(provider));
    if (!provider) return;
    const op = generation.current;
    // Passive reuse never opens a wallet prompt. A future landing-page connection is visible here.
    Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]).then(([accounts, chain]) => {
      if (op !== generation.current || !Array.isArray(accounts) || !validAccount(accounts[0]) ||
          typeof chain !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chain)) return;
      connected.current = true; setAccount(accounts[0].toLowerCase()); setChainId(chain.toLowerCase()); invalidate();
    }).catch(() => undefined);
    const accountsChanged = (...args: unknown[]) => {
      if (!connected.current) return;
      const accounts = args[0];
      const next = Array.isArray(accounts) && validAccount(accounts[0]) ? accounts[0].toLowerCase() : null;
      if (!next) connected.current = false;
      setAccount(next); invalidate();
    };
    const chainChanged = (...args: unknown[]) => {
      if (!connected.current) return;
      setChainId(typeof args[0] === 'string' ? args[0].toLowerCase() : null); invalidate();
    };
    const disconnected = () => { connected.current = false; setAccount(null); setChainId(null); invalidate(); };
    provider.on?.('accountsChanged', accountsChanged);
    provider.on?.('chainChanged', chainChanged);
    provider.on?.('disconnect', disconnected);
    return () => { provider.removeListener?.('accountsChanged', accountsChanged); provider.removeListener?.('chainChanged', chainChanged);
      provider.removeListener?.('disconnect', disconnected); };
  }, []);
  const session = useCallback(async (): Promise<WalletSession | null> => {
    const provider = injected();
    if (!provider) return null;
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      const chain = await provider.request({ method: 'eth_chainId' });
      if (!Array.isArray(accounts) || !validAccount(accounts[0]) || typeof chain !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chain)) return null;
      connected.current = true; setAccount(accounts[0].toLowerCase()); setChainId(chain.toLowerCase());
      return { account: accounts[0].toLowerCase(), chainId: chain.toLowerCase() };
    } catch { return null; }
  }, []);
  const connect = useCallback(async () => {
    const provider = injected();
    if (!provider) { setError('No wallet found. Install or enable a browser wallet.'); setAvailable(false); return null; }
    setBusy(true); setError(null); const op = ++generation.current;
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const chain = await provider.request({ method: 'eth_chainId' });
      if (!Array.isArray(accounts) || !validAccount(accounts[0]) || typeof chain !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chain))
        throw new Error('Wallet returned an invalid account or chain');
      if (op !== generation.current) return null;
      connected.current = true; setAccount(accounts[0].toLowerCase()); setChainId(chain.toLowerCase()); invalidate();
      return { account: accounts[0].toLowerCase(), chainId: chain.toLowerCase() };
    } catch { if (op === generation.current) setError('Could not connect. Check your wallet and try again.'); }
    finally { if (op === generation.current) setBusy(false); }
    return null;
  }, []);
  const switchTo = useCallback(async (chain: Chain) => {
    const provider = injected();
    if (!provider || !connected.current) { setError('Connect your wallet first.'); return; }
    if (chainId === chain) return;
    setBusy(true); setError(null); const op = ++generation.current;
    try {
      try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain }] }); }
      catch (cause) {
        if (chain !== BASE_SEPOLIA_HEX || !cause || typeof cause !== 'object' || !('code' in cause) || cause.code !== 4902) throw cause;
        await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: BASE_SEPOLIA_HEX,
          chainName: 'Base Sepolia', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: ['https://sepolia.base.org'], blockExplorerUrls: ['https://sepolia.basescan.org'] }] });
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain }] });
      }
      const actual = await provider.request({ method: 'eth_chainId' });
      if (typeof actual !== 'string' || actual.toLowerCase() !== chain) throw new Error('Wallet did not switch to the required chain');
      if (op !== generation.current) return;
      setChainId(chain); invalidate();
    } catch { if (op === generation.current) setError('Could not switch networks. Check your wallet and try again.'); }
    finally { if (op === generation.current) setBusy(false); }
  }, [chainId]);
  const reset = useCallback(() => { ++generation.current; connected.current = false; setAccount(null); setChainId(null);
    setError(null); setBusy(false); invalidate(); }, []);
  return <Context.Provider value={{ available, account, chainId, error, revision, busy, session, connect, switchTo, reset }}>{children}</Context.Provider>;
}
export function useBuild009Wallet(): Wallet { const value = useContext(Context); if (!value) throw new Error('BUILD009_WALLET_MISSING'); return value; }
