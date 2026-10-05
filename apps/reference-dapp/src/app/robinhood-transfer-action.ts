// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createRobinhoodTransferService, type RobinhoodTransferService, type TransferWalletDiagnostic } from '../server/robinhood-transfer-service';
import { nativeTransferReadRpcs } from '../server/robinhood-rpc';
import { cloudFlow, cloudFlowMode } from '../server/flow-runtime';

let service: RobinhoodTransferService | null = null;
/**
 * Live public reads need an explicit local development flag per network (`GRYLOO_ROBINHOOD_TESTNET=live`,
 * `GRYLOO_ETHEREUM_SEPOLIA_TRANSFER=live`); automated tests use only the loopback harness.
 */
export async function robinhoodTransferMode(): Promise<'live' | 'harness' | 'off'> {
  // Cloud deployment: the cloud runtime (remote API or embedded PostgreSQL) owns the flow and its explicit enablement.
  const cloud = await cloudFlowMode('robinhood-transfer');
  if (cloud) return cloud;
  if (process.env.GRYLOO_ROBINHOOD_HARNESS === 'MOCKED_LOOPBACK_ONLY') return 'harness';
  return (process.env.GRYLOO_ROBINHOOD_TESTNET === 'live' || process.env.GRYLOO_ETHEREUM_SEPOLIA_TRANSFER === 'live') && process.env.NODE_ENV === 'development' ? 'live' : 'off';
}
async function current(): Promise<RobinhoodTransferService> {
  const mode = await robinhoodTransferMode();
  if (mode === 'off') throw new Error('TRANSFER_PUBLIC_TESTNET_NOT_ENABLED');
  const journalDir = process.env.GRYLOO_ROBINHOOD_JOURNAL;
  if (!journalDir) throw new Error('TRANSFER_STORAGE_NOT_CONFIGURED');
  service ??= createRobinhoodTransferService({ journalDir, provenance: mode === 'harness' ? 'MOCKED' : 'PUBLIC_TESTNET', ...nativeTransferReadRpcs(mode, process.env) });
  return service;
}
async function run<T>(method: string, args: readonly unknown[], action: (service: RobinhoodTransferService) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  const cloud = await cloudFlow<T>('robinhood-transfer', method, args);
  if (cloud) return cloud;
  try { return { ok: true, value: await action(await current()) }; }
  catch (cause) { const code = cause instanceof Error ? cause.message : ''; return { ok: false, code: /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'TRANSFER_SERVICE_UNAVAILABLE' }; }
}
export async function transferSimulate(workflow: SemanticWorkflow, account: string) { return run('simulate', [workflow, account], s => s.simulate(workflow, account)); }
export async function transferReview(id: string, commitment: string, workflow: SemanticWorkflow) { return run('review', [id, commitment, workflow], s => s.review(id, commitment, workflow)); }
export async function transferInvalidate(id: string) { return run('invalidate', [id], s => s.invalidate(id)); }
export async function transferBegin(id: string, account: string, workflow: SemanticWorkflow) { return run('begin', [id, account, workflow], s => s.begin(id, account, workflow)); }
export async function transferHandoff(id: string) { return run('handoff', [id], s => s.handoff(id)); }
export async function transferReport(id: string, result: { kind: 'HASH'; hash: string } | { kind: 'UNKNOWN' | 'REJECTED'; code?: string }) { return run('report', [id, result], s => s.report(id, result)); }
export async function transferWalletFailure(id: string, diagnostic: TransferWalletDiagnostic) { return run('walletFailure', [id, diagnostic], s => s.walletFailure(id, diagnostic)); }
export async function transferObserve(id: string) { return run('observe', [id], s => s.observe(id)); }
export async function transferStatus(id: string) { return run('status', [id], s => s.load(id)); }
export async function transferRecoverReview(id: string) { return run('recoverReview', [id], s => s.recoverReview(id)); }
