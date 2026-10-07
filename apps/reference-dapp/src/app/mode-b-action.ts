// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createForkRpc } from '../server/fork-rpc';
import { createModeBService, type ModeBServerProfile } from '../server/mode-b-service';
import { isHostedDeployment } from '../server/deployment';

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
type Service = ReturnType<typeof createModeBService>;
let cache: { key: string; service: Service; profile: ModeBServerProfile } | null = null;
const EXECUTION = /^exec-[0-9a-f]{24}$/;
const HASH = /^0x[0-9a-f]{64}$/;
function runtime() {
  // BUILD-CLOUD-PARITY-001: a local rehearsal (loopback chain, MOCKED harness, local journal) is never enabled on a hosted deployment.
  if (process.env.GRYLOO_MODE_B !== 'fork' || isHostedDeployment(process.env)) return null;
  const path = process.env.GRYLOO_MODE_B_PROFILE;
  if (!path || !isAbsolute(path)) throw new Error('MODE_B_CONFIGURATION_INVALID');
  const source = readFileSync(path, 'utf8');
  const key = `${path}\n${source}`;
  if (cache?.key === key) return cache;
  const profile = JSON.parse(source) as ModeBServerProfile;
  const service = createModeBService(profile, createForkRpc({ url: profile.rpcUrl }));
  cache = { key, service, profile };
  return cache;
}
function id(input: unknown) {
  const value = (input as { executionId?: unknown } | null)?.executionId;
  if (typeof value !== 'string' || !EXECUTION.test(value)) throw new Error('MODE_B_INPUT_INVALID');
  return value;
}
function code(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(message) ? message : 'MODE_B_INTERNAL_ERROR';
}
async function run<T>(fn: (service: Service) => Promise<T>): Promise<Result<T>> {
  try { const value = runtime(); return value ? { ok: true, value: await fn(value.service) } : { ok: false, code: 'MODE_B_OFF' }; }
  catch (error) { return { ok: false, code: code(error) }; }
}
export async function modeBInfo(): Promise<Result<{ available: boolean; owner?: string; executor?: string; safe?: string;
  executions?: readonly { executionId: string; preparedAt: string }[] }>> {
  try {
    const value = runtime();
    if (!value) return { ok: true, value: { available: false } };
    await value.service.boundary();
    const { owner, executor, safe } = value.profile;
    return { ok: true, value: { available: true, owner, executor, safe, executions: await value.service.list() } };
  } catch (error) { return { ok: false, code: code(error) }; }
}
export async function modeBPrepare(input: unknown) {
  return run(service => service.prepare((input as { workflow?: unknown } | null)?.workflow as SemanticWorkflow));
}
export async function modeBExecution(input: unknown) {
  return run(service => service.status(id(input)));
}
export async function modeBInstallationStep(input: unknown) {
  return run(service => {
    const index = (input as { index?: unknown } | null)?.index;
    if (!Number.isSafeInteger(index)) throw new Error('MODE_B_INPUT_INVALID');
    return service.installationStep(id(input), index as number);
  });
}
export async function modeBConfirm(input: unknown) {
  return run(service => {
    const value = input as { phase?: unknown; index?: unknown; hash?: unknown } | null;
    if ((value?.phase !== 'installation' && value?.phase !== 'revocation') || !Number.isSafeInteger(value.index) ||
      typeof value.hash !== 'string' || !HASH.test(value.hash)) throw new Error('MODE_B_INPUT_INVALID');
    return service.confirm(id(input), value.phase, value.index as number, value.hash);
  });
}
export async function modeBRunWorker(input: unknown) {
  return run(service => {
    const keyPath = process.env.GRYLOO_MODE_B_EXECUTOR_KEY_FILE;
    if (!keyPath) throw new Error('MODE_B_LOCAL_KEY_UNAVAILABLE');
    return service.worker(id(input), keyPath);
  });
}
export async function modeBReconcile(input: unknown) {
  return run(service => service.reconcile(id(input)));
}
