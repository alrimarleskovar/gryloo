// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: configuration of the FloFi Developer API (`/api/developer/v1`). Every error disables it (fail closed).
 *
 *   FLOFI_DEVELOPER=enabled                       explicit opt-in; otherwise 404 DEVELOPER_API_NOT_ENABLED
 *   FLOFI_PUBLIC_ORIGIN=https://host               the origin approval links point to (shared with MCP; never request headers)
 *   FLOFI_DEVELOPER_SECRET=<32–512 chars>          dedicated key material: API-key digests, the `flofi_dhs_` approval-link key and the
 *                                                  webhook signing secrets are HKDF-derived from it, one label each. Refused if it
 *                                                  equals any other deployment secret.
 *   FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256=<hex>    optional: SHA-256 of the scheduler bearer for the internal dispatch endpoint
 *   FLOFI_DEVELOPER_WEBHOOK_LOOPBACK=ALLOW_LOCAL_ONLY  tests only: `http://127.0.0.1` webhook endpoints on a non-hosted server
 *
 * Only SANDBOX credentials exist in this build: their policy is test funds only, every mainnet off. Nothing here is financial
 * authority — a developer credential never signs, submits or approves; the end user's wallet does, in FloFi.
 */
import { createHash, hkdfSync, timingSafeEqual } from 'node:crypto';
import { deploymentTenant, isHostedDeployment, publicOrigin } from '../server/deployment.ts';
import type { HandoffPolicy } from '../platform/index.ts';

type Env = Readonly<Record<string, string | undefined>>;
export const DEVELOPER_ENVIRONMENTS = Object.freeze(['sandbox', 'production'] as const);
export type DeveloperEnvironment = (typeof DEVELOPER_ENVIRONMENTS)[number];
export const DEVELOPER_SCOPES = Object.freeze(['strategies', 'approvals', 'executions', 'webhooks'] as const);
export type DeveloperScope = (typeof DEVELOPER_SCOPES)[number];
export type DeveloperKeys = { readonly apiKey: Buffer; readonly handoff: Buffer; readonly webhook: Buffer };
export type DeveloperConfig = {
  readonly enabled: true; readonly tenantId: string; readonly origin: string; readonly keys: DeveloperKeys;
  readonly dispatchTokenDigest: Buffer | null; readonly webhookLoopback: boolean;
};
export type DeveloperConfigResult = DeveloperConfig | { readonly enabled: false; readonly code: 'DEVELOPER_API_NOT_ENABLED' | 'DEVELOPER_CONFIGURATION_INVALID'; readonly reason?: string };
/** The handoff policy of sandbox credentials: test funds only; no mainnet network, whatever else the deployment allows. */
export const SANDBOX_POLICY: HandoffPolicy = Object.freeze({ ok: true, testFunds: true, mainnetNetworks: Object.freeze([]) });

const invalid = (reason: string) => ({ enabled: false, code: 'DEVELOPER_CONFIGURATION_INVALID', reason } as const);
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();
const sameSecret = (a: string, b: string | undefined) => b !== undefined && b !== '' && timingSafeEqual(sha256(a), sha256(b));
/** One HKDF key per purpose: a digest or signature made for one purpose can never be replayed as another. */
export const developerKey = (secret: string, label: 'api-key' | 'handoff' | 'webhook') =>
  Buffer.from(hkdfSync('sha256', secret, 'flofi', `flofi/developer/${label}/v1`, 32));

export function readDeveloperConfig(env: Env): DeveloperConfigResult {
  if (env.FLOFI_DEVELOPER !== 'enabled') return { enabled: false, code: 'DEVELOPER_API_NOT_ENABLED' };
  let tenantId: string;
  try { tenantId = deploymentTenant(env); } catch { return invalid('TENANT'); }
  const origin = publicOrigin(env);
  if (!origin) return invalid('FLOFI_PUBLIC_ORIGIN');
  const secret = env.FLOFI_DEVELOPER_SECRET ?? '';
  if (secret.length < 32 || secret.length > 512) return invalid('FLOFI_DEVELOPER_SECRET');
  // Dedicated key material: never the internal API bearer, the wallet-session key, MCP's OAuth secret or a channel secret.
  for (const other of [env.API_AUTH_TOKEN, env.FLOFI_SESSION_SECRET, env.FLOFI_MCP_OAUTH_SECRET, env.FLOFI_CHANNEL_SECRET])
    if (sameSecret(secret, other)) return invalid('FLOFI_DEVELOPER_SECRET_REUSED');
  const dispatch = env.FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256 ?? '';
  if (dispatch !== '' && !/^[0-9a-f]{64}$/.test(dispatch)) return invalid('FLOFI_DEVELOPER_DISPATCH_TOKEN_SHA256');
  const loopback = env.FLOFI_DEVELOPER_WEBHOOK_LOOPBACK ?? '';
  if (loopback !== '' && loopback !== 'ALLOW_LOCAL_ONLY') return invalid('FLOFI_DEVELOPER_WEBHOOK_LOOPBACK');
  // Loopback webhook endpoints are a local test seam only; a hosted deployment with it set is misconfigured.
  if (loopback === 'ALLOW_LOCAL_ONLY' && isHostedDeployment(env)) return invalid('FLOFI_DEVELOPER_WEBHOOK_LOOPBACK_HOSTED');
  return Object.freeze({ enabled: true, tenantId, origin,
    keys: Object.freeze({ apiKey: developerKey(secret, 'api-key'), handoff: developerKey(secret, 'handoff'), webhook: developerKey(secret, 'webhook') }),
    dispatchTokenDigest: dispatch === '' ? null : Buffer.from(dispatch, 'hex'), webhookLoopback: loopback === 'ALLOW_LOCAL_ONLY' });
}
