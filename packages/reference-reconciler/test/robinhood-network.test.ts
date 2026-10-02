// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { ROBINHOOD_CHAIN_MAINNET as MAINNET, ROBINHOOD_CHAIN_TESTNET as TESTNET, robinhoodExpectedCode,
  type RobinhoodNetwork } from '../../action-registry/src/robinhood-chain.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { toHex } from '@defi-workflow-engine/reference-compiler';
import { NETWORK_READ_METHODS, assertNetworkReadMethod, verifyNetworkState, type NetworkExpectation, type NetworkRpc } from '../src/robinhood-network.js';

const NOW = Date.parse('2026-10-02T00:00:00Z');
const HEAD = '0x' + 'ab'.repeat(32);
type Chain = { chainId: string; block: unknown; code: Record<string, string> };
/** A scripted read-only chain. Code exists exactly where the expectation says PRESENT unless overridden. */
function chain(network: RobinhoodNetwork, change: Partial<Chain> = {}): { rpc: NetworkRpc; calls: { method: string; params: readonly unknown[] }[] } {
  const code: Record<string, string> = Object.fromEntries(robinhoodExpectedCode(network)
    .map(item => [item.address, item.expect === 'PRESENT' ? '0x6080604052' : '0x']));
  const state: Chain = { chainId: network.chainHex, block: { number: '0x7975392', hash: HEAD, timestamp: '0x' + (NOW / 1000 - 3).toString(16) },
    ...change, code: { ...code, ...change.code } };
  const calls: { method: string; params: readonly unknown[] }[] = [];
  return { calls, rpc: async (method, params) => {
    calls.push({ method, params });
    if (method === 'eth_chainId') return state.chainId;
    if (method === 'eth_getBlockByNumber') return state.block;
    if (method === 'eth_getCode') {
      const [address, at] = params as [string, { blockHash: string; requireCanonical: boolean }];
      if (at.blockHash !== HEAD || at.requireCanonical !== true) throw new Error('unpinned read');
      return state.code[address] ?? '0x';
    }
    throw new Error('unexpected method ' + method);
  } };
}
const expectation = (network: RobinhoodNetwork): NetworkExpectation => ({ chainId: network.chainId, maximumHeadAgeSeconds: 60,
  maximumClockSkewSeconds: 5, code: robinhoodExpectedCode(network) });
const now = () => NOW;

