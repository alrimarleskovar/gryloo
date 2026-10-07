// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLOWS } from '../../backend/flows.ts';
import { baseSepoliaSwapRpc } from './public-testnet-rpc.ts';

afterEach(() => { vi.restoreAllMocks(); });
/** A provider double: answers each POST from `replies` in order (a number is an HTTP status without a body). */
function provider(replies: (number | Record<string, unknown>)[]) {
  const hosts: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    hosts.push(new URL(String(input)).host);
    const reply = replies.shift() ?? 503;
    return typeof reply === 'number' ? new Response('busy', { status: reply }) : new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, ...reply }), { status: 200 });
  });
  return hosts;
}

describe('BUILD-CLOUD-PARITY-001 Base Sepolia read clients on shared serverless egress', () => {
  it('the live Uniswap liquidity client retries a dropped read and returns the answer', async () => {
    const hosts = provider([429, { result: '0x2dc6c0' }]);
    await expect(FLOWS['uniswap-liquidity'].transport('live', {}).rpc('eth_blockNumber', [])).resolves.toBe('0x2dc6c0');
    expect(hosts).toEqual(['sepolia.base.org', 'sepolia.base.org']);
  });
  it('the live swap client retries a dropped read, stays bound to chain 84532 and honours the shared override', async () => {
    provider([503, { result: '0x14a34' }]);
    await expect(FLOWS['base-sepolia-swap'].transport('live', {}).rpc('eth_chainId', [])).resolves.toBe('0x14a34');
    const hosts = provider([{ result: '0x1' }]);
    await expect(baseSepoliaSwapRpc('https://base-sepolia.keyed.example/v2/k')('eth_chainId', [])).rejects.toThrow('WRONG_PROVIDER_CHAIN');
    expect(hosts).toEqual(['base-sepolia.keyed.example']);
  });
  it('an answer the node gave is never retried, and bounded retries end in a classified failure', async () => {
    const hosts = provider([{ error: { code: -32000, message: 'execution reverted' } }]);
    await expect(FLOWS['uniswap-liquidity'].transport('live', {}).rpc('eth_call', [])).rejects.toThrow('PUBLIC_RPC_RESPONSE_INVALID');
    expect(hosts).toHaveLength(1);
    expect(() => baseSepoliaSwapRpc('http://plain.example')).toThrow('PUBLIC_RPC_CONFIGURATION_INVALID');
  });
});
