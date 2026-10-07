// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only JSON-RPC clients for the native test-ETH self-transfer (RH-DEMO-001 Robinhood Testnet; BUILD-ETHEREUM-001
 * Ethereum Sepolia), shared by the in-process server action and the cloud backend. Each client is bound to one profile's
 * chain: an `eth_chainId` for any other chain is refused, never followed. Only allowlisted read methods; the server has no
 * send, sign or wallet method of any kind. Live reads are paced and serialized; provider throttling is retried a bounded
 * number of times.
 */
import { ETHEREUM_SEPOLIA_TRANSFER, ROBINHOOD_TESTNET_TRANSFER, type NativeTransferProfile } from '@defi-workflow-engine/action-registry';
import type { TransferRpc } from '@defi-workflow-engine/reference-compiler';

const methods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
/** Loopback MOCKED harness endpoints (e2e/robinhood-transfer-harness.mjs); never a public provider. */
const HARNESS: Readonly<Record<string, string>> = Object.freeze({
  [ROBINHOOD_TESTNET_TRANSFER.chain]: 'http://127.0.0.1:8553', [ETHEREUM_SEPOLIA_TRANSFER.chain]: 'http://127.0.0.1:8553/ethereum-sepolia' });
/** Optional HTTPS override for a profile's public RPC; anything else is a configuration error. */
export function transferRpcUrl(profile: NativeTransferProfile, override: string | undefined): string {
  if (override === undefined || override === '') return profile.rpc;
  let url: URL;
  try { url = new URL(override); } catch { throw new Error('TRANSFER_RPC_CONFIGURATION_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('TRANSFER_RPC_CONFIGURATION_INVALID');
  return url.href;
}
export function createNativeTransferReadRpc(profile: NativeTransferProfile, mode: 'live' | 'harness', endpointOverride?: string): TransferRpc {
  const endpoint = mode === 'harness' ? HARNESS[profile.chain]! : transferRpcUrl(profile, endpointOverride);
  const expectedChain = BigInt(profile.chainId);
  let queue: Promise<unknown> = Promise.resolve();
  const read = async (method: string, params: readonly unknown[]) => {
    if (!methods.has(method)) throw new Error('TRANSFER_RPC_METHOD_DENIED');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (mode === 'live') await new Promise<void>(resolve => setTimeout(resolve, attempt === 0 ? 120 : 600 * attempt));
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { 'content-type': 'application/json', 'user-agent': 'Gryloo/RH-DEMO-001' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const text = await response.text(); if (text.length > 1_048_576) throw new Error('TRANSFER_RPC_RESPONSE_TOO_LARGE');
      if (response.status === 429) { if (attempt < 2) continue; throw new Error('TRANSFER_RPC_RATE_LIMITED'); }
      if (!response.ok) throw new Error('TRANSFER_RPC_UNAVAILABLE');
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || !('result' in value) || 'error' in value) throw new Error('TRANSFER_RPC_RESPONSE_INVALID');
      if (method === 'eth_chainId' && (typeof value.result !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(value.result) || BigInt(value.result) !== expectedChain))
        throw new Error('TRANSFER_WRONG_CHAIN');
      return value.result;
    }
    throw new Error('TRANSFER_RPC_RATE_LIMITED');
  };
  return (method, params) => { const result = queue.then(() => read(method, params)); queue = result.catch(() => undefined); return result; };
}
export function createRobinhoodReadRpc(mode: 'live' | 'harness'): TransferRpc { return createNativeTransferReadRpc(ROBINHOOD_TESTNET_TRANSFER, mode); }
/**
 * Read clients for the transfer networks a deployment enables: Robinhood Testnet with `GRYLOO_ROBINHOOD_TESTNET=live`,
 * Ethereum Sepolia with `GRYLOO_ETHEREUM_SEPOLIA_TRANSFER=live` (optional HTTPS `GRYLOO_ETHEREUM_SEPOLIA_RPC_URL`). The MOCKED
 * loopback harness serves both. A network that is not enabled has no client, so its runs fail closed.
 */
export function nativeTransferReadRpcs(mode: 'live' | 'harness', env: Readonly<Record<string, string | undefined>>): { rpc?: TransferRpc; rpcs: Readonly<Record<string, TransferRpc>> } {
  const robinhood = mode === 'harness' || env.GRYLOO_ROBINHOOD_TESTNET === 'live', ethereum = mode === 'harness' || env.GRYLOO_ETHEREUM_SEPOLIA_TRANSFER === 'live';
  return { ...robinhood ? { rpc: createRobinhoodReadRpc(mode) } : {},
    rpcs: Object.freeze(ethereum ? { [ETHEREUM_SEPOLIA_TRANSFER.chain]: createNativeTransferReadRpc(ETHEREUM_SEPOLIA_TRANSFER, mode, env.GRYLOO_ETHEREUM_SEPOLIA_RPC_URL) } : {}) };
}
