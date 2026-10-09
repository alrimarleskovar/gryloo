// SPDX-License-Identifier: AGPL-3.0-only
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { describe, expect, it } from 'vitest';
import { editorReducer, initialEditor } from '../domain/editor';
import { validateSavedWorkflow } from '../domain/saved-workflow';
import { composeWorkflowBound } from '../engine/strategy-engine';
import type { StrategySpec } from '../engine/strategy-spec';
import { routeStrategy, sideOf, spendOf, observedAssetOf } from './assets.ts';
import { bindStrategy, sourceDrift, strategyOfSavedWorkflow, verifyBinding } from './binding.ts';
import { validateAutomationInput } from './definition.ts';
import { assertLimits, bindingViolation, NO_LIMITS, occurrenceViolation, type Limits } from './limits.ts';

const NOW = Date.parse('2026-10-08T10:00:00Z');
const limits = (patch: Partial<Limits> = {}): Limits => ({ ...NO_LIMITS, ...patch });
const usage = (patch: Partial<Parameters<typeof occurrenceViolation>[3]> = {}) => ({ amountPeriod: null, countPeriod: null, lastOccurrenceAt: null, ...patch });
const spend = (amount: string) => ({ asset: 'USDC', amount });
const savedSwap = (amount = '2', direction: 'USDC_TO_WETH' | 'WETH_TO_USDC' = 'USDC_TO_WETH') => validateSavedWorkflow(editorReducer(initialEditor(),
  { type: 'ADD_TESTNET_SWAP', direction, amount, slippage: '50', source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext()).workflow);

describe('BUILD-AUTOMATION-001 limits', () => {
  it('bounds the bound action: amount per execution and slippage', () => {
    expect(bindingViolation(limits({ maxAmountPerExecution: '50' }), spend('50'), 50)).toBeNull();
    expect(bindingViolation(limits({ maxAmountPerExecution: '50' }), spend('50.000001'), 50)).toBe('LIMIT_AMOUNT_PER_EXECUTION');
    expect(bindingViolation(limits({ maxSlippageBps: 30 }), spend('1'), 50)).toBe('LIMIT_SLIPPAGE');
  });

  it('counts period usage, occurrences and cooldown for one more occurrence', () => {
    const l = limits({ maxAmountPerPeriod: { amount: '100', period: 'WEEK' }, maxOccurrencesPerPeriod: { count: 3, period: 'WEEK' }, cooldownMinutes: 60 });
    expect(occurrenceViolation(l, spend('50'), 50, usage({ amountPeriod: { sum: '50', asset: 'USDC' }, countPeriod: 1 }), NOW)).toBeNull();
    expect(occurrenceViolation(l, spend('50'), 50, usage({ amountPeriod: { sum: '50.01', asset: 'USDC' }, countPeriod: 1 }), NOW)).toBe('LIMIT_PERIOD_AMOUNT');
    expect(occurrenceViolation(l, spend('1'), 50, usage({ countPeriod: 3 }), NOW)).toBe('LIMIT_PERIOD_COUNT');
    expect(occurrenceViolation(l, spend('1'), 50, usage({ lastOccurrenceAt: NOW - 59 * 60_000 }), NOW)).toBe('LIMIT_COOLDOWN');
    expect(occurrenceViolation(l, spend('1'), 50, usage({ lastOccurrenceAt: NOW - 60 * 60_000 }), NOW)).toBeNull();
    expect(occurrenceViolation(l, spend('1'), 50, usage({ amountPeriod: { sum: '1', asset: 'WETH' } }), NOW)).toBe('LIMIT_PERIOD_ASSET_MISMATCH');
    // A notify-only occurrence still counts and cools down, but spends nothing.
    expect(occurrenceViolation(l, null, null, usage({ amountPeriod: { sum: '100', asset: 'USDC' } }), NOW)).toBeNull();
  });

  it('refuses malformed limits', () => {
    for (const bad of [limits({ maxAmountPerExecution: '0' }), limits({ maxAmountPerExecution: '-1' }), limits({ cooldownMinutes: -1 }), limits({ cooldownMinutes: 1.5 }),
      limits({ maxOccurrencesPerPeriod: { count: 0, period: 'DAY' } }), limits({ maxAmountPerPeriod: { amount: '1', period: 'YEAR' as 'DAY' } }), limits({ maxSlippageBps: 10_001 })])
      expect(() => assertLimits(bad)).toThrow('AUTOMATION_LIMITS_INVALID');
  });
});

describe('BUILD-AUTOMATION-001 observation versus execution capability', () => {
  it('maps a buy or sell of an observed asset to an existing swap route, and never substitutes one', () => {
    expect(routeStrategy({ asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '50', slippageBps: 50 })).toEqual({ ok: true,
      strategy: { version: 1, action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50', slippageBps: 50 } });
    expect(routeStrategy({ asset: 'ETH', side: 'SELL', network: 'ethereum-sepolia', amount: '0.01', slippageBps: 30 })).toMatchObject({ ok: true,
      strategy: { inputAsset: 'WETH', outputAsset: 'USDC' } });
    expect(routeStrategy({ asset: 'SOL', side: 'BUY', network: 'solana-devnet', amount: '1', slippageBps: 50 })).toMatchObject({ ok: true,
      strategy: { inputAsset: 'devUSDC', outputAsset: 'SOL' } });
    expect(routeStrategy({ asset: 'BTC', side: 'BUY', network: 'base-sepolia', amount: '50', slippageBps: 50 })).toEqual({ ok: false, code: 'BTC_EXECUTION_ROUTE_UNAVAILABLE' });
    expect(routeStrategy({ asset: 'ETH', side: 'BUY', network: 'solana-devnet', amount: '50', slippageBps: 50 })).toEqual({ ok: false, code: 'AUTOMATION_ROUTE_NETWORK_UNSUPPORTED' });
    // Every route composes on the canonical engine (the same IR and hash as every other FloFi surface).
    for (const [asset, network] of [['ETH', 'base-sepolia'], ['ETH', 'ethereum-sepolia'], ['ETH', 'base'], ['SOL', 'solana-devnet'], ['SOL', 'solana']] as const)
      for (const side of ['BUY', 'SELL'] as const) {
        const route = routeStrategy({ asset, side, network, amount: '1', slippageBps: 50 });
        expect(route.ok && composeWorkflowBound(route.strategy, undefined).ok, `${asset} ${side} ${network}`).toBe(true);
      }
  });

  it('derives spend, side and observed asset from the canonical swap', () => {
    const buy: StrategySpec = { version: 1, action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50', slippageBps: 50 };
    expect([spendOf(buy), sideOf(buy), observedAssetOf(buy)]).toEqual([{ asset: 'USDC', amount: '50' }, 'BUY', 'ETH']);
    expect(sideOf({ ...buy, inputAsset: 'WETH', outputAsset: 'USDC' } as StrategySpec)).toBe('SELL');
    expect(spendOf({ version: 1, action: 'withdraw', network: 'base-sepolia', asset: 'USDC', amount: '1' })).toBeNull();
  });
});

describe('BUILD-AUTOMATION-001 strategy and saved-workflow binding', () => {
  it('binds one canonical swap with its workflow hash and engine version, and refuses other actions', () => {
    const bound = bindStrategy({ action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50' });
    expect(bound.ok && bound.binding).toMatchObject({ strategy: { slippageBps: 50, version: 1 }, workflowHash: expect.stringMatching(/^0x[0-9a-f]{64}$/), engineVersion: 'flofi-engine-2', source: null });
    expect(bound.ok && verifyBinding(bound.binding)).toEqual({ ok: true });
    expect(bound.ok && verifyBinding({ ...bound.binding, workflowHash: '0x' + '0'.repeat(64) })).toEqual({ ok: false, code: 'STRATEGY_STALE' });
    expect(bindStrategy({ action: 'withdraw', network: 'base-sepolia', asset: 'USDC', amount: '1' })).toEqual({ ok: false, code: 'AUTOMATION_ACTION_UNSUPPORTED' });
    expect(bindStrategy({ action: 'swap', network: 'base-sepolia', inputAsset: 'WBTC', outputAsset: 'USDC', amount: '1' })).toEqual({ ok: false, code: 'SWAP_ASSET_PAIR_UNSUPPORTED' });
  });

  it('derives the exact strategy of a saved single-swap workflow, and refuses anything it cannot reproduce node for node', () => {
    const saved = savedSwap('50'), derived = strategyOfSavedWorkflow(saved);
    expect(derived).toMatchObject({ ok: true, strategy: { action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50', slippageBps: 50 } });
    expect(strategyOfSavedWorkflow(savedSwap('0.01', 'WETH_TO_USDC'))).toMatchObject({ ok: true, strategy: { inputAsset: 'WETH', amount: '0.01' } });
    const tampered = structuredClone(saved);
    const node = tampered.nodes.find(n => n.actionType === 'asset.swap.exact-input')!;
    node.adapterConstraints = { adapters: [], protocols: ['uniswap', 'cow-protocol'] };
    expect(strategyOfSavedWorkflow(tampered)).toEqual({ ok: false, code: 'AUTOMATION_WORKFLOW_NOT_REPRESENTABLE' });
    const empty = structuredClone(saved);
    empty.nodes = empty.nodes.filter(n => n.actionType !== 'asset.swap.exact-input');
    expect(strategyOfSavedWorkflow(empty)).toEqual({ ok: false, code: 'AUTOMATION_WORKFLOW_NOT_REPRESENTABLE' });
  });

  it('flags a saved-workflow edit as drift and never follows it', () => {
    const source = { workflowId: 'workflow-x', workflowHash: '0x' + 'a'.repeat(64), version: 3 };
    expect(sourceDrift(source, { workflowHash: source.workflowHash, version: 3 })).toBeNull();
    expect(sourceDrift(source, { workflowHash: '0x' + 'b'.repeat(64), version: 4 })).toBe('WORKFLOW_CHANGED');
    expect(sourceDrift(source, { workflowHash: source.workflowHash, version: 4 })).toBe('WORKFLOW_CHANGED');
    expect(sourceDrift(source, null)).toBe('WORKFLOW_CHANGED');
    expect(sourceDrift(null, null)).toBeNull();
  });
});

describe('BUILD-AUTOMATION-001 automation input', () => {
  const dca = { version: 1, kind: 'SCHEDULED_DCA', name: 'Weekly ETH', schedule: { frequency: 'WEEKLY', weekday: 1, time: '09:00', timezone: 'Europe/Lisbon' },
    action: { kind: 'ROUTE', asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '50', slippageBps: 50 },
    limits: { maxAmountPerExecution: '50', maxAmountPerPeriod: null, maxOccurrencesPerPeriod: null, cooldownMinutes: 0, maxSlippageBps: 100 }, expiresAt: null };
  it('accepts the three kinds and normalizes them', () => {
    expect(validateAutomationInput(dca, NOW)).toMatchObject({ ok: true, value: { kind: 'SCHEDULED_DCA', name: 'Weekly ETH', timezone: 'Europe/Lisbon',
      definition: { schedule: { frequency: 'WEEKLY', weekday: 1 }, condition: null, watch: null } } });
    const trigger = { version: 1, kind: 'PRICE_TRIGGER', name: ' ETH dip ', timezone: 'UTC', condition: { type: 'PRICE_BELOW', asset: 'ETH', threshold: '3000', checkEveryMinutes: 15 },
      action: dca.action, limits: dca.limits, expiresAt: '2027-01-01T00:00:00Z' };
    expect(validateAutomationInput(trigger, NOW)).toMatchObject({ ok: true, value: { name: 'ETH dip', expiresAt: new Date('2027-01-01T00:00:00Z') } });
    expect(validateAutomationInput({ ...trigger, action: null, condition: { type: 'PERCENT_DROP', asset: 'BTC', reference: '100000', percent: '5', checkEveryMinutes: 60 } }, NOW).ok).toBe(true);
    const watch = { version: 1, kind: 'DAILY_WATCH', name: 'Morning round', schedule: { frequency: 'DAILY', weekday: null, time: '09:00', timezone: 'Europe/Lisbon' },
      watch: { assets: ['BTC', 'ETH', 'SOL'] }, expiresAt: null };
    expect(validateAutomationInput(watch, NOW)).toMatchObject({ ok: true, value: { action: null, definition: { watch: { assets: ['BTC', 'ETH', 'SOL'] } } } });
  });

  it('is closed: no execution mode, no extra field, no unknown zone, no mismatched asset, no past expiry', () => {
    expect(validateAutomationInput({ ...dca, executionMode: 'AUTOMATIC' }, NOW)).toEqual({ ok: false, code: 'AUTOMATION_INPUT_INVALID' });
    expect(validateAutomationInput({ ...dca, action: { ...dca.action, signer: '0x' + '1'.repeat(40) } }, NOW)).toEqual({ ok: false, code: 'AUTOMATION_INPUT_INVALID' });
    expect(validateAutomationInput({ ...dca, schedule: { ...dca.schedule, timezone: 'Europe/Atlantis' } }, NOW)).toEqual({ ok: false, code: 'AUTOMATION_SCHEDULE_INVALID' });
    expect(validateAutomationInput({ ...dca, schedule: { ...dca.schedule, weekday: null } }, NOW)).toEqual({ ok: false, code: 'AUTOMATION_SCHEDULE_INVALID' });
    expect(validateAutomationInput({ ...dca, name: '\u0007' }, NOW)).toEqual({ ok: false, code: 'AUTOMATION_NAME_INVALID' });
    expect(validateAutomationInput({ ...dca, expiresAt: '2026-01-01T00:00:00Z' }, NOW)).toEqual({ ok: false, code: 'AUTOMATION_EXPIRY_INVALID' });
    expect(validateAutomationInput({ ...dca, action: { ...dca.action, amount: '0' } }, NOW)).toEqual({ ok: false, code: 'AUTOMATION_AMOUNT_INVALID' });
    expect(validateAutomationInput({ version: 1, kind: 'PRICE_TRIGGER', name: 'x', timezone: 'UTC', condition: { type: 'PRICE_BELOW', asset: 'SOL', threshold: '100', checkEveryMinutes: 15 },
      action: dca.action, limits: dca.limits, expiresAt: null }, NOW)).toEqual({ ok: false, code: 'AUTOMATION_ACTION_ASSET_MISMATCH' });
    expect(validateAutomationInput({ version: 1, kind: 'PRICE_TRIGGER', name: 'x', timezone: 'UTC', condition: { type: 'PRICE_BELOW', asset: 'ETH', threshold: '100', checkEveryMinutes: 1 },
      action: null, limits: dca.limits, expiresAt: null }, NOW)).toEqual({ ok: false, code: 'AUTOMATION_INPUT_INVALID' });
  });
});
