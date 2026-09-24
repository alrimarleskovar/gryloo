// SPDX-License-Identifier: AGPL-3.0-only
import canonicalize from 'canonicalize';
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { BASE_OBSERVATION_PROFILE as P, BaseObservationError, collectBaseTranscript, createReviewContext } from '../src/index.js';

const context = createReviewContext({ registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry });
const MIN = 4295128739n, MAX = 1461446703485210103287273052203988822378723970342n;
const H = `0x${'ab'.repeat(32)}`;
const NOW_S = 1_790_000_000;
const WETH_USDC = { from: 'WETH', to: 'USDC', amountIn: '1000000000000000000' } as const;
const USDC_WETH = { from: 'USDC', to: 'WETH', amountIn: '2500000000' } as const;

/** Keccak-256 with the original padding, used only to re-derive the six selectors. */
function keccak256(input: Uint8Array): string {
  const RC = [0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
  const ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
  const mask = (1n << 64n) - 1n;
  const rotl = (value: bigint, n: number) => n === 0 ? value : ((value << BigInt(n)) | (value >> BigInt(64 - n))) & mask;
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((input.length + 1) / rate) * rate);
  padded.set(input);
  padded[input.length]! ^= 0x01;
  padded[padded.length - 1]! ^= 0x80;
  const s: bigint[] = Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane += 1) {
      let value = 0n;
      for (let byte = 7; byte >= 0; byte -= 1) value = (value << 8n) | BigInt(padded[offset + lane * 8 + byte]!);
      s[lane]! ^= value;
    }
    for (const rc of RC) {
      const c = [0, 1, 2, 3, 4].map(x => s[x]! ^ s[x + 5]! ^ s[x + 10]! ^ s[x + 15]! ^ s[x + 20]!);
      const d = [0, 1, 2, 3, 4].map(x => c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1));
      for (let i = 0; i < 25; i += 1) s[i]! ^= d[i % 5]!;
      const b: bigint[] = Array(25).fill(0n);
      for (let x = 0; x < 5; x += 1) for (let y = 0; y < 5; y += 1) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y]!, ROT[x]![y]!);
      for (let x = 0; x < 5; x += 1) for (let y = 0; y < 5; y += 1) s[x + 5 * y] = b[x + 5 * y]! ^ ((~b[(x + 1) % 5 + 5 * y]! & mask) & b[(x + 2) % 5 + 5 * y]!);
      s[0]! ^= rc;
    }
  }
  let out = '';
  for (let lane = 0; lane < 4; lane += 1) for (let byte = 0; byte < 8; byte += 1) out += Number((s[lane]! >> BigInt(8 * byte)) & 0xffn).toString(16).padStart(2, '0');
  return out;
}
const utf8 = (text: string) => new TextEncoder().encode(text);

const word = (value: bigint) => value.toString(16).padStart(64, '0');
const addr = (address: string) => address.slice(2).padStart(64, '0');
const stringData = (text: string) => `0x${word(32n)}${word(BigInt(text.length))}${Buffer.from(text).toString('hex').padEnd(64, '0')}`;
type Quote = { amountOut: bigint; sqrt: bigint; ticks?: bigint } | { error: { code: number; message: string } };
interface ChainOptions {
  block?: Record<string, unknown> | null;
  finalBlock?: Record<string, unknown> | null;
  pools?: Partial<Record<number, string | null>>;
  quotes?: Partial<Record<number, Quote>>;
  respond?: (request: { id: number; method: string; params: unknown[] }, index: number) => string | undefined;
}
const POOL_500 = '0xd0b53d9277642d899df5c87a3966a349a798f224';
const POOL_3000 = '0x6c561b446416e1a00e8e93e221854d6ea4171372';
const SQRT = 4339505179874779489431521n;

