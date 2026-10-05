// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-013 lending composition read client, shared by the in-process server action and (BUILD-CLOUD-PARITY-001) the cloud flow.
 * Live reads use the keyed Base Sepolia provider BUILD-013 requires (public endpoints rate-limit its sequential `eth_simulateV1`):
 * the key travels only in a server-side Bearer header. Reads are allowlisted, paced and serialized; the client is bound to Base
 * Sepolia and has no send, sign or wallet method. Without the key, every live read fails closed.
 */
import type { SupplyRpc } from '@defi-workflow-engine/reference-compiler';

const methods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_simulateV1', 'eth_getBalance',
  'eth_getTransactionCount', 'eth_gasPrice', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
/** Loopback MOCKED harness (e2e/lending-harness.mjs); never a public provider. */
export const LENDING_HARNESS_RPC_URL = 'http://127.0.0.1:8554';
const LENDING_PUBLIC_RPC_URL = 'https://base-sepolia.g.alchemy.com/v2';

export function createLendingRpc(harness: boolean, env: Readonly<Record<string, string | undefined>>): SupplyRpc {
  const credential = env.GRYLOO_ALCHEMY_API_KEY;
  if (!harness && !credential?.trim()) return () => Promise.reject(new Error('LENDING_PUBLIC_CREDENTIAL_NOT_CONFIGURED'));
  let queue: Promise<unknown> = Promise.resolve();
  const read = async (method: string, params: readonly unknown[]) => {
    if (!methods.has(method)) throw Error('LENDING_RPC_METHOD_DENIED');
    if (!harness) await new Promise<void>(resolve => setTimeout(resolve, 150));
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (!harness) headers.authorization = `Bearer ${credential}`;
    const response = await fetch(harness ? LENDING_HARNESS_RPC_URL : LENDING_PUBLIC_RPC_URL, { method: 'POST', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(15000), headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const text = await response.text(); if (text.length > 1048576) throw Error('LENDING_RPC_RESPONSE_TOO_LARGE');
    const value: unknown = JSON.parse(text);
    if (!response.ok || !value || typeof value !== 'object' || !('result' in value) || 'error' in value)
      throw Error(method === 'eth_simulateV1' ? 'LENDING_SEQUENTIAL_SIMULATION_UNAVAILABLE' : 'LENDING_RPC_UNAVAILABLE');
    // Bound to Base Sepolia: a provider answering for any other chain is refused, never followed.
    if (method === 'eth_chainId' && (typeof value.result !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(value.result) || BigInt(value.result) !== 84532n))
      throw Error('LENDING_WRONG_CHAIN');
    return value.result;
  };
  return (method, params) => { const result = queue.then(() => read(method, params)); queue = result.catch(() => undefined); return result; };
}
