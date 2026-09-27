// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { isAbsolute, join } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createCowService, discoverCow, type CowScenario } from '../server/cow-service';

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
type Service = ReturnType<typeof createCowService>;
let cache: { directory: string; service: Service } | null = null;
const EXECUTION = /^cow-[0-9a-f]{24}$/;
const SIGNATURE = /^0x[0-9a-f]{130}$/;
const OWNER = /^0x[0-9a-f]{40}$/;
function runtime(): Service | null {
  if (process.env.GRYLOO_COW !== 'loopback') return null;
  const directory = process.env.GRYLOO_COW_RUNTIME;
  if (!directory || !isAbsolute(directory) || directory.includes('..')) throw new Error('COW_CONFIGURATION_INVALID');
  if (!cache || cache.directory !== directory) cache = { directory, service: createCowService(join(directory, 'cow')) };
  return cache.service;
}
const code = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : '';
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(message) ? message : 'COW_INTERNAL_ERROR';
};
const id = (value: unknown): string => {
  if (typeof value !== 'string' || !EXECUTION.test(value)) throw new Error('COW_INPUT_INVALID');
  return value;
};
const signature = (value: unknown): string => {
  if (typeof value !== 'string' || !SIGNATURE.test(value)) throw new Error('COW_INPUT_INVALID');
  return value;
};
async function run<T>(work: (service: Service) => Promise<T>): Promise<Result<T>> {
  try { const service = runtime(); return service ? { ok: true, value: await work(service) } : { ok: false, code: 'COW_OFF' }; }
  catch (cause) { return { ok: false, code: code(cause) }; }
}
export async function cowInfo(input: { workflow: SemanticWorkflow }) {
  try {
    const service = runtime();
    if (!service) return { ok: true as const, value: { enabled: false as const, discovery: null, executions: [] } };
    return { ok: true as const, value: { enabled: true as const, discovery: discoverCow(input.workflow),
      executions: await service.list() } };
  } catch (cause) { return { ok: false as const, code: code(cause) }; }
}
export async function cowPrepare(input: { workflow: SemanticWorkflow; owner: string; scenario: CowScenario }) {
  return run(service => {
    if (!OWNER.test(input.owner) || !['fill', 'hold', 'ambiguous', 'expire', 'failure'].includes(input.scenario))
      throw new Error('COW_INPUT_INVALID');
    return service.prepare(input.workflow, input.owner, input.scenario);
  });
}
export async function cowExecution(input: { executionId: string }) {
  return run(service => service.status(id(input.executionId)));
}
export async function cowPost(input: { executionId: string; signature: string }) {
  return run(service => service.signAndPost(id(input.executionId), signature(input.signature)));
}
export async function cowTrack(input: { executionId: string }) {
  return run(service => service.track(id(input.executionId)));
}
export async function cowCancel(input: { executionId: string; signature: string }) {
  return run(service => service.cancel(id(input.executionId), signature(input.signature)));
}
export async function cowReconcile(input: { executionId: string }) {
  return run(service => service.reconcile(id(input.executionId)));
}
