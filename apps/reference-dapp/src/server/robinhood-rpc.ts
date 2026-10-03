// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only Robinhood Testnet JSON-RPC client shared by the in-process server action and the cloud backend.
 * Only allowlisted read methods; the server has no send, sign or wallet method of any kind. Live reads are
 * paced and serialized; provider throttling is retried a bounded number of times.
 */
import { ROBINHOOD_TESTNET_TRANSFER as profile } from '@defi-workflow-engine/action-registry';
import type { TransferRpc } from '@defi-workflow-engine/reference-compiler';

const methods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
export function createRobinhoodReadRpc(mode: 'live' | 'harness'): TransferRpc {
  const endpoint = mode === 'harness' ? 'http://127.0.0.1:8553' : profile.rpc;
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
      return value.result;
    }
    throw new Error('TRANSFER_RPC_RATE_LIMITED');
  };
  return (method, params) => { const result = queue.then(() => read(method, params)); queue = result.catch(() => undefined); return result; };
}
