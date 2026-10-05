// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { switchWalletNetwork, walletChainLabel } from '../wallet/evm-networks';

export const BASE_HEX = '0x2105';
export const ARBITRUM_HEX = '0xa4b1';
export const BASE_SEPOLIA_HEX = '0x14a34';
export const ROBINHOOD_TESTNET_HEX = '0xb626';
export const ETHEREUM_SEPOLIA_HEX = '0xaa36a7';
type Chain = typeof BASE_HEX | typeof ARBITRUM_HEX | typeof BASE_SEPOLIA_HEX | typeof ROBINHOOD_TESTNET_HEX | typeof ETHEREUM_SEPOLIA_HEX;
export type WalletSession = { readonly account: string; readonly chainId: string };
type Provider = { request(input: { method: string; params?: unknown[] }): Promise<unknown>;
  readonly isMetaMask?: boolean; readonly isBraveWallet?: boolean;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void };
type Wallet = { readonly available: boolean; readonly account: string | null; readonly chainId: string | null;
  readonly providerError: string | null;
  readonly error: string | null; readonly revision: number; readonly busy: boolean;
  session(): Promise<WalletSession | null>; connect(): Promise<WalletSession | null>; switchTo(chain: Chain): Promise<void>; reset(): void };
const Context = createContext<Wallet | null>(null);
const validAccount = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
type Discovery = { readonly announced: Map<Provider, string>; readonly listeners: Set<() => void>; selected: Provider | null };
const discoveries = new WeakMap<Window, Discovery>();
const usable = (value: unknown): value is Provider => Boolean(value && typeof (value as Provider).request === 'function');
const braveWallet = (provider: Provider, rdns?: string) => provider.isBraveWallet === true || rdns === 'com.brave.wallet';
function selectProvider(target: Window, discovery: Discovery): Provider | null {
  const announced = [...discovery.announced].filter(([provider, rdns]) => !braveWallet(provider, rdns));
  const announcedMetaMask = announced.filter(([, rdns]) => rdns === 'io.metamask');
  if (announcedMetaMask.length) return announcedMetaMask.length === 1 ? announcedMetaMask[0]![0] : null;
  // EIP-6963 is authoritative: an announced wallet is used through its announced provider object, never through the
  // separate window.ethereum proxy it may also inject (Rabby does, and may flag that proxy isMetaMask for compatibility).
  // Several announced wallets without MetaMask stay ambiguous and fail closed.
  if (announced.length) return announced.length === 1 ? announced[0]![0] : null;
  const ethereum = (target as Window & { ethereum?: { providers?: unknown } }).ethereum;
  const multiple = Array.isArray(ethereum?.providers);
  const legacy = [...new Set((multiple ? ethereum.providers as unknown[] : [ethereum]).filter(usable))];
  if (multiple) {
    const metaMask = legacy.filter(provider => provider.isMetaMask === true && provider.isBraveWallet !== true);
    if (metaMask.length) return metaMask.length === 1 ? metaMask[0]! : null;
  }
  // An ambiguous fallback must never route an owner request through the aggregate window.ethereum.
  const providers = [...new Set([...discovery.announced.keys(), ...legacy])];
  if (providers.length !== 1 || providers[0]!.isBraveWallet === true) return null;
  return providers[0]!;
}
function updateSelection(target: Window, discovery: Discovery): void {
  const next = selectProvider(target, discovery);
  if (next === discovery.selected) return;
  discovery.selected = next;
  for (const listener of discovery.listeners) listener();
}
function discover(target: Window): Discovery {
  const existing = discoveries.get(target);
  if (existing) return existing;
  const discovery: Discovery = { announced: new Map(), listeners: new Set(), selected: null };
  discoveries.set(target, discovery);
  // EIP-6963 requires the announcement listener to remain for the page lifetime, including late injection.
  target.addEventListener('eip6963:announceProvider', event => {
    const detail = (event as CustomEvent<{ provider?: unknown; info?: { rdns?: unknown } }>).detail;
    if (!detail || !usable(detail.provider) || typeof detail.info?.rdns !== 'string') return;
    if (!discovery.announced.has(detail.provider)) discovery.announced.set(detail.provider, detail.info.rdns);
    updateSelection(target, discovery);
  });
  target.dispatchEvent(new Event('eip6963:requestProvider'));
  updateSelection(target, discovery);
  return discovery;
}
export function injected(): Provider | null {
  if (typeof window === 'undefined') return null;
  const discovery = discover(window);
  updateSelection(window, discovery);
  return discovery.selected;
}
function subscribeProvider(listener: () => void): () => void {
  const discovery = discover(window);
  discovery.listeners.add(listener);
  return () => { discovery.listeners.delete(listener); };
}
function incompatibleWalletMessage(): string | null {
  const discovery = discover(window);
  const ethereum = (window as Window & { ethereum?: { providers?: unknown } }).ethereum;
  const legacy = Array.isArray(ethereum?.providers) ? ethereum.providers : [ethereum];
  return [...discovery.announced.keys(), ...legacy].some(provider => usable(provider) && provider.isBraveWallet === true)
    ? 'No compatible wallet. Enable MetaMask or Rabby for this site and refresh; Brave Wallet cannot be used.' : null;
}
export function chainName(id: string | null): string { return walletChainLabel(id); }
export function Build009WalletProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
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
    let detach: (() => void) | undefined;
    const bind = () => {
      detach?.();
      ++generation.current; connected.current = false;
      setAccount(null); setChainId(null); setBusy(false); invalidate();
      const provider = injected();
      setAvailable(Boolean(provider));
      setProviderError(provider ? null : incompatibleWalletMessage());
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
      detach = () => { provider.removeListener?.('accountsChanged', accountsChanged); provider.removeListener?.('chainChanged', chainChanged);
        provider.removeListener?.('disconnect', disconnected); };
    };
    const unsubscribe = subscribeProvider(bind);
    bind();
    return () => { unsubscribe(); detach?.(); ++generation.current; };
  }, []);
  const session = useCallback(async (): Promise<WalletSession | null> => {
    const provider = injected();
    if (!provider) return null;
    const op = generation.current;
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      const chain = await provider.request({ method: 'eth_chainId' });
      if (op !== generation.current || injected() !== provider) return null;
      if (!Array.isArray(accounts) || !validAccount(accounts[0]) || typeof chain !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chain)) return null;
      connected.current = true; setAccount(accounts[0].toLowerCase()); setChainId(chain.toLowerCase());
      return { account: accounts[0].toLowerCase(), chainId: chain.toLowerCase() };
    } catch { return null; }
  }, []);
  const connect = useCallback(async () => {
    const provider = injected();
    if (!provider) { setError(incompatibleWalletMessage() ?? 'No wallet found. Install or enable a browser wallet.'); setAvailable(false); return null; }
    setBusy(true); setError(null); const op = ++generation.current;
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const chain = await provider.request({ method: 'eth_chainId' });
      if (!Array.isArray(accounts) || !validAccount(accounts[0]) || typeof chain !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chain))
        throw new Error('Wallet returned an invalid account or chain');
      if (op !== generation.current || injected() !== provider) return null;
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
      await switchWalletNetwork(provider, chain);
      if (op !== generation.current || injected() !== provider) return;
      setChainId(chain); invalidate();
    } catch { if (op === generation.current) setError('Could not switch networks. Check your wallet and try again.'); }
    finally { if (op === generation.current) setBusy(false); }
  }, [chainId]);
  const reset = useCallback(() => { ++generation.current; connected.current = false; setAccount(null); setChainId(null);
    setError(null); setBusy(false); invalidate(); }, []);
  return <Context.Provider value={{ available, providerError, account, chainId, error, revision, busy, session, connect, switchTo, reset }}>{children}</Context.Provider>;
}
export function useBuild009Wallet(): Wallet { const value = useContext(Context); if (!value) throw new Error('BUILD009_WALLET_MISSING'); return value; }
