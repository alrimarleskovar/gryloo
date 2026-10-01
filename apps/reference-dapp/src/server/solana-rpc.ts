// SPDX-License-Identifier: AGPL-3.0-only
import type { SolanaRpc } from '@defi-workflow-engine/reference-compiler';

/** Read methods for simulation/reconciliation. sendTransaction is reachable only from the owner-signed submit path. */
const methods = new Set(['getGenesisHash', 'getMultipleAccounts', 'getLatestBlockhash', 'getBlockHeight', 'simulateTransaction',
  'getSignatureStatuses', 'getTransaction', 'sendTransaction']);

/** An owner-chosen HTTPS RPC may carry its own credential in its path; it is never logged or returned. */
export function solanaRpcOverride(value: string | undefined, code: string): string | undefined {
  if (value && (() => { try { const url = new URL(value); return url.protocol !== 'https:' || Boolean(url.username || url.password); } catch { return true; } })()) throw new Error(code);
  return value;
}
/** Serialized, allowlisted JSON-RPC transport shared by every Solana swap runtime. Cluster identity is verified by the callers. */
export function createSolanaRpc(endpoint: string, loopback: boolean): SolanaRpc {
  let queue: Promise<unknown> = Promise.resolve();
  const post = async (method: string, params: readonly unknown[]) => {
    if (!methods.has(method)) throw new Error('SOLANA_RPC_METHOD_DENIED');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!loopback) await new Promise<void>(resolve => setTimeout(resolve, attempt === 0 ? 120 : 600 * attempt));
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20_000),
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const text = await response.text(); if (text.length > 2_097_152) throw new Error('SOLANA_RPC_RESPONSE_TOO_LARGE');
      if (response.status === 429 && method !== 'sendTransaction') { if (attempt < 2) continue; throw new Error('SOLANA_RPC_RATE_LIMITED'); }
      const value: unknown = JSON.parse(text);
      if (value && typeof value === 'object' && 'error' in value && value.error) {
        const rpcError = value.error as { code?: unknown; message?: unknown };
        throw new Error(method === 'sendTransaction' ? 'SOLANA_SEND_REJECTED' : 'SOLANA_RPC_ERROR', { cause: { code: rpcError.code, message: String(rpcError.message ?? '').slice(0, 300) } });
      }
      if (!response.ok || !value || typeof value !== 'object' || !('result' in value)) throw new Error('SOLANA_RPC_UNAVAILABLE');
      return value.result;
    }
    throw new Error('SOLANA_RPC_RATE_LIMITED');
  };
  return (method, params) => { const result = queue.then(() => post(method, params)); queue = result.catch(() => undefined); return result; };
}
