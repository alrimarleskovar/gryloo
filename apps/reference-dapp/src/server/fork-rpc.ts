// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Strict server-side adapter for the local chain-31337 fork. Loopback only, read and simulate
 * methods only: it can never sign, broadcast, change fork state or reach a provider. There is
 * no credential here; the recorded provider transcript is served to Anvil by a separate process.
 */
import type { ForkCall } from './mode-a-service';

export const FORK_RPC_METHODS = Object.freeze([
  'eth_chainId', 'anvil_metadata', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_call', 'eth_getCode',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_getStorageAt', 'eth_simulateV1', 'eth_getTransactionReceipt',
  'eth_getRawTransactionByHash', 'txpool_content',
] as const);
export const FORK_RPC_LIMITS = Object.freeze({ timeoutMs: 20_000, maxResponseBytes: 1_048_576, maxRequestBytes: 65_536 });

type Fetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** A JSON-RPC error message is reduced to safe characters; a revert stays recognizable to the quote reader. */
function safeMessage(value: unknown): string {
  return String(value ?? 'invalid').replace(/[^A-Za-z0-9 _:.,()-]/g, '').slice(0, 160);
}

export function createForkRpc(options: { readonly url: string; readonly timeoutMs?: number; readonly fetchImpl?: Fetch }): ForkCall {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(options.url);
  if (!match || Number(match[1]) > 65535) throw new Error('FORK_RPC_URL_REFUSED');
  const timeoutMs = options.timeoutMs ?? FORK_RPC_LIMITS.timeoutMs;
  const fetchImpl: Fetch = options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  let id = 0;
  return async (method, params = []) => {
    if (!(FORK_RPC_METHODS as readonly string[]).includes(method)) throw new Error('FORK_RPC_METHOD_REFUSED');
    const requestId = ++id;
    const body = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params });
    if (body.length > FORK_RPC_LIMITS.maxRequestBytes) throw new Error('FORK_RPC_REQUEST_TOO_LARGE');
    let response: Awaited<ReturnType<Fetch>>;
    try {
      response = await fetchImpl(options.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body,
        signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) { throw new Error('FORK_RPC_UNAVAILABLE', { cause: error }); }
    if (!response.ok) throw new Error(`FORK_RPC_HTTP_${response.status}`);
    const text = await response.text();
    if (text.length > FORK_RPC_LIMITS.maxResponseBytes) throw new Error('FORK_RPC_RESPONSE_TOO_LARGE');
    let value: unknown;
    try { value = JSON.parse(text); } catch (error) { throw new Error('FORK_RPC_RESPONSE_INVALID', { cause: error }); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('FORK_RPC_RESPONSE_INVALID');
    const reply = value as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: { message?: unknown } };
    if (reply.jsonrpc !== '2.0' || reply.id !== requestId) throw new Error('FORK_RPC_RESPONSE_INVALID');
    if (reply.error !== undefined) throw new Error(`FORK_RPC_ERROR:${safeMessage(reply.error?.message)}`);
    if (!('result' in reply)) throw new Error('FORK_RPC_RESPONSE_INVALID');
    return reply.result;
  };
}
