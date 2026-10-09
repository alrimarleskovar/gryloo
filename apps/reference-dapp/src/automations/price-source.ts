// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: read-only market observations behind one provider abstraction. A price is a deterministic input to a
 * comparison and nothing else: no source can sign, submit, approve or move anything, and a failed, slow or stale observation changes
 * no automation state.
 *
 *   chainlink   Chainlink AggregatorV3 proxies on Base mainnet, read with `eth_call` (latestRoundData, decimals, description) through
 *               a configured RPC endpoint. Feed addresses are CONFIGURATION, never unverified pins in code; before any answer is used,
 *               the endpoint must report chain 8453 and the feed must describe itself as "<ASSET> / USD" with sane decimals. The
 *               answer's own `updatedAt` is the observation time. Evidence: PUBLIC_READ_ONLY.
 *   fixture     a JSON file under /tmp for tests and local rehearsals (refused on hosted deployments). Evidence: MOCKED.
 *   off         every observation is PRICE_SOURCE_OFF.
 *
 * The transport can only send `eth_chainId` and `eth_call`; any other method (`eth_sendRawTransaction`, `eth_sendTransaction`, …) is
 * refused before anything leaves the process (AUTOMATION_RPC_METHOD_FORBIDDEN). Every request is bounded (5 s, 64 KiB, no redirects).
 */
import { readFile } from 'node:fs/promises';
import { formatScaled, parseScaled, PRICE_SCALE } from './decimal.ts';
import { OBSERVED_ASSETS, type ObservedAsset } from './trigger.ts';

export type PriceEvidence = 'PUBLIC_READ_ONLY' | 'MOCKED';
export type PriceObservation = {
  readonly asset: ObservedAsset; readonly priceUsd: string; readonly observedAt: string; readonly receivedAt: string;
  readonly source: 'CHAINLINK' | 'FIXTURE'; readonly evidence: PriceEvidence;
  readonly provenance: { readonly network?: 'base'; readonly chainId?: number; readonly feed?: string; readonly roundId?: string; readonly description?: string };
};
export type PriceResult = { readonly ok: true; readonly observation: PriceObservation } | { readonly ok: false; readonly code: string };
export interface PriceSource {
  readonly id: 'chainlink' | 'fixture' | 'off';
  /** Observations older than this (by the source's own timestamp) are stale and never used. */
  readonly maxAgeMs: number;
  /** The assets this source can observe on this deployment. */
  readonly assets: readonly ObservedAsset[];
  readonly observe: (asset: ObservedAsset, now: Date) => Promise<PriceResult>;
}
/** Fresh: not older than `maxAgeMs` and not more than a minute in the future. */
export const observationFresh = (o: PriceObservation, now: Date, maxAgeMs: number) => {
  const at = Date.parse(o.observedAt);
  return Number.isFinite(at) && now.getTime() - at <= maxAgeMs && at - now.getTime() <= 60_000;
};

export const OFF_SOURCE: PriceSource = Object.freeze({ id: 'off', maxAgeMs: 0, assets: [], observe: async () => ({ ok: false, code: 'PRICE_SOURCE_OFF' }) as const });

// ── JSON-RPC (read-only by construction) ───────────────────────────────────────────────────────────────────────────────────────
export const PRICE_RPC_METHODS: ReadonlySet<string> = new Set(['eth_chainId', 'eth_call']);
export type RpcTransport = (method: string, params: readonly unknown[]) => Promise<unknown>;
/** A JSON-RPC transport that refuses every method outside the read allowlist before any byte is sent. */
export function readOnlyRpc(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5_000): RpcTransport {
  let id = 0;
  return async (method, params) => {
    if (!PRICE_RPC_METHODS.has(method)) throw new Error('AUTOMATION_RPC_METHOD_FORBIDDEN');
    let response: Response;
    try {
      response = await fetchImpl(url, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    } catch (error) {
      throw new Error(error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'PRICE_SOURCE_TIMEOUT' : 'PRICE_SOURCE_UNREACHABLE', { cause: error });
    }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(response.status === 429 ? 'PRICE_SOURCE_RATE_LIMITED' : 'PRICE_SOURCE_ERROR'); }
    const text = await response.text().catch(() => '');
    if (!text || text.length > 65_536) throw new Error('PRICE_SOURCE_RESPONSE_INVALID');
    let body: { result?: unknown; error?: unknown };
    try { body = JSON.parse(text) as typeof body; } catch { throw new Error('PRICE_SOURCE_RESPONSE_INVALID'); }
    if (!body || typeof body !== 'object' || body.error !== undefined || body.result === undefined) throw new Error('PRICE_SOURCE_ERROR');
    return body.result;
  };
}

