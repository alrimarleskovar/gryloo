// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { isAbsolute } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createFileExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { createUniswapLiquidityService, type UniswapLiquidityService, type UniswapWalletDiagnostic } from '../server/uniswap-liquidity-service';
import { baseSepoliaRpcUrl, createBaseSepoliaReadRpc, UNISWAP_LIQUIDITY_RPC_METHODS } from '../server/public-testnet-rpc';
import { UNI_MOCK_CODE_PINS, UNI_MOCK_RPC_URL } from '../server/uniswap-liquidity-mock';
import { callCloudFlow } from '../server/cloud-api-client';

/**
 * BUILD-UNISWAP-LIQUIDITY-PUBLIC: Uniswap v3 liquidity on Base Sepolia with test tokens. Simulation and Review are read-only;
 * each approval and the mint need the owner's Review, Execute click and wallet signature. Flofi never signs or sends.
 * Deployed: forwards the identical contract to the Flofi API (PostgreSQL, workers). Local: the same service on files.
 */
type Mode = 'live' | 'harness' | 'off';
function localMode(): Mode {
  if (process.env.GRYLOO_UNISWAP_LIQUIDITY_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
  return process.env.GRYLOO_UNISWAP_LIQUIDITY_TESTNET === 'live' ? 'live' : 'off';
}
let service: UniswapLiquidityService | null = null;
function current(): UniswapLiquidityService {
  const mode = localMode();
  if (mode === 'off') throw new Error('UNISWAP_LIQUIDITY_PUBLIC_TESTNET_NOT_ENABLED');
  const journalDir = process.env.GRYLOO_UNISWAP_LIQUIDITY_JOURNAL;
  if (!journalDir || !isAbsolute(journalDir)) throw new Error('UNISWAP_LIQUIDITY_STORAGE_NOT_CONFIGURED');
  service ??= createUniswapLiquidityService({ storage: createFileExecutionStorage(journalDir, 'UNISWAP_LIQUIDITY_BUSY'),
    rpc: createBaseSepoliaReadRpc(mode === 'harness' ? UNI_MOCK_RPC_URL : baseSepoliaRpcUrl(process.env.GRYLOO_BASE_SEPOLIA_RPC_URL), UNISWAP_LIQUIDITY_RPC_METHODS),
    provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_TESTNET', executionEnabled: process.env.GRYLOO_UNISWAP_LIQUIDITY_EXECUTION !== 'DISABLED',
    ...mode === 'harness' ? { mockedCodePins: UNI_MOCK_CODE_PINS } : {} });
  return service;
}
async function run<T>(method: string, args: readonly unknown[], action: (service: UniswapLiquidityService) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  // Cloud deployment (BUILD-CLOUD-001): forward the identical contract to the stateless Flofi API.
  if (process.env.API_BASE_URL) return callCloudFlow<T>('uniswap-liquidity', method, args);
  try { return { ok: true, value: await action(current()) }; }
  catch (cause) { const code = cause instanceof Error ? cause.message : ''; return { ok: false, code: /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'UNISWAP_LIQUIDITY_SERVICE_UNAVAILABLE' }; }
}
export async function uniswapLiquidityMode(): Promise<Mode> {
  if (process.env.API_BASE_URL) {
    const remote = await callCloudFlow<unknown>('uniswap-liquidity', 'mode', []);
    return remote.ok && (remote.value === 'live' || remote.value === 'harness') ? remote.value : 'off';
  }
  return localMode();
}
export async function uniswapLiquidityInfo() { return run('info', [], async s => ({ executionEnabled: s.executionEnabled })); }
export async function uniswapLiquidityPrice() { return run('price', [], s => s.price()); }
export async function uniswapLiquiditySimulate(workflow: SemanticWorkflow, owner: string) { return run('simulate', [workflow, owner], s => s.simulate(workflow, owner)); }
export async function uniswapLiquidityRefresh(id: string) { return run('refresh', [id], s => s.refresh(id)); }
export async function uniswapLiquidityReview(id: string, commitment: string, workflow: SemanticWorkflow) { return run('review', [id, commitment, workflow], s => s.review(id, commitment, workflow)); }
export async function uniswapLiquidityInvalidate(id: string) { return run('invalidate', [id], s => s.invalidate(id)); }
export async function uniswapLiquidityBegin(id: string, owner: string, workflow: SemanticWorkflow) { return run('begin', [id, owner, workflow], s => s.begin(id, owner, workflow)); }
export async function uniswapLiquidityHandoff(id: string) { return run('handoff', [id], s => s.handoff(id)); }
export async function uniswapLiquidityReport(id: string, result: { kind: 'HASH'; hash: string } | { kind: 'UNKNOWN' | 'REJECTED'; code?: string }) {
  return run('report', [id, result], s => s.report(id, result));
}
export async function uniswapLiquidityWalletFailure(id: string, diagnostic: UniswapWalletDiagnostic) { return run('walletFailure', [id, diagnostic], s => s.walletFailure(id, diagnostic)); }
export async function uniswapLiquidityObserve(id: string) { return run('observe', [id], s => s.observe(id)); }
export async function uniswapLiquidityStatus(id: string) { return run('status', [id], s => s.load(id)); }
