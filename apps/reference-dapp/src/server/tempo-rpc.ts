// SPDX-License-Identifier: AGPL-3.0-only
import { TEMPO_PAYMENT } from '@defi-workflow-engine/action-registry';
import type { TempoRpc } from '@defi-workflow-engine/reference-compiler';
const METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_simulateV1',
  'eth_gasPrice', 'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getRawTransactionByHash', 'eth_getTransactionReceipt']);
/** Same allowlist on API and worker. No faucet, send, sign, wallet, write or state-override method. */
export function createTempoReadRpc(): TempoRpc {
  let queue: Promise<unknown> = Promise.resolve();
  const read: TempoRpc = async (method, params) => {
    if (!METHODS.has(method)) throw new Error('TEMPO_RPC_METHOD_DENIED');
    for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise<void>(resolve => setTimeout(resolve, attempt ? 500 * attempt : 150));
    const response = await fetch(TEMPO_PAYMENT.rpc, { method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (response.status === 429 && attempt < 2) continue;
    if (!response.ok) throw new Error('TEMPO_RPC_UNAVAILABLE');
    const text = await response.text(); if (text.length > 4_194_304) throw new Error('TEMPO_RPC_TOO_LARGE');
    const body = JSON.parse(text);
    if (body.error?.code === -32005 && attempt < 2) continue;
    if (body.jsonrpc !== '2.0' || body.id !== 1 || body.error || !('result' in body)) throw new Error('TEMPO_RPC_UNVERIFIABLE');
    return body.result;
    }
    throw new Error('TEMPO_RPC_RATE_LIMITED');
  };
  return (method, params) => { const next = queue.then(() => read(method, params)); queue = next.catch(() => undefined); return next; };
}
