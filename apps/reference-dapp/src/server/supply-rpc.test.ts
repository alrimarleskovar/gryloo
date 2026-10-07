// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-ETHEREUM-001: the Aave and native-transfer read clients are bound to one chain and never send. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AAVE_V3_BASE_SEPOLIA, AAVE_V3_ETHEREUM_SEPOLIA, ETHEREUM_SEPOLIA_TRANSFER } from '@defi-workflow-engine/action-registry';
import { createLendingReadRpcs, createSupplyReadRpc, supplyRpcUrl } from './supply-rpc';
import { createNativeTransferReadRpc } from './robinhood-rpc';

/** A scripted JSON-RPC endpoint: answers eth_chainId with `chain` and records every URL and method. */
function endpoint(chain: string, body?: string) {
  const requests: { url: string; method: string }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    const { method, id } = JSON.parse(init.body) as { method: string; id: number };
    requests.push({ url, method });
    return new Response(body ?? JSON.stringify({ jsonrpc: '2.0', id, result: method === 'eth_chainId' ? chain : '0x1' }), { status: 200 });
  });
  return requests;
}
afterEach(() => vi.unstubAllGlobals());

describe('chain-bound Aave read clients', () => {
  it('reads Ethereum Sepolia from its own endpoint and accepts only chain 0xaa36a7', async () => {
    const requests = endpoint('0xaa36a7');
    const rpc = createSupplyReadRpc(true, AAVE_V3_ETHEREUM_SEPOLIA);
    expect(await rpc('eth_chainId', [])).toBe('0xaa36a7');
    expect(await rpc('eth_blockNumber', [])).toBe('0x1');
    expect(requests.map(request => request.url)).toEqual(['http://127.0.0.1:8549/ethereum-sepolia', 'http://127.0.0.1:8549/ethereum-sepolia']);
  });
  it.each(['0x14a34', '0x1', '0xaa36a8'])('refuses a provider that reports %s for Ethereum Sepolia', async reported => {
    endpoint(reported);
    await expect(createSupplyReadRpc(true, AAVE_V3_ETHEREUM_SEPOLIA)('eth_chainId', [])).rejects.toThrow('SUPPLY_WRONG_CHAIN');
  });
  it('keeps Base Sepolia on its existing endpoint and chain', async () => {
    const requests = endpoint('0x14a34');
    await createSupplyReadRpc(true, AAVE_V3_BASE_SEPOLIA)('eth_chainId', []);
    expect(requests[0]!.url).toBe('http://127.0.0.1:8549');
    endpoint('0xaa36a7');
    await expect(createSupplyReadRpc(true, AAVE_V3_BASE_SEPOLIA)('eth_chainId', [])).rejects.toThrow('SUPPLY_WRONG_CHAIN');
  });
  it('denies every send or signing method before any network request', async () => {
    const requests = endpoint('0xaa36a7');
    for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign', 'eth_signTransaction', 'wallet_switchEthereumChain'])
      await expect(createSupplyReadRpc(true, AAVE_V3_ETHEREUM_SEPOLIA)(method, [])).rejects.toThrow('SUPPLY_RPC_METHOD_DENIED');
    expect(requests).toEqual([]);
  });
  it('refuses an oversized or malformed response', async () => {
    endpoint('0xaa36a7', JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + '0'.repeat(1_048_600) }));
    await expect(createSupplyReadRpc(true, AAVE_V3_ETHEREUM_SEPOLIA)('eth_call', [])).rejects.toThrow('SUPPLY_RPC_RESPONSE_TOO_LARGE');
    endpoint('0xaa36a7', JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'execution reverted: 51' } }));
    await expect(createSupplyReadRpc(true, AAVE_V3_ETHEREUM_SEPOLIA)('eth_call', [])).rejects.toThrow('SUPPLY_RPC_RESPONSE_INVALID');
  });
  it('accepts only an HTTPS override without credentials, and uses the public endpoint by default', () => {
    expect(supplyRpcUrl(AAVE_V3_ETHEREUM_SEPOLIA, undefined)).toBe('https://ethereum-sepolia-rpc.publicnode.com');
    expect(supplyRpcUrl(AAVE_V3_ETHEREUM_SEPOLIA, 'https://sepolia.example.org/rpc')).toBe('https://sepolia.example.org/rpc');
    for (const bad of ['http://sepolia.example.org', 'https://user:pass@sepolia.example.org', 'https://sepolia.example.org/#x', 'not a url', 'wss://sepolia.example.org'])
      expect(() => supplyRpcUrl(AAVE_V3_ETHEREUM_SEPOLIA, bad)).toThrow('SUPPLY_RPC_CONFIGURATION_INVALID');
  });
  it('builds one client per registered profile, keyed by CAIP-2 chain', () => {
    expect(Object.keys(createLendingReadRpcs(true))).toEqual(['eip155:84532', 'eip155:11155111']);
    expect(() => createLendingReadRpcs(false, { GRYLOO_ETHEREUM_SEPOLIA_RPC_URL: 'http://plain.example' })).toThrow('SUPPLY_RPC_CONFIGURATION_INVALID');
  });
});

describe('chain-bound native-transfer read client', () => {
  it('accepts only Ethereum Sepolia for the Ethereum Sepolia profile', async () => {
    endpoint('0xaa36a7');
    expect(await createNativeTransferReadRpc(ETHEREUM_SEPOLIA_TRANSFER, 'harness')('eth_chainId', [])).toBe('0xaa36a7');
    endpoint('0x1');
    await expect(createNativeTransferReadRpc(ETHEREUM_SEPOLIA_TRANSFER, 'harness')('eth_chainId', [])).rejects.toThrow('TRANSFER_WRONG_CHAIN');
    await expect(createNativeTransferReadRpc(ETHEREUM_SEPOLIA_TRANSFER, 'harness')('eth_sendRawTransaction', [])).rejects.toThrow('TRANSFER_RPC_METHOD_DENIED');
  });
});
