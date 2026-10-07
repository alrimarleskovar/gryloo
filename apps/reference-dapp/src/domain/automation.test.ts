// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { nextScheduledOccurrence, scheduledDcaSpec, validateAutomationSpec } from './automation';

describe('AUTOMATION-001A schedule contract', () => {
  it('normalizes a DCA strategy through the canonical engine and grants no execution authority', () => {
    const result = validateAutomationSpec(scheduledDcaSpec({ name: 'Weekly WETH DCA', network: 'base-sepolia', amount: '25',
      cadence: 'WEEKLY', timezone: 'Europe/Lisbon', localTime: '09:00', weekday: 3 }));
    expect(result).toMatchObject({ spec: { execution: 'OWNER_CONFIRMATION_REQUIRED', strategy: {
      action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '25' } } });
    expect('code' in result ? null : result.workflowHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it('keeps a Lisbon daily schedule on its wall-clock time', () => {
    const next = nextScheduledOccurrence({ type: 'SCHEDULE', cadence: 'DAILY', timezone: 'Europe/Lisbon', localTime: '09:15' },
      new Date('2026-10-07T20:00:00Z'));
    expect(next.toISOString()).toBe('2026-10-08T08:15:00.000Z');
  });
  it('selects the requested ISO weekday and rejects unsupported mainnet scheduling in 001A', () => {
    const next = nextScheduledOccurrence({ type: 'SCHEDULE', cadence: 'WEEKLY', timezone: 'UTC', localTime: '10:00', weekday: 1 },
      new Date('2026-10-07T20:00:00Z'));
    expect(next.toISOString()).toBe('2026-10-12T10:00:00.000Z');
    const result = validateAutomationSpec(scheduledDcaSpec({ name: 'X', network: 'base-sepolia', amount: '1',
      cadence: 'DAILY', timezone: 'UTC', localTime: '10:00' }));
    expect('code' in result).toBe(false);
    expect(validateAutomationSpec({ ...scheduledDcaSpec({ name: 'X', network: 'base-sepolia', amount: '1',
      cadence: 'DAILY', timezone: 'UTC', localTime: '10:00' }), strategy: { action: 'supply' } })).toEqual({ code: 'AUTOMATION_STRATEGY_INVALID' });
  });
});
