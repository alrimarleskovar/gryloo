// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { outputSafe } from '../channels/core/delivery.ts';
import { readAutomationConfig, parseFeeds } from './config.ts';
import { notificationText } from './copy.ts';
import { handleAutomationDispatch, handleAutomationHealth } from './http.ts';
import type { OccurrenceRecord, RuleRecord } from './store.ts';

const SECRET = randomBytes(32).toString('hex');
const base = (patch: Record<string, string | undefined> = {}) => ({ FLOFI_AUTOMATIONS: 'enabled', FLOFI_AUTOMATION_SECRET: SECRET, FLOFI_PUBLIC_ORIGIN: 'https://flofi.test', ...patch });
const reason = (env: Record<string, string | undefined>) => { const c = readAutomationConfig(env); return c.enabled ? 'ENABLED' : 'reason' in c ? c.reason : c.code; };
const FEED = '0x' + 'ab'.repeat(20);

describe('BUILD-AUTOMATION-001 configuration (fail closed)', () => {
  it('is off unless enabled, and needs a dedicated secret and the public origin', () => {
    expect(reason({})).toBe('AUTOMATIONS_NOT_ENABLED');
    expect(reason({ FLOFI_AUTOMATIONS: 'yes' })).toBe('FLOFI_AUTOMATIONS');
    expect(reason(base())).toBe('ENABLED');
    expect(reason(base({ FLOFI_AUTOMATION_SECRET: 'short' }))).toBe('FLOFI_AUTOMATION_SECRET');
    expect(reason(base({ FLOFI_PUBLIC_ORIGIN: undefined }))).toBe('FLOFI_PUBLIC_ORIGIN');
    for (const name of ['API_AUTH_TOKEN', 'FLOFI_SESSION_SECRET', 'FLOFI_MCP_OAUTH_SECRET', 'FLOFI_DEVELOPER_SECRET', 'FLOFI_CHANNEL_SECRET'])
      expect(reason(base({ [name]: SECRET }))).toBe('FLOFI_AUTOMATION_SECRET_REUSED');
  });

  it('keeps mainnet off by default and accepts only mainnet ids in the mainnet list', () => {
    const c = readAutomationConfig(base());
    expect(c.enabled && c.policy).toEqual({ ok: true, testFunds: true, mainnetNetworks: [] });
    expect(reason(base({ FLOFI_AUTOMATION_HANDOFF_MAINNET_NETWORKS: 'base-sepolia' }))).toBe('FLOFI_AUTOMATION_HANDOFF_MAINNET_NETWORKS');
    expect(reason(base({ FLOFI_AUTOMATION_HANDOFF_TEST_FUNDS: 'maybe' }))).toBe('FLOFI_AUTOMATION_HANDOFF_TEST_FUNDS');
  });

  it('validates the price source: Chainlink feeds and https RPC, fixture and test clock never on a hosted deployment', () => {
    expect(reason(base({ FLOFI_AUTOMATION_PRICE_SOURCE: 'coingecko' }))).toBe('FLOFI_AUTOMATION_PRICE_SOURCE');
    expect(reason(base({ FLOFI_AUTOMATION_PRICE_SOURCE: 'chainlink' }))).toBe('FLOFI_AUTOMATION_CHAINLINK_FEEDS');
    const c = readAutomationConfig(base({ FLOFI_AUTOMATION_PRICE_SOURCE: 'chainlink', FLOFI_AUTOMATION_CHAINLINK_FEEDS: `ETH=${FEED}`, GRYLOO_BASE_RPC_URL: 'https://base.example/v2/key' }));
    expect(c.enabled && c.price).toEqual({ kind: 'chainlink', rpcUrl: 'https://base.example/v2/key', feeds: { ETH: FEED }, maxAgeMs: 3_600_000 });
    expect(reason(base({ FLOFI_AUTOMATION_PRICE_SOURCE: 'chainlink', FLOFI_AUTOMATION_CHAINLINK_FEEDS: `ETH=${FEED}`, FLOFI_AUTOMATION_CHAINLINK_RPC_URL: 'https://u:p@base.example' })))
      .toBe('FLOFI_AUTOMATION_CHAINLINK_RPC_URL');
    expect(reason(base({ FLOFI_AUTOMATION_PRICE_SOURCE: 'chainlink', FLOFI_AUTOMATION_CHAINLINK_FEEDS: `ETH=${FEED}`, FLOFI_AUTOMATION_CHAINLINK_RPC_URL: 'http://127.0.0.1:8545',
      VERCEL: '1', VERCEL_ENV: 'production' }))).toBe('FLOFI_AUTOMATION_CHAINLINK_RPC_URL');
    expect(parseFeeds(`ETH=${FEED},ETH=${FEED}`)).toBeNull();
    expect(parseFeeds(`DOGE=${FEED}`)).toBeNull();
    expect(reason(base({ FLOFI_AUTOMATION_PRICE_SOURCE: 'fixture', FLOFI_AUTOMATION_PRICE_FIXTURE: '/tmp/prices.json' }))).toBe('ENABLED');
    expect(reason(base({ FLOFI_AUTOMATION_PRICE_SOURCE: 'fixture', FLOFI_AUTOMATION_PRICE_FIXTURE: '/home/prices.json' }))).toBe('FLOFI_AUTOMATION_PRICE_FIXTURE');
    expect(reason(base({ FLOFI_AUTOMATION_PRICE_SOURCE: 'fixture', FLOFI_AUTOMATION_PRICE_FIXTURE: '/tmp/prices.json', FLOFI_DEPLOYMENT: 'hosted' }))).toBe('FLOFI_AUTOMATION_PRICE_FIXTURE');
    expect(reason(base({ FLOFI_AUTOMATION_TEST_CLOCK: 'enabled', FLOFI_DEPLOYMENT: 'hosted' }))).toBe('FLOFI_AUTOMATION_TEST_CLOCK');
    expect(reason(base({ FLOFI_AUTOMATION_PRICE_MAX_AGE_SECONDS: '5' }))).toBe('FLOFI_AUTOMATION_PRICE_MAX_AGE_SECONDS');
  });
});