const SELECTORS = Object.freeze({ latestRoundData: '0xfeaf968c', decimals: '0x313ce567', description: '0x7284e416' });
const HEX = /^0x[0-9a-fA-F]*$/;
const words = (hex: unknown): bigint[] => {
  if (typeof hex !== 'string' || !HEX.test(hex) || (hex.length - 2) % 64 !== 0) throw new Error('PRICE_SOURCE_RESPONSE_INVALID');
  return Array.from({ length: (hex.length - 2) / 64 }, (_, i) => BigInt('0x' + hex.slice(2 + i * 64, 66 + i * 64)));
};
/** The ABI `string` return value (offset, length, bytes), bounded. */
export function decodeAbiString(hex: unknown): string {
  const w = words(hex);
  if (w.length < 2 || w[0] !== 32n || w[1]! > 64n) throw new Error('PRICE_SOURCE_RESPONSE_INVALID');
  const length = Number(w[1]), bytes = Buffer.from((hex as string).slice(2 + 128, 2 + 128 + length * 2), 'hex');
  if (bytes.length !== length) throw new Error('PRICE_SOURCE_RESPONSE_INVALID');
  return bytes.toString('utf8');
}
const INT256 = 1n << 255n, UINT256 = 1n << 256n;
/** latestRoundData() → (roundId, answer, startedAt, updatedAt, answeredInRound). */
export function decodeRound(hex: unknown): { readonly roundId: bigint; readonly answer: bigint; readonly updatedAt: bigint } {
  const w = words(hex);
  if (w.length !== 5) throw new Error('PRICE_SOURCE_RESPONSE_INVALID');
  const answer = w[1]! >= INT256 ? w[1]! - UINT256 : w[1]!;
  return { roundId: w[0]!, answer, updatedAt: w[3]! };
}
/** An integer answer with `decimals` → the exact decimal USD price at PRICE_SCALE (truncated beyond 8 decimals). */
export function scaledPrice(answer: bigint, decimals: number): string {
  const units = decimals >= PRICE_SCALE ? answer / 10n ** BigInt(decimals - PRICE_SCALE) : answer * 10n ** BigInt(PRICE_SCALE - decimals);
  return formatScaled(units, PRICE_SCALE);
}

