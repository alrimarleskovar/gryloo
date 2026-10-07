// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { isAbsolute } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createBridgeService } from '../server/bridge-service';
import { isHostedDeployment } from '../server/deployment';
type Service = ReturnType<typeof createBridgeService>;
type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
let cache: { directory: string; service: Service } | null = null;
function runtime(): Service | null {
  // BUILD-CLOUD-PARITY-001: a local rehearsal (loopback chain, MOCKED harness, local journal) is never enabled on a hosted deployment.
  if (process.env.GRYLOO_BRIDGE !== 'mocked' || isHostedDeployment(process.env)) return null;
  const directory = process.env.GRYLOO_BRIDGE_JOURNAL;
  if (!directory || !isAbsolute(directory) || directory.includes('..')) throw new Error('BRIDGE_CONFIGURATION_INVALID');
  if (!cache || cache.directory !== directory) cache = { directory, service: createBridgeService(directory) };
  return cache.service;
}
const code = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : '';
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(message) ? message : 'BRIDGE_INTERNAL_ERROR';
};
const id = (value: unknown): string => {
  if (typeof value !== 'string' || !/^bridge-[0-9a-f]{24}$/.test(value)) throw new Error('BRIDGE_INPUT_INVALID');
  return value;
};
async function run<T>(work: (service: Service) => Promise<T>): Promise<Result<T>> {
  try { const service = runtime(); return service ? { ok: true, value: await work(service) } : { ok: false, code: 'BRIDGE_OFF' }; }
  catch (cause) { return { ok: false, code: code(cause) }; }
}
export async function bridgeInfo() {
  return run(async service => ({ enabled: true as const, environment: 'MOCKED' as const, executions: await service.list() }));
}
export async function bridgeQuote(input: { workflow: SemanticWorkflow; owner: string; scenario: 'normal' | 'uncertain' }) {
  return run(service => {
    if (!['normal', 'uncertain'].includes(input.scenario) || typeof input.owner !== 'string'
      || !/^0x[0-9a-fA-F]{40}$/.test(input.owner)) throw new Error('BRIDGE_INPUT_INVALID');
    return service.quote(input.workflow, input.owner, input.scenario);
  });
}
export async function bridgeLoad(executionId: string) { return run(service => service.load(id(executionId))); }
export async function bridgeAuthorize(executionId: string, manifestHash: string) {
  return run(service => {
    if (!/^0x[0-9a-f]{64}$/.test(manifestHash)) throw new Error('BRIDGE_INPUT_INVALID');
    return service.authorize(id(executionId), manifestHash);
  });
}
export async function bridgeApprove(executionId: string) { return run(service => service.approve(id(executionId))); }
export async function bridgeSubmit(executionId: string) { return run(service => service.submit(id(executionId))); }
export async function bridgeRecheck(executionId: string) { return run(service => service.recheck(id(executionId))); }
export async function bridgeConfirmSource(executionId: string) { return run(service => service.confirmSource(id(executionId))); }
export async function bridgeProgress(executionId: string) { return run(service => service.progress(id(executionId))); }
export async function bridgeConfirmDestination(executionId: string) { return run(service => service.confirmDestination(id(executionId))); }
export async function bridgeReconcile(executionId: string) { return run(service => service.reconcile(id(executionId))); }
