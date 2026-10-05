// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { EVM_WALLET_NETWORKS, switchWalletNetwork, walletChainLabel, walletChainRef, walletNetwork } from './evm-networks';

type Call = { method: string; params?: unknown[] | undefined };
/** A scripted EIP-1193 provider: records every request and fails the first switch with `switchError` when given. */
function wallet(options: { chain: string; known?: string[]; switchError?: unknown; reportAfterSwitch?: string }) {
  const calls: Call[] = [];
  let chain = options.chain;
  const known = new Set(options.known ?? ['0x2105', '0xa4b1', '0x14a34']);
  const provider = { request: async ({ method, params }: Call) => {
    calls.push({ method, params });
    if (method === 'eth_chainId') return options.reportAfterSwitch ?? chain;
    if (method === 'wallet_switchEthereumChain') {
      const target = (params?.[0] as { chainId: string }).chainId;
      if (options.switchError !== undefined && calls.filter(call => call.method === method).length === 1) throw options.switchError;
      if (!known.has(target)) throw Object.assign(new Error('unknown chain'), { code: 4902 });
      chain = target; return null;
    }
    if (method === 'wallet_addEthereumChain') { known.add((params?.[0] as { chainId: string }).chainId); return null; }
    throw new Error('unexpected method ' + method);
  } };
  return { provider, calls };
}

