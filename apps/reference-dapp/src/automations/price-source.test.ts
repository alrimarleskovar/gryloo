// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { chainlinkSource, decodeAbiString, fixtureSource, readOnlyRpc, scaledPrice } from './price-source.ts';

const NOW = new Date('2026-10-08T10:00:00Z');
const FEED = '0x' + '7'.repeat(40);
const word = (value: bigint) => (value < 0n ? (1n << 256n) + value : value).toString(16).padStart(64, '0');
const abiString = (text: string) => '0x' + word(32n) + word(BigInt(text.length)) + Buffer.from(text).toString('hex').padEnd(64, '0');
type Script = { chain?: string; description?: string; decimals?: bigint; answer?: bigint; updatedAt?: bigint; status?: number; throws?: Error };
/** A JSON-RPC double for one Chainlink proxy; records every method it was asked for. */
function node(script: Script = {}) {
  const methods: string[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params: [{ to: string; data: string }] };
    methods.push(body.method);
    if (script.throws) throw script.throws;
    if (script.status) return new Response('{}', { status: script.status });
    const result = body.method === 'eth_chainId' ? script.chain ?? '0x2105'
      : body.params[0].data === '0x7284e416' ? abiString(script.description ?? 'ETH / USD')
        : body.params[0].data === '0x313ce567' ? '0x' + word(script.decimals ?? 8n)
          : '0x' + word(18446744073709552001n) + word(script.answer ?? 295_012_345_678n) + word(1n) + word(script.updatedAt ?? BigInt(NOW.getTime() / 1000 - 60)) + word(1n);
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, methods };
}
const source = (script: Script = {}, maxAgeMs = 3_600_000) => { const n = node(script);
  return { n, s: chainlinkSource({ rpc: readOnlyRpc('https://base.example', n.fetch), feeds: { ETH: FEED }, maxAgeMs }) }; };

describe('BUILD-AUTOMATION-001 read-only price sources', () => {
  it('refuses every JSON-RPC method that is not a read, before anything is sent', async () => {
    const n = node(), rpc = readOnlyRpc('https://base.example', n.fetch);
    for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'eth_accounts', 'wallet_addEthereumChain'])
      await expect(rpc(method, [])).rejects.toThrow('AUTOMATION_RPC_METHOD_FORBIDDEN');
    expect(n.methods).toEqual([]);
  });

  it('observes a verified Chainlink USD feed with its own timestamp and on-chain provenance', async () => {
    const { s, n } = source();
    expect(s.assets).toEqual(['ETH']);
    expect(await s.observe('ETH', NOW)).toEqual({ ok: true, observation: { asset: 'ETH', priceUsd: '2950.12345678', observedAt: '2026-10-08T09:59:00.000Z',
      receivedAt: NOW.toISOString(), source: 'CHAINLINK', evidence: 'PUBLIC_READ_ONLY', provenance: { network: 'base', chainId: 8453, feed: FEED,
        roundId: '18446744073709552001', description: 'ETH / USD' } } });
    // The chain and the feed are verified once; later observations read only the round.
    await s.observe('ETH', NOW);
    expect(n.methods).toEqual(['eth_chainId', 'eth_call', 'eth_call', 'eth_call', 'eth_call']);
    expect(await s.observe('BTC', NOW)).toEqual({ ok: false, code: 'PRICE_ASSET_UNSUPPORTED' });
  });

  it('fails closed on the wrong chain, a feed that is not the asset’s USD feed, stale or invalid answers and provider failures', async () => {
    expect(await source({ chain: '0x1' }).s.observe('ETH', NOW)).toEqual({ ok: false, code: 'PRICE_SOURCE_WRONG_CHAIN' });
    expect(await source({ description: 'BTC / USD' }).s.observe('ETH', NOW)).toEqual({ ok: false, code: 'PRICE_FEED_MISMATCH' });
    expect(await source({ decimals: 40n }).s.observe('ETH', NOW)).toEqual({ ok: false, code: 'PRICE_FEED_MISMATCH' });
    expect(await source({ updatedAt: BigInt(NOW.getTime() / 1000 - 7_200) }).s.observe('ETH', NOW)).toEqual({ ok: false, code: 'PRICE_STALE' });
    expect(await source({ answer: -5n }).s.observe('ETH', NOW)).toEqual({ ok: false, code: 'PRICE_SOURCE_RESPONSE_INVALID' });
    expect(await source({ status: 429 }).s.observe('ETH', NOW)).toEqual({ ok: false, code: 'PRICE_SOURCE_RATE_LIMITED' });
    expect(await source({ status: 500 }).s.observe('ETH', NOW)).toEqual({ ok: false, code: 'PRICE_SOURCE_ERROR' });
    expect(await source({ throws: Object.assign(new Error('t'), { name: 'TimeoutError' }) }).s.observe('ETH', NOW)).toEqual({ ok: false, code: 'PRICE_SOURCE_TIMEOUT' });
    expect(await source({ throws: new TypeError('fetch failed') }).s.observe('ETH', NOW)).toEqual({ ok: false, code: 'PRICE_SOURCE_UNREACHABLE' });
  });

  it('decodes ABI strings and scales answers exactly', () => {
    expect(decodeAbiString(abiString('SOL / USD'))).toBe('SOL / USD');
    expect(() => decodeAbiString('0x1234')).toThrow('PRICE_SOURCE_RESPONSE_INVALID');
    expect(scaledPrice(295_012_345_678n, 8)).toBe('2950.12345678');
    expect(scaledPrice(2_950_123_456_789_012_345_678n, 18)).toBe('2950.12345678');
    expect(scaledPrice(2_950n, 0)).toBe('2950');
  });

  it('serves fixture observations (MOCKED) and treats old ones as stale', async () => {
    const files: Record<string, string> = { '/tmp/p.json': JSON.stringify({ ETH: { priceUsd: '2950.5', observedAt: '2026-10-08T09:30:00Z' }, BTC: { priceUsd: '100000' },
      SOL: { priceUsd: 'cheap' } }) };
    const s = fixtureSource('/tmp/p.json', 3_600_000, async p => files[p]!);
    expect(await s.observe('ETH', NOW)).toMatchObject({ ok: true, observation: { priceUsd: '2950.5', source: 'FIXTURE', evidence: 'MOCKED' } });
    expect(await s.observe('BTC', NOW)).toMatchObject({ ok: true, observation: { observedAt: NOW.toISOString() } });
    expect(await s.observe('SOL', NOW)).toEqual({ ok: false, code: 'PRICE_SOURCE_RESPONSE_INVALID' });
    expect(await s.observe('ETH', new Date('2026-10-08T11:00:00Z'))).toEqual({ ok: false, code: 'PRICE_STALE' });
    expect(await fixtureSource('/tmp/missing.json', 1, async () => { throw new Error('ENOENT'); }).observe('ETH', NOW)).toEqual({ ok: false, code: 'PRICE_SOURCE_UNREACHABLE' });
  });
});
