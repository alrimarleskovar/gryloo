// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only Base Sepolia JSON-RPC clients for the public Uniswap v3 swap and liquidity flows, shared by the in-process
 * server actions and the cloud backend. Only allowlisted read methods; no send, sign or wallet method exists.
 */
import { BASE_SEPOLIA } from '../domain/public-testnet-swap.ts';
import type { Rpc } from './public-testnet-service.ts';

const SEND_METHODS = new Set(['eth_sendTransaction', 'eth_sendRawTransaction', 'sendTransaction', 'eth_sign', 'eth_signTransaction', 'personal_sign']);
export function createBaseSepoliaReadRpc(url: string, methods: readonly string[]): Rpc {
  if (methods.some(method => SEND_METHODS.has(method))) throw new Error('PUBLIC_RPC_METHOD_DENIED');
  const allowed = new Set(methods);
  return async (method, params) => {
    if (!allowed.has(method)) throw new Error('PUBLIC_RPC_METHOD_DENIED');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, { method: 'POST', cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!response.ok) throw new Error('PUBLIC_RPC_UNAVAILABLE');
      const text = await response.text();
      if (text.length > 1_048_576) throw new Error('PUBLIC_RPC_RESPONSE_TOO_LARGE');
      const result: unknown = JSON.parse(text);
      if (!result || typeof result !== 'object' || !('result' in result) || 'error' in result) throw new Error('PUBLIC_RPC_RESPONSE_INVALID');
      return result.result;
    } catch (cause) {
      if (cause instanceof Error && /^[A-Z_]+$/.test(cause.message)) throw cause;
      throw new Error('PUBLIC_RPC_UNAVAILABLE', { cause });
    } finally { clearTimeout(timeout); }
  };
}
export const publicTestnetRpc: Rpc = createBaseSepoliaReadRpc(BASE_SEPOLIA.rpcUrl, ['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode',
  'eth_call', 'eth_getBalance', 'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionReceipt', 'eth_getTransactionByHash']);
/** The liquidity flow additionally simulates call sequences and discovers owner transactions by nonce. */
export const UNISWAP_LIQUIDITY_RPC_METHODS = Object.freeze(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_maxPriorityFeePerGas', 'eth_simulateV1', 'eth_getTransactionReceipt', 'eth_getTransactionByHash']);
/** Optional HTTPS override (e.g. a keyed provider for rate limits); anything else is a configuration error. */
export function baseSepoliaRpcUrl(override: string | undefined): string {
  if (override === undefined || override === '') return BASE_SEPOLIA.rpcUrl;
  let url: URL;
  try { url = new URL(override); } catch { throw new Error('UNISWAP_LIQUIDITY_RPC_CONFIGURATION_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('UNISWAP_LIQUIDITY_RPC_CONFIGURATION_INVALID');
  return url.href;
}
