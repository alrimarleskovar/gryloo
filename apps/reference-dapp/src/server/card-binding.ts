// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Saved-card ownership. Credentials are browser-local, so a saved card belongs to the browser that added it: the server seals
 * each provider reference (customer and saved-card id) into a binding MAC'd with a key derived from the deployment secret.
 * Only a holder of the binding can list or remove that card at the provider, and a binding never acts for another provider,
 * provider environment (test vs production) or deployment tenant (each Vercel Preview branch has its own).
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { walletSessionKey } from './wallet-session.ts';
import { deploymentTenant } from './deployment.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type CardProviderEnvironment = 'test' | 'production';
/** What a binding seals: provider, provider environment, deployment tenant and the exact provider references. */
export type CardBinding = { readonly provider: string; readonly environment: CardProviderEnvironment; readonly tenant: string;
  readonly customerId: string; readonly cardId: string };
const BINDING = /^cb1\.([A-Za-z0-9_-]{16,1024})\.([A-Za-z0-9_-]{43})$/;
const bindingKey = (env: Env) => Buffer.from(hkdfSync('sha256', walletSessionKey(env), 'flofi', 'flofi/card-binding/v1', 32));
export function sealCardBinding(env: Env, binding: Omit<CardBinding, 'tenant'>): string {
  const body = Buffer.from(JSON.stringify({ v: 1, p: binding.provider, m: binding.environment, t: deploymentTenant(env), c: binding.customerId,
    k: binding.cardId })).toString('base64url');
  return `cb1.${body}.${createHmac('sha256', bindingKey(env)).update(`cb1.${body}`).digest('base64url')}`;
}
/** The binding's references when its MAC verifies and it belongs to this provider, environment and deployment; else null. */
export function openCardBinding(env: Env, value: unknown, expected: { readonly provider: string; readonly environment: CardProviderEnvironment }): CardBinding | null {
  const match = typeof value === 'string' ? BINDING.exec(value) : null;
  if (!match) return null;
  const mac = Buffer.from(match[2]!, 'base64url'), expectedMac = createHmac('sha256', bindingKey(env)).update(`cb1.${match[1]}`).digest();
  if (mac.length !== expectedMac.length || !timingSafeEqual(mac, expectedMac)) return null;
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(Buffer.from(match[1]!, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return null; }
  if (!payload || payload.v !== 1 || payload.p !== expected.provider || payload.m !== expected.environment || payload.t !== deploymentTenant(env)
    || typeof payload.c !== 'string' || typeof payload.k !== 'string') return null;
  return { provider: expected.provider, environment: expected.environment, tenant: payload.t as string, customerId: payload.c, cardId: payload.k };
}
