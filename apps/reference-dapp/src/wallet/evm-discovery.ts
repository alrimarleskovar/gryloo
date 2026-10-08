// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Canonical EVM provider discovery. EIP-6963 announcements are collected for the page lifetime, one entry per provider
 * object, so several extensions coexist and none overwrites another. A legacy `window.ethereum` (EIP-1193) is offered
 * only when nothing announces, and it is never assumed to be MetaMask.
 *
 * Two different selections exist:
 *  - the owner's explicit choice from the wallet selector (`chooseEvmWallet`), the only path that may open a wallet prompt;
 *  - a passive provider used solely for silent reads (`eth_accounts`, `eth_chainId`) of a wallet the site is already
 *    authorized for. It prefers the owner's remembered wallet and otherwise keeps the reviewed deterministic rules.
 */
import { safeWalletIcon, safeWalletName, updateWalletPreference, walletPreference, type WalletChoice } from './wallet-registry';

export type EvmProvider = { request(input: { method: string; params?: unknown[] }): Promise<unknown>;
  readonly isMetaMask?: boolean; readonly isBraveWallet?: boolean;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void };
type Announcement = { readonly rdns: string; readonly uuid: string | null; readonly name: string | null; readonly icon: string | null };
type Discovery = {
  readonly announced: Map<EvmProvider, Announcement>;
  /** Selection changes (passive or chosen provider). */
  readonly listeners: Set<() => void>;
  /** Any discovery change, including a new announcement that does not change the selection. */
  readonly catalogue: Set<() => void>;
  selected: EvmProvider | null;
  chosen: EvmProvider | null;
};
const discoveries = new WeakMap<Window, Discovery>();
export const usableEvmProvider = (value: unknown): value is EvmProvider => Boolean(value && typeof (value as EvmProvider).request === 'function');
const braveWallet = (provider: EvmProvider, rdns?: string) => provider.isBraveWallet === true || rdns === 'com.brave.wallet';
const text = (value: unknown) => typeof value === 'string' && value ? value : null;

function legacy(target: Window): { readonly providers: EvmProvider[]; readonly multiple: boolean } {
  const ethereum = (target as Window & { ethereum?: { providers?: unknown } }).ethereum;
  const multiple = Array.isArray(ethereum?.providers);
  return { providers: [...new Set((multiple ? ethereum!.providers as unknown[] : [ethereum]).filter(usableEvmProvider))], multiple };
}
function passiveProvider(target: Window, discovery: Discovery): EvmProvider | null {
  const announced = [...discovery.announced].filter(([provider, info]) => !braveWallet(provider, info.rdns));
  const preferred = walletPreference().evm;
  const remembered = preferred ? announced.filter(([, info]) => info.rdns === preferred) : [];
  if (remembered.length === 1) return remembered[0]![0];
  const announcedMetaMask = announced.filter(([, info]) => info.rdns === 'io.metamask');
  if (announcedMetaMask.length) return announcedMetaMask.length === 1 ? announcedMetaMask[0]![0] : null;
  // EIP-6963 is authoritative: an announced wallet is used through its announced provider object, never through the
  // separate window.ethereum proxy it may also inject (Rabby does, and may flag that proxy isMetaMask for compatibility).
  // Several announced wallets without MetaMask stay ambiguous and fail closed.
  if (announced.length) return announced.length === 1 ? announced[0]![0] : null;
  const { providers: legacyProviders, multiple } = legacy(target);
  if (multiple) {
    const metaMask = legacyProviders.filter(provider => provider.isMetaMask === true && provider.isBraveWallet !== true);
    if (metaMask.length) return metaMask.length === 1 ? metaMask[0]! : null;
  }
  // An ambiguous fallback must never route an owner request through the aggregate window.ethereum.
  const providers = [...new Set([...discovery.announced.keys(), ...legacyProviders])];
  if (providers.length !== 1 || providers[0]!.isBraveWallet === true) return null;
  return providers[0]!;
}
function updateSelection(target: Window, discovery: Discovery): void {
  const next = discovery.chosen ?? passiveProvider(target, discovery);
  if (next === discovery.selected) return;
  discovery.selected = next;
  for (const listener of discovery.listeners) listener();
}
function discover(target: Window): Discovery {
  const existing = discoveries.get(target);
  if (existing) return existing;
  const discovery: Discovery = { announced: new Map(), listeners: new Set(), catalogue: new Set(), selected: null, chosen: null };
  discoveries.set(target, discovery);
  // EIP-6963 requires the announcement listener to remain for the page lifetime, including late injection.
  target.addEventListener('eip6963:announceProvider', event => {
    const detail = (event as CustomEvent<{ provider?: unknown; info?: { rdns?: unknown; uuid?: unknown; name?: unknown; icon?: unknown } }>).detail;
    if (!detail || !usableEvmProvider(detail.provider) || typeof detail.info?.rdns !== 'string') return;
    if (!discovery.announced.has(detail.provider)) {
      discovery.announced.set(detail.provider, { rdns: detail.info.rdns, uuid: text(detail.info.uuid), name: text(detail.info.name), icon: safeWalletIcon(detail.info.icon) });
      for (const listener of discovery.catalogue) listener();
    }
    updateSelection(target, discovery);
  });
  target.dispatchEvent(new Event('eip6963:requestProvider'));
  updateSelection(target, discovery);
  return discovery;
}
const browser = (): Window | null => typeof window === 'undefined' ? null : window;

