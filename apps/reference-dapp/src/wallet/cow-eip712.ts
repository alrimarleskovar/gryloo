// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import type { CowTypedData, CowOrder } from '@defi-workflow-engine/reference-compiler';

type Provider = { readonly isGrylooCowLocalWallet?: boolean; request(input: { method: string; params?: readonly unknown[] }): Promise<unknown> };
const ADDRESS = /^0x[0-9a-f]{40}$/;
const SIGNATURE = /^0x[0-9a-f]{130}$/;
export const localCowProvider = (): Provider | null => {
  const provider = (globalThis as { ethereum?: unknown }).ethereum as Provider | undefined;
  return provider?.isGrylooCowLocalWallet === true && typeof provider.request === 'function' ? provider : null;
};
export async function connectLocalCowWallet(provider: Provider): Promise<string> {
  if (provider.isGrylooCowLocalWallet !== true) throw new Error('COW_PUBLIC_WALLET_REFUSED');
  const chain = await provider.request({ method: 'eth_chainId' });
  if (chain !== '0x2105') throw new Error('COW_WALLET_CHAIN_MISMATCH');
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !ADDRESS.test(accounts[0].toLowerCase()))
    throw new Error('COW_WALLET_ACCOUNT_INVALID');
  return accounts[0].toLowerCase();
}
export function reviewCowTypedData(data: CowTypedData, order: CowOrder, owner: string): void {
  if (data.primaryType !== 'Order' || data.domain.name !== 'Gnosis Protocol' || data.domain.version !== 'v2' ||
    data.domain.chainId !== 8453 || data.domain.verifyingContract !== '0x9008d19f58aabd9ed0d60971565aa8510560ab41' ||
    JSON.stringify(data.message) !== JSON.stringify(order) || order.receiver !== owner ||
    order.sellAmount === '0' || order.buyAmount === '0' || order.kind !== 'sell' ||
    order.partiallyFillable || order.feeAmount !== '0') throw new Error('COW_BROWSER_REVIEW_MISMATCH');
}
export async function signLocalCowTypedData(provider: Provider, owner: string, data: CowTypedData): Promise<string> {
  if (provider.isGrylooCowLocalWallet !== true) throw new Error('COW_PUBLIC_WALLET_REFUSED');
  if (await provider.request({ method: 'eth_chainId' }) !== '0x2105') throw new Error('COW_WALLET_CHAIN_MISMATCH');
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts) || accounts[0]?.toLowerCase() !== owner) throw new Error('COW_WALLET_ACCOUNT_MISMATCH');
  const result = await provider.request({ method: 'eth_signTypedData_v4', params: [owner, JSON.stringify(data)] });
  if (typeof result !== 'string' || !SIGNATURE.test(result)) throw new Error('COW_WALLET_SIGNATURE_INVALID');
  return result;
}