/** A scripted Base node: it answers the fixed read plan from in-memory state only. */
function fakeChain(options: ChainOptions = {}) {
  const requests: { id: number; method: string; params: unknown[] }[] = [];
  const head = options.block === undefined ? { number: '0x2625a00', hash: H, timestamp: `0x${(NOW_S - 1).toString(16)}`, transactions: [] } : options.block;
  const pools: Record<number, string | null> = { 100: null, 500: POOL_500, 3000: POOL_3000, 10000: null, ...options.pools };
  const quotes: Record<number, Quote> = { 500: { amountOut: 2_500_123_456n, sqrt: SQRT }, 3000: { amountOut: 2_499_000_000n, sqrt: SQRT + 7n }, ...options.quotes };
  const transport = async (text: string) => {
    const request = JSON.parse(text) as { id: number; method: string; params: unknown[] };
    requests.push(request);
    const custom = options.respond?.(request, requests.length);
    if (custom !== undefined) return custom;
    const ok = (result: unknown) => JSON.stringify({ jsonrpc: '2.0', id: request.id, result });
    const error = (code: number, message: string) => JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code, message } });
    switch (request.method) {
      case 'eth_chainId': return ok('0x2105');
      case 'eth_getBlockByNumber': return ok(request.params[0] === 'latest' ? head : options.finalBlock === undefined ? head : options.finalBlock);
      case 'eth_getCode': return ok(`0x6080${(request.params[0] as string).slice(2, 10)}`);
      case 'eth_call': {
        const { to, data } = request.params[0] as { to: string; data: string };
        const selector = data.slice(0, 10), usdc = to === P.contracts.usdc;
        if (selector === P.selectors.decimals) return ok(`0x${word(usdc ? 6n : 18n)}`);
        if (selector === P.selectors.symbol) return ok(stringData(usdc ? 'USDC' : 'WETH'));
        if (selector === P.selectors.factory) return ok(`0x${addr(P.contracts.factory)}`);
        if (selector === P.selectors.weth9) return ok(`0x${addr(P.contracts.weth)}`);
        if (selector === P.selectors.getPool) return ok(`0x${addr(pools[Number(BigInt(`0x${data.slice(138, 202)}`))] ?? `0x${'0'.repeat(40)}`)}`);
        if (selector === P.selectors.quoteExactInputSingle) {
          const quote = quotes[Number(BigInt(`0x${data.slice(202, 266)}`))];
          if (!quote) return error(3, 'execution reverted');
          if ('error' in quote) return error(quote.error.code, quote.error.message);
          return ok(`0x${word(quote.amountOut)}${word(quote.sqrt)}${word(quote.ticks ?? 2n)}${word(96_000n)}`);
        }
        return error(-32601, 'unexpected call');
      }
      default: return error(-32601, 'method not found');
    }
  };
  return { transport, requests };
}
function clock(startMs = NOW_S * 1000) {
  let now = startMs;
  const waits: { ms: number; afterRequests: number }[] = [];
  return { now: () => now, advance: (ms: number) => { now += ms; }, waits, wait: (requests: () => number) => async (ms: number) => { waits.push({ ms, afterRequests: requests() }); } };
}
async function collect(swap: typeof WETH_USDC | typeof USDC_WETH = WETH_USDC, options: ChainOptions = {}, time = clock()) {
  const chain = fakeChain(options);
  const result = await collectBaseTranscript({ swap, mode: 'LIVE_READ_ONLY', providerHost: P.providerHost },
    { transport: chain.transport, now: time.now, wait: time.wait(() => chain.requests.length), settleMs: 1000 }, context);
  return { ...result, chain, time };
}
async function rejectsWith(promise: Promise<unknown>, code: string, requestsSent?: number) {
  const error = await promise.then(() => null, (cause: unknown) => cause);
  expect(error).toBeInstanceOf(BaseObservationError);
  expect((error as BaseObservationError).code).toBe(code);
  if (requestsSent !== undefined) expect((error as BaseObservationError).requestsSent).toBe(requestsSent);
  return error as BaseObservationError;
}

