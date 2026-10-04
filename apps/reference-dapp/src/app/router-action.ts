// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createFileExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { createRouterService, ROUTER_RUN_ID, type RouterService, type RouterWalletDiagnostic } from '../server/router-service';
import { ROUTER_NETWORKS, routerNetworkMode, routerNetworkRuntime, type RouterMode, type RouterNetwork } from '../server/router-runtime';
import { callCloudFlow, listCloudRuns } from '../server/cloud-api-client';
import { assertRunOwnership, ROUTER_OWNERSHIP } from '../server/run-ownership';
import { currentWalletPrincipal } from '../server/session-principal';

/**
 * BUILD-ROUTER-001: Base USDC → Arbitrum USDC through the canonical Cross-chain Router. Quotes, simulation and Review are
 * read-only; each wallet request needs the owner's Review, Execute click and wallet signature. Flofi never signs or sends.
 * Deployed: forwards the identical contract to the Flofi API (PostgreSQL, workers). Local: the same service on files.
 * BUILD-JOURNEY-001: every call names its network (`mainnet`, or `testnet` = Base Sepolia → Arbitrum Sepolia, its own flow and
 * storage) and runs as the signed-in wallet: a run is only visible to, and operable by, the wallet that created it.
 */
type Result<T> = { ok: true; value: T } | { ok: false; code: string };
export type RouterRunSummary = { runId: string; status: string; hasEvidence: boolean; updatedAt: string };
const FLOW: Readonly<Record<RouterNetwork, string>> = { mainnet: 'crosschain-router', testnet: 'crosschain-router-testnet' };
const DISABLED: Readonly<Record<RouterNetwork, string>> = { mainnet: 'ROUTER_NOT_ENABLED', testnet: 'ROUTER_TESTNET_NOT_ENABLED' };
const JOURNAL: Readonly<Record<RouterNetwork, string>> = { mainnet: 'GRYLOO_ROUTER_JOURNAL', testnet: 'GRYLOO_ROUTER_TESTNET_JOURNAL' };
const isNetwork = (value: unknown): value is RouterNetwork => (ROUTER_NETWORKS as readonly unknown[]).includes(value);
const services = new Map<RouterNetwork, RouterService>();
function journalDir(network: RouterNetwork): string {
  const dir = process.env[JOURNAL[network]];
  if (!dir || !isAbsolute(dir)) throw new Error('ROUTER_STORAGE_NOT_CONFIGURED');
  return dir;
}
function current(network: RouterNetwork): RouterService {
  const mode = routerNetworkMode(network, process.env);
  if (mode === 'off') throw new Error(DISABLED[network]);
  let service = services.get(network);
  if (!service) {
    // Separate storage per network: owner+nonce and in-flight-deposit guards are per chain.
    service = createRouterService({ storage: createFileExecutionStorage(journalDir(network), 'ROUTER_BUSY'), ...routerNetworkRuntime(network, mode, process.env) });
    services.set(network, service);
  }
  return service;
}
const classified = (cause: unknown) => { const code = cause instanceof Error ? cause.message : ''; return /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'ROUTER_SERVICE_UNAVAILABLE'; };
async function run<T>(network: RouterNetwork, method: string, args: readonly unknown[], action: (service: RouterService) => Promise<T>): Promise<Result<T>> {
  if (!isNetwork(network)) return { ok: false, code: 'ROUTER_NETWORK_INVALID' };
  let principal: string | null;
  try { principal = await currentWalletPrincipal(); } catch (cause) { return { ok: false, code: classified(cause) }; }
  // Cloud deployment (BUILD-CLOUD-001): forward the identical contract to the stateless Flofi API, which enforces ownership.
  if (process.env.API_BASE_URL) return callCloudFlow<T>(FLOW[network], method, args, { principal });
  try {
    const service = current(network);
    await assertRunOwnership(ROUTER_OWNERSHIP, method, args, principal, async id => (await service.load(id)).owner);
    return { ok: true, value: await action(service) };
  } catch (cause) { return { ok: false, code: classified(cause) }; }
}
export async function crossChainRouterMode(network: RouterNetwork = 'mainnet'): Promise<RouterMode> {
  if (!isNetwork(network)) return 'off';
  if (process.env.API_BASE_URL) {
    const remote = await callCloudFlow<unknown>(FLOW[network], 'mode', []);
    return remote.ok && (remote.value === 'live' || remote.value === 'harness') ? remote.value : 'off';
  }
  return routerNetworkMode(network, process.env);
}
export async function routerInfo(network: RouterNetwork) { return run(network, 'info', [], async s => ({ executionEnabled: s.executionEnabled })); }
export async function routerSimulate(network: RouterNetwork, workflow: SemanticWorkflow, owner: string) { return run(network, 'simulate', [workflow, owner], s => s.simulate(workflow, owner)); }
export async function routerRefresh(network: RouterNetwork, id: string) { return run(network, 'refresh', [id], s => s.refresh(id)); }
export async function routerReview(network: RouterNetwork, id: string, commitment: string, workflow: SemanticWorkflow) {
  return run(network, 'review', [id, commitment, workflow], s => s.review(id, commitment, workflow));
}
export async function routerInvalidate(network: RouterNetwork, id: string, reason: 'SEMANTIC_EDIT' | 'WALLET_CHANGED' = 'SEMANTIC_EDIT') {
  return run(network, 'invalidate', reason === 'SEMANTIC_EDIT' ? [id] : [id, reason], s => s.invalidate(id, reason));
}
export async function routerBegin(network: RouterNetwork, id: string, owner: string, workflow: SemanticWorkflow) {
  return run(network, 'begin', [id, owner, workflow], s => s.begin(id, owner, workflow));
}
export async function routerHandoff(network: RouterNetwork, id: string) { return run(network, 'handoff', [id], s => s.handoff(id)); }
export async function routerReport(network: RouterNetwork, id: string, result: { kind: 'HASH'; hash: string } | { kind: 'UNKNOWN' | 'REJECTED'; code?: string }) {
  return run(network, 'report', [id, result], s => s.report(id, result));
}
export async function routerWalletFailure(network: RouterNetwork, id: string, diagnostic: RouterWalletDiagnostic) {
  return run(network, 'walletFailure', [id, diagnostic], s => s.walletFailure(id, diagnostic));
}
export async function routerObserve(network: RouterNetwork, id: string) { return run(network, 'observe', [id], s => s.observe(id)); }
export async function routerStatus(network: RouterNetwork, id: string) { return run(network, 'status', [id], s => s.load(id)); }
/** BUILD-JOURNEY-001: the signed-in wallet's runs, newest first, so a run can be recovered from any browser. */
export async function routerRuns(network: RouterNetwork): Promise<Result<RouterRunSummary[]>> {
  if (!isNetwork(network)) return { ok: false, code: 'ROUTER_NETWORK_INVALID' };
  let principal: string | null;
  try { principal = await currentWalletPrincipal(); } catch (cause) { return { ok: false, code: classified(cause) }; }
  if (!principal) return { ok: false, code: 'WALLET_SESSION_REQUIRED' };
  if (process.env.API_BASE_URL) {
    const listed = await listCloudRuns(FLOW[network], principal);
    return listed.ok ? { ok: true, value: listed.value.map(r => ({ runId: r.runId, status: r.status, hasEvidence: r.hasEvidence, updatedAt: r.updatedAt })) } : listed;
  }
  try {
    const service = current(network), dir = journalDir(network);
    const names = (await readdir(dir).catch(() => [] as string[])).filter(name => name.endsWith('.jsonl') && ROUTER_RUN_ID.test(name.slice(0, -6)));
    const dated = await Promise.all(names.map(async name => ({ id: name.slice(0, -6), at: (await stat(join(dir, name))).mtime })));
    const runs: RouterRunSummary[] = [];
    for (const { id, at } of dated.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 50)) {
      const record = await service.load(id).catch(() => null);
      if (record?.owner !== principal) continue;
      runs.push({ runId: id, status: record.verdict !== 'PENDING' ? record.verdict : record.attempts.find(a => ['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN',
        'PENDING'].includes(a.state))?.state ?? record.phase, hasEvidence: record.evidence !== null, updatedAt: at.toISOString() });
      if (runs.length >= 25) break;
    }
    return { ok: true, value: runs };
  } catch (cause) { return { ok: false, code: classified(cause) }; }
}
