// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { isAbsolute } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createFileExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { createRouterService, type RouterService, type RouterWalletDiagnostic } from '../server/router-service';
import { routerMode, routerRuntime, type RouterMode } from '../server/router-runtime';
import { callCloudFlow } from '../server/cloud-api-client';

/**
 * BUILD-ROUTER-001: Base USDC → Arbitrum USDC through the canonical Cross-chain Router. Quotes, simulation and Review are
 * read-only; each wallet request needs the owner's Review, Execute click and wallet signature. Flofi never signs or sends.
 * Deployed: forwards the identical contract to the Flofi API (PostgreSQL, workers). Local: the same service on files.
 */
let service: RouterService | null = null;
function current(): RouterService {
  const mode = routerMode(process.env);
  if (mode === 'off') throw new Error('ROUTER_NOT_ENABLED');
  const journalDir = process.env.GRYLOO_ROUTER_JOURNAL;
  if (!journalDir || !isAbsolute(journalDir)) throw new Error('ROUTER_STORAGE_NOT_CONFIGURED');
  service ??= createRouterService({ storage: createFileExecutionStorage(journalDir, 'ROUTER_BUSY'), ...routerRuntime(mode, process.env) });
  return service;
}
async function run<T>(method: string, args: readonly unknown[], action: (service: RouterService) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  // Cloud deployment (BUILD-CLOUD-001): forward the identical contract to the stateless Flofi API.
  if (process.env.API_BASE_URL) return callCloudFlow<T>('crosschain-router', method, args);
  try { return { ok: true, value: await action(current()) }; }
  catch (cause) { const code = cause instanceof Error ? cause.message : ''; return { ok: false, code: /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'ROUTER_SERVICE_UNAVAILABLE' }; }
}
export async function crossChainRouterMode(): Promise<RouterMode> {
  if (process.env.API_BASE_URL) {
    const remote = await callCloudFlow<unknown>('crosschain-router', 'mode', []);
    return remote.ok && (remote.value === 'live' || remote.value === 'harness') ? remote.value : 'off';
  }
  return routerMode(process.env);
}
export async function routerInfo() { return run('info', [], async s => ({ executionEnabled: s.executionEnabled })); }
export async function routerSimulate(workflow: SemanticWorkflow, owner: string) { return run('simulate', [workflow, owner], s => s.simulate(workflow, owner)); }
export async function routerRefresh(id: string) { return run('refresh', [id], s => s.refresh(id)); }
export async function routerReview(id: string, commitment: string, workflow: SemanticWorkflow) { return run('review', [id, commitment, workflow], s => s.review(id, commitment, workflow)); }
export async function routerInvalidate(id: string) { return run('invalidate', [id], s => s.invalidate(id)); }
export async function routerBegin(id: string, owner: string, workflow: SemanticWorkflow) { return run('begin', [id, owner, workflow], s => s.begin(id, owner, workflow)); }
export async function routerHandoff(id: string) { return run('handoff', [id], s => s.handoff(id)); }
export async function routerReport(id: string, result: { kind: 'HASH'; hash: string } | { kind: 'UNKNOWN' | 'REJECTED'; code?: string }) {
  return run('report', [id, result], s => s.report(id, result));
}
export async function routerWalletFailure(id: string, diagnostic: RouterWalletDiagnostic) { return run('walletFailure', [id, diagnostic], s => s.walletFailure(id, diagnostic)); }
export async function routerObserve(id: string) { return run('observe', [id], s => s.observe(id)); }
export async function routerStatus(id: string) { return run('status', [id], s => s.load(id)); }