describe('shared EVM wallet networks', () => {
  it('maps every recognized hex chain to its CAIP-2 reference and unknown chains to null', () => {
    expect(walletChainRef('0x2105')).toBe('eip155:8453');
    expect(walletChainRef('0xA4B1')).toBe('eip155:42161');
    expect(walletChainRef('0x14a34')).toBe('eip155:84532');
    expect(walletChainRef('0xb626')).toBe('eip155:46630');
    expect(walletChainRef('0x1237')).toBe('eip155:4663');
    // BUILD-ETHEREUM-001: Ethereum Sepolia is a switch target; Ethereum Mainnet is recognized only to be named and refused.
    expect(walletChainRef('0xaa36a7')).toBe('eip155:11155111');
    expect(walletChainRef('0x1')).toBe('eip155:1');
    for (const other of ['0x7a69', '0xb6260', '0xaa36a8', null, undefined, '']) expect(walletChainRef(other)).toBeNull();
    for (const network of EVM_WALLET_NETWORKS) expect(network.chain).toBe(`eip155:${Number.parseInt(network.hex, 16)}`);
  });
  it('keeps the existing labels and names Robinhood networks', () => {
    expect(walletChainLabel('0x2105')).toBe('Base (8453)');
    expect(walletChainLabel('0xa4b1')).toBe('Arbitrum (42161)');
    expect(walletChainLabel('0x14a34')).toBe('Base Sepolia');
    expect(walletChainLabel('0xb626')).toBe('Robinhood Chain Testnet (46630)');
    expect(walletChainLabel('0x1237')).toBe('Robinhood Chain (4663)');
    expect(walletChainLabel('0x89')).toBe('Other chain (0x89)');
    expect(walletChainLabel(null)).toBe('Unknown');
  });
  it('never offers Robinhood mainnet as a switch target', async () => {
    expect(walletNetwork('0x1237')).toMatchObject({ switchable: false, add: null });
    const { provider, calls } = wallet({ chain: '0x14a34' });
    await expect(switchWalletNetwork(provider, '0x1237')).rejects.toThrow('WALLET_NETWORK_NOT_SWITCHABLE');
    await expect(switchWalletNetwork(provider, '0x1')).rejects.toThrow('WALLET_NETWORK_NOT_SWITCHABLE');
    expect(calls).toEqual([]);
  });
  it('switches to Robinhood Testnet directly when the wallet knows it', async () => {
    const { provider, calls } = wallet({ chain: '0x14a34', known: ['0xb626'] });
    await switchWalletNetwork(provider, '0xb626');
    expect(calls.map(call => call.method)).toEqual(['wallet_switchEthereumChain', 'eth_chainId']);
    expect(calls[0]?.params).toEqual([{ chainId: '0xb626' }]);
  });
  it('adds Robinhood Testnet from official parameters only after 4902, then switches and reads back', async () => {
    const { provider, calls } = wallet({ chain: '0x2105' });
    await switchWalletNetwork(provider, '0xb626');
    expect(calls.map(call => call.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain', 'eth_chainId']);
    expect(calls[1]?.params).toEqual([{ chainId: '0xb626', chainName: 'Robinhood Chain Testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
      blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'] }]);
  });
  it('keeps the Base Sepolia add parameters byte-for-byte', async () => {
    const { provider, calls } = wallet({ chain: '0x2105', known: ['0x2105'] });
    await switchWalletNetwork(provider, '0x14a34');
    expect(JSON.stringify(calls[1]?.params)).toBe(JSON.stringify([{ chainId: '0x14a34', chainName: 'Base Sepolia',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://sepolia.base.org'],
      blockExplorerUrls: ['https://sepolia.basescan.org'] }]));
  });
  it('never adds a mainnet it cannot add; the 4902 error propagates', async () => {
    const { provider, calls } = wallet({ chain: '0x14a34', known: [] });
    await expect(switchWalletNetwork(provider, '0x2105')).rejects.toMatchObject({ code: 4902 });
    expect(calls.map(call => call.method)).toEqual(['wallet_switchEthereumChain']);
  });
  it('propagates a user rejection without adding or retrying', async () => {
    const { provider, calls } = wallet({ chain: '0x14a34', switchError: Object.assign(new Error('rejected'), { code: 4001 }) });
    await expect(switchWalletNetwork(provider, '0xb626')).rejects.toMatchObject({ code: 4001 });
    expect(calls.map(call => call.method)).toEqual(['wallet_switchEthereumChain']);
  });
  it('names Ethereum Sepolia and Ethereum Mainnet distinctly', () => {
    expect(walletChainLabel('0xaa36a7')).toBe('Ethereum Sepolia (11155111)');
    expect(walletChainLabel('0x1')).toBe('Ethereum Mainnet (1)');
  });
  it('never offers Ethereum Mainnet as a switch target or adds it, so Sepolia support has no path to Mainnet', async () => {
    expect(walletNetwork('0x1')).toMatchObject({ chain: 'eip155:1', switchable: false, add: null });
    const { provider, calls } = wallet({ chain: '0xaa36a7', known: ['0x1', '0xaa36a7'] });
    await expect(switchWalletNetwork(provider, '0x1')).rejects.toThrow('WALLET_NETWORK_NOT_SWITCHABLE');
    await expect(switchWalletNetwork(provider, '0x01')).rejects.toThrow('WALLET_NETWORK_NOT_SWITCHABLE');
    expect(calls).toEqual([]);
  });
  it('switches to Ethereum Sepolia directly when the wallet knows it, and reads the chain back', async () => {
    const { provider, calls } = wallet({ chain: '0x1', known: ['0xaa36a7'] });
    await switchWalletNetwork(provider, '0xAA36A7');
    expect(calls.map(call => call.method)).toEqual(['wallet_switchEthereumChain', 'eth_chainId']);
    expect(calls[0]?.params).toEqual([{ chainId: '0xaa36a7' }]);
  });
  it('adds Ethereum Sepolia from the official record only after 4902, then switches and reads back', async () => {
    const { provider, calls } = wallet({ chain: '0x14a34', known: [] });
    await switchWalletNetwork(provider, '0xaa36a7');
    expect(calls.map(call => call.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain', 'eth_chainId']);
    expect(calls[1]?.params).toEqual([{ chainId: '0xaa36a7', chainName: 'Ethereum Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], blockExplorerUrls: ['https://sepolia.etherscan.io'] }]);
  });
  it('fails when the wallet stays on Base or Mainnet after an Ethereum Sepolia switch', async () => {
    for (const reported of ['0x14a34', '0x1']) {
      const { provider } = wallet({ chain: '0x14a34', known: ['0xaa36a7'], reportAfterSwitch: reported });
      await expect(switchWalletNetwork(provider, '0xaa36a7')).rejects.toThrow('WALLET_DID_NOT_SWITCH');
    }
  });
  it('propagates a refused Ethereum Sepolia add without switching', async () => {
    const calls: { method: string }[] = [];
    const provider = { request: async ({ method }: { method: string }) => { calls.push({ method });
      if (method === 'wallet_switchEthereumChain') throw Object.assign(new Error('unknown'), { code: 4902 });
      throw Object.assign(new Error('rejected'), { code: 4001 }); } };
    await expect(switchWalletNetwork(provider, '0xaa36a7')).rejects.toMatchObject({ code: 4001 });
    expect(calls.map(call => call.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain']);
  });
  it('rejects a wallet that reports another chain after switching', async () => {
    const { provider } = wallet({ chain: '0x14a34', known: ['0xb626'], reportAfterSwitch: '0x1237' });
    await expect(switchWalletNetwork(provider, '0xb626')).rejects.toThrow('WALLET_DID_NOT_SWITCH');
  });
});
