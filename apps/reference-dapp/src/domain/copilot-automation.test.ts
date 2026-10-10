// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { groundAutomationDraft, parseAutomationDraft, type AutomationDraft } from './copilot-automation';
import { parseCopilotIntentV2 } from './copilot-intent-v2';
import { validateAutomationInput } from '../automations/definition';
import { CopilotSession } from './copilot-session.test-harness';

const draft = (patch: Partial<AutomationDraft> = {}): AutomationDraft => ({ kind: 'SCHEDULED_DCA', asset: 'ETH', side: 'BUY', network: 'BASE_SEPOLIA', amount: '10', spendAsset: 'USDC', time: '09:00', condition: null, threshold: null, percent: null, ...patch });
describe('Copilot Automation interpretation and grounding', () => {
  it('accepts only a typed automation interpretation with no authority fields', () => {
    expect(parseCopilotIntentV2({ version: '2', language: 'PT', kind: 'AUTOMATION', draft: draft() })).toMatchObject({ kind: 'AUTOMATION', draft: draft() });
    for (const key of ['execute', 'sign', 'executionMode', 'owner', 'transaction', 'signature']) expect(() => parseAutomationDraft({ ...draft(), [key]: true })).toThrow();
  });
  it.each(['Buy 10 USDC of ETH every day at 9:00 on Base Sepolia.', 'Todo dia às 9:00 compre 10 USDC de ETH na Base Sepolia.', 'Compra 10 USDC de ETH todos os dias às 9h na Base Sepolia.'])('grounds daily DCA: %s', text => {
    const result = groundAutomationDraft(draft(), text, 'Europe/Lisbon');
    expect(result.kind).toBe('PROPOSAL');
    if (result.kind !== 'PROPOSAL') throw Error(result.message);
    expect(result.input).toMatchObject({ kind: 'SCHEDULED_DCA', schedule: { frequency: 'DAILY', time: '09:00', timezone: 'Europe/Lisbon' }, action: { kind: 'ROUTE', network: 'base-sepolia', amount: '10', side: 'BUY' }, limits: { maxAmountPerExecution: '10' } });
    expect(validateAutomationInput(result.input, Date.now()).ok).toBe(true);
    expect(result.input).not.toHaveProperty('executionMode');
  });
  it.each([
    ['If ETH falls below $3000, prepare a buy of 50 USDC on Base Sepolia.', 'PRICE_BELOW', 'BUY', '50', 'USDC', '3000'],
    ['Se ETH cair abaixo de $3000, prepara uma compra de 50 USDC na Base Sepolia.', 'PRICE_BELOW', 'BUY', '50', 'USDC', '3000'],
    ['If ETH rises above $5000, prepare a sell of 0.1 ETH on Base Sepolia.', 'PRICE_ABOVE', 'SELL', '0.1', 'ETH', '5000'],
  ] as const)('grounds a crossing: %s', (text, condition, side, amount, spendAsset, threshold) => {
    expect(groundAutomationDraft(draft({ kind: 'PRICE_TRIGGER', condition, side, amount, spendAsset, threshold, time: null }), text, 'UTC')).toMatchObject({ kind: 'PROPOSAL', input: { kind: 'PRICE_TRIGGER', condition: { type: condition, threshold, checkEveryMinutes: 15 }, action: { side, amount } } });
  });
  // BUILD-AUTOMATION-002: percentage moves. The percentage and the reference price must both be in the user's words; words such as
  // "automatically" or a weekly maximum in the text never become a mode or a limit (the draft has no field for either).
  it.each([
    ['If ETH drops 5% from $3000, buy 50 USDC of ETH on Base Sepolia automatically, max 200 USDC/week.', 'PERCENT_DROP', '5'],
    ['Se ETH cair 5% a partir de $3000, compra 50 USDC de ETH na Base Sepolia.', 'PERCENT_DROP', '5'],
    ['If ETH rises 7.5% from 3000 USD, buy 50 USDC of ETH on Base Sepolia.', 'PERCENT_RISE', '7.5'],
  ] as const)('grounds a percentage move from a stated reference: %s', (text, condition, percent) => {
    const result = groundAutomationDraft(draft({ kind: 'PRICE_TRIGGER', condition, threshold: '3000', percent, amount: '50', time: null }), text, 'UTC');
    expect(result).toMatchObject({ kind: 'PROPOSAL', input: { kind: 'PRICE_TRIGGER', condition: { type: condition, asset: 'ETH', reference: '3000', percent, checkEveryMinutes: 15 },
      action: { kind: 'ROUTE', network: 'base-sepolia', amount: '50', side: 'BUY' }, limits: { maxAmountPerExecution: '50', maxAmountPerPeriod: null } } });
    if (result.kind === 'PROPOSAL') { expect(validateAutomationInput(result.input, Date.now()).ok).toBe(true); expect(result.input).not.toHaveProperty('executionMode'); }
  });
  it.each([
    [draft({ kind: 'PRICE_TRIGGER', condition: 'PERCENT_DROP', threshold: '3000', percent: '5', amount: '50', time: null }), 'If ETH drops 5%, buy 50 USDC of ETH on Base Sepolia automatically.', 'From which USD reference price should the percentage be measured?'],
    [draft({ kind: 'PRICE_TRIGGER', condition: 'PERCENT_DROP', threshold: '3000', percent: '5', amount: '50', time: null }), 'If ETH drops from $3000, buy 50 USDC of ETH on Base Sepolia.', 'By what percentage, and in which direction, should the price move?'],
    [draft({ kind: 'PRICE_TRIGGER', condition: 'PERCENT_RISE', threshold: '3000', percent: '5', amount: '50', time: null }), 'If ETH drops 5% from $3000, buy 50 USDC of ETH on Base Sepolia.', 'By what percentage, and in which direction, should the price move?'],
  ] as const)('asks instead of inferring a reference, a percentage or a direction (%#)', (raw, text, message) => {
    expect(groundAutomationDraft(raw, text, 'UTC')).toEqual({ kind: 'CLARIFICATION', message });
  });
  it('parses the percentage strictly', () => {
    expect(parseAutomationDraft(draft({ kind: 'PRICE_TRIGGER', condition: 'PERCENT_DROP', threshold: '3000', percent: '12.25' })).percent).toBe('12.25');
    for (const percent of ['5%', '-5', '12.345', '10000']) expect(() => parseAutomationDraft({ ...draft(), percent })).toThrow();
    const legacy: Record<string, unknown> = { ...draft() };
    delete legacy.percent;
    expect(() => parseAutomationDraft(legacy)).toThrow();
  });
  it.each(['Every day at 8:00 check ETH for me.', 'Todos os dias às 8h verifica ETH para mim.'])('grounds read-only daily watch: %s', text => {
    expect(groundAutomationDraft(draft({ kind: 'DAILY_WATCH', side: null, amount: null, spendAsset: null, network: null, time: '08:00' }), text, 'UTC')).toMatchObject({ kind: 'PROPOSAL', input: { kind: 'DAILY_WATCH', watch: { assets: ['ETH'] } } });
  });
  it.each([
    [draft({ amount: null, time: null, network: null }), 'Compre ETH todo dia.'],
    [draft({ kind: 'PRICE_TRIGGER', condition: 'PRICE_BELOW', threshold: null, amount: null }), 'Se ETH cair, compra.'],
    [draft({ network: 'BASE' }), 'Buy 10 USDC of ETH every day at 9:00.'],
    [draft({ network: 'BASE' }), 'Buy 10 USDC of ETH every day at 9:00 on Base Sepolia.'],
    [draft({ amount: '100' }), 'Buy 10 USDC of ETH every day at 9:00 on Base Sepolia.'],
    [draft({ time: '10:00' }), 'Buy 10 USDC of ETH every day at 9:00 on Base Sepolia.'],
    [draft({ side: 'SELL' }), 'Buy 10 USDC of ETH every day at 9:00 on Base Sepolia.'],
  ])('clarifies absent or invented values', (value, text) => {
    expect(groundAutomationDraft(value as AutomationDraft, text as string, 'UTC').kind).toBe('CLARIFICATION');
  });
  it('refuses BTC execution without substituting another asset', () => {
    expect(groundAutomationDraft(draft({ asset: 'BTC' }), 'Buy 10 USDC of BTC every day at 9 on Base Sepolia', 'UTC')).toMatchObject({ kind: 'UNSUPPORTED' });
  });
  it.each(['If ETH falls below 3000 euros, prepare a buy of 50 USDC on Base Sepolia.',
    'If ETH falls below 3000, prepare a buy of 50 USDC on Base Sepolia.'])('clarifies an absent USD price unit: %s', text => {
    expect(groundAutomationDraft(draft({ kind: 'PRICE_TRIGGER', condition: 'PRICE_BELOW', threshold: '3000', amount: '50', time: null }), text, 'UTC').kind).toBe('CLARIFICATION');
  });
  it('refuses a named unsupported network and never substitutes an enabled route', () => {
    expect(groundAutomationDraft(draft({ network: 'ARBITRUM' }), 'Buy 10 USDC of ETH every day at 9:00 on Arbitrum.', 'UTC').kind).toBe('UNSUPPORTED');
  });
  it('does not turn a SOL price condition into an ETH condition using a second asset mention', () => {
    expect(groundAutomationDraft(draft({ kind: 'PRICE_TRIGGER', condition: 'PRICE_BELOW', threshold: '3000', amount: '50', time: null }),
      'If SOL falls below $3000, prepare a buy of 50 USDC of ETH on Base Sepolia.', 'UTC').kind).toBe('CLARIFICATION');
  });
  it('grounds a network clarification in the open request without changing the workflow', () => {
    const session = new CopilotSession();
    const workflow = session.workflow;
    expect(session.say('Buy 10 USDC of ETH every day at 9:00.', { version: '2', language: 'EN', kind: 'AUTOMATION', draft: draft({ network: null }) })).toMatchObject({ kind: 'CLARIFICATION' });
    expect(session.say('Base Sepolia.', { version: '2', language: 'EN', kind: 'AUTOMATION', draft: draft() })).toMatchObject({ kind: 'AUTOMATION_PROPOSAL', automation: { action: { network: 'base-sepolia' } } });
    expect(session.workflow).toBe(workflow); expect(session.pending).toBeNull();
    expect(session.say('Buy ETH every day.', { version: '2', language: 'EN', kind: 'AUTOMATION', draft: draft() })).toMatchObject({ kind: 'CLARIFICATION' });
  });
});
