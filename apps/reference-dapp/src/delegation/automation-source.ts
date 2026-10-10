// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: one authoring model. The Automations form and the chat's grounded draft (PR #77) both produce the canonical
 * `AutomationInput`; delegated mode compiles that same object, plus the delegation terms only the owner enters, into the delegated
 * input. Its single step goes through the same `routeStrategy` as every confirm-mode rule, so the rule, its strategy and its workflow
 * hash are identical whichever surface authored it.
 *
 *   - the canonical object is validated by the canonical `validateAutomationInput`, never by a second schema;
 *   - nothing here decides the execution mode: a caller reaches this only after the owner explicitly chose "Automatic within limits";
 *   - confirm-mode limits are proposal limits, not authority: delegated limits come from `terms` (what the owner reviews and signs);
 *   - a daily watch or a notify-only trigger executes nothing, so there is nothing to delegate (`DELEGATION_NOT_APPLICABLE`);
 *   - a saved-workflow action is refused until it reuses AUTOMATION-001's saved-workflow binding (`DELEGATED_SAVED_WORKFLOW_NOT_IMPLEMENTED`).
 *
 * Pure: no IO, no authority.
 */
import { validateAutomationInput, type AutomationInput } from '../automations/definition.ts';
import { isCanonicalDelegatedSource, isDelegatedAutomationInput, type DelegatedAutomationInput, type DelegationTerms } from './definition.ts';

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
/** The widest per-step slippage a delegated step accepts (the delegated schema's bound). */
export const DELEGATED_MAX_STEP_SLIPPAGE_BPS = 1_000;

export function delegatedSourceFromAutomation(automation: unknown, terms: DelegationTerms, now: number): Result<DelegatedAutomationInput> {
  const canonical = validateAutomationInput(automation, now);
  if (!canonical.ok) return canonical;
  const input = automation as AutomationInput;
  if (input.kind === 'DAILY_WATCH' || !input.action) return { ok: false, code: 'DELEGATION_NOT_APPLICABLE' };
  if (input.action.kind !== 'ROUTE') return { ok: false, code: 'DELEGATED_SAVED_WORKFLOW_NOT_IMPLEMENTED' };
  if (input.action.slippageBps > DELEGATED_MAX_STEP_SLIPPAGE_BPS) return { ok: false, code: 'DELEGATED_STEP_SLIPPAGE_TOO_HIGH' };
  const { asset, side, network, amount, slippageBps } = input.action;
  const value: DelegatedAutomationInput = {
    version: 1, name: input.name,
    trigger: input.kind === 'SCHEDULED_DCA' ? { kind: 'SCHEDULE', schedule: { ...input.schedule } } : { kind: 'PRICE', timezone: input.timezone, condition: { ...input.condition } },
    steps: [{ asset, side, network, amount, slippageBps }],
    limits: terms.limits, expiresAt: terms.expiresAt,
  };
  return isDelegatedAutomationInput(value) ? { ok: true, value } : { ok: false, code: 'DELEGATION_INPUT_INVALID' };
}

/** Either delegated input form → the one delegated input the service validates and compiles. */
export function delegatedInputOf(raw: unknown, now: number): Result<DelegatedAutomationInput> {
  if (isCanonicalDelegatedSource(raw)) return delegatedSourceFromAutomation(raw.automation, raw.terms, now);
  return isDelegatedAutomationInput(raw) ? { ok: true, value: raw } : { ok: false, code: 'DELEGATION_INPUT_INVALID' };
}
