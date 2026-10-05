// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-PARITY-001: a bounded, non-secret readiness report for one deployment (served at `/api/flofi/readiness`).
 *
 * It answers "what is this deployment wired to?" without the hosting dashboard: the runtime kind, whether its database and
 * schema are usable, its tenant, each flow's enablement, whether the wallet session and Copilot are configured and, on request,
 * whether each public network endpoint the flows would use answers with the expected chain identity.
 *
 * It never returns a URL (an RPC URL may embed a credential), a key, a connection string, an upstream message or a stack trace:
 * only fixed labels, upper-case codes, chain ids, block numbers and latencies. Results are cached briefly per instance so the
 * public endpoint cannot be used to amplify provider traffic.
 */
import { AAVE_V3_BASE_SEPOLIA, AAVE_V3_ETHEREUM_SEPOLIA, CROSSCHAIN_ROUTER_BASE_ARBITRUM as ROUTER, CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as ROUTER_TESTNET,
  JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET, ROBINHOOD_TESTNET_TRANSFER } from '@defi-workflow-engine/action-registry';
import type { FlowName } from '../../backend/flows.ts';
import { copilotConfig, copilotTuning } from './copilot-service.ts';
import { deploymentEnvironment, isHostedDeployment, type DeploymentEnvironment } from './deployment.ts';
import { cloudFlowMode, embeddedRuntime, flowRuntimeKind, type FlowRuntimeKind } from './flow-runtime.ts';
import { baseSepoliaRpcUrl } from './public-testnet-rpc.ts';
import { routerRpcUrl } from './router-runtime.ts';
import { solanaRpcOverride } from './solana-rpc.ts';
import { supplyRpcUrl } from './supply-rpc.ts';
import { transferRpcUrl } from './robinhood-rpc.ts';
import { walletSessionKey } from './wallet-session.ts';

type Env = Readonly<Record<string, string | undefined>>;
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const code = (error: unknown, fallback: string) => error instanceof Error && CODE.test(error.message) ? error.message : fallback;
export const READINESS_FLOWS: readonly FlowName[] = Object.freeze(['base-sepolia-swap', 'uniswap-liquidity', 'aave-supply', 'robinhood-transfer',
  'crosschain-router-testnet', 'solana-devnet-swap', 'orca-liquidity', 'lending-composition', 'crosschain-router', 'jupiter-swap']);

export type NetworkStatus = { readonly status: 'REACHABLE' | 'WRONG_CHAIN' | 'UNREACHABLE' | 'RATE_LIMITED' | 'CONFIGURATION_INVALID';
  readonly chain: string; readonly endpoint: 'PUBLIC_DEFAULT' | 'DEPLOYMENT_OVERRIDE'; readonly block?: number; readonly latencyMs?: number };
export type Readiness = {
  readonly service: 'flofi-web'; readonly ok: boolean; readonly checkedAt: string;
  readonly deployment: { readonly environment: DeploymentEnvironment; readonly hosted: boolean; readonly commit: string | null; readonly branch: string | null; readonly region: string | null };
  readonly runtime: { readonly kind: FlowRuntimeKind; readonly status: string; readonly tenant: string | null; readonly schemaVersion: number | null };
  readonly session: { readonly status: string };
  readonly copilot: { readonly mode: string };
  readonly flows: Readonly<Partial<Record<FlowName, string>>>;
  /** Supported user-facing capabilities that never run on a hosted deployment, with the reason code. */
  readonly localOnly: Readonly<Record<string, string>>;
  readonly networks?: Readonly<Record<string, NetworkStatus>>;
};

type Probe = { readonly name: string; readonly chain: string; readonly kind: 'evm'; readonly chainId: number; readonly url: () => string; readonly override: string | undefined }
  | { readonly name: string; readonly chain: string; readonly kind: 'solana'; readonly genesisHash: string; readonly url: () => string; readonly override: string | undefined };
