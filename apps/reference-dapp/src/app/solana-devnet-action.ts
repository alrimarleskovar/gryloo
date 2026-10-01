// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { ORCA_WHIRLPOOLS_DEVNET as profile } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createSolanaDevnetService, type SolanaSwapService, type SolanaSwapWalletDiagnostic } from '../server/jupiter-service';
import { createSolanaRpc, solanaRpcOverride } from '../server/solana-rpc';

/**
 * Solana Devnet canonical swap through Orca Whirlpools with valueless test tokens. Simulation and Review are read-only.
 * Execution still requires the owner's Review, Execute click and wallet signature; Gryloo never signs. Every request
 * verifies the Devnet genesis hash, so a misconfigured mainnet RPC fails closed.
 */
let service: SolanaSwapService | null = null;
const HARNESS = 'http://127.0.0.1:8552';
function current(): SolanaSwapService {
  const harness = process.env.GRYLOO_SOLANA_DEVNET_HARNESS === 'MOCKED_LOOPBACK_ONLY';
  const journalDir = process.env.GRYLOO_SOLANA_DEVNET_JOURNAL;
  if (!journalDir) throw new Error('DEVNET_SWAP_STORAGE_NOT_CONFIGURED');
  if (service) return service;
  const override = solanaRpcOverride(process.env.GRYLOO_SOLANA_DEVNET_RPC_URL, 'DEVNET_SWAP_RPC_CONFIGURATION_INVALID');
  service = createSolanaDevnetService({ journalDir, provenance: harness ? 'MOCKED' : 'PUBLIC_DEVNET',
    executionEnabled: process.env.GRYLOO_SOLANA_DEVNET_EXECUTION !== 'DISABLED',
    rpc: createSolanaRpc(harness ? HARNESS + '/rpc' : override ?? profile.rpc, harness) });
  return service;
}
async function run<T>(action: (service: SolanaSwapService) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  try { return { ok: true, value: await action(current()) }; }
  catch (cause) { const code = cause instanceof Error ? cause.message : ''; return { ok: false, code: /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'DEVNET_SWAP_SERVICE_UNAVAILABLE' }; }
}
export async function solanaDevnetInfo() { return run(async service => ({ executionEnabled: service.executionEnabled })); }
export async function solanaDevnetSimulate(workflow: SemanticWorkflow, owner: string) { return run(service => service.simulate(workflow, owner)); }
export async function solanaDevnetReview(id: string, commitment: string, workflow: SemanticWorkflow) { return run(service => service.review(id, commitment, workflow)); }
export async function solanaDevnetInvalidate(id: string) { return run(service => service.invalidate(id)); }
export async function solanaDevnetBegin(id: string, owner: string, workflow: SemanticWorkflow) { return run(service => service.begin(id, owner, workflow)); }
export async function solanaDevnetWalletFailure(id: string, diagnostic: SolanaSwapWalletDiagnostic) { return run(service => service.walletFailure(id, diagnostic)); }
export async function solanaDevnetSubmit(id: string, signedTransaction: string) { return run(service => service.submit(id, signedTransaction)); }
export async function solanaDevnetObserve(id: string) { return run(service => service.observe(id)); }
export async function solanaDevnetStatus(id: string) { return run(service => service.load(id)); }
