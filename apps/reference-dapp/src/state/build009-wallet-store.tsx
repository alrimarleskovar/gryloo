// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { switchWalletNetwork, walletChainLabel } from '../wallet/evm-networks';
import { chooseEvmWallet, chosenEvmProvider, clearChosenEvmWallet, evmWalletEntries, evmWalletIdentity, incompatibleWalletMessage, injected,
  subscribeEvmDiscovery, subscribeEvmSelection } from '../wallet/evm-discovery';
import { updateWalletPreference, walletPreference, type WalletChoice } from '../wallet/wallet-registry';
import { useWalletSelector } from '../components/wallet-selector';

export const BASE_HEX = '0x2105';
export const ARBITRUM_HEX = '0xa4b1';
export const BASE_SEPOLIA_HEX = '0x14a34';
export const ROBINHOOD_TESTNET_HEX = '0xb626';
export const ETHEREUM_SEPOLIA_HEX = '0xaa36a7';
type Chain = typeof BASE_HEX | typeof ARBITRUM_HEX | typeof BASE_SEPOLIA_HEX | typeof ROBINHOOD_TESTNET_HEX | typeof ETHEREUM_SEPOLIA_HEX;
export type WalletSession = { readonly account: string; readonly chainId: string };
type Wallet = { readonly available: boolean; readonly account: string | null; readonly chainId: string | null;
  /** Public identity of the provider in use (explicit choice, or the passive provider of an already-authorized wallet). */
  readonly provider: Pick<WalletChoice, 'key' | 'name' | 'icon'> | null;
  readonly providerError: string | null;
  readonly error: string | null; readonly revision: number; readonly busy: boolean;
  session(): Promise<WalletSession | null>;
  /** Opens the canonical wallet selector (EVM wallets) and connects only the wallet the owner picks. */
  connect(): Promise<WalletSession | null>;
  /** Connects one selector choice. Only this path sends `eth_requestAccounts`, and only to that provider. */
  connectWith(choiceId: string): Promise<WalletSession | null>;
  switchTo(chain: Chain): Promise<void>; reset(): void };