/** The endpoints the flows themselves would call, resolved by the flows' own configuration functions. */
export function readinessProbes(env: Env): readonly Probe[] {
  const solana = (value: string | undefined, fallback: string) => solanaRpcOverride(value, 'CONFIGURATION_INVALID') ?? fallback;
  return [
    { name: 'base-sepolia', chain: 'eip155:84532', kind: 'evm', chainId: 84532, override: env.GRYLOO_BASE_SEPOLIA_RPC_URL, url: () => baseSepoliaRpcUrl(env.GRYLOO_BASE_SEPOLIA_RPC_URL) },
    { name: 'base-sepolia-aave', chain: 'eip155:84532', kind: 'evm', chainId: 84532, override: env.GRYLOO_BASE_SEPOLIA_RPC_URL, url: () => supplyRpcUrl(AAVE_V3_BASE_SEPOLIA, env.GRYLOO_BASE_SEPOLIA_RPC_URL) },
    { name: 'ethereum-sepolia', chain: 'eip155:11155111', kind: 'evm', chainId: 11155111, override: env.GRYLOO_ETHEREUM_SEPOLIA_RPC_URL,
      url: () => supplyRpcUrl(AAVE_V3_ETHEREUM_SEPOLIA, env.GRYLOO_ETHEREUM_SEPOLIA_RPC_URL) },
    { name: 'arbitrum-sepolia', chain: 'eip155:421614', kind: 'evm', chainId: 421614, override: env.GRYLOO_ARBITRUM_SEPOLIA_RPC_URL,
      url: () => routerRpcUrl(env.GRYLOO_ARBITRUM_SEPOLIA_RPC_URL, ROUTER_TESTNET.destination.rpc) },
    { name: 'robinhood-testnet', chain: ROBINHOOD_TESTNET_TRANSFER.chain, kind: 'evm', chainId: ROBINHOOD_TESTNET_TRANSFER.chainId, override: undefined,
      url: () => transferRpcUrl(ROBINHOOD_TESTNET_TRANSFER, undefined) },
    { name: 'solana-devnet', chain: ORCA_WHIRLPOOLS_DEVNET.chain, kind: 'solana', genesisHash: ORCA_WHIRLPOOLS_DEVNET.genesisHash, override: env.GRYLOO_SOLANA_DEVNET_RPC_URL,
      url: () => solana(env.GRYLOO_SOLANA_DEVNET_RPC_URL, ORCA_WHIRLPOOLS_DEVNET.rpc) },
    // Mainnets are probed read-only because their flows offer read-only Simulate/Review; nothing here enables execution.
    { name: 'base', chain: ROUTER.source.chain, kind: 'evm', chainId: ROUTER.source.chainId, override: env.GRYLOO_BASE_RPC_URL, url: () => routerRpcUrl(env.GRYLOO_BASE_RPC_URL, ROUTER.source.rpc) },
    { name: 'arbitrum', chain: ROUTER.destination.chain, kind: 'evm', chainId: ROUTER.destination.chainId, override: env.GRYLOO_ARBITRUM_RPC_URL,
      url: () => routerRpcUrl(env.GRYLOO_ARBITRUM_RPC_URL, ROUTER.destination.rpc) },
    { name: 'solana', chain: JUPITER_SOLANA_MAINNET.chain, kind: 'solana', genesisHash: JUPITER_SOLANA_MAINNET.genesisHash, override: env.GRYLOO_SOLANA_RPC_URL,
      url: () => solana(env.GRYLOO_SOLANA_RPC_URL, JUPITER_SOLANA_MAINNET.rpc) },
  ];
}
async function probe(target: Probe, fetcher: typeof fetch, now: () => number): Promise<NetworkStatus> {
  const base = { chain: target.chain, endpoint: target.override ? 'DEPLOYMENT_OVERRIDE' as const : 'PUBLIC_DEFAULT' as const };
  let url: string;
  try { url = target.url(); } catch { return { ...base, status: 'CONFIGURATION_INVALID' }; }
  const rpc = async (method: string) => {
    const response = await fetcher(url, { method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }) });
    if (response.status === 429) throw new Error('RATE_LIMITED');
    const text = await response.text();
    if (!response.ok || text.length > 65_536) throw new Error('UNREACHABLE');
    const value = JSON.parse(text) as { result?: unknown };
    if (!value || typeof value !== 'object' || !('result' in value)) throw new Error('UNREACHABLE');
    return value.result;
  };
  const started = now();
  try {
    if (target.kind === 'evm') {
      const id = await rpc('eth_chainId');
      if (typeof id !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(id) || BigInt(id) !== BigInt(target.chainId)) return { ...base, status: 'WRONG_CHAIN' };
      const block = await rpc('eth_blockNumber');
      return { ...base, status: 'REACHABLE', ...typeof block === 'string' && /^0x[0-9a-fA-F]{1,16}$/.test(block) ? { block: Number(BigInt(block)) } : {}, latencyMs: now() - started };
    }
    if (await rpc('getGenesisHash') !== target.genesisHash) return { ...base, status: 'WRONG_CHAIN' };
    const height = await rpc('getBlockHeight');
    return { ...base, status: 'REACHABLE', ...Number.isSafeInteger(height) ? { block: height as number } : {}, latencyMs: now() - started };
  } catch (error) { return { ...base, status: error instanceof Error && error.message === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'UNREACHABLE' }; }
}