describe('read plan and encoding (L-1)', () => {
  it('re-derives the six selectors with Keccak-256', () => {
    expect(keccak256(utf8(''))).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(keccak256(utf8('transfer(address,uint256)')).slice(0, 8)).toBe('a9059cbb');
    const signatures = { decimals: 'decimals()', symbol: 'symbol()', factory: 'factory()', weth9: 'WETH9()', getPool: 'getPool(address,address,uint24)',
      quoteExactInputSingle: 'quoteExactInputSingle((address,address,uint256,uint24,uint160))' } as const;
    for (const [key, signature] of Object.entries(signatures)) expect(P.selectors[key as keyof typeof signatures]).toBe(`0x${keccak256(utf8(signature)).slice(0, 8)}`);
    expect(Object.keys(P.selectors)).toHaveLength(6);
  });

  it('binds the profile to the registry and to the pinned TickMath limits', () => {
    expect(P.contracts.usdc).toBe(context.assets.USDC.asset.address);
    expect(P.contracts.weth).toBe(context.assets.WETH.asset.address);
    expect(P.priceLimits).toEqual({ zeroForOne: (MIN + 1n).toString(), oneForZero: (MAX - 1n).toString() });
    expect(Object.isFrozen(P.contracts) && Object.isFrozen(P.uncertainty)).toBe(true);
  });

  it.each([['WETH to USDC', WETH_USDC], ['USDC to WETH', USDC_WETH]] as const)('%s sends the exact golden sequence, hash-pinned and account-free', async (_label, swap) => {
    const { chain, transcript, facts } = await collect(swap);
    const tokenIn = context.assets[swap.from].asset.address, tokenOut = context.assets[swap.to].asset.address;
    const at = { blockHash: H, requireCanonical: true };
    const call = (to: string, data: string) => ({ method: 'eth_call', params: [{ to, data }, at] });
    const expected: { method: string; params: unknown[] }[] = [
      { method: 'eth_chainId', params: [] },
      { method: 'eth_getBlockByNumber', params: ['latest', false] },
      ...(['usdc', 'weth', 'factory', 'quoter'] as const).map(label => ({ method: 'eth_getCode', params: [P.contracts[label], at] })),
      call(P.contracts.usdc, P.selectors.decimals), call(P.contracts.usdc, P.selectors.symbol),
      call(P.contracts.weth, P.selectors.decimals), call(P.contracts.weth, P.selectors.symbol),
      call(P.contracts.quoter, P.selectors.factory), call(P.contracts.quoter, P.selectors.weth9),
      ...[100, 500, 3000, 10000].map(fee => call(P.contracts.factory, `${P.selectors.getPool}${addr(tokenIn)}${addr(tokenOut)}${word(BigInt(fee))}`)),
      ...[500, 3000].map(fee => call(P.contracts.quoter, `${P.selectors.quoteExactInputSingle}${addr(tokenIn)}${addr(tokenOut)}${word(BigInt(swap.amountIn))}${word(BigInt(fee))}${word(0n)}`)),
      { method: 'eth_getBlockByNumber', params: ['0x2625a00', false] },
    ];
    expect(chain.requests).toEqual(expected.map((request, index) => ({ jsonrpc: '2.0', id: index + 1, ...request })));
    const parsed = JSON.parse(new TextDecoder().decode(transcript));
    expect(parsed.exchanges.map((exchange: { request: string }) => exchange.request)).toEqual(expected.map((request, index) => canonicalize({ jsonrpc: '2.0', id: index + 1, ...request })));
    expect(parsed.exchanges[2].request).toBe(`{"id":3,"jsonrpc":"2.0","method":"eth_getCode","params":["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",{"blockHash":"${H}","requireCanonical":true}]}`);
    for (const request of chain.requests.filter(item => item.method === 'eth_call' || item.method === 'eth_getCode')) {
      expect(request.params[1]).toEqual(at);
      if (request.method === 'eth_call') expect(Object.keys(request.params[0] as object).sort()).toEqual(['data', 'to']);
    }
    expect(facts.requests).toBe(19);
    expect(Object.keys(parsed).sort()).toEqual(['chainId', 'completedAt', 'exchanges', 'format', 'mode', 'providerHost', 'startedAt', 'swap']);
    expect(new TextDecoder().decode(transcript)).toBe(canonicalize(parsed));
  });

  it('waits once after the head read, then pins every read to that block', async () => {
    const { time } = await collect();
    expect(time.waits).toEqual([{ ms: 1000, afterRequests: 2 }]);
  });

  it('uses exactly 21 requests when all four tiers have pools', async () => {
    const pools = { 100: POOL_500, 10000: POOL_3000 };
    const quotes = { 100: { amountOut: 1n, sqrt: SQRT }, 10000: { amountOut: 1n, sqrt: SQRT } };
    const { facts } = await collect(WETH_USDC, { pools, quotes });
    expect(facts.requests).toBe(P.maximumRequests);
  });
});

