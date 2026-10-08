// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the WhatsApp adapter's configuration and its activation guard.
 *
 * POLICY GUARD (owner decision D1). The WhatsApp Business Messaging Policy (last updated 2026-09-23, §4) prohibits using WhatsApp for
 * Business for "buying, selling, promoting, or otherwise facilitating the exchange of" "Real, virtual, or fake currency". The live
 * Cloud API path (Graph transport, templates, delivery statuses) is implemented in full, but it activates only when ALL of these hold:
 *   - FLOFI_WHATSAPP=enabled and FLOFI_WHATSAPP_PROVIDER=live, with a valid access token and Graph API version;
 *   - `WHATSAPP_POLICY_CLEARANCE` below records the owner's written clearance (Meta's written confirmation or counsel's opinion that this
 *     use is permitted) — set only by a reviewed code change — and FLOFI_WHATSAPP_POLICY_CLEARANCE equals its reference.
 * Today `WHATSAPP_POLICY_CLEARANCE` is null, so `live` is refused (WHATSAPP_LIVE_PROVIDER_NOT_CLEARED) whatever the variables say, and
 * on ANY hosted deployment the webhook answers 404 CHANNEL_PROVIDER_NOT_ACTIVATED (the fixture provider never runs hosted).
 *
 *   FLOFI_WHATSAPP=enabled                       explicit opt-in (otherwise 404)
 *   FLOFI_WHATSAPP_PROVIDER=fixture|live         fixture (default): outbound messages are rendered and recorded, never sent
 *   FLOFI_WHATSAPP_POLICY_CLEARANCE=<reference>  live only: must equal the clearance recorded in code
 *   FLOFI_WHATSAPP_ALLOWED_SENDERS=<sha256>,…    SHA-256 hex digests of allowed senders (BSUID or phone digits); empty = deny all
 *   WHATSAPP_APP_SECRET (+ _PREVIOUS)            the Meta app secret(s) that sign webhook payloads (X-Hub-Signature-256)
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN                the subscription verification token (≥ 32 characters)
 *   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID   the business number and account the webhook belongs to
 *   WHATSAPP_ACCESS_TOKEN, WHATSAPP_GRAPH_API_VERSION         the Cloud API transport (required for live; validated if present)
 *   WHATSAPP_NOTIFICATION_TEMPLATE=<name>:<lang> optional: an approved Utility template with one body variable, used for status
 *                                                notifications once the 24-hour window has closed (never for an approval link)
 * Every error disables the adapter (fail closed). A sender id is never a wallet identity.
 */
import { createHash } from 'node:crypto';
import { isHostedDeployment } from '../../server/deployment.ts';
import { sameSecret } from '../core/config.ts';

type Env = Readonly<Record<string, string | undefined>>;
/** The owner's written clearance for live WhatsApp use, recorded by a reviewed code change. None exists: live use is not permitted. */
export type WhatsAppClearance = { readonly reference: string; readonly recordedOn: string; readonly basis: string };
export const WHATSAPP_POLICY_CLEARANCE: WhatsAppClearance | null = null;

export type WhatsAppTemplate = { readonly name: string; readonly language: string };
export type WhatsAppConfig = {
  readonly enabled: true; readonly provider: 'fixture' | 'live'; readonly appSecrets: readonly string[]; readonly verifyToken: string; readonly phoneNumberId: string;
  readonly businessAccountId: string; readonly allowedSenders: ReadonlySet<string>; readonly accessToken: string | null; readonly graphVersion: string | null;
  readonly template: WhatsAppTemplate | null;
};
export type WhatsAppConfigResult = WhatsAppConfig
  | { readonly enabled: false; readonly code: 'WHATSAPP_NOT_ENABLED' | 'CHANNEL_PROVIDER_NOT_ACTIVATED' | 'WHATSAPP_LIVE_PROVIDER_NOT_CLEARED' }
  | { readonly enabled: false; readonly code: 'WHATSAPP_CONFIGURATION_INVALID'; readonly reason: string };

const invalid = (reason: string) => ({ enabled: false, code: 'WHATSAPP_CONFIGURATION_INVALID', reason } as const);
const SECRET = /^[\x21-\x7e]{16,256}$/, TOKEN = /^[\x21-\x7e]{32,256}$/, NUMERIC_ID = /^[0-9]{5,32}$/, DIGEST = /^[0-9a-f]{64}$/;
const TEMPLATE = /^([a-z0-9_]{1,512}):([a-z]{2,3}(?:_[A-Z]{2})?)$/;

