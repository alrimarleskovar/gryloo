// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { BASE_SEPOLIA, createPublicTestnetService, publicRecordingEnabled,
  type PublicTestnetService, type PublicRun, type PublicBegin, type Rpc } from '../server/public-testnet-service';

export type PublicResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
let service: PublicTestnetService | null = null;
let serviceDir: string | null = null;
const allowedMethods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call',
  'eth_getBalance', 'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionReceipt', 'eth_getTransactionByHash']);
const rpc: Rpc = async (method, params) => {
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
function current(): PublicTestnetService {
  if (!publicRecordingEnabled(process.env)) throw new Error('PUBLIC_RECORDING_OFF');
  const dir = process.env.GRYLOO_PUBLIC_TESTNET_JOURNAL!;
  if (!service || serviceDir !== dir) { service = createPublicTestnetService({ rpc, journalDir: dir }); serviceDir = dir; }
  return service;
}
function code(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(message) ? message : 'PUBLIC_INTERNAL_ERROR';
}
async function run<T>(action: (service: PublicTestnetService) => T | Promise<T>): Promise<PublicResult<T>> {
  try { return { ok: true, value: await action(current()) }; }
  catch (error) { return { ok: false, code: code(error) }; }
}
const id = (value: unknown) => typeof value === 'string' && /^pub-[0-9a-f]{24}$/.test(value) ? value : (() => { throw new Error('INPUT_INVALID'); })();
export async function publicPrepare(workflow: SemanticWorkflow): Promise<PublicResult<PublicRun>> {
  return run(service => service.prepare(workflow));
}
export async function publicRefresh(executionId: string): Promise<PublicResult<PublicRun>> {
  return run(service => service.refresh(id(executionId)));
}
export async function publicReview(executionId: string, manifestHash: string): Promise<PublicResult<PublicRun>> {
  return run(service => service.review(id(executionId), manifestHash));
}
export async function publicBegin(executionId: string, account: string): Promise<PublicResult<PublicBegin>> {
  return run(service => service.begin(id(executionId), account));
}
export async function publicReport(executionId: string, attemptId: string,
  result: { kind: 'HASH'; txHash: string } | { kind: 'REJECTED' | 'UNKNOWN' }): Promise<PublicResult<PublicRun>> {
  return run(service => service.report(id(executionId), attemptId, result));
}
export async function publicObserve(executionId: string): Promise<PublicResult<PublicRun>> {
  return run(service => service.observe(id(executionId)));
}
export async function publicStatus(executionId: string): Promise<PublicResult<PublicRun>> {
  return run(service => service.load(id(executionId)));
}
export async function publicAvailability(): Promise<boolean> { return publicRecordingEnabled(process.env); }
