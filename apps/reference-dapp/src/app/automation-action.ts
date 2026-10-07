// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/**
 * AUTOMATION-001A BFF. The browser never receives the API bearer token and never supplies an owner header:
 * the owner comes only from FloFi's verified EIP-4361 wallet session.
 */
import { createAutomationStore, type AutomationEvent, type AutomationRule, type AutomationState } from '@defi-workflow-engine/cloud-runtime';
import { cloudApiBaseUrl } from '../server/cloud-api-client';
import { embeddedRuntime, flowRuntimeKind } from '../server/flow-runtime';
import { currentWalletPrincipal } from '../server/session-principal';
import { WALLET_PRINCIPAL_HEADER } from '../server/run-ownership';
import { nextScheduledOccurrence, validateAutomationSpec } from '../domain/automation';

type Result<T> = { ok: true; value: T } | { ok: false; code: string };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const classified = (cause: unknown, fallback = 'AUTOMATION_UNAVAILABLE') =>
  cause instanceof Error && CODE.test(cause.message) ? cause.message : fallback;

async function principal(): Promise<string> {
  const value = await currentWalletPrincipal();
  if (!value) throw new Error('WALLET_SESSION_REQUIRED');
  return value;
}
async function remote<T>(method: 'GET' | 'POST', path: string, owner: string, body?: unknown): Promise<Result<T>> {
  const base = cloudApiBaseUrl();
  if (!base) return { ok: false, code: 'CLOUD_API_NOT_CONFIGURED' };
  const target = new URL(path.replace(/^\//, ''), base.href.endsWith('/') ? base : new URL(base.href + '/'));
  try {
    const response = await fetch(target, { method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { ...body !== undefined ? { 'content-type': 'application/json' } : {},
        ...process.env.API_AUTH_TOKEN ? { authorization: `Bearer ${process.env.API_AUTH_TOKEN}` } : {},
        [WALLET_PRINCIPAL_HEADER]: owner }, ...body !== undefined ? { body: JSON.stringify(body) } : {} });
    const value = await response.json() as { ok?: unknown; value?: T; code?: unknown };
    if (response.ok && value.ok === true && 'value' in value) return { ok: true, value: value.value as T };
    return { ok: false, code: typeof value.code === 'string' && CODE.test(value.code) ? value.code : 'AUTOMATION_UNAVAILABLE' };
  } catch { return { ok: false, code: 'AUTOMATION_UNAVAILABLE' }; }
}
async function embedded<T>(action: (store: ReturnType<typeof createAutomationStore>, owner: string) => Promise<T>): Promise<Result<T>> {
  try {
    const owner = await principal(), runtime = await embeddedRuntime();
    return { ok: true, value: await action(createAutomationStore(runtime.db, runtime.tenantId), owner) };
  } catch (cause) { return { ok: false, code: classified(cause) }; }
}
async function run<T>(remoteCall: (owner: string) => Promise<Result<T>>, localCall: (store: ReturnType<typeof createAutomationStore>, owner: string) => Promise<T>): Promise<Result<T>> {
  let owner: string;
  try { owner = await principal(); } catch (cause) { return { ok: false, code: classified(cause) }; }
  const kind = flowRuntimeKind(process.env);
  if (kind === 'remote') return remoteCall(owner);
  if (kind === 'embedded') return embedded(localCall);
  return { ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' };
}

export async function automationSnapshot(): Promise<Result<{ rules: readonly AutomationRule[]; events: readonly AutomationEvent[] }>> {
  return run(async owner => {
    const [rules, events] = await Promise.all([remote<readonly AutomationRule[]>('GET', '/v1/automations', owner),
      remote<readonly AutomationEvent[]>('GET', '/v1/automation-events', owner)]);
    if (!rules.ok) return rules; if (!events.ok) return events;
    return { ok: true, value: { rules: rules.value, events: events.value } };
  }, async (store, owner) => ({ rules: await store.list(owner), events: await store.events(owner) }));
}
export async function createAutomation(spec: unknown): Promise<Result<AutomationRule>> {
  const valid = validateAutomationSpec(spec);
  if ('code' in valid) return { ok: false, code: valid.code };
  return run(owner => remote<AutomationRule>('POST', '/v1/automations', owner, { spec: valid.spec }),
    async (store, owner) => store.create({ ownerAccount: owner, spec: valid.spec, workflowHash: valid.workflowHash,
      nextEvaluationAt: nextScheduledOccurrence(valid.spec.trigger, new Date()) }));
}
export async function setAutomationState(automationId: string, state: AutomationState): Promise<Result<AutomationRule>> {
  if (!/^auto-[0-9a-f]{24}$/.test(automationId) || !['ACTIVE','PAUSED'].includes(state)) return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return run(owner => remote<AutomationRule>('POST', `/v1/automations/${automationId}/state`, owner, { state }),
    async (store, owner) => await store.setState(owner, automationId, state) ?? Promise.reject(new Error('AUTOMATION_NOT_FOUND')));
}
export async function openAutomationEvent(eventId: string): Promise<Result<AutomationEvent>> {
  if (!/^evt-[0-9a-f]{24}$/.test(eventId)) return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return run(owner => remote<AutomationEvent>('POST', `/v1/automation-events/${eventId}/open`, owner, {}),
    async (store, owner) => await store.open(owner, eventId) ?? Promise.reject(new Error('AUTOMATION_EVENT_NOT_FOUND')));
}
export async function dismissAutomationEvent(eventId: string): Promise<Result<{ dismissed: true }>> {
  if (!/^evt-[0-9a-f]{24}$/.test(eventId)) return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return run(owner => remote<{ dismissed: true }>('POST', `/v1/automation-events/${eventId}/dismiss`, owner, {}),
    async (store, owner) => {
      if (!await store.dismiss(owner, eventId)) throw new Error('AUTOMATION_EVENT_NOT_FOUND');
      return { dismissed: true as const };
    });
}
