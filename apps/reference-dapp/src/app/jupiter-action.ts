// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { JUPITER_SOLANA_MAINNET as profile } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createJupiterService, type JupiterService, type JupiterWalletDiagnostic } from '../server/jupiter-service';
import { createSolanaRpc, solanaRpcOverride } from '../server/solana-rpc';
import { cloudFlow } from '../server/flow-runtime';
import { createJupiterHttp } from '../server/jupiter-http';

let service: JupiterService | null = null;
const HARNESS = 'http://127.0.0.1:8551';
function current(): JupiterService {
  const harness = process.env.GRYLOO_JUPITER_HARNESS === 'MOCKED_LOOPBACK_ONLY';
  const journalDir = process.env.GRYLOO_JUPITER_JOURNAL;
  if (!journalDir) throw new Error('JUPITER_STORAGE_NOT_CONFIGURED');
  if (service) return service;
  const override = solanaRpcOverride(process.env.GRYLOO_SOLANA_RPC_URL, 'JUPITER_RPC_CONFIGURATION_INVALID');
  const rpcEndpoint = harness ? HARNESS + '/rpc' : override ?? profile.rpc;
  const buildEndpoint = harness ? HARNESS + '/swap/v2/build' : profile.api + profile.endpoint;
  const apiKey = harness ? undefined : process.env.JUPITER_API_KEY;
  service = createJupiterService({
    journalDir, provenance: harness ? 'MOCKED' : 'PUBLIC_MAINNET',
    // Owner mainnet execution is opt-in server configuration; simulation and Review stay read-only without it.
    executionEnabled: harness || process.env.GRYLOO_JUPITER_OWNER_EXECUTION === 'MAINNET_OWNER_APPROVED',
    rpc: createSolanaRpc(rpcEndpoint, harness),
    http: createJupiterHttp(buildEndpoint, apiKey),
  });
  return service;
}
async function run<T>(method: string, args: readonly unknown[], action: (service: JupiterService) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  // Cloud deployment: the remote Flofi API (BUILD-CLOUD-001) or the embedded PostgreSQL runtime (BUILD-CLOUD-PARITY-001).
  const cloud = await cloudFlow<T>('jupiter-swap', method, args);
  if (cloud) return cloud;
  try { return { ok: true, value: await action(current()) }; }
  catch (cause) { const code = cause instanceof Error ? cause.message : ''; return { ok: false, code: /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'JUPITER_SERVICE_UNAVAILABLE' }; }
}
export async function jupiterInfo() { return run('info', [], async service => ({ executionEnabled: service.executionEnabled })); }
export async function jupiterSimulate(workflow: SemanticWorkflow, owner: string) { return run('simulate', [workflow, owner], service => service.simulate(workflow, owner)); }
export async function jupiterReview(id: string, commitment: string, workflow: SemanticWorkflow) { return run('review', [id, commitment, workflow], service => service.review(id, commitment, workflow)); }
export async function jupiterInvalidate(id: string) { return run('invalidate', [id], service => service.invalidate(id)); }
export async function jupiterBegin(id: string, owner: string, workflow: SemanticWorkflow) { return run('begin', [id, owner, workflow], service => service.begin(id, owner, workflow)); }
export async function jupiterWalletFailure(id: string, diagnostic: JupiterWalletDiagnostic) { return run('walletFailure', [id, diagnostic], service => service.walletFailure(id, diagnostic)); }
export async function jupiterSubmit(id: string, signedTransaction: string) { return run('submit', [id, signedTransaction], service => service.submit(id, signedTransaction)); }
export async function jupiterObserve(id: string) { return run('observe', [id], service => service.observe(id)); }
export async function jupiterStatus(id: string) { return run('status', [id], service => service.load(id)); }
