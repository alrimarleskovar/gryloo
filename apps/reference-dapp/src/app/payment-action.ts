// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { isAbsolute } from 'node:path';
import type { PaymentDraftRequest } from '@defi-workflow-engine/workflow-contracts';
import { createFileExecutionStorage } from '@defi-workflow-engine/reference-executor';
import { cloudFlow, cloudFlowMode } from '../server/flow-runtime';
import { createPaymentFlowService, type PaymentFlowService, type PaymentWalletResult } from '../server/payment-flow-service';
import { paymentMode, paymentRuntime, type PaymentMode } from '../server/payment-runtime';
import { assertRunOwnership, PAYMENT_OWNERSHIP } from '../server/run-ownership';
import { currentWalletPrincipal } from '../server/session-principal';

/**
 * Stablecoin → Pix through the configured PaymentAdapter (Woovi). Quotes, simulation and Review move nothing; the source
 * transfer is signed and sent only by the owner's own wallet, and the provider pays out only after FloFi verified it on-chain.
 * Provider credentials stay on the server. Deployed: the identical contract on the cloud runtime. Local: the same service on files.
 * Every call runs as the signed-in wallet: a run is only visible to, and operable by, the wallet that created it.
 */
type Result<T> = { ok: true; value: T } | { ok: false; code: string };
let service: PaymentFlowService | null = null;
function current(): PaymentFlowService {
  if (paymentMode(process.env) === 'off') throw new Error('PAYMENT_NOT_ENABLED');
  const dir = process.env.GRYLOO_PAYMENT_JOURNAL;
  if (!dir || !isAbsolute(dir)) throw new Error('PAYMENT_STORAGE_NOT_CONFIGURED');
  service ??= createPaymentFlowService({ storage: createFileExecutionStorage(dir, 'PAYMENT_BUSY'), ...paymentRuntime(process.env) });
  return service;
}
const classified = (cause: unknown) => { const code = cause instanceof Error ? cause.message : ''; return /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'PAYMENT_SERVICE_UNAVAILABLE'; };
async function run<T>(method: string, args: readonly unknown[], action: (service: PaymentFlowService) => Promise<T>): Promise<Result<T>> {
  let principal: string | null;
  try { principal = await currentWalletPrincipal(); } catch (cause) { return { ok: false, code: classified(cause) }; }
  // Cloud deployment (remote API or embedded PostgreSQL runtime): the same backend enforces ownership against the durable run.
  const cloud = await cloudFlow<T>('pix-payment', method, args, { principal });
  if (cloud) return cloud;
  try {
    const payments = current();
    await assertRunOwnership(PAYMENT_OWNERSHIP, method, args, principal, async id => (await payments.load(id)).facts.owner.address);
    return { ok: true, value: await action(payments) };
  } catch (cause) { return { ok: false, code: classified(cause) }; }
}
export async function paymentFlowMode(): Promise<PaymentMode> {
  const cloud = await cloudFlowMode('pix-payment');
  return cloud === null ? paymentMode(process.env) : cloud === 'live' ? 'live' : 'off';
}
export async function paymentInfo() { return run('info', [], async s => ({ executionEnabled: s.executionEnabled })); }
export async function paymentSimulate(request: PaymentDraftRequest, owner: string) { return run('simulate', [request, owner], s => s.simulate(request, owner)); }
export async function paymentReview(id: string, commitment: string) { return run('review', [id, commitment], s => s.review(id, commitment)); }
export async function paymentInvalidate(id: string) { return run('invalidate', [id], s => s.invalidate(id)); }
export async function paymentBegin(id: string, owner: string) { return run('begin', [id, owner], s => s.begin(id, owner)); }
export async function paymentHandoff(id: string) { return run('handoff', [id], s => s.handoff(id)); }
export async function paymentReport(id: string, result: PaymentWalletResult) { return run('report', [id, result], s => s.report(id, result)); }
export async function paymentObserve(id: string) { return run('observe', [id], s => s.observe(id)); }
export async function paymentStatus(id: string) { return run('status', [id], s => s.load(id)); }