/** Capabilities that are user-facing locally but deliberately never run on a hosted deployment (see the cloud parity matrix). */
const LOCAL_ONLY: Readonly<Record<string, string>> = Object.freeze({
  'across-mocked-demo': 'ACROSS_MOCKED_DEMO_LOCAL_ONLY', 'cow-mocked-loopback': 'COW_OFF', 'lifi-bridge-mocked': 'BRIDGE_OFF', 'local-fork-modes': 'LOCAL_FORK_ONLY' });

export async function readiness(options: { readonly env?: Env; readonly networks?: boolean; readonly fetcher?: typeof fetch; readonly now?: () => number } = {}): Promise<Readiness> {
  const env = options.env ?? process.env, fetcher = options.fetcher ?? fetch, now = options.now ?? Date.now, kind = flowRuntimeKind(env);
  let runtime: Readiness['runtime'] = { kind, status: kind === 'local' ? 'LOCAL_DEVELOPMENT' : 'NOT_CONFIGURED', tenant: null, schemaVersion: null };
  if (kind === 'embedded') {
    try { const host = await embeddedRuntime(env); await host.ping(); runtime = { kind, status: 'READY', tenant: host.tenantId, schemaVersion: host.schemaVersion }; }
    catch (error) { runtime = { kind, status: code(error, 'CLOUD_RUNTIME_UNAVAILABLE'), tenant: null, schemaVersion: null }; }
  } else if (kind === 'remote') {
    let status = 'CLOUD_API_UNAVAILABLE';
    try {
      const base = new URL(env.API_BASE_URL!), target = new URL('readyz', base.href.endsWith('/') ? base : new URL(base.href + '/'));
      const response = await fetcher(target, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (response.ok && (await response.json() as { ok?: unknown }).ok === true) status = 'READY';
    } catch { /* reported as unavailable; the URL is never echoed */ }
    runtime = { kind, status, tenant: null, schemaVersion: null };
  }
  let session = 'CONFIGURED';
  try { walletSessionKey(env); if (!env.FLOFI_SESSION_SECRET && !env.API_AUTH_TOKEN) session = 'LOCAL_PROCESS_KEY'; } catch (error) { session = code(error, 'WALLET_SESSION_NOT_CONFIGURED'); }
  const copilot = copilotConfig(env), copilotMode = copilot.mode === 'live' && !copilotTuning(env) ? 'unavailable' : copilot.mode;
  const flows: Partial<Record<FlowName, string>> = {};
  // A runtime that is not ready serves no flow: every flow reads `off` without probing further.
  if (kind !== 'local') await Promise.all(READINESS_FLOWS.map(async flow => {
    flows[flow] = runtime.status === 'READY' ? await cloudFlowMode(flow, env, fetcher) ?? 'off' : 'off';
  }));
  const networks: Record<string, NetworkStatus> = {};
  // Different hosts, probed concurrently: the report stays within one serverless invocation even when every endpoint times out.
  if (options.networks) for (const [name, status] of await Promise.all(readinessProbes(env).map(async target => [target.name, await probe(target, fetcher, now)] as const)))
    networks[name] = status;
  const hosted = isHostedDeployment(env);
  return { service: 'flofi-web', ok: runtime.status === 'READY' || runtime.status === 'LOCAL_DEVELOPMENT', checkedAt: new Date(now()).toISOString(),
    deployment: { environment: deploymentEnvironment(env), hosted, commit: /^[0-9a-f]{7,40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '') ? env.VERCEL_GIT_COMMIT_SHA! : null,
      branch: env.VERCEL_GIT_COMMIT_REF && env.VERCEL_GIT_COMMIT_REF.length <= 200 ? env.VERCEL_GIT_COMMIT_REF : null,
      region: /^[a-z0-9]{2,12}$/.test(env.VERCEL_REGION ?? '') ? env.VERCEL_REGION! : null },
    runtime, session: { status: session }, copilot: { mode: copilotMode }, flows, localOnly: hosted ? LOCAL_ONLY : {}, ...options.networks ? { networks } : {} };
}

/** Per-instance cache (performance only): at most one computation per variant every 15 s, shared by concurrent requests. */
const CACHE = Symbol.for('flofi.readiness');
export function cachedReadiness(networks: boolean): Promise<Readiness> {
  const holder = globalThis as unknown as Record<symbol, Map<boolean, { at: number; value: Promise<Readiness> }> | undefined>;
  const cache = holder[CACHE] ??= new Map(), hit = cache.get(networks);
  if (hit && Date.now() - hit.at < 15_000) return hit.value;
  const value = readiness({ networks }).catch(error => { cache.delete(networks); throw error; });
  cache.set(networks, { at: Date.now(), value });
  return value;
}
