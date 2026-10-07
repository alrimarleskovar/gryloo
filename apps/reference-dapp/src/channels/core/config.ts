// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: Channel Core configuration — server-only, never `NEXT_PUBLIC_*`. Any error disables every channel (fail
 * closed); nothing falls back to another secret or to defaults that would widen access.
 *
 *   FLOFI_CHANNEL_SECRET                    ≥ 32 chars, dedicated: refused when equal to API_AUTH_TOKEN, FLOFI_SESSION_SECRET,
 *                                           FLOFI_MCP_OAUTH_SECRET or any provider secret
 *   FLOFI_PUBLIC_ORIGIN                     the origin approval links point to (https; loopback http only off-hosting)
 *   FLOFI_CHANNEL_SUPPORT_CONTACT           the human escalation path shown in HELP (https URL or e-mail address), required
 *   FLOFI_CHANNEL_PRIVACY_URL               the privacy policy shown in HELP and at first contact (https), required
 *   FLOFI_CHANNEL_COPILOT                   enabled (default) | disabled — disabled = exact commands only, no model at all
 *   FLOFI_CHANNEL_SIMULATION                enabled (default) | disabled — the read-only preview before the approval link
 *   FLOFI_CHANNEL_LANGUAGE                  EN (default) | PT — reply language until the user's own language is known
 *   FLOFI_CHANNEL_HANDOFF_TEST_FUNDS        enabled (default) | disabled
 *   FLOFI_CHANNEL_HANDOFF_MAINNET_NETWORKS  mainnet network ids a channel proposal may name (default none:
 *                                           MAINNET_HANDOFF_DISABLED_BY_POLICY); every mainnet a workflow touches must be listed
 *
 * None of this is financial authority. The channel's approval links carry none, and its policy only decides which proposals FloFi
 * will even hand to an owner for review.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { NETWORKS } from '../../engine/strategy-engine';
import { NETWORK_IDS, type NetworkId } from '../../engine/strategy-spec';
import type { HandoffPolicy } from '../../platform/index.ts';
import { deploymentTenant, isHostedDeployment } from '../../server/deployment.ts';
import { channelKeys, type ChannelKeys } from './crypto.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type ChannelLanguage = 'EN' | 'PT';
export type ChannelCoreConfig = {
  readonly enabled: true; readonly tenantId: string; readonly origin: string; readonly keys: ChannelKeys; readonly policy: Extract<HandoffPolicy, { ok: true }>;
  readonly copilot: boolean; readonly simulation: boolean; readonly language: ChannelLanguage; readonly supportContact: string; readonly privacyUrl: string;
  readonly hosted: boolean;
};
export type ChannelCoreConfigResult = ChannelCoreConfig | { readonly enabled: false; readonly code: 'CHANNEL_CONFIGURATION_INVALID'; readonly reason: string };

const invalid = (reason: string) => ({ enabled: false, code: 'CHANNEL_CONFIGURATION_INVALID', reason } as const);
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();
/** Constant-time equality of two configured secrets (an unset one never matches). */
export const sameSecret = (a: string, b: string | undefined) => b !== undefined && b !== '' && timingSafeEqual(sha256(a), sha256(b));
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const switchOf = (value: string | undefined, fallback: 'enabled' | 'disabled') => {
  const v = value === undefined || value === '' ? fallback : value;
  return v === 'enabled' ? true : v === 'disabled' ? false : null;
};

/** The exact origin FloFi is served from: `https://host[:port]`, or `http://` loopback on a local (non-hosted) server only. */
export function channelPublicOrigin(env: Env): string | null {
  const raw = env.FLOFI_PUBLIC_ORIGIN ?? '';
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.origin !== raw || url.username || url.password) return null;
  if (url.protocol === 'https:') return url.origin;
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname) && !isHostedDeployment(env) ? url.origin : null;
}
const httpsUrl = (raw: string | undefined) => {
  try { const url = new URL(raw ?? ''); return url.protocol === 'https:' && !url.username && !url.password && raw!.length <= 256 ? url.toString() : null; }
  catch { return null; }
};
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

/** The channel handoff policy: test funds and each mainnet explicitly. Any malformed value invalidates the configuration. */
export function readChannelHandoffPolicy(env: Env): Extract<HandoffPolicy, { ok: true }> | null {
  const testFunds = switchOf(env.FLOFI_CHANNEL_HANDOFF_TEST_FUNDS, 'enabled');
  if (testFunds === null) return null;
  const listed = (env.FLOFI_CHANNEL_HANDOFF_MAINNET_NETWORKS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  // Only mainnet networks may be listed; a test network here is a configuration mistake, not a permission.
  if (!listed.every(n => (NETWORK_IDS as readonly string[]).includes(n) && NETWORKS[n as NetworkId].class === 'MAINNET')) return null;
  return { ok: true, testFunds, mainnetNetworks: Object.freeze([...new Set(listed as NetworkId[])]) };
}

/** Channel Core's configuration. `providerSecrets` are the enabled adapters' own secrets, which the channel secret must differ from. */
export function readChannelCoreConfig(env: Env, providerSecrets: readonly string[] = []): ChannelCoreConfigResult {
  let tenantId: string;
  try { tenantId = deploymentTenant(env); } catch { return invalid('TENANT'); }
  const origin = channelPublicOrigin(env);
  if (!origin) return invalid('FLOFI_PUBLIC_ORIGIN');
  const secret = env.FLOFI_CHANNEL_SECRET ?? '';
  if (secret.length < 32 || secret.length > 512) return invalid('FLOFI_CHANNEL_SECRET');
  if (['API_AUTH_TOKEN', 'FLOFI_SESSION_SECRET', 'FLOFI_MCP_OAUTH_SECRET'].some(name => sameSecret(secret, env[name])) || providerSecrets.some(p => sameSecret(secret, p)))
    return invalid('FLOFI_CHANNEL_SECRET_REUSED');
  const support = (env.FLOFI_CHANNEL_SUPPORT_CONTACT ?? '').trim(), supportContact = EMAIL.test(support) ? support : httpsUrl(support);
  if (!supportContact) return invalid('FLOFI_CHANNEL_SUPPORT_CONTACT');
  const privacyUrl = httpsUrl(env.FLOFI_CHANNEL_PRIVACY_URL);
  if (!privacyUrl) return invalid('FLOFI_CHANNEL_PRIVACY_URL');
  const copilot = switchOf(env.FLOFI_CHANNEL_COPILOT, 'enabled'), simulation = switchOf(env.FLOFI_CHANNEL_SIMULATION, 'enabled');
  if (copilot === null) return invalid('FLOFI_CHANNEL_COPILOT');
  if (simulation === null) return invalid('FLOFI_CHANNEL_SIMULATION');
  const language = env.FLOFI_CHANNEL_LANGUAGE === undefined || env.FLOFI_CHANNEL_LANGUAGE === '' ? 'EN' : env.FLOFI_CHANNEL_LANGUAGE;
  if (language !== 'EN' && language !== 'PT') return invalid('FLOFI_CHANNEL_LANGUAGE');
  const policy = readChannelHandoffPolicy(env);
  if (!policy) return invalid('FLOFI_CHANNEL_HANDOFF_POLICY');
  return Object.freeze({ enabled: true, tenantId, origin, keys: channelKeys(secret), policy, copilot, simulation, language, supportContact, privacyUrl,
    hosted: isHostedDeployment(env) });
}
