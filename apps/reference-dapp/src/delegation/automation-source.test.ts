// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { routeStrategy } from '../automations/assets.ts';
import { bindStrategy } from '../automations/binding.ts';
import type { AutomationInput } from '../automations/definition.ts';
import { composeWorkflowBound } from '../engine/strategy-engine.ts';
import { delegatedInputOf, delegatedSourceFromAutomation } from './automation-source.ts';
import type { DelegatedAutomationInput, DelegationTerms } from './definition.ts';
import { requirementOf } from './steps.ts';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const terms: DelegationTerms = { limits: { assets: [], maxExecutionsPerPeriod: { count: 2, period: 'WEEK' }, cooldownMinutes: 0, maxSlippageBps: 100 },
  expiresAt: '2027-01-10T00:00:00Z' };
// What the Automations form and PR #77's grounded chat draft both produce (`groundAutomationDraft` → AutomationInput).
const dca: AutomationInput = { version: 1, kind: 'SCHEDULED_DCA', name: 'ETH DCA', schedule: { frequency: 'WEEKLY', weekday: 1, time: '09:00', timezone: 'Europe/Lisbon' },
  action: { kind: 'ROUTE', asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '50', slippageBps: 50 },
  limits: { maxAmountPerExecution: '50', maxAmountPerPeriod: null, maxOccurrencesPerPeriod: null, cooldownMinutes: 0, maxSlippageBps: null }, expiresAt: null };
const trigger: AutomationInput = { version: 1, kind: 'PRICE_TRIGGER', name: 'Buy the dip', timezone: 'UTC',
  condition: { type: 'PERCENT_DROP', asset: 'ETH', reference: '2500', percent: '5', checkEveryMinutes: 15 },
  action: { kind: 'ROUTE', asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '50', slippageBps: 50 },
  limits: { maxAmountPerExecution: '50', maxAmountPerPeriod: null, maxOccurrencesPerPeriod: null, cooldownMinutes: 60, maxSlippageBps: null }, expiresAt: null };
const workspaceForm: DelegatedAutomationInput = { version: 1, name: 'ETH DCA', trigger: { kind: 'SCHEDULE', schedule: { frequency: 'WEEKLY', weekday: 1, time: '09:00', timezone: 'Europe/Lisbon' } },
  steps: [{ asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '50', slippageBps: 50 }], limits: terms.limits, expiresAt: terms.expiresAt };

describe('one authoring model: the canonical AutomationInput compiles to the delegated input', () => {
  it('yields exactly the delegated input the Automations steps form produces', () => {
    expect(delegatedSourceFromAutomation(dca, terms, NOW)).toEqual({ ok: true, value: workspaceForm });
    expect(delegatedInputOf({ version: 1, source: 'AUTOMATION_INPUT', automation: dca, terms }, NOW)).toEqual({ ok: true, value: workspaceForm });
    expect(delegatedInputOf(workspaceForm, NOW)).toEqual({ ok: true, value: workspaceForm });
  });
  it('binds the same strategy and workflow hash as the confirm-mode rule of the same AutomationInput', () => {
    for (const input of [dca, trigger]) {
      const action = (input as Extract<AutomationInput, { action: unknown }>).action!;
      const route = routeStrategy(action as Parameters<typeof routeStrategy>[0]);
      const confirm = bindStrategy(route.ok ? route.strategy : null);
      const delegated = delegatedSourceFromAutomation(input, terms, NOW);
      expect(confirm.ok && delegated.ok).toBe(true);
      if (!confirm.ok || !delegated.ok) return;
      const step = delegated.value.steps[0]!;
      const strategy = routeStrategy({ asset: step.asset, side: step.side, network: step.network, amount: step.amount, slippageBps: step.slippageBps });
      const composed = composeWorkflowBound(strategy.ok ? strategy.strategy : null, undefined);
      const requirement = composed.ok ? requirementOf(composed) : null;
      expect(requirement?.ok).toBe(true);
      if (!requirement?.ok) return;
      expect(requirement.value.strategy).toEqual(confirm.binding.strategy);
      expect(requirement.value.workflowHash).toBe(confirm.binding.workflowHash);
    }
  });
  it('keeps the trigger: a percent drop stays a price trigger on the same asset', () => {
    const r = delegatedSourceFromAutomation(trigger, terms, NOW);
    expect(r.ok && r.value.trigger).toEqual({ kind: 'PRICE', timezone: 'UTC', condition: { type: 'PERCENT_DROP', asset: 'ETH', reference: '2500', percent: '5', checkEveryMinutes: 15 } });
  });
  it('carries only the owner terms as authority, never the confirm-mode proposal limits', () => {
    const r = delegatedSourceFromAutomation(dca, terms, NOW);
    expect(r.ok && r.value.limits).toBe(terms.limits);
    expect(r.ok && r.value.expiresAt).toBe(terms.expiresAt);
  });
  it('refuses what executes nothing, what is not delegable yet, and anything the canonical validator refuses', () => {
    const watch: AutomationInput = { version: 1, kind: 'DAILY_WATCH', name: 'Watch', schedule: { frequency: 'DAILY', weekday: null, time: '08:00', timezone: 'UTC' },
      watch: { assets: ['ETH'] }, expiresAt: null };
    expect(delegatedSourceFromAutomation(watch, terms, NOW)).toEqual({ ok: false, code: 'DELEGATION_NOT_APPLICABLE' });
    expect(delegatedSourceFromAutomation({ ...trigger, action: null }, terms, NOW)).toEqual({ ok: false, code: 'DELEGATION_NOT_APPLICABLE' });
    expect(delegatedSourceFromAutomation({ ...dca, action: { kind: 'SAVED_WORKFLOW', workflowId: 'wf_1' } }, terms, NOW))
      .toEqual({ ok: false, code: 'DELEGATED_SAVED_WORKFLOW_NOT_IMPLEMENTED' });
    expect(delegatedSourceFromAutomation({ ...dca, action: { ...dca.action, slippageBps: 1_500 } } as AutomationInput, terms, NOW))
      .toEqual({ ok: false, code: 'DELEGATED_STEP_SLIPPAGE_TOO_HIGH' });
    expect(delegatedSourceFromAutomation({ ...dca, extra: true }, terms, NOW)).toEqual({ ok: false, code: 'AUTOMATION_INPUT_INVALID' });
    expect(delegatedSourceFromAutomation({ ...dca, schedule: { ...dca.schedule, timezone: 'Mars/Olympus' } }, terms, NOW).ok).toBe(false);
    // A mode field smuggled into the envelope (e.g. by an AI draft) is not part of the closed schema.
    expect(delegatedInputOf({ version: 1, source: 'AUTOMATION_INPUT', automation: dca, terms, executionMode: 'DELEGATED_WITH_LIMITS' }, NOW))
      .toEqual({ ok: false, code: 'DELEGATION_INPUT_INVALID' });
    expect(delegatedInputOf({ version: 1, source: 'AUTOMATION_INPUT', automation: dca, terms: { ...terms, expiresAt: 'never' } }, NOW))
      .toEqual({ ok: false, code: 'DELEGATION_INPUT_INVALID' });
  });
});