describe('BUILD-AUTOMATION-001 operator endpoints', () => {
  const token = randomBytes(24).toString('base64url'), digest = createHash('sha256').update(token).digest('hex');
  const call = (handler: typeof handleAutomationDispatch, env: Record<string, string | undefined>, init: RequestInit = {}) =>
    handler(new Request('http://127.0.0.1/api/automations/dispatch', init), { env });
  it('do not exist unless automations and the scheduler digest are configured, and refuse a wrong bearer', async () => {
    expect((await call(handleAutomationDispatch, {})).status).toBe(404);
    expect((await call(handleAutomationDispatch, base())).status).toBe(404);
    expect((await call(handleAutomationHealth, base())).status).toBe(404);
    const env = base({ FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256: digest });
    expect((await call(handleAutomationDispatch, env)).status).toBe(401);
    expect((await call(handleAutomationDispatch, env, { headers: { authorization: 'Bearer not-the-scheduler-token' } })).status).toBe(401);
    expect((await call(handleAutomationDispatch, env, { method: 'PUT' })).status).toBe(405);
    // The test clock is refused unless explicitly enabled (and it can never be enabled on a hosted deployment).
    const clocked = await call(handleAutomationDispatch, env, { headers: { authorization: `Bearer ${token}`, 'x-flofi-automation-now': '2030-01-01T00:00:00Z' } });
    expect([clocked.status, await clocked.json()]).toEqual([400, { ok: false, code: 'AUTOMATION_TEST_CLOCK_REFUSED' }]);
    // Without the embedded runtime there is no store: closed, never a fallback.
    const offline = await call(handleAutomationDispatch, env, { headers: { authorization: `Bearer ${token}` } });
    expect([offline.status, await offline.json()]).toEqual([503, { ok: false, code: 'AUTOMATION_STORE_UNAVAILABLE' }]);
  });
});

describe('BUILD-AUTOMATION-001 notification copy', () => {
  const rule = { name: 'ETH dip', definition: { condition: { type: 'PRICE_BELOW', asset: 'ETH', threshold: '3000', checkEveryMinutes: 15 } } } as unknown as RuleRecord;
  const occurrence = { kind: 'PRICE', occurrenceId: 'occ_' + 'a'.repeat(26), strategy: { version: 1, action: 'swap', network: 'base-sepolia', inputAsset: 'USDC',
    outputAsset: 'WETH', amount: '100', slippageBps: 50 }, observation: { asset: 'ETH', priceUsd: '2950.12345678', source: 'CHAINLINK', evidence: 'PUBLIC_READ_ONLY' } } as unknown as OccurrenceRecord;
  it('states the observation, the condition and the action, and that nothing is authorized (EN/PT)', () => {
    expect(notificationText('EN', rule, occurrence)).toBe(['FloFi automation “ETH dip”: ETH observed at $2,950.12 (Chainlink) — your condition “ETH below $3,000” is met.',
      'Prepare 100 USDC → WETH on Base Sepolia?', 'Nothing is authorized: open FloFi, run a fresh simulation, review the Strategy Manifest and sign with your own wallet.'].join('\n'));
    expect(notificationText('PT', rule, occurrence)).toMatch(/^Automação do FloFi “ETH dip”: ETH observado em \$2,950\.12 \(Chainlink\)[\s\S]*Preparar 100 USDC → WETH na Base Sepolia\?\nNada está autorizado/);
    expect(notificationText('EN', rule, { ...occurrence, strategy: null } as OccurrenceRecord)).toMatch(/This automation only notifies you\.$/);
  });
  it('passes the channel output guard with its workspace link, which carries no secret; an approval-looking link does not', () => {
    const reply = { text: notificationText('EN', rule, occurrence), choices: [], link: { label: 'Open in FloFi', url: `https://flofi.test/app/automations?occurrence=${occurrence.occurrenceId}` } };
    expect(outputSafe(reply, 'https://flofi.test')).toBe(true);
    expect(outputSafe({ ...reply, link: { label: 'x', url: 'https://flofi.test/app/automations?occurrence=occ_x&secret=1' } }, 'https://flofi.test')).toBe(false);
    expect(outputSafe({ ...reply, link: { label: 'x', url: 'https://evil.test/app/automations' } }, 'https://flofi.test')).toBe(false);
    expect(outputSafe({ ...reply, text: 'flofi_auhs_' + 'a'.repeat(43) }, 'https://flofi.test')).toBe(false);
  });
});
