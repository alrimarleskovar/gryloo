// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createForkRpc } from '../server/fork-rpc';
import { createCompositionService, type CompositionServerProfile } from '../server/composition-service';
import { isHostedDeployment } from '../server/deployment';
type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
type Service = ReturnType<typeof createCompositionService>;
let cache: { key: string; service: Service; profile: CompositionServerProfile } | null = null;
const EXECUTION = /^exec-[0-9a-f]{24}$/;
const HASH = /^0x[0-9a-f]{64}$/;
function runtime() {
  // BUILD-CLOUD-PARITY-001: a local rehearsal (loopback chain, MOCKED harness, local journal) is never enabled on a hosted deployment.
  if (process.env.GRYLOO_COMPOSITION_MODE !== 'fork' || isHostedDeployment(process.env)) return null;
  const path = process.env.GRYLOO_COMPOSITION_PROFILE;
  if (!path || !isAbsolute(path)) throw new Error('COMPOSITION_CONFIGURATION_INVALID');
  const source = readFileSync(path, 'utf8'), key = `${path}\n${source}`;
  if (cache?.key === key) return cache;
  const profile = JSON.parse(source) as CompositionServerProfile;
  if (profile.environment !== 'FORK_REPRODUCED' &&
      !(profile.environment === 'MOCKED' && process.env.GRYLOO_COMPOSITION_ALLOW_MOCKED_UI === '1'))
    throw new Error('COMPOSITION_PUBLIC_UI_REQUIRES_FORK_REPLAY');
  const service = createCompositionService(profile, createForkRpc({ url: profile.rpcUrl }));
  cache = { key, service, profile };
  return cache;
}
function id(input: unknown) {
  const value = (input as { executionId?: unknown } | null)?.executionId;
  if (typeof value !== 'string' || !EXECUTION.test(value)) throw new Error('COMPOSITION_INPUT_INVALID');
  return value;
}
function code(error: unknown) {
  const value = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(value) ? value : 'COMPOSITION_INTERNAL_ERROR';
}
async function run<T>(fn: (service: Service) => Promise<T>): Promise<Result<T>> {
  try { const value = runtime(); return value ? { ok: true, value: await fn(value.service) } : { ok: false, code: 'COMPOSITION_OFF' }; }
  catch (error) { return { ok: false, code: code(error) }; }
}
export async function compositionInfo(): Promise<Result<{ available: boolean; owner?: string; safe?: string;
  executor?: string; environment?: 'MOCKED' | 'FORK_REPRODUCED'; executions?: readonly { executionId: string; preparedAt: string }[] }>> {
  try { const value = runtime();
    if (!value) return { ok: true, value: { available: false } };
    await value.service.poolState(await value.service.atHead());
    return { ok: true, value: { available: true, owner: value.profile.owner, safe: value.profile.safe,
      executor: value.profile.executor, environment: value.profile.environment, executions: await value.service.list() } };
  } catch (error) { return { ok: false, code: code(error) }; }
}
export async function compositionPrepare(input: unknown) {
  return run(service => service.prepare((input as { workflow?: unknown } | null)?.workflow as SemanticWorkflow));
}
export async function compositionExecution(input: unknown) { return run(service => service.status(id(input))); }
export async function compositionInstallationStep(input: unknown) {
  return run(service => { const index = (input as { index?: unknown } | null)?.index;
    if (!Number.isSafeInteger(index)) throw new Error('COMPOSITION_INPUT_INVALID');
    return service.installationStep(id(input), index as number); });
}
export async function compositionConfirm(input: unknown) {
  return run(service => { const v = input as { phase?: unknown; index?: unknown; hash?: unknown } | null;
    if ((v?.phase !== 'installation' && v?.phase !== 'revocation') || !Number.isSafeInteger(v.index) ||
        typeof v.hash !== 'string' || !HASH.test(v.hash)) throw new Error('COMPOSITION_INPUT_INVALID');
    return service.confirm(id(input), v.phase, v.index as number, v.hash); });
}
export async function compositionRunWorker(input: unknown) {
  return run(service => { const key = process.env.GRYLOO_COMPOSITION_EXECUTOR_KEY_FILE;
    if (!key) throw new Error('COMPOSITION_LOCAL_KEY_UNAVAILABLE');
    return service.worker(id(input), key); });
}
export async function compositionRecoverKnown(input: unknown) {
  return run(service => { const key = process.env.GRYLOO_COMPOSITION_EXECUTOR_KEY_FILE;
    if (!key) throw new Error('COMPOSITION_LOCAL_KEY_UNAVAILABLE');
    return service.worker(id(input), key, 'recoverKnown'); });
}
