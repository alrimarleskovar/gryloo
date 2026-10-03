// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only Base Sepolia JSON-RPC client for the Aave Supply family, shared by the in-process server action and
 * the cloud backend. Public reads are paced and serialized; only bounded provider throttling is retried.
 * No mutation method is permitted.
 */
import { AAVE_V3_BASE_SEPOLIA as profile } from '@defi-workflow-engine/action-registry';
import type { SupplyRpc } from '@defi-workflow-engine/reference-compiler';

const methods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_simulateV1',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
export function createSupplyReadRpc(harness: boolean): SupplyRpc {
  const endpoint = harness ? 'http://127.0.0.1:8549' : profile.rpc;
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
      return value.result;
    }
    throw new Error('SUPPLY_RPC_RATE_LIMITED');
  };
  return (method, params) => { const result = queue.then(() => read(method, params)); queue = result.catch(() => undefined); return result; };
}
