// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { ROBINHOOD_TESTNET_TRANSFER as profile } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createRobinhoodTransferService, type RobinhoodTransferService, type TransferWalletDiagnostic } from '../server/robinhood-transfer-service';

let service: RobinhoodTransferService | null = null;
/** Read methods only. The server has no send, sign or wallet method of any kind. */
const methods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
/** Live public reads need an explicit local development flag; automated tests use only the loopback harness. */
export async function robinhoodTransferMode(): Promise<'live' | 'harness' | 'off'> {
  if (process.env.GRYLOO_ROBINHOOD_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
  return process.env.GRYLOO_ROBINHOOD_TESTNET === 'live' && process.env.NODE_ENV === 'development' ? 'live' : 'off';
}
async function current(): Promise<RobinhoodTransferService> {
  const mode = await robinhoodTransferMode();
  if (mode === 'off') throw new Error('TRANSFER_PUBLIC_TESTNET_NOT_ENABLED');
  const journalDir = process.env.GRYLOO_ROBINHOOD_JOURNAL;
  if (!journalDir) throw new Error('TRANSFER_STORAGE_NOT_CONFIGURED');
  if (!service) {
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
    service = createRobinhoodTransferService({ journalDir, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_TESTNET', rpc: (method, params) => {
      const result = queue.then(() => read(method, params)); queue = result.catch(() => undefined); return result;
    } });
  }
  return service;
}
async function run<T>(action: (service: RobinhoodTransferService) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  try { return { ok: true, value: await action(await current()) }; }
  catch (cause) { const code = cause instanceof Error ? cause.message : ''; return { ok: false, code: /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'TRANSFER_SERVICE_UNAVAILABLE' }; }
}
export async function transferSimulate(workflow: SemanticWorkflow, account: string) { return run(s => s.simulate(workflow, account)); }
export async function transferReview(id: string, commitment: string, workflow: SemanticWorkflow) { return run(s => s.review(id, commitment, workflow)); }
export async function transferInvalidate(id: string) { return run(s => s.invalidate(id)); }
export async function transferBegin(id: string, account: string, workflow: SemanticWorkflow) { return run(s => s.begin(id, account, workflow)); }
export async function transferHandoff(id: string) { return run(s => s.handoff(id)); }
export async function transferReport(id: string, result: { kind: 'HASH'; hash: string } | { kind: 'UNKNOWN' | 'REJECTED'; code?: string }) { return run(s => s.report(id, result)); }
export async function transferWalletFailure(id: string, diagnostic: TransferWalletDiagnostic) { return run(s => s.walletFailure(id, diagnostic)); }
export async function transferObserve(id: string) { return run(s => s.observe(id)); }
export async function transferStatus(id: string) { return run(s => s.load(id)); }
export async function transferRecoverReview(id: string) { return run(s => s.recoverReview(id)); }