export type ChainlinkConfig = { readonly rpc: RpcTransport; readonly feeds: Readonly<Partial<Record<ObservedAsset, string>>>; readonly maxAgeMs: number };
const BASE_CHAIN_ID = 8453;
/** The Chainlink source: every feed is verified on-chain (chain, description, decimals) once per process before its answers are used. */
export function chainlinkSource(config: ChainlinkConfig): PriceSource {
  const verified = new Map<ObservedAsset, Promise<{ decimals: number; description: string }>>();
  let chain: Promise<void> | null = null;
  const call = (to: string, data: string) => config.rpc('eth_call', [{ to, data }, 'latest']);
  const verifyChain = () => chain ??= (async () => {
    const id = await config.rpc('eth_chainId', []);
    if (typeof id !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(id) || Number.parseInt(id, 16) !== BASE_CHAIN_ID) throw new Error('PRICE_SOURCE_WRONG_CHAIN');
  })().catch(error => { chain = null; throw error; });
  const verifyFeed = (asset: ObservedAsset, feed: string) => {
    let v = verified.get(asset);
    if (!v) {
      v = (async () => {
        await verifyChain();
        const description = decodeAbiString(await call(feed, SELECTORS.description));
        const decimals = Number(words(await call(feed, SELECTORS.decimals))[0] ?? -1n);
        if (description !== `${asset} / USD`) throw new Error('PRICE_FEED_MISMATCH');
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error('PRICE_FEED_MISMATCH');
        return { decimals, description };
      })();
      v.catch(() => verified.delete(asset));
      verified.set(asset, v);
    }
    return v;
  };
  const assets = OBSERVED_ASSETS.filter(a => Boolean(config.feeds[a]));
  return Object.freeze({ id: 'chainlink' as const, maxAgeMs: config.maxAgeMs, assets, async observe(asset: ObservedAsset, now: Date): Promise<PriceResult> {
    const feed = config.feeds[asset];
    if (!feed) return { ok: false, code: 'PRICE_ASSET_UNSUPPORTED' } as const;
    try {
      const { decimals, description } = await verifyFeed(asset, feed);
      const round = decodeRound(await call(feed, SELECTORS.latestRoundData));
      if (round.answer <= 0n || round.updatedAt <= 0n || round.updatedAt > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))) return { ok: false, code: 'PRICE_SOURCE_RESPONSE_INVALID' } as const;
      const observation: PriceObservation = { asset, priceUsd: scaledPrice(round.answer, decimals), observedAt: new Date(Number(round.updatedAt) * 1000).toISOString(),
        receivedAt: now.toISOString(), source: 'CHAINLINK', evidence: 'PUBLIC_READ_ONLY',
        provenance: { network: 'base', chainId: BASE_CHAIN_ID, feed: feed.toLowerCase(), roundId: round.roundId.toString(), description } };
      return observationFresh(observation, now, config.maxAgeMs) ? { ok: true, observation } as const : { ok: false, code: 'PRICE_STALE' } as const;
    } catch (error) {
      return { ok: false, code: error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message) ? error.message : 'PRICE_SOURCE_ERROR' } as const;
    }
  } });
}

/**
 * The fixture source: `{ "ETH": { "priceUsd": "2950.5", "observedAt": "2026-10-08T09:00:00Z" }, … }` read on every observation (tests
 * rewrite it). An entry without `observedAt` is observed "now".
 */
export function fixtureSource(path: string, maxAgeMs: number, read: (path: string) => Promise<string> = p => readFile(p, 'utf8')): PriceSource {
  return Object.freeze({ id: 'fixture' as const, maxAgeMs, assets: [...OBSERVED_ASSETS], async observe(asset: ObservedAsset, now: Date): Promise<PriceResult> {
    let entry: { priceUsd?: unknown; observedAt?: unknown } | undefined;
    try { entry = (JSON.parse(await read(path)) as Record<string, typeof entry>)[asset]; } catch { return { ok: false, code: 'PRICE_SOURCE_UNREACHABLE' } as const; }
    if (!entry) return { ok: false, code: 'PRICE_ASSET_UNSUPPORTED' } as const;
    const units = parseScaled(entry.priceUsd, PRICE_SCALE), observedAt = entry.observedAt === undefined ? now.toISOString() : entry.observedAt;
    if (units === null || units <= 0n || typeof observedAt !== 'string' || Number.isNaN(Date.parse(observedAt))) return { ok: false, code: 'PRICE_SOURCE_RESPONSE_INVALID' } as const;
    const observation: PriceObservation = { asset, priceUsd: formatScaled(units, PRICE_SCALE), observedAt: new Date(observedAt).toISOString(), receivedAt: now.toISOString(),
      source: 'FIXTURE', evidence: 'MOCKED', provenance: {} };
    return observationFresh(observation, now, maxAgeMs) ? { ok: true, observation } as const : { ok: false, code: 'PRICE_STALE' } as const;
  } });
}
