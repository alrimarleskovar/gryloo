// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/**
 * BUILD-AUTOMATION-001: the server actions of the Automations workspace. Every action re-verifies, server-side, that this browser holds
 * a proven wallet session (HttpOnly EIP-4361 / Sign-In With Solana cookie) for EXACTLY the owner it names — the browser's address is a
 * selection hint only — and every store query is scoped to that owner, so another wallet's automation is never found by its id.
 *
 * None of these actions signs, submits, claims or applies anything. "Review in FloFi" returns an approval link of the shared approval
 * model; the owner then follows /approve (wallet proof, fresh simulation, Strategy Manifest Review, own signature). Automations run only
 * on the embedded PostgreSQL runtime (AUTOMATION_STORE_UNAVAILABLE otherwise — never memory, files or /tmp).
 */
import { readChannelDeployment } from '../channels/registry';
import { readAutomationConfig } from '../automations/config';
import { automationLogger, automationRouteLogger } from '../automations/log';
import { automationHost, automationRuntime, newAutomationId } from '../automations/runtime';
import { createAutomationService, type AutomationService } from '../automations/service';
import type { Side } from '../automations/assets';
import type { ObservedAsset } from '../automations/trigger';
import type { LinkCodeView, OccurrenceView, OpenedView, OverviewView, RuleHistoryView, RuleView } from '../automations/views';
import type { Command } from '../domain/commands';
import { workflowOwner, type WorkflowOwner } from '../domain/saved-workflow';
import { currentWalletPrincipals } from '../server/session-principal';

type Result<T> = { ok: true; value: T } | { ok: false; code: string };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const failure = (cause: unknown): { ok: false; code: string } => ({ ok: false, code: cause instanceof Error && CODE.test(cause.message) ? cause.message : 'AUTOMATION_UNAVAILABLE' });

async function withService<T>(expected: WorkflowOwner, work: (service: AutomationService, owner: WorkflowOwner) => Promise<T>): Promise<Result<T>> {
  try {
    if (!expected || !workflowOwner(`${expected.namespace}:${expected.address}`)) return { ok: false, code: 'WALLET_SESSION_REQUIRED' };
    const principal = (await currentWalletPrincipals()).find(p => p.namespace === expected.namespace && p.address === expected.address);
    if (!principal) return { ok: false, code: 'WALLET_SESSION_REQUIRED' };
    const env = process.env, config = readAutomationConfig(env);
    if (!config.enabled) return { ok: false, code: config.code };
    const host = await automationHost(env, config);
    if ('code' in host) return { ok: false, code: host.code };
    const log = automationLogger(await automationRouteLogger()), now = () => new Date();
    const rt = automationRuntime(env, config, host, log, now);
    const channels = readChannelDeployment(env);
    const service = createAutomationService({ config, db: host.db, store: rt.store, handoffs: rt.handoffs, allow: rt.allow, runtime: rt.engine, price: rt.price, log, now,
      newId: newAutomationId, telegramAvailable: channels.ok && channels.deployment.telegram !== null && channels.deployment.core.tenantId === host.tenantId });
    return { ok: true, value: await work(service, { namespace: principal.namespace, address: principal.address }) };
  } catch (cause) { return failure(cause); }
}

/** Whether this deployment runs automations at all (no owner needed: it reveals nothing about anyone). */
export async function automationsAvailability(): Promise<{ readonly enabled: boolean; readonly code: string | null }> {
  const config = readAutomationConfig(process.env);
  return config.enabled ? { enabled: true, code: null } : { enabled: false, code: config.code };
}
export async function automationOverview(owner: WorkflowOwner): Promise<Result<OverviewView>> { return withService(owner, (s, o) => s.overview(o)); }
export async function createAutomation(owner: WorkflowOwner, input: unknown): Promise<Result<RuleView>> { return withService(owner, (s, o) => s.create(o, input)); }
export async function changeAutomationState(owner: WorkflowOwner, ruleId: string, version: number, action: 'PAUSE' | 'RESUME' | 'ARCHIVE'): Promise<Result<RuleView>> {
  if (!['PAUSE', 'RESUME', 'ARCHIVE'].includes(action) || typeof ruleId !== 'string' || !Number.isSafeInteger(version)) return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return withService(owner, (s, o) => s.setState(o, ruleId, version, action));
}
export async function rebindAutomation(owner: WorkflowOwner, ruleId: string, version: number): Promise<Result<RuleView>> {
  if (typeof ruleId !== 'string' || !Number.isSafeInteger(version)) return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return withService(owner, (s, o) => s.rebind(o, ruleId, version));
}
export async function automationHistory(owner: WorkflowOwner, ruleId: string): Promise<Result<RuleHistoryView>> {
  if (typeof ruleId !== 'string') return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return withService(owner, (s, o) => s.history(o, ruleId));
}
/** A fresh approval link (shared approval model) for an open occurrence; the browser then opens /approve. Authorizes nothing. */
export async function openAutomationOccurrence(owner: WorkflowOwner, occurrenceId: string): Promise<Result<OpenedView>> {
  if (typeof occurrenceId !== 'string') return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return withService(owner, (s, o) => s.open(o, occurrenceId));
}
export async function dismissAutomationOccurrence(owner: WorkflowOwner, occurrenceId: string): Promise<Result<OccurrenceView>> {
  if (typeof occurrenceId !== 'string') return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return withService(owner, (s, o) => s.dismiss(o, occurrenceId));
}
/** Buy / Sell on a watch report: FloFi's ordinary authoring command for the owner's own Build draft (Apply → Simulate → Review → sign). */
export async function prepareWatchProposal(owner: WorkflowOwner, occurrenceId: string, request: { asset: ObservedAsset; side: Side; network: string; amount: string; slippageBps: number }):
  Promise<Result<{ readonly command: Command; readonly summary: string }>> {
  if (typeof occurrenceId !== 'string' || !request || typeof request !== 'object' || typeof request.amount !== 'string' || !/^(0|[1-9][0-9]{0,29})(\.[0-9]{1,18})?$/.test(request.amount)
    || !Number.isInteger(request.slippageBps)) return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return withService(owner, async (s, o) => {
    const prepared = await s.prepareWatchAction(o, occurrenceId, { asset: request.asset, side: request.side, network: request.network, amount: request.amount, slippageBps: request.slippageBps });
    return { command: prepared.command, summary: prepared.summary };
  });
}
export async function createTelegramLinkCode(owner: WorkflowOwner): Promise<Result<LinkCodeView>> { return withService(owner, (s, o) => s.telegramLinkCode(o)); }
export async function unlinkTelegram(owner: WorkflowOwner): Promise<Result<{ readonly unlinked: boolean }>> { return withService(owner, (s, o) => s.telegramUnlink(o)); }
