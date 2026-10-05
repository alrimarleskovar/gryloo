// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createAcrossService } from '../server/across-service';
import { isHostedDeployment } from '../server/deployment';
/**
 * BUILD-010 MOCKED Across demonstration (simulated deposit, fill and refund) on a local journal. BUILD-CLOUD-PARITY-001: its
 * lifecycle depends on that journal, which a hosted deployment's instances do not share, so it stays local; the real Across
 * path on the cloud runtime is the Cross-chain Router.
 */
let local: ReturnType<typeof createAcrossService> | null = null;
const service = () => {
  if (isHostedDeployment(process.env)) throw new Error('ACROSS_MOCKED_DEMO_LOCAL_ONLY');
  return local ??= createAcrossService(join(tmpdir(), 'gryloo-build010-across-journal'));
};
const id = (value: string) => {
  if (!/^across-[0-9a-f]{24}$/.test(value)) throw new Error('ACROSS_ID_INVALID'); return value;
};
const result = async <T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; code: string }> => {
  try { return { ok: true, value: await work() }; }
  catch (cause) { const message = cause instanceof Error ? cause.message : '';
    return { ok: false, code: /^[A-Z][A-Z0-9_]{2,63}$/.test(message) ? message : 'ACROSS_INTERNAL_ERROR' }; }
};
export async function acrossInfo() { return result(async () => ({ liveQuoteAvailable: Boolean(process.env.ACROSS_API_KEY && process.env.ACROSS_INTEGRATOR_ID) })); }
export async function acrossQuote(workflow: SemanticWorkflow, owner: string) { return result(() => service().quote(workflow, owner)); }
export async function acrossLoad(executionId: string) { return result(() => service().load(id(executionId))); }
export async function acrossAuthorize(executionId: string, hash: string) { return result(() => service().authorize(id(executionId), hash)); }
export async function acrossApprove(executionId: string) { return result(() => service().approve(id(executionId))); }
export async function acrossPrepare(executionId: string) { return result(() => service().prepare(id(executionId))); }
export async function acrossSubmit(executionId: string, uncertain: boolean) { return result(() => service().submit(id(executionId), uncertain)); }
export async function acrossRecheck(executionId: string) { return result(() => service().recheck(id(executionId))); }
export async function acrossConfirmSource(executionId: string) { return result(() => service().confirmSource(id(executionId))); }
export async function acrossProgress(executionId: string) { return result(() => service().progress(id(executionId))); }
export async function acrossDelay(executionId: string) { return result(() => service().delay(id(executionId))); }
export async function acrossFill(executionId: string) { return result(() => service().fill(id(executionId))); }
export async function acrossReconcile(executionId: string) { return result(() => service().reconcile(id(executionId))); }
export async function acrossExpire(executionId: string) { return result(() => service().expire(id(executionId))); }
export async function acrossRefundPending(executionId: string) { return result(() => service().refundPending(id(executionId))); }
export async function acrossRefundConfirm(executionId: string) { return result(() => service().refundConfirm(id(executionId))); }