const Context = createContext<Wallet | null>(null);
const validAccount = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
export { injected } from '../wallet/evm-discovery';
/** Silent reads reuse an already-authorized wallet unless the owner explicitly disconnected it in FloFi. */
const passiveReuseAllowed = () => Boolean(chosenEvmProvider()) || !walletPreference().evmDisconnected;
export function chainName(id: string | null): string { return walletChainLabel(id); }
export function Build009WalletProvider({ children }: { children: ReactNode }) {
  const selector = useWalletSelector();
  const [available, setAvailable] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Wallet['provider']>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!error) return; const timer = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(timer); }, [error]);
  const connected = useRef(false);
  const generation = useRef(0);
  const events = useRef(0);
  const suppressed = useRef(false);
  const invalidate = () => setRevision(n => n + 1);
  useEffect(() => {
    let detach: (() => void) | undefined;
    const describe = () => {
      const provider = injected();
      setAvailable(Boolean(provider) || evmWalletEntries().length > 0);
      setIdentity(evmWalletIdentity(provider));
      setProviderError(provider || evmWalletEntries().length ? null : incompatibleWalletMessage());
      return provider;
    };
    const bind = () => {
      detach?.();
      ++generation.current; connected.current = false;
      setAccount(null); setChainId(null); setBusy(false); invalidate();
      const provider = describe();
      if (!provider) return;
      suppressed.current = false;
      // Passive reuse never opens a wallet prompt, and never runs after the owner disconnected in FloFi (HOTFIX-WALLET-SELECTOR).
      // Provider identity and event epoch protect passive reads from overwriting newer wallet state.
      const synchronize = () => {
        if (!passiveReuseAllowed()) return;
        const op = generation.current, epoch = events.current;
        Promise.all([provider.request({ method: 'eth_accounts' }), provider.request({ method: 'eth_chainId' })]).then(([accounts, chain]) => {
          if (op !== generation.current || epoch !== events.current || injected() !== provider || suppressed.current || !passiveReuseAllowed()) return;
          const next = Array.isArray(accounts) && validAccount(accounts[0]) ? accounts[0].toLowerCase() : null;
          connected.current = Boolean(next); setAccount(next);
          setChainId(next && typeof chain === 'string' && /^0x[0-9a-fA-F]+$/.test(chain) ? chain.toLowerCase() : null);
          invalidate();
        }).catch(() => undefined);
      };
      const active = () => injected() === provider && !suppressed.current && passiveReuseAllowed();
      const accountsChanged = (...args: unknown[]) => {
        if (!active()) return;
        ++events.current;
        const accounts = args[0];
        const next = Array.isArray(accounts) && validAccount(accounts[0]) ? accounts[0].toLowerCase() : null;
        connected.current = Boolean(next); setAccount(next); setChainId(null); invalidate();
        if (next) synchronize();
      };
      const chainChanged = (...args: unknown[]) => {
        if (!active()) return;
        ++events.current;
        setChainId(typeof args[0] === 'string' && /^0x[0-9a-fA-F]+$/.test(args[0]) ? args[0].toLowerCase() : null); invalidate();
        if (!connected.current) synchronize();
      };
      const disconnected = () => {
        if (!active()) return;
        ++generation.current; ++events.current;
        connected.current = false; setAccount(null); setChainId(null); setBusy(false); invalidate();
      };
      const reconnected = () => { if (active()) synchronize(); };
      synchronize();
      provider.on?.('connect', reconnected);
      provider.on?.('accountsChanged', accountsChanged);
      provider.on?.('chainChanged', chainChanged);
      provider.on?.('disconnect', disconnected);
      detach = () => { provider.removeListener?.('accountsChanged', accountsChanged); provider.removeListener?.('chainChanged', chainChanged);
        provider.removeListener?.('disconnect', disconnected); provider.removeListener?.('connect', reconnected); };
    };
    const unsubscribe = subscribeEvmSelection(bind);
    // A new announcement can change availability and names without changing the provider in use.
    const unsubscribeDiscovery = subscribeEvmDiscovery(() => { describe(); });
    bind();
    return () => { unsubscribe(); unsubscribeDiscovery(); detach?.(); ++generation.current; };
  }, []);
  const session = useCallback(async (): Promise<WalletSession | null> => {
    const provider = injected();
    if (!provider || !passiveReuseAllowed()) return null;
    const op = generation.current, epoch = events.current;
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      const chain = await provider.request({ method: 'eth_chainId' });
      if (op !== generation.current || epoch !== events.current || injected() !== provider) return null;
      if (!Array.isArray(accounts) || !validAccount(accounts[0]) || typeof chain !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chain)) return null;
      connected.current = true; setAccount(accounts[0].toLowerCase()); setChainId(chain.toLowerCase());
      return { account: accounts[0].toLowerCase(), chainId: chain.toLowerCase() };
    } catch { return null; }
  }, []);
  const connectWith = useCallback(async (choiceId: string) => {
    // Recording the choice rebinds listeners to this provider before the single account request below.
    const provider = chooseEvmWallet(choiceId);
    if (!provider) { setError('That wallet is no longer available. Refresh the page and choose it again.'); return null; }
    suppressed.current = false;
    setBusy(true); setError(null); const op = ++generation.current, epoch = events.current;
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const chain = await provider.request({ method: 'eth_chainId' });
      if (!Array.isArray(accounts) || !validAccount(accounts[0]) || typeof chain !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chain))
        throw new Error('Wallet returned an invalid account or chain');
      if (op !== generation.current || epoch !== events.current || injected() !== provider) return null;
      connected.current = true; setAccount(accounts[0].toLowerCase()); setChainId(chain.toLowerCase()); invalidate();
      setIdentity(evmWalletIdentity(provider));
      return { account: accounts[0].toLowerCase(), chainId: chain.toLowerCase() };
    } catch { if (op === generation.current) setError('Could not connect. Check your wallet and try again.'); }
    finally { if (op === generation.current) setBusy(false); }
    return null;
  }, []);
  const connect = useCallback(async () => {
    const choice = await selector.choose({ ecosystems: ['evm'] });
    return choice ? connectWith(choice.id) : null;
  }, [selector, connectWith]);
  const switchTo = useCallback(async (chain: Chain) => {
    const provider = injected();
    if (!provider || !connected.current) { setError('Connect your wallet first.'); return; }
    if (chainId === chain) return;
    setBusy(true); setError(null); const op = ++generation.current;
    try {
      await switchWalletNetwork(provider, chain);
      const epoch = events.current;
      const actual = await provider.request({ method: 'eth_chainId' });
      if (op !== generation.current || epoch !== events.current || injected() !== provider) return;
      setChainId(typeof actual === 'string' && /^0x[0-9a-fA-F]+$/.test(actual) ? actual.toLowerCase() : null); invalidate();
    } catch { if (op === generation.current) setError('Could not switch networks. Check your wallet and try again.'); }
    finally { if (op === generation.current) setBusy(false); }
  }, [chainId]);
  // Disconnect ends FloFi's use of the wallet: no silent reuse until the owner picks a wallet again.
  const reset = useCallback(() => { ++generation.current; ++events.current; connected.current = false; setAccount(null); setChainId(null);
    updateWalletPreference({ evmDisconnected: true }); clearChosenEvmWallet(); suppressed.current = true;
    setError(null); setBusy(false); invalidate(); }, []);
  return <Context.Provider value={{ available, providerError, account, chainId, provider: identity, error, revision, busy, session, connect, connectWith, switchTo, reset }}>{children}</Context.Provider>;
}
export function useBuild009Wallet(): Wallet { const value = useContext(Context); if (!value) throw new Error('BUILD009_WALLET_MISSING'); return value; }
