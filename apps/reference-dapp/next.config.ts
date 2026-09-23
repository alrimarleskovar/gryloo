// SPDX-License-Identifier: AGPL-3.0-only
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
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
