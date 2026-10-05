// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseCopilotIntentV2, parseCopilotOutputV2, v1MissingFields } from './copilot-intent-v2';
import { act, CHANGES, intent, NO_TARGET } from './copilot-session.test-harness';

const supply = act.lending('SUPPLY', { network: 'BASE_SEPOLIA', asset: 'USDC', amount: '5' });
const accepts = (value: unknown) => expect(parseCopilotIntentV2(value)).toEqual(value);
const rejects = (value: unknown, code = 'COPILOT_INTENT_INVALID') => expect(() => parseCopilotIntentV2(value)).toThrow(code);

describe('CopilotIntentV2 strict parsing', () => {
  it('accepts every declared kind exactly as given', () => {
    accepts(intent.action(supply));
    accepts(intent.action(supply, 'PT', { from: NO_TARGET, fields: ['network', 'amount'] }));
    accepts(intent.composition([act.lending('SUPPLY'), act.lending('BORROW'), act.swap()]));
    accepts(intent.edit({ amount: '2' }));
    accepts(intent.edit({ rangeUnit: 'PRICE', lower: '2000', upper: '4000' }, { step: 'LIQUIDITY' }));
    accepts(intent.edit({ deposits: [{ asset: 'USDC', maxAmount: '50' }] }));
    accepts(intent.repeat());
    accepts(intent.repeat({ amount: '2' }, { step: 'SWAP', ordinal: 'LAST' }));
    accepts(intent.remove({ ordinal: 'SECOND' }, 'PT'));
    accepts(intent.insert('BEFORE', { step: 'BORROW' }, act.lending('SUPPLY', { amount: '5' })));
    accepts(intent.question('WORKFLOW_OVERVIEW'));
    accepts(intent.question('STEP_DETAIL', { ordinal: 'FIRST' }, 'PT'));
    accepts(intent.clarify(['target', 'amount'], 'Which step, and how much?', ['Step 2']));
    accepts(intent.unsupported('Staking is not supported.'));
    expect(parseCopilotOutputV2({ intent: intent.edit({ amount: '2' }) })).toEqual(intent.edit({ amount: '2' }));
  });
  it('rejects V1 shapes, missing language, unknown kinds and invented fields', () => {
    rejects({ version: '1', kind: 'ACTION', action: supply, reuse: null, language: 'EN' });
    const { language: _language, ...noLanguage } = intent.edit({ amount: '2' });
    void _language;
    rejects(noLanguage);
    rejects({ ...intent.edit({ amount: '2' }), language: 'ES' });
    rejects({ version: '2', language: 'EN', kind: 'EXECUTE', transaction: {} });
    rejects({ version: '2', language: 'EN', kind: 'SIGN' });
    rejects({ ...intent.edit({ amount: '2' }), calldata: '0xa9059cbb' });
    rejects({ ...intent.edit({ amount: '2' }), changes: { ...CHANGES, amount: '2', data: '0x00' } });
    rejects({ ...intent.edit({ amount: '2' }), target: { ...NO_TARGET, nodeId: 'node-002' } });
    rejects({ ...intent.edit({ amount: '2' }), target: { step: 'TRANSFER', ordinal: null } });
    rejects({ ...intent.edit({ amount: '2' }), target: { step: null, ordinal: 'SIXTH' } });
    rejects(intent.question('SEND_FUNDS'));
    rejects({ ...intent.question('PROTOCOLS'), answer: 'Aave pays 12%' });
    rejects({ intent: intent.edit({ amount: '2' }), extra: true }, 'COPILOT_INTENT_INVALID');
    const hidden = intent.edit({ amount: '2' });
    Object.defineProperty(hidden, 'execute', { value: true, enumerable: false });
    rejects(hidden);
    rejects(Object.assign(Object.create({ inherited: 1 }), intent.edit({ amount: '2' })));
  });
  it('requires at least one change for an edit, a whole range, and bounded reuse and deposits', () => {
    rejects(intent.edit({}));
    rejects(intent.edit({ rangeUnit: 'PRICE', lower: '2000' }));
    rejects(intent.edit({ deposits: [{ asset: 'USDC', maxAmount: '1' }, { asset: 'WETH', maxAmount: '1' }, { asset: 'SOL', maxAmount: '1' }] }));
    rejects(intent.edit({ deposits: [{ asset: 'USDC', maxAmount: 'all' }] }));
    rejects(intent.action(supply, 'EN', { from: NO_TARGET, fields: [] }));
    rejects(intent.action(supply, 'EN', { from: NO_TARGET, fields: ['network', 'network'] }));
    rejects(intent.action(supply, 'EN', { from: NO_TARGET, fields: ['calldata'] }));
    rejects(intent.composition([act.lending('SUPPLY'), act.lending('BORROW'), act.swap(), act.swap()]), 'COPILOT_TOO_MANY_ACTIONS');
    rejects(intent.composition([act.lending('SUPPLY')]));
  });
  it('keeps V1 value patterns: no words for amounts, no malformed addresses or slippage', () => {
    rejects(intent.edit({ amount: 'all' }));
    rejects(intent.edit({ amount: '1e3' }));
    rejects(intent.edit({ slippageBps: '0.5' }));
    rejects(intent.edit({ recipient: '0x1234' }));
    expect((parseCopilotIntentV2(intent.edit({ recipient: '0xABCDEF0000000000000000000000000000000001' })) as { changes: { recipient: string } }).changes.recipient)
      .toBe('0xabcdef0000000000000000000000000000000001');
  });
  it('bounds displayed prose and refuses control and bidirectional characters', () => {
    rejects(intent.clarify(['amount'], 'x'.repeat(301)));
    rejects(intent.clarify(['amount'], 'How much?', ['a', 'b', 'c', 'd', 'e']));
    rejects(intent.unsupported('No‮.'));
    rejects(intent.unsupported('   '));
    rejects(intent.clarify(['amount', 'amount'], 'How much?'));
    expect(v1MissingFields(['target', 'amount', 'network'])).toEqual(['amount', 'network']);
  });
});
