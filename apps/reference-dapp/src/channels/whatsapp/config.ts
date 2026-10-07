// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the WhatsApp adapter's configuration and its activation guard.
 *
 * POLICY GUARD (owner decision D1). The WhatsApp Business Messaging Policy (last updated 2026-09-23, §4) prohibits using WhatsApp for
 * Business for "buying, selling, promoting, or otherwise facilitating the exchange of" "Real, virtual, or fake currency". Until the
 * owner holds written clearance, this adapter is fixture-only:
 *   - on ANY hosted deployment the webhook answers 404 CHANNEL_PROVIDER_NOT_ACTIVATED, whatever the variables say;
 *   - FLOFI_WHATSAPP_PROVIDER accepts only `fixture` (outbound messages are rendered and recorded, never sent); `live` is refused
 *     with WHATSAPP_LIVE_PROVIDER_NOT_CLEARED;
 *   - the Graph API transport exists for the cleared future and is only ever exercised against a fake `fetch`.
 * Lifting the guard is a separate, reviewed change.
 *
 *   FLOFI_WHATSAPP=enabled                       explicit opt-in (otherwise 404)
 *   FLOFI_WHATSAPP_PROVIDER=fixture              the only provider of this build
 *   FLOFI_WHATSAPP_ALLOWED_SENDERS=<sha256>,…    SHA-256 hex digests of allowed senders (BSUID or phone digits); empty = deny all
 *   WHATSAPP_APP_SECRET (+ _PREVIOUS)            the Meta app secret(s) that sign webhook payloads (X-Hub-Signature-256)
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN                the subscription verification token (≥ 32 characters)
 *   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID   the business number and account the webhook belongs to
 *   WHATSAPP_ACCESS_TOKEN, WHATSAPP_GRAPH_API_VERSION         the future live transport only (validated if present, never used here)
 * Every error disables the adapter (fail closed). A sender id is never a wallet identity.
 */
import { createHash } from 'node:crypto';
import { isHostedDeployment } from '../../server/deployment.ts';
import { sameSecret } from '../core/config.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type WhatsAppConfig = {
  readonly enabled: true; readonly provider: 'fixture'; readonly appSecrets: readonly string[]; readonly verifyToken: string; readonly phoneNumberId: string;
  readonly businessAccountId: string; readonly allowedSenders: ReadonlySet<string>; readonly accessToken: string | null; readonly graphVersion: string | null;
};
export type WhatsAppConfigResult = WhatsAppConfig
  | { readonly enabled: false; readonly code: 'WHATSAPP_NOT_ENABLED' | 'CHANNEL_PROVIDER_NOT_ACTIVATED' | 'WHATSAPP_LIVE_PROVIDER_NOT_CLEARED' }
  | { readonly enabled: false; readonly code: 'WHATSAPP_CONFIGURATION_INVALID'; readonly reason: string };

const invalid = (reason: string) => ({ enabled: false, code: 'WHATSAPP_CONFIGURATION_INVALID', reason } as const);
const SECRET = /^[\x21-\x7e]{16,256}$/, TOKEN = /^[\x21-\x7e]{32,256}$/, NUMERIC_ID = /^[0-9]{5,32}$/, DIGEST = /^[0-9a-f]{64}$/;

export function readWhatsAppConfig(env: Env): WhatsAppConfigResult {
  if (env.FLOFI_WHATSAPP !== 'enabled') return { enabled: false, code: 'WHATSAPP_NOT_ENABLED' };
  // D1: never on a deployed environment in this build, regardless of any other variable.
  if (isHostedDeployment(env)) return { enabled: false, code: 'CHANNEL_PROVIDER_NOT_ACTIVATED' };
  const provider = env.FLOFI_WHATSAPP_PROVIDER === undefined || env.FLOFI_WHATSAPP_PROVIDER === '' ? 'fixture' : env.FLOFI_WHATSAPP_PROVIDER;
  if (provider === 'live') return { enabled: false, code: 'WHATSAPP_LIVE_PROVIDER_NOT_CLEARED' };
  if (provider !== 'fixture') return invalid('FLOFI_WHATSAPP_PROVIDER');
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
  return Object.freeze({ enabled: true, provider: 'fixture', appSecrets: Object.freeze([current, ...previous ? [previous] : []]), verifyToken, phoneNumberId,
    businessAccountId, allowedSenders: new Set(allowed), accessToken, graphVersion });
}
/** The secrets this adapter holds, which Channel Core's own secret must differ from. */
export const whatsAppSecrets = (config: WhatsAppConfig): string[] => [...config.appSecrets, config.verifyToken, ...config.accessToken ? [config.accessToken] : []];
/** Default deny: a sender is allowed only when the digest of one of its provider ids (BSUID or phone digits) is listed. */
export function senderAllowed(config: WhatsAppConfig, ids: readonly (string | null | undefined)[]): boolean {
  return ids.some(id => typeof id === 'string' && id !== '' && config.allowedSenders.has(createHash('sha256').update(id, 'utf8').digest('hex')));
}
