// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-JOURNEY-001: the wallet session of the current request (server actions only). Reads the HttpOnly session cookie
 * and verifies its MAC and expiry; the browser cannot forge or extend it. Returns the lower-case wallet address or null.
 */
import { cookies, headers } from 'next/headers';
import { readWalletSession, WALLET_SESSION_COOKIE, type WalletSession } from './wallet-session.ts';

export async function currentWalletSession(): Promise<WalletSession | null> {
  return readWalletSession(process.env, (await cookies()).get(WALLET_SESSION_COOKIE)?.value, new Date());
}
export async function currentWalletPrincipal(): Promise<string | null> {
  return (await currentWalletSession())?.account ?? null;
}
/** The origin the browser used (EIP-4361 domain and URI) and whether cookies must be `Secure`. */
export async function requestOrigin(): Promise<{ domain: string; uri: string; secure: boolean }> {
  const h = await headers();
  const domain = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0]!.trim();
  const loopback = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(domain);
  const proto = (h.get('x-forwarded-proto') ?? '').split(',')[0]!.trim() || (loopback ? 'http' : 'https');
  const secure = proto === 'https' || !loopback;
  return { domain, uri: `${secure ? 'https' : 'http'}://${domain}`, secure };
}
