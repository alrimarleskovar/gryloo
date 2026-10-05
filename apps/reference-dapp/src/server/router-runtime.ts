// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001 runtime configuration, shared by the in-process server action and the cloud backend flow.
 * Read-only RPC clients (allowlisted methods; no send, sign or wallet method can exist), provider transports and the
 * explicit gates:
 *  - `GRYLOO_ROUTER=live`: read-only quotes, simulation and Review on Base mainnet / Arbitrum One;
 *  - `GRYLOO_ROUTER_OWNER_EXECUTION=MAINNET_OWNER_APPROVED`: additionally allows `begin` (the owner's wallet still signs
 *    and sends every transaction; Flofi never does) — the same real-funds deployment opt-in as the Jupiter mainnet flow;
 *  - `GRYLOO_ROUTER_HARNESS=MOCKED_LOOPBACK_ONLY`: the loopback MOCKED harness (tests); it always wins over `live`.
 * BUILD-JOURNEY-001, the same router on public testnets (Base Sepolia → Arbitrum Sepolia, test USDC), a separate flow:
 *  - `GRYLOO_ROUTER_TESTNET=live`: quotes, simulation, Review and owner-wallet execution (like every other testnet flow);
 *    `GRYLOO_ROUTER_TESTNET_EXECUTION=DISABLED` keeps it Simulate/Review-only;
 *  - `GRYLOO_ROUTER_TESTNET_HARNESS=MOCKED_LOOPBACK_ONLY`: its loopback MOCKED harness (tests only).
 */
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as profile, CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET, type RouterProfile } from '@defi-workflow-engine/action-registry';
import type { RoutingProvider } from '@defi-workflow-engine/workflow-contracts';
import { createBaseSepoliaReadRpc, pacedReadRpc } from './public-testnet-rpc.ts';
import type { Rpc } from './public-testnet-service.ts';
import { createRouteProviders, createRouterHttp, type RouteProvider } from './router-providers.ts';
import { ROUTER_MOCK_ACROSS_API, ROUTER_MOCK_ARBITRUM_RPC_URL, ROUTER_MOCK_BASE_RPC_URL, ROUTER_MOCK_CODE_PINS, ROUTER_MOCK_LIFI_API, ROUTER_TESTNET_MOCK } from './router-mock.ts';
import type { RouterCodePins, RouterProvenance } from './router-service.ts';

export type RouterMode = 'live' | 'harness' | 'off';
/** BUILD-JOURNEY-001: which router deployment a call addresses. Each network is its own flow and durable namespace. */
export type RouterNetwork = 'mainnet' | 'testnet';
export const ROUTER_NETWORKS: readonly RouterNetwork[] = Object.freeze(['mainnet', 'testnet']);
type Env = Readonly<Record<string, string | undefined>>;
export const ROUTER_BASE_RPC_METHODS = Object.freeze(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getBalance',
  'eth_getTransactionCount', 'eth_maxPriorityFeePerGas', 'eth_simulateV1', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getStorageAt', 'eth_getLogs']);
export const ROUTER_ARBITRUM_RPC_METHODS = Object.freeze(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getLogs',
  'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getStorageAt']);
