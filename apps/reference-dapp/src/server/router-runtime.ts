// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001 runtime configuration, shared by the in-process server action and the cloud backend flow.
 * Read-only RPC clients (allowlisted methods; no send, sign or wallet method can exist), provider transports and the
 * explicit gates:
 *  - `GRYLOO_ROUTER=live`: read-only quotes, simulation and Review on Base mainnet / Arbitrum One;
 *  - `GRYLOO_ROUTER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED`: additionally allows `begin` (the owner's wallet still signs
 *    and sends every transaction; Flofi never does) — the same real-funds deployment opt-in as the Jupiter mainnet flow;
 *  - `GRYLOO_ROUTER_HARNESS=MOCKED_LOOPBACK_ONLY`: the loopback MOCKED harness (tests); it always wins over `live`.
 */
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as profile } from '@defi-workflow-engine/action-registry';
import type { RoutingProvider } from '@defi-workflow-engine/workflow-contracts';
import { createBaseSepoliaReadRpc } from './public-testnet-rpc.ts';
import type { Rpc } from './public-testnet-service.ts';
import { createRouteProviders, createRouterHttp, type RouteProvider } from './router-providers.ts';
import { ROUTER_MOCK_ACROSS_API, ROUTER_MOCK_ARBITRUM_RPC_URL, ROUTER_MOCK_BASE_RPC_URL, ROUTER_MOCK_CODE_PINS, ROUTER_MOCK_LIFI_API } from './router-mock.ts';
import type { RouterCodePins } from './router-service.ts';

export type RouterMode = 'live' | 'harness' | 'off';
type Env = Readonly<Record<string, string | undefined>>;
export const ROUTER_BASE_RPC_METHODS = Object.freeze(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getBalance',
  'eth_getTransactionCount', 'eth_maxPriorityFeePerGas', 'eth_simulateV1', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getStorageAt', 'eth_getLogs']);
export const ROUTER_ARBITRUM_RPC_METHODS = Object.freeze(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getLogs',
  'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getStorageAt']);
export function routerMode(env: Env): RouterMode {
  if (env.GRYLOO_ROUTER_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
  return env.GRYLOO_ROUTER === 'live' ? 'live' : 'off';
}
/** Optional HTTPS override (e.g. a keyed provider for rate limits); anything else is a configuration error. */
export function routerRpcUrl(override: string | undefined, fallback: string): string {
  if (override === undefined || override === '') return fallback;
  let url: URL;
  try { url = new URL(override); } catch { throw new Error('ROUTER_RPC_CONFIGURATION_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('ROUTER_RPC_CONFIGURATION_INVALID');
  return url.href;
}
/**
 * Public endpoints rate-limit bursts (public Base answered HTTP 429 "over rate limit" to the router's parallel Review reads
 * during the BUILD-ROUTER-001 preflight). Every router RPC is a read, so calls are paced through one queue per transport and
 * transport failures are retried with backoff. An answer the node gave (including a JSON-RPC error) is never retried.
 */
export function pacedReadRpc(rpc: Rpc, options: { minIntervalMs?: number; retries?: number; sleep?: (ms: number) => Promise<void> } = {}): Rpc {
  // Measured on public Base (2026-10-04): a burst of ~5 eth_call succeeds, then HTTP 429 for several seconds.
  const minIntervalMs = options.minIntervalMs ?? 250, retries = options.retries ?? 6;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let queue: Promise<unknown> = Promise.resolve(), last = 0;
  return (method, params) => {
    const run = queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = last + minIntervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();
        try { return await rpc(method, params); }
        catch (cause) {
          if (!(cause instanceof Error && cause.message === 'PUBLIC_RPC_UNAVAILABLE') || attempt >= retries) throw cause;
          await sleep(500 * 2 ** attempt);
        }
      }
    });
    queue = run.catch(() => undefined);
    return run;
  };
}
export type RouterRuntime = { readonly sourceRpc: Rpc; readonly destinationRpc: Rpc; readonly providers: Readonly<Record<RoutingProvider, RouteProvider>>;
  readonly provenance: 'PUBLIC_MAINNET' | 'MOCKED'; readonly executionEnabled: boolean; readonly mockedCodePins?: RouterCodePins };
export function routerRuntime(mode: 'live' | 'harness', env: Env): RouterRuntime {
  const http = createRouterHttp();
  if (mode === 'harness') return { sourceRpc: createBaseSepoliaReadRpc(ROUTER_MOCK_BASE_RPC_URL, ROUTER_BASE_RPC_METHODS),
    destinationRpc: createBaseSepoliaReadRpc(ROUTER_MOCK_ARBITRUM_RPC_URL, ROUTER_ARBITRUM_RPC_METHODS),
    providers: createRouteProviders({ http, lifiApi: ROUTER_MOCK_LIFI_API, acrossApi: ROUTER_MOCK_ACROSS_API }), provenance: 'MOCKED', executionEnabled: true,
    mockedCodePins: ROUTER_MOCK_CODE_PINS };
  return { sourceRpc: pacedReadRpc(createBaseSepoliaReadRpc(routerRpcUrl(env.GRYLOO_BASE_RPC_URL, profile.source.rpc), ROUTER_BASE_RPC_METHODS)),
    destinationRpc: pacedReadRpc(createBaseSepoliaReadRpc(routerRpcUrl(env.GRYLOO_ARBITRUM_RPC_URL, profile.destination.rpc), ROUTER_ARBITRUM_RPC_METHODS)),
    providers: createRouteProviders({ http, ...env.ACROSS_API_KEY ? { acrossApiKey: env.ACROSS_API_KEY } : {}, ...env.ACROSS_INTEGRATOR_ID ? { acrossIntegratorId: env.ACROSS_INTEGRATOR_ID } : {},
      ...env.LIFI_API_KEY ? { lifiApiKey: env.LIFI_API_KEY } : {} }),
    provenance: 'PUBLIC_MAINNET', executionEnabled: env.GRYLOO_ROUTER_OWNER_EXECUTION === 'MAINNET_OWNER_APPROVED' };
}