describe('full-input rule and tier statuses (plan §3.2.2)', () => {
  const zeroForOne = (MIN + 1n), oneForZero = (MAX - 1n);
  it.each([
    ['WETH to USDC at the limit', WETH_USDC, zeroForOne, 'FULL_INPUT_NOT_PROVEN', null],
    ['WETH to USDC one above the limit', WETH_USDC, zeroForOne + 1n, 'QUOTED', '2500123456'],
    ['USDC to WETH at the limit', USDC_WETH, oneForZero, 'FULL_INPUT_NOT_PROVEN', null],
    ['USDC to WETH one below the limit', USDC_WETH, oneForZero - 1n, 'QUOTED', '2500123456'],
  ] as const)('%s', async (_label, swap, sqrt, status, amountOut) => {
    const { facts } = await collect(swap, { quotes: { 500: { amountOut: 2_500_123_456n, sqrt } } });
    expect(facts.tiers[1]).toEqual({ fee: 500, pool: POOL_500, status, amountOut });
  });

  it('reports no pool, zero output and a quote revert without a number, in fixed order', async () => {
    const { facts } = await collect(WETH_USDC, { pools: { 100: POOL_500, 10000: POOL_3000 }, quotes: {
      100: { amountOut: 0n, sqrt: SQRT }, 500: { error: { code: 3, message: 'execution reverted: SPL' } },
      3000: { error: { code: -32000, message: 'execution reverted' } }, 10000: { amountOut: 9n, sqrt: SQRT } } });
    expect(facts.tiers).toEqual([
      { fee: 100, pool: POOL_500, status: 'ZERO_OUTPUT', amountOut: null },
      { fee: 500, pool: POOL_500, status: 'QUOTE_REVERTED', amountOut: null },
      { fee: 3000, pool: POOL_3000, status: 'QUOTE_REVERTED', amountOut: null },
      { fee: 10000, pool: POOL_3000, status: 'QUOTED', amountOut: '9' },
    ]);
    const noPools = await collect(WETH_USDC, { pools: { 500: null, 3000: null } });
    expect(noPools.facts.tiers.map(tier => tier.status)).toEqual(['NO_POOL', 'NO_POOL', 'NO_POOL', 'NO_POOL']);
    expect(noPools.facts.requests).toBe(17);
  });

  it('never ranks tiers, whatever the amounts', async () => {
    const { facts } = await collect(WETH_USDC, { quotes: { 500: { amountOut: 1n, sqrt: SQRT }, 3000: { amountOut: 999n, sqrt: SQRT } } });
    expect(facts.tiers.map(tier => tier.fee)).toEqual([100, 500, 3000, 10000]);
    expect(Object.keys(facts.tiers[1]!).sort()).toEqual(['amountOut', 'fee', 'pool', 'status']);
  });

  it.each([
    ['a price at MIN_SQRT_RATIO', { amountOut: 5n, sqrt: MIN }],
    ['a price at MAX_SQRT_RATIO', { amountOut: 5n, sqrt: MAX }],
    ['ticks beyond uint32', { amountOut: 5n, sqrt: SQRT, ticks: 1n << 32n }],
  ] as const)('rejects %s as invalid', async (_label, quote) => {
    await rejectsWith(collect(WETH_USDC, { quotes: { 500: quote } }), 'RPC_RESPONSE_INVALID');
  });
});

