// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { readiness, readinessProbes } from './readiness.ts';

// Split so the fixture is never mistaken for a live key by secret scanners.
const SECRETS = { OPENAI_API_KEY: ['sk', 'proj', 'SECRETOPENAIKEY000000000000'].join('-'), API_AUTH_TOKEN: 'apitoken-SECRET-0123456789abcdef0123456789',
  FLOFI_SESSION_SECRET: 'session-SECRET-0123456789abcdef0123456789', DATABASE_URL: 'postgres://flofi:DBPASSWORD@db.internal.example:5432/flofi',
  GRYLOO_BASE_SEPOLIA_RPC_URL: 'https://base-sepolia.g.example.com/v2/RPCKEYBASE123', GRYLOO_ETHEREUM_SEPOLIA_RPC_URL: 'https://eth-sepolia.example.com/RPCKEYETH456',
  GRYLOO_SOLANA_DEVNET_RPC_URL: 'https://devnet.example.com/RPCKEYSOL789', JUPITER_API_KEY: 'JUPITERSECRETKEY', LIFI_API_KEY: 'LIFISECRETKEY' };
const leaked = (report: unknown) => Object.values(SECRETS).flatMap(secret => [secret, ...secret.match(/[A-Z]{6,}[A-Z0-9]*/g) ?? []])
  .filter(fragment => JSON.stringify(report).includes(fragment));
/** A JSON-RPC endpoint double answering by URL; it records which hosts were asked. */
function chains(answers: Record<string, unknown | ((method: string) => unknown)>) {
  const asked: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), host = new URL(url).host, method = (JSON.parse(String(init?.body)) as { method: string }).method;
    asked.push(host);
    const answer = answers[host];
    if (answer === undefined) throw new Error('connect ECONNREFUSED ' + url);
    const result = typeof answer === 'function' ? answer(method) : answer;
    if (result === 429) return new Response('slow down', { status: 429 });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
  }) as typeof fetch;
  return { fetcher, asked };
}

describe('BUILD-CLOUD-PARITY-001 readiness', () => {
  it('reports a hosted deployment without a runtime as not ready, and never echoes a secret, URL or credential', async () => {
    const env = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'claude/build-cloud-parity-001', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), VERCEL_REGION: 'iad1',
      FLOFI_COPILOT: 'live', ...SECRETS, DATABASE_URL: '' };
    const { fetcher } = chains({});
    const report = await readiness({ env, networks: true, fetcher });
    expect(report).toMatchObject({ ok: false, runtime: { kind: 'unconfigured', status: 'NOT_CONFIGURED' }, session: { status: 'CONFIGURED' },
      deployment: { environment: 'preview', hosted: true, commit: 'a'.repeat(40), branch: 'claude/build-cloud-parity-001', region: 'iad1' },
      copilot: { mode: 'unavailable' }, localOnly: { 'across-mocked-demo': 'ACROSS_MOCKED_DEMO_LOCAL_ONLY', 'cow-mocked-loopback': 'COW_OFF' } });
    // Every flow fails closed on an unconfigured hosted runtime.
    expect(new Set(Object.values(report.flows))).toEqual(new Set(['off']));
    expect(Object.values(report.networks!).every(n => n.status === 'UNREACHABLE')).toBe(true);
    expect(leaked(report)).toEqual([]);
    expect(JSON.stringify(report)).not.toMatch(/https?:\/\/|postgres:|ECONNREFUSED/);
  });
  it('probes exactly the endpoints the flows use and classifies chain identity, throttling and bad configuration', async () => {
    const env = { GRYLOO_BASE_SEPOLIA_RPC_URL: SECRETS.GRYLOO_BASE_SEPOLIA_RPC_URL, GRYLOO_ETHEREUM_SEPOLIA_RPC_URL: 'http://plain.example', GRYLOO_SOLANA_DEVNET_RPC_URL: SECRETS.GRYLOO_SOLANA_DEVNET_RPC_URL };
    const { fetcher, asked } = chains({
      'base-sepolia.g.example.com': (m: string) => m === 'eth_chainId' ? '0x14a34' : '0x2dc6c0',
      'sepolia-rollup.arbitrum.io': '0x1',                                   // a provider answering for another chain
      'rpc.testnet.chain.robinhood.com': 429,
      'devnet.example.com': (m: string) => m === 'getGenesisHash' ? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' : 4242,
    });
    const report = await readiness({ env, networks: true, fetcher, now: (() => { let t = 0; return () => (t += 7); })() });
    expect(report.networks).toMatchObject({
      'base-sepolia': { status: 'REACHABLE', chain: 'eip155:84532', endpoint: 'DEPLOYMENT_OVERRIDE', block: 3_000_000 },
      'base-sepolia-aave': { status: 'REACHABLE', endpoint: 'DEPLOYMENT_OVERRIDE' },          // one Base Sepolia setting for every flow
      'ethereum-sepolia': { status: 'CONFIGURATION_INVALID', endpoint: 'DEPLOYMENT_OVERRIDE' }, // plain HTTP is refused, never followed
      'arbitrum-sepolia': { status: 'WRONG_CHAIN', endpoint: 'PUBLIC_DEFAULT' },
      'solana-devnet': { status: 'REACHABLE', block: 4242 },
      base: { status: 'UNREACHABLE' }, solana: { status: 'UNREACHABLE' } });
    expect(['RATE_LIMITED', 'UNREACHABLE']).toContain(report.networks!['robinhood-testnet']!.status);
    expect(asked).not.toContain('plain.example');
    expect(leaked(report)).toEqual([]);
  });
  it('lists every supported network once with its expected chain', () => {
    expect(readinessProbes({}).map(p => `${p.name}=${p.chain}`)).toEqual(['base-sepolia=eip155:84532', 'base-sepolia-aave=eip155:84532', 'ethereum-sepolia=eip155:11155111',
      'arbitrum-sepolia=eip155:421614', 'robinhood-testnet=eip155:46630', 'solana-devnet=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'base=eip155:8453',
      'arbitrum=eip155:42161', 'solana=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp']);
  });
  it('local development is reported as such, with no flow probing through a cloud runtime', async () => {
    const report = await readiness({ env: {}, fetcher: chains({}).fetcher });
    expect(report).toMatchObject({ ok: true, runtime: { kind: 'local', status: 'LOCAL_DEVELOPMENT' }, session: { status: 'LOCAL_PROCESS_KEY' }, flows: {}, localOnly: {} });
    expect(report.networks).toBeUndefined();
  });
  it('a remote API runtime is READY only when the API answers its readiness probe', async () => {
    const env = { API_BASE_URL: 'https://api.flofi.example', API_AUTH_TOKEN: SECRETS.API_AUTH_TOKEN, VERCEL: '1', VERCEL_ENV: 'production' };
    const up = (async (input: string | URL | Request) => new Response(JSON.stringify(String(input).endsWith('/readyz') ? { ok: true } : { ok: true, value: 'live' }))) as typeof fetch;
    expect((await readiness({ env, fetcher: up })).runtime).toEqual({ kind: 'remote', status: 'READY', tenant: null, schemaVersion: null });
    const down = (async () => { throw new Error('getaddrinfo ENOTFOUND api.flofi.example'); }) as typeof fetch;
    const report = await readiness({ env, fetcher: down });
    expect(report).toMatchObject({ ok: false, runtime: { kind: 'remote', status: 'CLOUD_API_UNAVAILABLE' } });
    expect(JSON.stringify(report)).not.toContain('api.flofi.example');
  });
});
