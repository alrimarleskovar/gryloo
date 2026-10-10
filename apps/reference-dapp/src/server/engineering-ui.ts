// SPDX-License-Identifier: AGPL-3.0-only
import { headers } from 'next/headers';
/** Explicit opt-in AND loopback host. Normal /app never mounts diagnostics even when opted in. */
export async function engineeringUiAllowed() {
  if (process.env.VERCEL || process.env.RAILWAY_PROJECT_ID || process.env.FLOFI_DEPLOYMENT === 'hosted') return false;
  if (process.env.FLOFI_ENGINEERING_UI !== 'LOOPBACK_ONLY') return false;
  const host = (await headers()).get('host') ?? '';
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/.test(host);
}
