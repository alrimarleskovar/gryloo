// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: chain transports of delegated authority, each with a closed method allowlist enforced before any byte leaves the
 * process, and an explicit provenance (MOCKED loopback harness vs a public network) that caps every evidence claim made from it.
 *
 *   read      verification of enrollments, grants and revocations (EVM `eth_call`/`eth_getCode`/…, Solana account reads)
 *   owner     read + broadcasting a transaction the OWNER signed (a Solana delegation or revocation) — never a session signature
 *   executor  read + broadcasting a transaction a SESSION SIGNER signed (the delegated executor only)
 */
type Rpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
export type TransportPurpose = 'read' | 'owner' | 'executor';
export type ChainTransport = { readonly chain: string; readonly provenance: 'MOCKED' | 'PUBLIC'; readonly rpc: Rpc };
const EVM_READ = new Set(['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getCode', 'eth_getBalance', 'eth_getTransactionCount', 'eth_gasPrice',
  'eth_maxPriorityFeePerGas', 'eth_estimateGas', 'eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_getTransactionByHash']);
const SOL_READ = new Set(['getLatestBlockhash', 'getAccountInfo', 'getBalance', 'getSignatureStatuses', 'getGenesisHash']);
export function allowedMethods(chain: string, purpose: TransportPurpose): ReadonlySet<string> {
  const evm = chain.startsWith('eip155:');
  const read = evm ? EVM_READ : SOL_READ;
  if (purpose === 'read') return read;
  if (purpose === 'owner') return evm ? read : new Set([...read, 'sendTransaction']);
  return new Set([...read, evm ? 'eth_sendRawTransaction' : 'sendTransaction']);
}
/** Wraps `inner` so only `purpose`'s methods reach it (DELEGATION_RPC_METHOD_FORBIDDEN otherwise). */
export function guarded(chain: string, purpose: TransportPurpose, provenance: ChainTransport['provenance'], inner: Rpc): ChainTransport {
  const allowed = allowedMethods(chain, purpose);
  return { chain, provenance, rpc: async (method, params) => {
    if (!allowed.has(method)) throw new Error('DELEGATION_RPC_METHOD_FORBIDDEN');
    return inner(method, params);
  } };
}
/** A JSON-RPC 2.0 client over HTTP(S) with a timeout; an error response throws its message (bounded, never a body echo beyond 200 chars). */
export function httpRpc(url: string, fetchImpl: typeof fetch = fetch): Rpc {
  let id = 0;
  return async (method, params) => {
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const body = await response.json().catch(() => null) as { result?: unknown; error?: { message?: unknown } } | null;
    if (!body) throw new Error('DELEGATION_RPC_UNAVAILABLE');
    if (body.error) throw new Error(typeof body.error.message === 'string' ? body.error.message.slice(0, 200) : 'DELEGATION_RPC_ERROR');
    return body.result;
  };
}