describe('fail-closed consistency (plan §3.2.3 and §3.7)', () => {
  const at = (index: number, response: (id: number) => string) => ({ respond: (request: { id: number }, n: number) => n === index ? response(request.id) : undefined });
  const result = (id: number, value: unknown) => JSON.stringify({ jsonrpc: '2.0', id, result: value });
  const error = (id: number, code: number, message: string) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });

  it('rejects a rejected hash-pinned read with no fallback and no further request', async () => {
    const failure = await rejectsWith(collect(WETH_USDC, at(3, id => error(id, -32602, 'invalid argument 1: hex string without 0x prefix'))), 'PINNED_READ_REJECTED', 3);
    expect(failure.providerErrorCode).toBe(-32602);
    for (const [index, code] of [[5, -32000], [9, -32000], [13, -32001]] as const) {
      const chain = fakeChain(at(index, id => error(id, code, 'header not found')));
      await rejectsWith(collectBaseTranscript({ swap: WETH_USDC, mode: 'LIVE_READ_ONLY', providerHost: P.providerHost },
        { transport: chain.transport, now: () => NOW_S * 1000, wait: async () => {}, settleMs: 0 }, context), 'PINNED_READ_REJECTED', index);
      expect(chain.requests).toHaveLength(index);
    }
    await rejectsWith(collect(WETH_USDC, { quotes: { 500: { error: { code: -32000, message: 'header for hash not found' } } } }), 'PINNED_READ_REJECTED', 17);
  });

  it('classifies unpinned read errors as provider errors', async () => {
    const failure = await rejectsWith(collect(WETH_USDC, at(1, id => error(id, -32005, 'limit exceeded'))), 'PROVIDER_ERROR', 1);
    expect(failure.providerErrorCode).toBe(-32005);
    await rejectsWith(collect(WETH_USDC, at(19, id => error(id, -32000, 'server busy'))), 'PROVIDER_ERROR', 19);
  });

  it.each([
    ['a null head block', { block: null }, 'BLOCK_INCONSISTENT'],
    ['a null final block', { finalBlock: null }, 'BLOCK_INCONSISTENT'],
    ['a changed final hash', { finalBlock: { number: '0x2625a00', hash: `0x${'cd'.repeat(32)}`, timestamp: `0x${(NOW_S - 1).toString(16)}` } }, 'REORG_DETECTED'],
    ['a changed final timestamp', { finalBlock: { number: '0x2625a00', hash: H, timestamp: `0x${NOW_S.toString(16)}` } }, 'BLOCK_INCONSISTENT'],
    ['a changed final number', { finalBlock: { number: '0x2625a01', hash: H, timestamp: `0x${(NOW_S - 1).toString(16)}` } }, 'BLOCK_INCONSISTENT'],
    ['a block without a hash', { block: { number: '0x1', timestamp: '0x1' } }, 'RPC_RESPONSE_INVALID'],
    ['an uppercase block hash', { block: { number: '0x1', hash: H.toUpperCase().replace('0X', '0x'), timestamp: '0x1' } }, 'RPC_RESPONSE_INVALID'],
    ['a non-canonical block number', { block: { number: '0x01', hash: H, timestamp: `0x${(NOW_S - 1).toString(16)}` } }, 'RPC_RESPONSE_INVALID'],
    ['a stale block', { block: { number: '0x1', hash: H, timestamp: `0x${(NOW_S - 16).toString(16)}` } }, 'STALE_BLOCK'],
    ['a block from the future', { block: { number: '0x1', hash: H, timestamp: `0x${(NOW_S + 3).toString(16)}` } }, 'CLOCK_SKEW'],
  ] as const)('fails closed on %s', async (_label, options, code) => {
    await rejectsWith(collect(WETH_USDC, options as ChainOptions), code);
  });

  it('accepts additional block fields such as Denim millisecond timestamps', async () => {
    const block = { number: '0x2625a00', hash: H, timestamp: `0x${(NOW_S - 1).toString(16)}`, timestampMs: `0x${((NOW_S - 1) * 1000 + 400).toString(16)}`, transactions: ['0x01'] };
    const { facts } = await collect(WETH_USDC, { block });
    expect(facts.block).toEqual({ number: 40_000_000, hash: H, timestamp: NOW_S - 1 });
  });

  it.each([
    ['a wrong chain', 1, (id: number) => result(id, '0x1'), 'WRONG_CHAIN'],
    ['an uppercase chain id', 1, (id: number) => result(id, '0X2105'), 'RPC_RESPONSE_INVALID'],
    ['an extra envelope key', 1, (id: number) => JSON.stringify({ jsonrpc: '2.0', id, result: '0x2105', extra: 1 }), 'RPC_RESPONSE_INVALID'],
    ['a wrong id', 1, (id: number) => result(id + 1, '0x2105'), 'RPC_RESPONSE_INVALID'],
    ['both result and error', 1, (id: number) => JSON.stringify({ jsonrpc: '2.0', id, result: '0x2105', error: { code: 1, message: 'x' } }), 'RPC_RESPONSE_INVALID'],
    ['a wrong jsonrpc version', 1, (id: number) => JSON.stringify({ jsonrpc: '1.0', id, result: '0x2105' }), 'RPC_RESPONSE_INVALID'],
    ['a batch array', 1, (id: number) => `[${result(id, '0x2105')}]`, 'RPC_RESPONSE_INVALID'],
    ['duplicate keys', 1, (id: number) => `{"jsonrpc":"2.0","id":${id},"result":"0x1","result":"0x2105"}`, 'RPC_RESPONSE_INVALID'],
    ['trailing data', 1, (id: number) => `${result(id, '0x2105')} {}`, 'RPC_RESPONSE_INVALID'],
    ['a lone surrogate', 1, (id: number) => `{"jsonrpc":"2.0","id":${id},"result":"\\ud800"}`, 'RPC_RESPONSE_INVALID'],
    ['missing code', 3, (id: number) => result(id, '0x'), 'CODE_MISSING'],
    ['non-hex code', 3, (id: number) => result(id, '0x6g'), 'RPC_RESPONSE_INVALID'],
    ['a short decimals word', 7, (id: number) => result(id, `0x${'0'.repeat(62)}`), 'RPC_RESPONSE_INVALID'],
    ['decimals above uint8', 7, (id: number) => result(id, `0x${word(256n)}`), 'RPC_RESPONSE_INVALID'],
    ['wrong USDC decimals', 7, (id: number) => result(id, `0x${word(18n)}`), 'ASSET_METADATA_MISMATCH'],
    ['a wrong symbol', 8, (id: number) => result(id, stringData('USDT')), 'ASSET_METADATA_MISMATCH'],
    ['a symbol with a bad offset', 8, (id: number) => result(id, `0x${word(64n)}${word(4n)}${'00'.repeat(32)}`), 'RPC_RESPONSE_INVALID'],
    ['a symbol with dirty padding', 8, (id: number) => result(id, `0x${word(32n)}${word(4n)}${Buffer.from('USDC').toString('hex')}${'1'.repeat(56)}`), 'RPC_RESPONSE_INVALID'],
    ['a wrong quoter factory', 11, (id: number) => result(id, `0x${addr(`0x${'11'.repeat(20)}`)}`), 'DEPLOYMENT_MISMATCH'],
    ['a wrong quoter WETH9', 12, (id: number) => result(id, `0x${addr(`0x${'22'.repeat(20)}`)}`), 'DEPLOYMENT_MISMATCH'],
    ['a pool word with high bits', 14, (id: number) => result(id, `0x${'1'.repeat(24)}${POOL_500.slice(2)}`), 'RPC_RESPONSE_INVALID'],
    ['a short quote return', 17, (id: number) => result(id, `0x${word(1n)}${word(SQRT)}${word(1n)}`), 'RPC_RESPONSE_INVALID'],
  ] as const)('fails closed on %s', async (_label, index, response, code) => {
    await rejectsWith(collect(WETH_USDC, at(index, response)), code, index);
  });

  it('enforces the overall deadline and validates its input', async () => {
    const time = clock();
    const chain = fakeChain({ respond: () => { time.advance(1_500); return undefined; } });
    await rejectsWith(collectBaseTranscript({ swap: WETH_USDC, mode: 'LIVE_READ_ONLY', providerHost: P.providerHost },
      { transport: chain.transport, now: time.now, wait: async () => {}, settleMs: 0 }, context), 'TRANSPORT_FAILED');
    for (const input of [
      { swap: WETH_USDC, mode: 'MOCKED', providerHost: P.providerHost },
      { swap: WETH_USDC, mode: 'LIVE_READ_ONLY', providerHost: 'other.example' },
      { swap: { ...WETH_USDC, amountIn: '0' }, mode: 'LIVE_READ_ONLY', providerHost: P.providerHost },
      { swap: { ...WETH_USDC, amountIn: '1000000000000000000001' }, mode: 'LIVE_READ_ONLY', providerHost: P.providerHost },
      { swap: { from: 'WETH', to: 'WETH', amountIn: '1' }, mode: 'LIVE_READ_ONLY', providerHost: P.providerHost },
      { swap: WETH_USDC, mode: 'LIVE_READ_ONLY', providerHost: P.providerHost, extra: 1 },
    ]) {
      const idle = fakeChain();
      await rejectsWith(collectBaseTranscript(input, { transport: idle.transport, now: () => 0, wait: async () => {}, settleMs: 0 }, context), 'INPUT_INVALID', 0);
      expect(idle.requests).toHaveLength(0);
    }
  });

  it('maps a non-coded transport failure to an internal error without details', async () => {
    const failure = await rejectsWith(collectBaseTranscript({ swap: WETH_USDC, mode: 'LIVE_READ_ONLY', providerHost: P.providerHost },
      { transport: async () => { throw new Error('secret detail'); }, now: () => NOW_S * 1000, wait: async () => {}, settleMs: 0 }, context), 'INTERNAL_ERROR', 1);
    expect(failure.message).toBe('INTERNAL_ERROR');
  });
});
