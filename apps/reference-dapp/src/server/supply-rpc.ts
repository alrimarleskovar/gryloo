// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only JSON-RPC clients for the Aave Supply family (Base Sepolia USDC; BUILD-ETHEREUM-001 Ethereum Sepolia WBTC), shared
 * by the in-process server action and the cloud backend. One client per profile: it only talks to that profile's chain,
 * and every `eth_chainId` it returns must be that chain. Public reads are paced and serialized; only bounded provider
 * throttling is retried. No mutation method is permitted and no network falls back to another.
 */
import { AAVE_V3_BASE_SEPOLIA, AAVE_V3_ETHEREUM_SEPOLIA, type AaveLendingProfile } from '@defi-workflow-engine/action-registry';
import type { SupplyRpc } from '@defi-workflow-engine/reference-compiler';

const methods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_simulateV1',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
/** Loopback MOCKED harness endpoints (e2e/supply-harness.mjs); never a public provider. */
const HARNESS: Readonly<Record<AaveLendingProfile['chain'], string>> = Object.freeze({
  [AAVE_V3_BASE_SEPOLIA.chain]: 'http://127.0.0.1:8549', [AAVE_V3_ETHEREUM_SEPOLIA.chain]: 'http://127.0.0.1:8549/ethereum-sepolia' });
/** Optional HTTPS override for a profile's public RPC (for example a keyed provider); anything else is a configuration error. */
export function supplyRpcUrl(profile: AaveLendingProfile, override: string | undefined): string {
  if (override === undefined || override === '') return profile.rpc;
  let url: URL;
  try { url = new URL(override); } catch { throw new Error('SUPPLY_RPC_CONFIGURATION_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('SUPPLY_RPC_CONFIGURATION_INVALID');
  return url.href;
}
export function createSupplyReadRpc(harness: boolean, profile: AaveLendingProfile, endpointOverride?: string): SupplyRpc {
  const endpoint = harness ? HARNESS[profile.chain] : supplyRpcUrl(profile, endpointOverride);
  const expectedChain = BigInt(profile.chainId);
  let queue: Promise<unknown> = Promise.resolve();
  const read = async (method: string, params: readonly unknown[]) => {
    if (!methods.has(method)) throw new Error('SUPPLY_RPC_METHOD_DENIED');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!harness) await new Promise<void>(resolve => setTimeout(resolve, attempt === 0 ? 150 : 500 * attempt));
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const text = await response.text(); if (text.length > 1_048_576) throw new Error('SUPPLY_RPC_RESPONSE_TOO_LARGE');
      const value: unknown = JSON.parse(text);
      const throttled = response.status === 429 || !!value && typeof value === 'object' && 'error' in value && !!value.error && typeof value.error === 'object' &&
        'code' in value.error && value.error.code === -32005;
      if (throttled) { if (method === 'eth_simulateV1') throw new Error('SUPPLY_SIMULATION_UNAVAILABLE'); if (attempt < 2) continue; throw new Error('SUPPLY_RPC_RATE_LIMITED'); }
      if (!response.ok) throw new Error('SUPPLY_RPC_UNAVAILABLE');
      if (!value || typeof value !== 'object' || !('result' in value) || 'error' in value) throw new Error(method === 'eth_simulateV1' ? 'SUPPLY_SIMULATION_UNAVAILABLE' : 'SUPPLY_RPC_RESPONSE_INVALID');
      // The client is bound to one chain: a provider that answers for any other chain is refused, never followed.
      if (method === 'eth_chainId' && (typeof value.result !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(value.result) || BigInt(value.result) !== expectedChain))
        throw new Error('SUPPLY_WRONG_CHAIN');
      return value.result;
    }
    throw new Error('SUPPLY_RPC_RATE_LIMITED');
  };
  return (method, params) => { const result = queue.then(() => read(method, params)); queue = result.catch(() => undefined); return result; };
}
/**
 * One read client per registered Aave profile, each at its profile's public endpoint unless the deployment names an HTTPS
 * override for that chain (server-side only, never sent to the browser): `GRYLOO_ETHEREUM_SEPOLIA_RPC_URL`, and
 * (BUILD-CLOUD-PARITY-001) the same `GRYLOO_BASE_SEPOLIA_RPC_URL` every other Base Sepolia client already honours.
 */
export function createLendingReadRpcs(harness: boolean, env: Readonly<Record<string, string | undefined>> = {}): Readonly<Record<AaveLendingProfile['chain'], SupplyRpc>> {
  return Object.freeze({
    [AAVE_V3_BASE_SEPOLIA.chain]: createSupplyReadRpc(harness, AAVE_V3_BASE_SEPOLIA, env.GRYLOO_BASE_SEPOLIA_RPC_URL),
    [AAVE_V3_ETHEREUM_SEPOLIA.chain]: createSupplyReadRpc(harness, AAVE_V3_ETHEREUM_SEPOLIA, env.GRYLOO_ETHEREUM_SEPOLIA_RPC_URL),
  });
}