describe('Robinhood Chain read-only network verifier', () => {
  it('verifies testnet identity, a fresh head, official contracts present and no canonical DEX/lending code', async () => {
    const { rpc, calls } = chain(TESTNET);
    const result = await verifyNetworkState(rpc, expectation(TESTNET), now);
    expect(result).toMatchObject({ status: 'VERIFIED', chainId: 46630, findings: [], head: { number: 0x7975392, hash: HEAD, ageSeconds: 3 } });
    expect(result.contracts.filter(item => item.observed === 'PRESENT').map(item => item.name)).toEqual(
      ['WETH', 'L2 Gateway Router', 'L2 Multicall', 'Permit2']);
    expect(result.contracts.filter(item => item.observed === 'ABSENT').map(item => item.name)).toEqual(
      ['uniswap UniswapV3Factory', 'uniswap SwapRouter02', 'uniswap QuoterV2', 'morpho Morpho Blue']);
    expect(result.contracts.find(item => item.name === 'WETH')).toMatchObject({ codeBytes: 5,
      codeHash: toHex(keccak_256(Uint8Array.of(0x60, 0x80, 0x60, 0x40, 0x52))) });
    expect(result.contracts.find(item => item.name === 'uniswap SwapRouter02')).toMatchObject({ codeBytes: 0, codeHash: null });
    expect(new Set(calls.map(call => call.method))).toEqual(new Set(NETWORK_READ_METHODS));
  });
  it('verifies mainnet with the canonical Uniswap and Morpho deployments present', async () => {
    const result = await verifyNetworkState(chain(MAINNET).rpc, expectation(MAINNET), now);
    expect(result.status).toBe('VERIFIED');
    expect(result.contracts.every(item => item.observed === 'PRESENT')).toBe(true);
    expect(result.contracts.map(item => item.name)).toContain('uniswap SwapRouter02');
  });
  it('flags code at a canonical address on testnet as a deployment the gate has not reviewed', async () => {
    const router = robinhoodExpectedCode(TESTNET).find(item => item.name === 'uniswap SwapRouter02')!.address;
    const result = await verifyNetworkState(chain(TESTNET, { code: { [router]: '0x60806040' } }).rpc, expectation(TESTNET), now);
    expect(result.status).toBe('MISMATCH');
    expect(result.findings).toEqual([{ code: 'UNEXPECTED_CODE', name: 'uniswap SwapRouter02', address: router }]);
  });
  it('flags a missing official contract', async () => {
    const weth = TESTNET.contracts[0]!.address;
    const result = await verifyNetworkState(chain(TESTNET, { code: { [weth]: '0x' } }).rpc, expectation(TESTNET), now);
    expect(result.findings).toEqual([{ code: 'CODE_MISSING', name: 'WETH', address: weth }]);
  });
  it('rejects the wrong chain, including the other Robinhood network and Base Sepolia', async () => {
    for (const chainId of [MAINNET.chainHex, '0x14a34', '0x0']) {
      await expect(verifyNetworkState(chain(TESTNET, { chainId }).rpc, expectation(TESTNET), now)).rejects.toThrow('WRONG_CHAIN');
    }
  });
  it('fails closed on a stale head and on a head ahead of the local clock', async () => {
    const at = (seconds: number) => ({ number: '0x1', hash: HEAD, timestamp: '0x' + seconds.toString(16) });
    await expect(verifyNetworkState(chain(TESTNET, { block: at(NOW / 1000 - 61) }).rpc, expectation(TESTNET), now)).rejects.toThrow('STALE_HEAD');
    await expect(verifyNetworkState(chain(TESTNET, { block: at(NOW / 1000 + 6) }).rpc, expectation(TESTNET), now)).rejects.toThrow('CLOCK_SKEW');
    expect((await verifyNetworkState(chain(TESTNET, { block: at(NOW / 1000 + 5) }).rpc, expectation(TESTNET), now)).head.ageSeconds).toBe(0);
  });
  it('fails closed on malformed provider responses', async () => {
    const malformed: Partial<Chain>[] = [{ chainId: 'b626' }, { chainId: '0x0b626' }, { block: null }, { block: [] },
      { block: { number: '0x1', hash: '0x1234', timestamp: '0x1' } }, { block: { number: 1, hash: HEAD, timestamp: '0x1' } },
      { code: { [TESTNET.contracts[0]!.address]: '0x123' } }, { code: { [TESTNET.contracts[0]!.address]: 'deadbeef' } }];
    for (const change of malformed)
      await expect(verifyNetworkState(chain(TESTNET, change).rpc, expectation(TESTNET), now)).rejects.toThrow('RPC_RESPONSE_INVALID');
  });
  it('allows only the three read methods at the transport boundary', () => {
    for (const method of NETWORK_READ_METHODS) expect(() => assertNetworkReadMethod(method)).not.toThrow();
    for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData_v4',
      'wallet_switchEthereumChain', 'eth_call', 'eth_estimateGas', 'ETH_CHAINID', ''])
      expect(() => assertNetworkReadMethod(method)).toThrow('READ_ONLY_METHOD_REQUIRED');
  });
  it('rejects malformed expectations before any read', async () => {
    const { rpc, calls } = chain(TESTNET);
    const bad: NetworkExpectation[] = [{ ...expectation(TESTNET), chainId: 0 }, { ...expectation(TESTNET), maximumHeadAgeSeconds: 0 },
      { ...expectation(TESTNET), code: [{ name: 'x', address: '0xABC', expect: 'PRESENT' }] },
      { ...expectation(TESTNET), code: [...expectation(TESTNET).code, expectation(TESTNET).code[0]!] }];
    for (const item of bad) await expect(verifyNetworkState(rpc, item, now)).rejects.toThrow('EXPECTATION_INVALID');
    expect(calls).toEqual([]);
  });
});
