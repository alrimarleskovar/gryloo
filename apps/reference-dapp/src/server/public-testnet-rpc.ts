// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only Base Sepolia JSON-RPC clients for the public Uniswap v3 swap and liquidity flows, shared by the in-process
 * server actions and the cloud backend. Only allowlisted read methods; no send, sign or wallet method exists.
 */
import { BASE_SEPOLIA, ETHEREUM_SEPOLIA_SWAP } from '../domain/public-testnet-swap.ts';
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
const PUBLIC_SWAP_RPC_METHODS = Object.freeze(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode',
  'eth_call', 'eth_getBalance', 'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionReceipt', 'eth_getTransactionByHash']);
/**
 * BUILD-CLOUD-PARITY-001: the Base Sepolia read client of the public swap, at the public endpoint or the deployment's HTTPS override
 * `GRYLOO_BASE_SEPOLIA_RPC_URL` (the one Base Sepolia endpoint setting every Base Sepolia flow shares), bound to chain 84532.
 */
export function baseSepoliaSwapRpc(override: string | undefined): Rpc {
  return chainBoundRpc(createBaseSepoliaReadRpc(httpsRpcUrl(override, BASE_SEPOLIA.rpcUrl, 'PUBLIC_RPC_CONFIGURATION_INVALID'), PUBLIC_SWAP_RPC_METHODS), BASE_SEPOLIA.chainId);
}
/** The liquidity flow additionally simulates call sequences and discovers owner transactions by nonce. */
export const UNISWAP_LIQUIDITY_RPC_METHODS = Object.freeze(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_maxPriorityFeePerGas', 'eth_simulateV1', 'eth_getTransactionReceipt', 'eth_getTransactionByHash']);
/** A read client bound to one chain: any `eth_chainId` for another chain is refused, never followed. */
export function chainBoundRpc(rpc: Rpc, chainId: number): Rpc {
  return async (method, params) => {
    const result = await rpc(method, params);
    if (method === 'eth_chainId' && (typeof result !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(result) || BigInt(result) !== BigInt(chainId))) throw new Error('WRONG_PROVIDER_CHAIN');
    return result;
  };
}
/**
 * BUILD-ETHEREUM-001: the Ethereum Sepolia read client of the public swap, at the public endpoint or the server-side HTTPS override
 * `GRYLOO_ETHEREUM_SEPOLIA_RPC_URL`. Never a fallback for Base Sepolia, and never one for Ethereum Mainnet.
 */
export function ethereumSepoliaSwapRpc(override: string | undefined, methods: readonly string[] = PUBLIC_SWAP_RPC_METHODS): Rpc {
  return chainBoundRpc(createBaseSepoliaReadRpc(httpsRpcUrl(override, ETHEREUM_SEPOLIA_SWAP.rpcUrl, 'PUBLIC_RPC_CONFIGURATION_INVALID'), methods), ETHEREUM_SEPOLIA_SWAP.chainId);
}
function httpsRpcUrl(override: string | undefined, fallback: string, code: string): string {
  if (override === undefined || override === '') return fallback;
  let url: URL;
  try { url = new URL(override); } catch { throw new Error(code); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(code);
  return url.href;
}
/** Optional HTTPS override (e.g. a keyed provider for rate limits); anything else is a configuration error. */
export function baseSepoliaRpcUrl(override: string | undefined): string {
  if (override === undefined || override === '') return BASE_SEPOLIA.rpcUrl;
  let url: URL;
  try { url = new URL(override); } catch { throw new Error('UNISWAP_LIQUIDITY_RPC_CONFIGURATION_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('UNISWAP_LIQUIDITY_RPC_CONFIGURATION_INVALID');
  return url.href;
}
