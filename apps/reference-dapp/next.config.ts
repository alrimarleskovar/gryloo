// SPDX-License-Identifier: AGPL-3.0-only
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // Cloak's pinned public relay, mainnet RPC and hash-verified circuit host. No arbitrary provider origins.
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "connect-src 'self' https://api.cloak.ag https://api.mainnet-beta.solana.com https://storage.googleapis.com" }] }];
  },
};

export default config;

/**
 * BUILD-002 compatibility shim for a declaration defect in next@16.3.5.
 *
 * The published Next declaration references URLPatternInput and
 * URLPatternOptions as globals, while TypeScript 5.9.3 and the installed
 * @types/node@24.13.4 do not provide both names globally.
 *
 * This is type-only. It does not install or polyfill URLPattern and has no
 * runtime effect. Remove and re-review it when Next, TypeScript, or Node type
 * versions change.
 */
declare global {
  type URLPatternInput = string | URLPatternInit;
  type URLPatternOptions = import("node:url").URLPatternOptions;
}
