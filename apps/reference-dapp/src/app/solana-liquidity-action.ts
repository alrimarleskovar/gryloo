// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY as profile } from '@defi-workflow-engine/action-registry';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createOrcaLiquidityService, type OrcaLiquidityService, type OrcaLiquidityWalletDiagnostic } from '../server/orca-liquidity-service';
import { createSolanaRpc, solanaRpcOverride } from '../server/solana-rpc';
import { callCloudFlow } from '../server/cloud-api-client';

/**
 * BUILD-015 Orca Whirlpools liquidity on Solana Devnet with valueless test tokens. Simulation, Review and Inspect are
 * read-only. Every lifecycle transaction needs the owner's Review, Execute click and wallet signature; Gryloo never signs.
 * The position-mint key for OPEN is generated in the browser and never sent here; only its public key is.
 */
let service: OrcaLiquidityService | null = null;
const HARNESS = 'http://127.0.0.1:8552';
function current(): OrcaLiquidityService {
  const harness = process.env.GRYLOO_SOLANA_DEVNET_HARNESS === 'MOCKED_LOOPBACK_ONLY';
  const journalDir = process.env.GRYLOO_SOLANA_DEVNET_JOURNAL;
  if (!journalDir) throw new Error('ORCA_LIQUIDITY_STORAGE_NOT_CONFIGURED');
  if (service) return service;
  const override = solanaRpcOverride(process.env.GRYLOO_SOLANA_DEVNET_RPC_URL, 'ORCA_LIQUIDITY_RPC_CONFIGURATION_INVALID');
  service = createOrcaLiquidityService({ journalDir, provenance: harness ? 'MOCKED' : 'PUBLIC_DEVNET',
    executionEnabled: process.env.GRYLOO_SOLANA_DEVNET_EXECUTION !== 'DISABLED',
    rpc: createSolanaRpc(harness ? HARNESS + '/rpc' : override ?? profile.rpc, harness) });
  return service;
}
async function run<T>(method: string, args: readonly unknown[], action: (service: OrcaLiquidityService) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  // Cloud deployment (BUILD-CLOUD-001): forward the identical contract to the stateless Flofi API.
  if (process.env.API_BASE_URL) return callCloudFlow<T>('orca-liquidity', method, args);
  try { return { ok: true, value: await action(current()) }; }
  catch (cause) { const code = cause instanceof Error ? cause.message : ''; return { ok: false, code: /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'ORCA_LIQUIDITY_SERVICE_UNAVAILABLE' }; }
}
type Request = { operation: 'OPEN' | 'DECREASE_PARTIAL' | 'EXIT'; positionMint: string; partBps?: number };
const request = (value: Request): Request => {
  if (!value || !['OPEN', 'DECREASE_PARTIAL', 'EXIT'].includes(value.operation) || typeof value.positionMint !== 'string' ||
      value.partBps !== undefined && !Number.isSafeInteger(value.partBps)) throw new Error('ORCA_LIQUIDITY_INPUT_INVALID');
  return { operation: value.operation, positionMint: value.positionMint, ...value.partBps === undefined ? {} : { partBps: value.partBps } };
};
export async function solanaLiquidityInfo() { return run('info', [], async service => ({ executionEnabled: service.executionEnabled })); }
export async function solanaLiquidityPrice() { return run('price', [], service => service.price()); }
export async function solanaLiquidityPositions(owner: string) { return run('positions', [owner], service => service.positions(owner)); }
export async function solanaLiquidityInspect(owner: string, positionMint: string) { return run('inspect', [owner, positionMint], service => service.inspect(owner, positionMint)); }
export async function solanaLiquiditySimulate(workflow: SemanticWorkflow, owner: string, value: Request) { return run('simulate', [workflow, owner, value], service => service.simulate(workflow, owner, request(value))); }
export async function solanaLiquidityReview(id: string, commitment: string, workflow: SemanticWorkflow) { return run('review', [id, commitment, workflow], service => service.review(id, commitment, workflow)); }
export async function solanaLiquidityInvalidate(id: string) { return run('invalidate', [id], service => service.invalidate(id)); }
export async function solanaLiquidityBegin(id: string, owner: string, workflow: SemanticWorkflow) { return run('begin', [id, owner, workflow], service => service.begin(id, owner, workflow)); }
export async function solanaLiquidityWalletFailure(id: string, diagnostic: OrcaLiquidityWalletDiagnostic) { return run('walletFailure', [id, diagnostic], service => service.walletFailure(id, diagnostic)); }
export async function solanaLiquiditySubmit(id: string, signedTransaction: string) { return run('submit', [id, signedTransaction], service => service.submit(id, signedTransaction)); }
export async function solanaLiquidityObserve(id: string) { return run('observe', [id], service => service.observe(id)); }
export async function solanaLiquidityStatus(id: string) { return run('status', [id], service => service.load(id)); }
