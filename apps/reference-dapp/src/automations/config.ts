// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: automation configuration — server-only, never `NEXT_PUBLIC_*`. Any malformed value disables automations
 * entirely (fail closed); nothing falls back to another secret or widens access.
 *
 *   FLOFI_AUTOMATIONS                          enabled | disabled (default): the Automations workspace, scheduler and approvals
 *   FLOFI_AUTOMATION_SECRET                    ≥ 32 chars, dedicated (refused when equal to API_AUTH_TOKEN, FLOFI_SESSION_SECRET,
 *                                              FLOFI_MCP_OAUTH_SECRET, FLOFI_DEVELOPER_SECRET or FLOFI_CHANNEL_SECRET): HKDF keys for the
 *                                              automation approval-link scheme and the Telegram link codes
 *   FLOFI_PUBLIC_ORIGIN                        the origin approval and notification links point to
 *   FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256     SHA-256 hex of the scheduler's bearer (Vercel Cron: the digest of CRON_SECRET); without it
 *                                              /api/automations/dispatch and /health do not exist (404)
 *   FLOFI_AUTOMATION_HANDOFF_TEST_FUNDS        enabled (default) | disabled
 *   FLOFI_AUTOMATION_HANDOFF_MAINNET_NETWORKS  mainnet network ids an automation may hand to its owner (default none:
 *                                              MAINNET_HANDOFF_DISABLED_BY_POLICY)
 *   FLOFI_AUTOMATION_PRICE_SOURCE              off (default) | chainlink | fixture
 *   FLOFI_AUTOMATION_CHAINLINK_RPC_URL         Base mainnet JSON-RPC (https; default GRYLOO_BASE_RPC_URL, else https://mainnet.base.org)
 *   FLOFI_AUTOMATION_CHAINLINK_FEEDS           `ETH=0x…,BTC=0x…,SOL=0x…` — Chainlink USD proxy addresses on Base mainnet (verified on-chain)
 *   FLOFI_AUTOMATION_PRICE_MAX_AGE_SECONDS     an observation older than this is stale (default 3600; 60–86400)
 *   FLOFI_AUTOMATION_PRICE_FIXTURE             fixture source only: absolute path under /tmp/ (refused on a hosted deployment)
 *   FLOFI_AUTOMATION_TEST_CLOCK                enabled: the bearer dispatch accepts `x-flofi-automation-now` (refused on a hosted deployment)
 *
 * None of this is financial authority: the policy only decides which proposals FloFi will even hand to their owner for review.
 */
import { createHash, hkdfSync, timingSafeEqual } from 'node:crypto';
import { NETWORKS } from '../engine/strategy-engine';
import { NETWORK_IDS, type NetworkId } from '../engine/strategy-spec';
import type { HandoffPolicy } from '../platform/index.ts';
import { deploymentTenant, isHostedDeployment, publicOrigin } from '../server/deployment.ts';
import { chainlinkSource, fixtureSource, OFF_SOURCE, readOnlyRpc, type PriceSource } from './price-source.ts';
import { OBSERVED_ASSETS, type ObservedAsset } from './trigger.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type AutomationKeys = { readonly approval: Buffer; readonly linkCode: Buffer };
export type PriceSourceConfig = { readonly kind: 'off' } | { readonly kind: 'chainlink'; readonly rpcUrl: string; readonly feeds: Readonly<Partial<Record<ObservedAsset, string>>>;
  readonly maxAgeMs: number } | { readonly kind: 'fixture'; readonly path: string; readonly maxAgeMs: number };
export type AutomationConfig = {
  readonly enabled: true; readonly tenantId: string; readonly origin: string; readonly keys: AutomationKeys; readonly policy: Extract<HandoffPolicy, { ok: true }>;
  readonly dispatchTokenDigest: Buffer | null; readonly price: PriceSourceConfig; readonly testClock: boolean; readonly hosted: boolean;
};
export type AutomationConfigResult = AutomationConfig | { readonly enabled: false; readonly code: 'AUTOMATIONS_NOT_ENABLED' | 'AUTOMATION_CONFIGURATION_INVALID'; readonly reason?: string };

const invalid = (reason: string) => ({ enabled: false, code: 'AUTOMATION_CONFIGURATION_INVALID', reason } as const);
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();
const sameSecret = (a: string, b: string | undefined) => b !== undefined && b !== '' && timingSafeEqual(sha256(a), sha256(b));
const derive = (secret: string, label: string) => Buffer.from(hkdfSync('sha256', secret, 'flofi', `flofi/automations/${label}/v1`, 32));
export const automationKeys = (secret: string): AutomationKeys => Object.freeze({ approval: derive(secret, 'approval-link'), linkCode: derive(secret, 'link-code') });
const switchOf = (value: string | undefined, fallback: 'enabled' | 'disabled') => {
  const v = value === undefined || value === '' ? fallback : value;
  return v === 'enabled' ? true : v === 'disabled' ? false : null;
};
const LOOPBACK = /^(?:127\.0\.0\.1|localhost|\[::1\])$/;
/** An https URL without credentials in the userinfo part (an http loopback URL off-hosting, for local rehearsals). */
function rpcUrl(raw: string, hosted: boolean): string | null {
  try {
    const url = new URL(raw);
    if (url.username || url.password || raw.length > 512) return null;
    if (url.protocol === 'https:') return url.toString();
    return url.protocol === 'http:' && LOOPBACK.test(url.hostname) && !hosted ? url.toString() : null;
  } catch { return null; }
}
/** `ETH=0x…,BTC=0x…` → feeds; null on any malformed or duplicate entry. */
export function parseFeeds(raw: string): Partial<Record<ObservedAsset, string>> | null {
  const feeds: Partial<Record<ObservedAsset, string>> = {};
  for (const item of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const match = /^([A-Z]{2,5})=(0x[0-9a-fA-F]{40})$/.exec(item);
    if (!match || !(OBSERVED_ASSETS as readonly string[]).includes(match[1]!) || feeds[match[1] as ObservedAsset]) return null;
    feeds[match[1] as ObservedAsset] = match[2]!.toLowerCase();
  }
  return feeds;
}

export function readAutomationConfig(env: Env): AutomationConfigResult {
  const enabled = switchOf(env.FLOFI_AUTOMATIONS, 'disabled');
  if (enabled === null) return invalid('FLOFI_AUTOMATIONS');
  if (!enabled) return { enabled: false, code: 'AUTOMATIONS_NOT_ENABLED' };
  let tenantId: string;
  try { tenantId = deploymentTenant(env); } catch { return invalid('TENANT'); }
  const origin = publicOrigin(env);
  if (!origin) return invalid('FLOFI_PUBLIC_ORIGIN');
  const secret = env.FLOFI_AUTOMATION_SECRET ?? '';
  if (secret.length < 32 || secret.length > 512) return invalid('FLOFI_AUTOMATION_SECRET');
  if (['API_AUTH_TOKEN', 'FLOFI_SESSION_SECRET', 'FLOFI_MCP_OAUTH_SECRET', 'FLOFI_DEVELOPER_SECRET', 'FLOFI_CHANNEL_SECRET'].some(name => sameSecret(secret, env[name])))
    return invalid('FLOFI_AUTOMATION_SECRET_REUSED');
  const testFunds = switchOf(env.FLOFI_AUTOMATION_HANDOFF_TEST_FUNDS, 'enabled');
  if (testFunds === null) return invalid('FLOFI_AUTOMATION_HANDOFF_TEST_FUNDS');
  const listed = (env.FLOFI_AUTOMATION_HANDOFF_MAINNET_NETWORKS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  // Only mainnet networks may be listed; a test network here is a configuration mistake, not a permission.
  if (!listed.every(n => (NETWORK_IDS as readonly string[]).includes(n) && NETWORKS[n as NetworkId].class === 'MAINNET')) return invalid('FLOFI_AUTOMATION_HANDOFF_MAINNET_NETWORKS');
  const dispatch = (env.FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256 ?? '').trim().toLowerCase();
  if (dispatch !== '' && !/^[0-9a-f]{64}$/.test(dispatch)) return invalid('FLOFI_AUTOMATION_DISPATCH_TOKEN_SHA256');
  const hosted = isHostedDeployment(env);
  const testClock = switchOf(env.FLOFI_AUTOMATION_TEST_CLOCK, 'disabled');
  if (testClock === null || (testClock && hosted)) return invalid('FLOFI_AUTOMATION_TEST_CLOCK');
  const maxAgeSeconds = env.FLOFI_AUTOMATION_PRICE_MAX_AGE_SECONDS === undefined || env.FLOFI_AUTOMATION_PRICE_MAX_AGE_SECONDS === '' ? 3_600
    : /^[0-9]{2,5}$/.test(env.FLOFI_AUTOMATION_PRICE_MAX_AGE_SECONDS) ? Number(env.FLOFI_AUTOMATION_PRICE_MAX_AGE_SECONDS) : NaN;
  if (!(maxAgeSeconds >= 60 && maxAgeSeconds <= 86_400)) return invalid('FLOFI_AUTOMATION_PRICE_MAX_AGE_SECONDS');
  const kind = env.FLOFI_AUTOMATION_PRICE_SOURCE === undefined || env.FLOFI_AUTOMATION_PRICE_SOURCE === '' ? 'off' : env.FLOFI_AUTOMATION_PRICE_SOURCE;
  let price: PriceSourceConfig;
  if (kind === 'off') price = { kind: 'off' };
  else if (kind === 'chainlink') {
    const url = rpcUrl(env.FLOFI_AUTOMATION_CHAINLINK_RPC_URL || env.GRYLOO_BASE_RPC_URL || 'https://mainnet.base.org', hosted);
    if (!url) return invalid('FLOFI_AUTOMATION_CHAINLINK_RPC_URL');
    const feeds = parseFeeds(env.FLOFI_AUTOMATION_CHAINLINK_FEEDS ?? '');
    if (!feeds || !Object.keys(feeds).length) return invalid('FLOFI_AUTOMATION_CHAINLINK_FEEDS');
    price = { kind: 'chainlink', rpcUrl: url, feeds, maxAgeMs: maxAgeSeconds * 1000 };
  } else if (kind === 'fixture') {
    const path = env.FLOFI_AUTOMATION_PRICE_FIXTURE ?? '';
    if (hosted || !path.startsWith('/tmp/') || path.includes('..') || path.length > 256) return invalid('FLOFI_AUTOMATION_PRICE_FIXTURE');
    price = { kind: 'fixture', path, maxAgeMs: maxAgeSeconds * 1000 };
  } else return invalid('FLOFI_AUTOMATION_PRICE_SOURCE');
  return Object.freeze({ enabled: true, tenantId, origin, keys: automationKeys(secret), policy: { ok: true as const, testFunds, mainnetNetworks: Object.freeze([...new Set(listed as NetworkId[])]) },
    dispatchTokenDigest: dispatch === '' ? null : Buffer.from(dispatch, 'hex'), price, testClock, hosted });
}

/** The configured price source (one per call site; the Chainlink feed verification is cached per source instance). */
export function priceSourceOf(config: PriceSourceConfig, fetchImpl: typeof fetch = fetch): PriceSource {
  if (config.kind === 'chainlink') return chainlinkSource({ rpc: readOnlyRpc(config.rpcUrl, fetchImpl), feeds: config.feeds, maxAgeMs: config.maxAgeMs });
  if (config.kind === 'fixture') return fixtureSource(config.path, config.maxAgeMs);
  return OFF_SOURCE;
}
