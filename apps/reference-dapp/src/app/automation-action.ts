// SPDX-License-Identifier: AGPL-3.0-only
'use server';
/**
 * BUILD-AUTOMATION-001: the server actions of the Automations workspace. Each one goes through `server/automation-operation.ts`, which
 * re-verifies, server-side, that this browser holds a proven wallet session (HttpOnly EIP-4361 / Sign-In With Solana cookie) for EXACTLY
 * the owner it names — the browser's address is a selection hint only — and then runs the operation where this deployment's runtime
 * runs: in process on the embedded PostgreSQL runtime, or on the Railway API (remote runtime, production) with the verified owner in
 * the server-to-server owner header. Every store query is scoped to that owner, so another wallet's automation is never found by its id.
 *
 * None of these actions signs, submits, claims or applies anything. "Review in FloFi" returns an approval link of the shared approval
 * model; the owner then follows /approve (wallet proof, fresh simulation, Strategy Manifest Review, own signature).
 */
import type { Side } from '../automations/assets';
import type { ObservedAsset } from '../automations/trigger';
import type { LinkCodeView, OccurrenceView, OpenedView, OverviewView, RuleHistoryView, RuleView } from '../automations/views';
import type { Command } from '../domain/commands';
import type { WorkflowOwner } from '../domain/saved-workflow';
import { automationAvailability, automationOperation } from '../server/automation-operation';

type Result<T> = { ok: true; value: T } | { ok: false; code: string };

/** Whether this deployment runs automations at all (no owner needed: it reveals nothing about anyone). */
export async function automationsAvailability(): Promise<{ readonly enabled: boolean; readonly code: string | null }> {
  return automationAvailability();
}
export async function automationOverview(owner: WorkflowOwner): Promise<Result<OverviewView>> { return automationOperation('overview', [], owner); }
export async function createAutomation(owner: WorkflowOwner, input: unknown): Promise<Result<RuleView>> { return automationOperation('create', [input], owner); }
export async function changeAutomationState(owner: WorkflowOwner, ruleId: string, version: number, action: 'PAUSE' | 'RESUME' | 'ARCHIVE'): Promise<Result<RuleView>> {
  if (!['PAUSE', 'RESUME', 'ARCHIVE'].includes(action) || typeof ruleId !== 'string' || !Number.isSafeInteger(version)) return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return automationOperation('setState', [ruleId, version, action], owner);
}
export async function rebindAutomation(owner: WorkflowOwner, ruleId: string, version: number): Promise<Result<RuleView>> {
  if (typeof ruleId !== 'string' || !Number.isSafeInteger(version)) return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return automationOperation('rebind', [ruleId, version], owner);
}
export async function automationHistory(owner: WorkflowOwner, ruleId: string): Promise<Result<RuleHistoryView>> {
  if (typeof ruleId !== 'string') return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return automationOperation('history', [ruleId], owner);
}
/** A fresh approval link (shared approval model) for an open occurrence; the browser then opens /approve. Authorizes nothing. */
export async function openAutomationOccurrence(owner: WorkflowOwner, occurrenceId: string): Promise<Result<OpenedView>> {
  if (typeof occurrenceId !== 'string') return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return automationOperation('open', [occurrenceId], owner);
}
export async function dismissAutomationOccurrence(owner: WorkflowOwner, occurrenceId: string): Promise<Result<OccurrenceView>> {
  if (typeof occurrenceId !== 'string') return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return automationOperation('dismiss', [occurrenceId], owner);
}
/** Buy / Sell on a watch report: FloFi's ordinary authoring command for the owner's own Build draft (Apply → Simulate → Review → sign). */
export async function prepareWatchProposal(owner: WorkflowOwner, occurrenceId: string, request: { asset: ObservedAsset; side: Side; network: string; amount: string; slippageBps: number }):
  Promise<Result<{ readonly command: Command; readonly summary: string }>> {
  if (typeof occurrenceId !== 'string' || !request || typeof request !== 'object' || typeof request.amount !== 'string' || !/^(0|[1-9][0-9]{0,29})(\.[0-9]{1,18})?$/.test(request.amount)
    || !Number.isInteger(request.slippageBps)) return { ok: false, code: 'AUTOMATION_INPUT_INVALID' };
  return automationOperation('prepareWatch', [occurrenceId, { asset: request.asset, side: request.side, network: request.network, amount: request.amount,
    slippageBps: request.slippageBps }], owner);
}
export async function createTelegramLinkCode(owner: WorkflowOwner): Promise<Result<LinkCodeView>> { return automationOperation('telegramLinkCode', [], owner); }
export async function unlinkTelegram(owner: WorkflowOwner): Promise<Result<{ readonly unlinked: boolean }>> { return automationOperation('telegramUnlink', [], owner); }
