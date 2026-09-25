// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { SWAP_ROUTER_02 } from '../src/abi.js';
import { BASE_CODE_PINS, validateForkQuote, type ForkQuoteFacts } from '../src/fork-quote.js';
const blockHash = '0x' + '1'.repeat(64);
const routerHash = '0x' + '2'.repeat(64);
const pool = '0x' + '3'.repeat(40);
const facts: ForkQuoteFacts = { executionChainId: 31337, sourceChainId: 8453,
  sourceBlockHash: blockHash, block: { number: 101, hash: blockHash, timestamp: 1000n },
  finalBlockHash: blockHash, finalBlockTimestamp: 1000n,
  codeHashes: { ...BASE_CODE_PINS, router: routerHash }, reviewedRouterCodeHash: routerHash,
  router: SWAP_ROUTER_02, factoryMatches: true, weth9Matches: true,
  tokenMetadataMatches: true, ownerCode: '0x', ownerBalance: 1000n,
  ownerEthBalance: 1n, ownerAllowance: 0n, ownerNonce: 0n, selectedFee: 500,
  tiers: [100, 500, 3000, 10000].map(fee => ({ fee, pool, status: 'QUOTED', amountOut: 200n, fullInputProven: true })) };
const read = (f = facts, now = 1000n) => validateForkQuote(f, now, 1000n, 100);
describe('fresh fork quote gate', () => {
  it('returns only a user-selected full-input tier with a slippage bound', () => {
    expect(read()).toEqual({ fee: 500, amountOut: 200n, minimumOut: 198n,
      blockHash, expiresAt: 1060n });
  });
  it('blocks changed source, code, owner authority, age and unproven tier', () => {
    expect(() => read({ ...facts, executionChainId: 8453 })).toThrow('FORK_CHAIN_MISMATCH');
    expect(() => read({ ...facts, finalBlockHash: routerHash })).toThrow('FORK_SOURCE_MISMATCH');
    expect(() => read({ ...facts, codeHashes: { ...facts.codeHashes, weth: routerHash } })).toThrow('CODE_DIGEST_MISMATCH');
    expect(() => read({ ...facts, ownerCode: '0x60' })).toThrow('OWNER_HAS_CODE');
    expect(() => read({ ...facts, ownerAllowance: 1n })).toThrow('PRE_EXISTING_ALLOWANCE');
    expect(() => read(facts, 1060n)).toThrow('QUOTE_EXPIRED');
    expect(() => read({ ...facts, tiers: facts.tiers.map(t => t.fee === 500 ? { ...t, fullInputProven: false } : t) })).toThrow('FULL_INPUT_NOT_PROVEN');
  });
});

import { collectScriptedForkQuote, FORK_CONTRACTS, type ForkQuoteQuery } from '../src/fork-quote.js';
function script(mutation: (query: ForkQuoteQuery, value: unknown) => unknown = (_query, value) => value) {
  const calls: ForkQuoteQuery[] = [];
  const read = async (query: ForkQuoteQuery): Promise<unknown> => {
    calls.push(query);
    let value: unknown;
    switch (query.kind) {
      case 'CHAIN': value = 31337; break;
      case 'METADATA': value = { sourceChainId: 8453, sourceBlockHash: blockHash }; break;
      case 'LATEST': value = { number: 101, hash: blockHash, timestamp: 1000n }; break;
      case 'CODE': value = query.address === SWAP_ROUTER_02 ? routerHash
        : BASE_CODE_PINS[Object.entries(FORK_CONTRACTS).find(([, address]) => address === query.address)![0] as keyof typeof BASE_CODE_PINS]; break;
      case 'TOKEN_METADATA': value = query.address === FORK_CONTRACTS.usdc
        ? { symbol: 'USDC', decimals: 6 } : { symbol: 'WETH', decimals: 18 }; break;
      case 'DEPLOYMENT': value = { factory: FORK_CONTRACTS.factory, weth9: FORK_CONTRACTS.weth }; break;
      case 'POOL': value = query.fee === 500 ? pool : null; break;
      case 'QUOTE': value = { amountOut: 200n, sqrtPriceX96After: 1n }; break;
      case 'ACCOUNT': value = { inputBalance: 1000n, ethBalance: 1n, allowance: 0n, nonce: 0n, code: '0x' }; break;
      case 'TAIL': value = { hash: blockHash, timestamp: 1000n }; break;
    }
    return mutation(query, value);
  };
  return { read, calls };
}
const input = { owner: '0x' + '4'.repeat(40), tokenIn: FORK_CONTRACTS.usdc,
  tokenOut: FORK_CONTRACTS.weth, amountIn: 1000n, selectedFee: 500, reviewedRouterCodeHash: routerHash };
describe('scripted fork quote read plan', () => {
  it('pins every state read, visits four tiers in order, and rereads the same block', async () => {
    const transport = script();
    const collected = await collectScriptedForkQuote(transport.read, input);
    expect(validateForkQuote(collected, 1000n, 1000n, 100).minimumOut).toBe(198n);
    expect(transport.calls.map(query => query.kind)).toEqual(['CHAIN', 'METADATA', 'LATEST',
      'CODE', 'CODE', 'CODE', 'CODE', 'CODE', 'TOKEN_METADATA', 'TOKEN_METADATA',
      'DEPLOYMENT', 'DEPLOYMENT', 'POOL', 'POOL', 'QUOTE', 'POOL', 'POOL', 'ACCOUNT', 'TAIL']);
    expect(transport.calls.filter(query => 'blockHash' in query).every(query => query.blockHash === blockHash
      && query.requireCanonical === true)).toBe(true);
    expect(transport.calls.at(-1)).toEqual({ kind: 'TAIL', blockNumber: 101 });
  });
  it('fails closed on a changed tail, code digest and unproven full-input quote', async () => {
    const changedTail = script((query, value) => query.kind === 'TAIL' ? { hash: routerHash, timestamp: 1000n } : value);
    await expect(collectScriptedForkQuote(changedTail.read, input).then(f => validateForkQuote(f, 1000n, 1000n, 100))).rejects.toThrow('FORK_SOURCE_MISMATCH');
    const changedCode = script((query, value) => query.kind === 'CODE' && query.address === FORK_CONTRACTS.usdc ? routerHash : value);
    await expect(collectScriptedForkQuote(changedCode.read, input).then(f => validateForkQuote(f, 1000n, 1000n, 100))).rejects.toThrow('CODE_DIGEST_MISMATCH');
    const partial = script((query, value) => query.kind === 'QUOTE'
      ? { amountOut: 200n, sqrtPriceX96After: 1461446703485210103287273052203988822378723970341n } : value);
    await expect(collectScriptedForkQuote(partial.read, input).then(f => validateForkQuote(f, 1000n, 1000n, 100))).rejects.toThrow('NO_QUOTED_TIER');
  });
});