/**
 * The adapter's configuration. `clearance` is the clearance recorded in code; only tests pass another (to prove the live path), never
 * an environment value.
 */
export function readWhatsAppConfig(env: Env, clearance: WhatsAppClearance | null = WHATSAPP_POLICY_CLEARANCE): WhatsAppConfigResult {
  if (env.FLOFI_WHATSAPP !== 'enabled') return { enabled: false, code: 'WHATSAPP_NOT_ENABLED' };
  const provider = env.FLOFI_WHATSAPP_PROVIDER === undefined || env.FLOFI_WHATSAPP_PROVIDER === '' ? 'fixture' : env.FLOFI_WHATSAPP_PROVIDER;
  if (provider !== 'fixture' && provider !== 'live') return invalid('FLOFI_WHATSAPP_PROVIDER');
  const cleared = provider === 'live' && clearance !== null && /^[\x21-\x7e]{8,128}$/.test(clearance.reference)
    && env.FLOFI_WHATSAPP_POLICY_CLEARANCE === clearance.reference;
  // D1: without recorded clearance, never on a deployed environment and never live, regardless of any other variable.
  if (isHostedDeployment(env) && !cleared) return { enabled: false, code: 'CHANNEL_PROVIDER_NOT_ACTIVATED' };
  if (provider === 'live' && !cleared) return { enabled: false, code: 'WHATSAPP_LIVE_PROVIDER_NOT_CLEARED' };
  const current = env.WHATSAPP_APP_SECRET ?? '', previous = env.WHATSAPP_APP_SECRET_PREVIOUS ?? '';
  if (!SECRET.test(current)) return invalid('WHATSAPP_APP_SECRET');
  if (previous !== '' && (!SECRET.test(previous) || previous === current)) return invalid('WHATSAPP_APP_SECRET_PREVIOUS');
  const verifyToken = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '';
  if (!TOKEN.test(verifyToken) || sameSecret(verifyToken, current) || sameSecret(verifyToken, previous)) return invalid('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID ?? '', businessAccountId = env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '';
  if (!NUMERIC_ID.test(phoneNumberId)) return invalid('WHATSAPP_PHONE_NUMBER_ID');
  if (!NUMERIC_ID.test(businessAccountId)) return invalid('WHATSAPP_BUSINESS_ACCOUNT_ID');
  const allowed = (env.FLOFI_WHATSAPP_ALLOWED_SENDERS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 256 || !allowed.every(d => DIGEST.test(d))) return invalid('FLOFI_WHATSAPP_ALLOWED_SENDERS');
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim() || null, graphVersion = env.WHATSAPP_GRAPH_API_VERSION?.trim() || null;
  if (accessToken !== null && (!/^[A-Za-z0-9._-]{32,1024}$/.test(accessToken) || [current, previous, verifyToken].some(s => sameSecret(accessToken, s)))) return invalid('WHATSAPP_ACCESS_TOKEN');
  if (graphVersion !== null && !/^v[0-9]{2,3}\.0$/.test(graphVersion)) return invalid('WHATSAPP_GRAPH_API_VERSION');
  if (provider === 'live' && !accessToken) return invalid('WHATSAPP_ACCESS_TOKEN');
  if (provider === 'live' && !graphVersion) return invalid('WHATSAPP_GRAPH_API_VERSION');
  const templateRaw = env.WHATSAPP_NOTIFICATION_TEMPLATE?.trim() ?? '', template = TEMPLATE.exec(templateRaw);
  if (templateRaw !== '' && !template) return invalid('WHATSAPP_NOTIFICATION_TEMPLATE');
  return Object.freeze({ enabled: true, provider, appSecrets: Object.freeze([current, ...previous ? [previous] : []]), verifyToken, phoneNumberId,
    businessAccountId, allowedSenders: new Set(allowed), accessToken, graphVersion, template: template ? Object.freeze({ name: template[1]!, language: template[2]! }) : null });
}
/** The secrets this adapter holds, which Channel Core's own secret must differ from. */
export const whatsAppSecrets = (config: WhatsAppConfig): string[] => [...config.appSecrets, config.verifyToken, ...config.accessToken ? [config.accessToken] : []];
/** Default deny: a sender is allowed only when the digest of one of its provider ids (BSUID or phone digits) is listed. */
export function senderAllowed(config: WhatsAppConfig, ids: readonly (string | null | undefined)[]): boolean {
  return ids.some(id => typeof id === 'string' && id !== '' && config.allowedSenders.has(createHash('sha256').update(id, 'utf8').digest('hex')));
}