export function routerMode(env: Env): RouterMode {
  if (env.GRYLOO_ROUTER_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
  return env.GRYLOO_ROUTER === 'live' ? 'live' : 'off';
}
export function routerTestnetMode(env: Env): RouterMode {
  if (env.GRYLOO_ROUTER_TESTNET_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
  return env.GRYLOO_ROUTER_TESTNET === 'live' ? 'live' : 'off';
}
export const routerNetworkMode = (network: RouterNetwork, env: Env): RouterMode => network === 'testnet' ? routerTestnetMode(env) : routerMode(env);
/** Optional HTTPS override (e.g. a keyed provider for rate limits); anything else is a configuration error. */
export function routerRpcUrl(override: string | undefined, fallback: string): string {
  if (override === undefined || override === '') return fallback;
  let url: URL;
  try { url = new URL(override); } catch { throw new Error('ROUTER_RPC_CONFIGURATION_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('ROUTER_RPC_CONFIGURATION_INVALID');
  return url.href;
}
// BUILD-CLOUD-PARITY-001: shared with every Base Sepolia read client (moved to public-testnet-rpc.ts; same behavior).
export { pacedReadRpc };
export type RouterRuntime = { readonly sourceRpc: Rpc; readonly destinationRpc: Rpc; readonly providers: Readonly<Record<RoutingProvider, RouteProvider>>;
  readonly provenance: RouterProvenance; readonly executionEnabled: boolean; readonly mockedCodePins?: RouterCodePins; readonly profile: RouterProfile };
export function routerRuntime(mode: 'live' | 'harness', env: Env): RouterRuntime {
  const http = createRouterHttp();
  if (mode === 'harness') return { sourceRpc: createBaseSepoliaReadRpc(ROUTER_MOCK_BASE_RPC_URL, ROUTER_BASE_RPC_METHODS),
    destinationRpc: createBaseSepoliaReadRpc(ROUTER_MOCK_ARBITRUM_RPC_URL, ROUTER_ARBITRUM_RPC_METHODS),
    providers: createRouteProviders({ http, lifiApi: ROUTER_MOCK_LIFI_API, acrossApi: ROUTER_MOCK_ACROSS_API }), provenance: 'MOCKED', executionEnabled: true,
    mockedCodePins: ROUTER_MOCK_CODE_PINS, profile };
  return { sourceRpc: pacedReadRpc(createBaseSepoliaReadRpc(routerRpcUrl(env.GRYLOO_BASE_RPC_URL, profile.source.rpc), ROUTER_BASE_RPC_METHODS)),
    destinationRpc: pacedReadRpc(createBaseSepoliaReadRpc(routerRpcUrl(env.GRYLOO_ARBITRUM_RPC_URL, profile.destination.rpc), ROUTER_ARBITRUM_RPC_METHODS)),
    providers: createRouteProviders({ http, ...env.ACROSS_API_KEY ? { acrossApiKey: env.ACROSS_API_KEY } : {}, ...env.ACROSS_INTEGRATOR_ID ? { acrossIntegratorId: env.ACROSS_INTEGRATOR_ID } : {},
      ...env.LIFI_API_KEY ? { lifiApiKey: env.LIFI_API_KEY } : {} }),
    provenance: 'PUBLIC_MAINNET', executionEnabled: env.GRYLOO_ROUTER_OWNER_EXECUTION === 'MAINNET_OWNER_APPROVED', profile };
}
/**
 * BUILD-JOURNEY-001: Base Sepolia → Arbitrum Sepolia with test USDC. Public read-only RPCs (optionally keyed HTTPS overrides; the
 * Base Sepolia one is shared with the Uniswap liquidity flow) and the providers' testnet endpoints. Owner-wallet execution is
 * on by default, as for the other testnet flows; Flofi still never signs or sends.
 */
export function routerTestnetRuntime(mode: 'live' | 'harness', env: Env): RouterRuntime {
  const http = createRouterHttp();
  if (mode === 'harness') return { sourceRpc: createBaseSepoliaReadRpc(ROUTER_TESTNET_MOCK.baseRpc, ROUTER_BASE_RPC_METHODS),
    destinationRpc: createBaseSepoliaReadRpc(ROUTER_TESTNET_MOCK.arbitrumRpc, ROUTER_ARBITRUM_RPC_METHODS),
    providers: createRouteProviders({ http, profile: TESTNET, lifiApi: ROUTER_TESTNET_MOCK.lifiApi, acrossApi: ROUTER_TESTNET_MOCK.acrossApi }),
    provenance: 'MOCKED', executionEnabled: true, mockedCodePins: ROUTER_TESTNET_MOCK.codePins, profile: TESTNET };
  return { sourceRpc: pacedReadRpc(createBaseSepoliaReadRpc(routerRpcUrl(env.GRYLOO_BASE_SEPOLIA_RPC_URL, TESTNET.source.rpc), ROUTER_BASE_RPC_METHODS)),
    destinationRpc: pacedReadRpc(createBaseSepoliaReadRpc(routerRpcUrl(env.GRYLOO_ARBITRUM_SEPOLIA_RPC_URL, TESTNET.destination.rpc), ROUTER_ARBITRUM_RPC_METHODS)),
    providers: createRouteProviders({ http, profile: TESTNET, ...env.LIFI_API_KEY ? { lifiApiKey: env.LIFI_API_KEY } : {} }),
    provenance: 'PUBLIC_TESTNET', executionEnabled: env.GRYLOO_ROUTER_TESTNET_EXECUTION !== 'DISABLED', profile: TESTNET };
}
export const routerNetworkRuntime = (network: RouterNetwork, mode: 'live' | 'harness', env: Env): RouterRuntime =>
  network === 'testnet' ? routerTestnetRuntime(mode, env) : routerRuntime(mode, env);
