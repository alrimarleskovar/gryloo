// SPDX-License-Identifier: AGPL-3.0-only
/** Jupiter swap-build HTTP client shared by the in-process server action and the cloud backend (read-only quotes/builds). */
import type { JupiterHttp } from '@defi-workflow-engine/reference-compiler';

export function createJupiterHttp(buildEndpoint: string, apiKey: string | undefined): JupiterHttp {
  return async query => {
    const response = await fetch(buildEndpoint + '?' + new URLSearchParams(query), { cache: 'no-store', signal: AbortSignal.timeout(20_000),
      headers: apiKey ? { 'x-api-key': apiKey } : {} });
    const text = await response.text(); if (text.length > 1_048_576) throw new Error('JUPITER_RESPONSE_TOO_LARGE');
    if (response.status === 429) throw new Error('JUPITER_RATE_LIMITED');
    if (response.status === 400 && /No routes found/.test(text)) throw new Error('JUPITER_NO_ROUTE');
    if (!response.ok) throw new Error('JUPITER_UNAVAILABLE');
    return JSON.parse(text) as unknown;
  };
}
