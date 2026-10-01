// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { JUPITER_SOLANA_MAINNET as profile } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createJupiterService, type JupiterService, type JupiterWalletDiagnostic } from '../server/jupiter-service';

let service: JupiterService | null = null;
// Read methods for simulation/reconciliation. sendTransaction is reachable only from the owner-signed submit path.
const methods = new Set(['getGenesisHash', 'getMultipleAccounts', 'getLatestBlockhash', 'getBlockHeight', 'simulateTransaction',
  'getSignatureStatuses', 'getTransaction', 'sendTransaction']);
const HARNESS = 'http://127.0.0.1:8551';
function current(): JupiterService {
  const harness = process.env.GRYLOO_JUPITER_HARNESS === 'MOCKED_LOOPBACK_ONLY';
  const journalDir = process.env.GRYLOO_JUPITER_JOURNAL;
  if (!journalDir) throw new Error('JUPITER_STORAGE_NOT_CONFIGURED');
  if (service) return service;
  const override = process.env.GRYLOO_SOLANA_RPC_URL;
  // An owner-chosen HTTPS RPC may carry its own credential; it is never logged or returned.
  if (override && (() => { try { const url = new URL(override); return url.protocol !== 'https:' || Boolean(url.username || url.password); } catch { return true; } })())
    throw new Error('JUPITER_RPC_CONFIGURATION_INVALID');
  const rpcEndpoint = harness ? HARNESS + '/rpc' : override ?? profile.rpc;
  const buildEndpoint = harness ? HARNESS + '/swap/v2/build' : profile.api + profile.endpoint;
  const apiKey = harness ? undefined : process.env.JUPITER_API_KEY;
  let queue: Promise<unknown> = Promise.resolve();
  const post = async (method: string, params: readonly unknown[]) => {
    if (!methods.has(method)) throw new Error('SOLANA_RPC_METHOD_DENIED');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!harness) await new Promise<void>(resolve => setTimeout(resolve, attempt === 0 ? 120 : 600 * attempt));
      const response = await fetch(rpcEndpoint, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20_000),
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
  service = createJupiterService({
    journalDir, provenance: harness ? 'MOCKED' : 'PUBLIC_MAINNET',
    // Owner mainnet execution is opt-in server configuration; simulation and Review stay read-only without it.
    executionEnabled: harness || process.env.GRYLOO_JUPITER_OWNER_EXECUTION === 'MAINNET_OWNER_APPROVED',
    rpc: (method, params) => { const result = queue.then(() => post(method, params)); queue = result.catch(() => undefined); return result; },
    http: async query => {
      const response = await fetch(buildEndpoint + '?' + new URLSearchParams(query), { cache: 'no-store', signal: AbortSignal.timeout(20_000),
        headers: apiKey ? { 'x-api-key': apiKey } : {} });
      const text = await response.text(); if (text.length > 1_048_576) throw new Error('JUPITER_RESPONSE_TOO_LARGE');
      if (response.status === 429) throw new Error('JUPITER_RATE_LIMITED');
      if (response.status === 400 && /No routes found/.test(text)) throw new Error('JUPITER_NO_ROUTE');
      if (!response.ok) throw new Error('JUPITER_UNAVAILABLE');
      return JSON.parse(text) as unknown;
    },
  });
  return service;
}
async function run<T>(action: (service: JupiterService) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  try { return { ok: true, value: await action(current()) }; }
  catch (cause) { const code = cause instanceof Error ? cause.message : ''; return { ok: false, code: /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'JUPITER_SERVICE_UNAVAILABLE' }; }
}
export async function jupiterInfo() { return run(async service => ({ executionEnabled: service.executionEnabled })); }
export async function jupiterSimulate(workflow: SemanticWorkflow, owner: string) { return run(service => service.simulate(workflow, owner)); }
export async function jupiterReview(id: string, commitment: string, workflow: SemanticWorkflow) { return run(service => service.review(id, commitment, workflow)); }
export async function jupiterInvalidate(id: string) { return run(service => service.invalidate(id)); }
export async function jupiterBegin(id: string, owner: string, workflow: SemanticWorkflow) { return run(service => service.begin(id, owner, workflow)); }
export async function jupiterWalletFailure(id: string, diagnostic: JupiterWalletDiagnostic) { return run(service => service.walletFailure(id, diagnostic)); }
export async function jupiterSubmit(id: string, signedTransaction: string) { return run(service => service.submit(id, signedTransaction)); }
export async function jupiterObserve(id: string) { return run(service => service.observe(id)); }
export async function jupiterStatus(id: string) { return run(service => service.load(id)); }