/** The provider every EVM flow uses: the owner's explicit choice, otherwise the passive provider (silent reads only). */
export function injected(): EvmProvider | null {
  const target = browser();
  if (!target) return null;
  const discovery = discover(target);
  updateSelection(target, discovery);
  return discovery.selected;
}
/** Whether a provider is the owner's explicit selector choice (as opposed to the passive fallback). */
export function chosenEvmProvider(): EvmProvider | null {
  const target = browser();
  return target ? discover(target).chosen : null;
}
export function subscribeEvmSelection(listener: () => void): () => void {
  const target = browser();
  if (!target) return () => undefined;
  const discovery = discover(target);
  discovery.listeners.add(listener);
  return () => { discovery.listeners.delete(listener); };
}
export function subscribeEvmDiscovery(listener: () => void): () => void {
  const target = browser();
  if (!target) return () => undefined;
  const discovery = discover(target);
  discovery.catalogue.add(listener);
  return () => { discovery.catalogue.delete(listener); };
}
/** Ask late-loading extensions to announce again. Announcing never opens a wallet prompt. */
export function requestEvmAnnouncements(): void { browser()?.dispatchEvent(new Event('eip6963:requestProvider')); }

export type EvmWalletEntry = { readonly choice: WalletChoice; readonly provider: EvmProvider };
/** Every selectable EVM wallet. Brave Wallet is excluded by the existing compatibility rule. */
export function evmWalletEntries(): EvmWalletEntry[] {
  const target = browser();
  if (!target) return [];
  const discovery = discover(target);
  const announced = [...discovery.announced].filter(([provider, info]) => !braveWallet(provider, info.rdns));
  if (announced.length) return announced.map(([provider, info], index) => ({ provider, choice: {
    id: `evm:${info.uuid ?? `${info.rdns}#${index}`}`, ecosystem: 'evm', key: info.rdns, name: safeWalletName(info.name, info.rdns), icon: info.icon,
  } }));
  const providers = legacy(target).providers.filter(provider => !braveWallet(provider));
  return providers.map((provider, index) => ({ provider, choice: {
    id: `evm:injected#${index}`, ecosystem: 'evm', key: 'injected', name: providers.length > 1 ? `Browser wallet ${index + 1}` : 'Browser wallet', icon: null,
  } }));
}
/** Public identity of a provider for display and saved credentials. */
export function evmWalletIdentity(provider: EvmProvider | null): Pick<WalletChoice, 'key' | 'name' | 'icon'> | null {
  if (!provider) return null;
  return evmWalletEntries().find(entry => entry.provider === provider)?.choice ?? null;
}
/** Records the owner's explicit choice. The caller then requests accounts from exactly this provider. */
export function chooseEvmWallet(id: string): EvmProvider | null {
  const target = browser();
  if (!target) return null;
  const entry = evmWalletEntries().find(candidate => candidate.choice.id === id);
  if (!entry) return null;
  const discovery = discover(target);
  // Remembered for ordering and silent reuse only; a remembered wallet is never opened without a new explicit choice.
  updateWalletPreference({ evm: entry.choice.key, evmDisconnected: false });
  discovery.chosen = entry.provider;
  updateSelection(target, discovery);
  return entry.provider;
}
export function clearChosenEvmWallet(): void {
  const target = browser();
  if (!target) return;
  const discovery = discover(target);
  if (!discovery.chosen) return;
  discovery.chosen = null;
  updateSelection(target, discovery);
}
export function incompatibleWalletMessage(): string | null {
  const target = browser();
  if (!target) return null;
  const discovery = discover(target);
  const ethereum = (target as Window & { ethereum?: { providers?: unknown } }).ethereum;
  const legacyProviders = Array.isArray(ethereum?.providers) ? ethereum.providers : [ethereum];
  return [...discovery.announced.keys(), ...legacyProviders].some(provider => usableEvmProvider(provider) && provider.isBraveWallet === true)
    && !evmWalletEntries().length ? 'No compatible wallet. Enable MetaMask or Rabby for this site and refresh; Brave Wallet cannot be used.' : null;
}
