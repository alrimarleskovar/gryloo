// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: webhook endpoints, secrets and signatures (Standard Webhooks). Webhooks are NOTIFICATIONS: no FloFi state ever
 * depends on a delivery or its response.
 *
 *   secret     `whsec_` + base64(HMAC-SHA-256(webhook key, "<tenant>:<endpoint>:1")): derived from the deployment's developer secret,
 *              never stored, returned once at creation. The trailing version input lets an in-place rotation be added later without
 *              changing existing secrets; in this release rotation is by replacement (create a new endpoint, accept both secrets,
 *              delete the old one).
 *   signature  `webhook-signature: v1,<base64 HMAC-SHA-256(secret bytes, "<webhook-id>.<webhook-timestamp>.<body>")>`
 *   URL        https on port 443 to a public host (checked again, pinned, at every delivery); no credentials or fragment. Plain
 *              `http://127.0.0.1` only with FLOFI_DEVELOPER_WEBHOOK_LOOPBACK=ALLOW_LOCAL_ONLY on a non-hosted server (tests).
 */
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { isPublicAddress } from '../platform/index.ts';
import type { DeveloperConfig } from './config.ts';

export const WEBHOOK_SECRET_PREFIX = 'whsec_';
export const WEBHOOK_SECRET_VERSION = 1;
/** The 32 secret bytes of an endpoint (the HMAC key its deliveries are signed with). */
export const webhookSecretBytes = (config: Pick<DeveloperConfig, 'keys'>, tenantId: string, endpointId: string): Buffer =>
  createHmac('sha256', config.keys.webhook).update(`${tenantId}:${endpointId}:${WEBHOOK_SECRET_VERSION}`, 'utf8').digest();
/** The endpoint's signing secret as the developer stores it. */
export const webhookSecret = (config: Pick<DeveloperConfig, 'keys'>, tenantId: string, endpointId: string) =>
  WEBHOOK_SECRET_PREFIX + webhookSecretBytes(config, tenantId, endpointId).toString('base64');
/** The Standard Webhooks signature header value of one delivery. */
export const signWebhook = (secret: Buffer, webhookId: string, timestamp: number, body: string) =>
  `v1,${createHmac('sha256', secret).update(`${webhookId}.${timestamp}.${body}`, 'utf8').digest('base64')}`;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
export type WebhookUrlCheck = { readonly ok: true; readonly url: string; readonly loopback: boolean } | { readonly ok: false; readonly reason: string };
/** A URL FloFi may deliver to. Every delivery re-resolves the host and refuses any non-public address (DNS can change after this). */
export function webhookUrlCheck(raw: string, loopbackAllowed: boolean): WebhookUrlCheck {
  if (typeof raw !== 'string' || raw.length < 10 || raw.length > 2048) return { ok: false, reason: 'WEBHOOK_URL_INVALID' };
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: 'WEBHOOK_URL_INVALID' }; }
  if (url.username || url.password || url.hash || raw.includes('#')) return { ok: false, reason: 'WEBHOOK_URL_INVALID' };
  if (url.protocol === 'http:') {
    return loopbackAllowed && LOOPBACK.has(url.hostname) ? { ok: true, url: url.href, loopback: true } : { ok: false, reason: 'WEBHOOK_URL_NOT_HTTPS' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'WEBHOOK_URL_NOT_HTTPS' };
  if (url.port !== '') return { ok: false, reason: 'WEBHOOK_URL_PORT' };
  const host = url.hostname;
  if (host.startsWith('[')) return { ok: false, reason: 'WEBHOOK_URL_HOST' };
  if (isIP(host) && !isPublicAddress(host)) return { ok: false, reason: 'WEBHOOK_URL_HOST' };
  if (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) return { ok: false, reason: 'WEBHOOK_URL_HOST' };
  return { ok: true, url: url.href, loopback: false };
}
