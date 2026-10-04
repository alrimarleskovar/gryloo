// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only Base Sepolia JSON-RPC client for the public Uniswap v3 swap, shared by the in-process server action
 * and the cloud backend. Only allowlisted read methods; no send, sign or wallet method exists.
 */
import { BASE_SEPOLIA } from '../domain/public-testnet-swap.ts';
import type { Rpc } from './public-testnet-service.ts';

const allowedMethods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call',
  'eth_getBalance', 'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionReceipt', 'eth_getTransactionByHash']);
export const publicTestnetRpc: Rpc = async (method, params) => {
  if (!allowedMethods.has(method)) throw new Error('PUBLIC_RPC_METHOD_DENIED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(BASE_SEPOLIA.rpcUrl, { method: 'POST', cache: 'no-store', signal: controller.signal,
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
