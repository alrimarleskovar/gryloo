// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { COPILOT_LIMITS, COPILOT_OUTPUT_SCHEMA, parseCopilotIntent, parseCopilotOutput, safeCopilotProse } from './copilot-intent';

const supply = { type: 'SUPPLY', protocol: 'AAVE_V3', network: 'BASE_SEPOLIA', asset: 'USDC', amount: '200', beneficiary: null };
const swap = { type: 'SWAP', network: 'BASE', inputAsset: 'USDC', outputAsset: 'ETH', amount: '100', slippageBps: null };
const bridge = { type: 'BRIDGE', sourceNetwork: 'BASE_SEPOLIA', destinationNetwork: 'ARBITRUM_SEPOLIA', asset: 'USDC', amount: '50', slippageBps: null,
  routing: null, recipient: null };
const liquidity = { type: 'LIQUIDITY', protocol: 'UNISWAP_V3', network: 'BASE_SEPOLIA', deposits: [{ asset: 'USDC', maxAmount: '10' }, { asset: 'WETH', maxAmount: '0.005' }],
  rangeUnit: 'PRICE', lower: '2000', upper: '3000', slippageBps: null };
const action = (value: unknown) => ({ version: '1', kind: 'ACTION', action: value });

describe('CopilotIntentV1 strict parsing', () => {
  it('accepts every declared form exactly as given', () => {
    for (const value of [supply, swap, bridge, liquidity, { ...supply, type: 'WITHDRAW' }]) expect(parseCopilotIntent(action(value))).toEqual(action(value));
    expect(parseCopilotIntent({ version: '1', kind: 'COMPOSITION', actions: [supply, { ...supply, type: 'BORROW' }, swap] }).kind).toBe('COMPOSITION');
    expect(parseCopilotIntent({ version: '1', kind: 'CLARIFICATION_REQUIRED', missing: ['amount', 'destinationNetwork'],
      question: 'How much USDC, and to which network?', options: ['Arbitrum Sepolia'] })).toMatchObject({ kind: 'CLARIFICATION_REQUIRED' });
    expect(parseCopilotIntent({ version: '1', kind: 'UNSUPPORTED', reason: 'Transfers are not supported.' })).toMatchObject({ kind: 'UNSUPPORTED' });
    expect(parseCopilotOutput({ intent: action(supply) })).toEqual(action(supply));
  });

  it('normalizes addresses to lower case and keeps unstated fields null', () => {
    const address = '0xAbCdEf0000000000000000000000000000000001';
    expect(parseCopilotIntent(action({ ...supply, beneficiary: address, network: null, amount: null }))).toMatchObject({
      action: { beneficiary: address.toLowerCase(), network: null, amount: null } });
  });

  it('rejects invented, hidden, symbolic and inherited fields', () => {
    for (const extra of [{ calldata: '0xdeadbeef' }, { to: '0x1111111111111111111111111111111111111111' }, { execute: true }, { signature: '0x' }])
      expect(() => parseCopilotIntent(action({ ...supply, ...extra }))).toThrow('COPILOT_INTENT_INVALID');
    expect(() => parseCopilotIntent({ ...action(supply), authorized: true })).toThrow();
    expect(() => parseCopilotOutput({ intent: action(supply), transaction: {} })).toThrow();
    const hidden = { ...supply };
    Object.defineProperty(hidden, 'calldata', { value: '0x', enumerable: false });
    expect(() => parseCopilotIntent(action(hidden))).toThrow();
    expect(() => parseCopilotIntent(action({ ...supply, [Symbol('authority')]: true }))).toThrow();
    expect(() => parseCopilotIntent(action(Object.assign(Object.create({ inherited: true }), supply)))).toThrow();
    const getter = { ...supply };
    Object.defineProperty(getter, 'amount', { get: () => '200', enumerable: true });
    expect(() => parseCopilotIntent(action(getter))).toThrow();
  });

  it('rejects undeclared actions, protocols, networks, assets and versions', () => {
    for (const value of [{ ...supply, type: 'TRANSFER' }, { ...supply, type: 'STAKE' }, { ...supply, protocol: 'COMPOUND' }, { ...supply, network: 'ETHEREUM' },
      { ...supply, asset: 'DAI' }, { ...bridge, routing: 'STARGATE' }, { ...liquidity, protocol: 'CURVE' }, { ...liquidity, rangeUnit: 'PERCENT' }])
      expect(() => parseCopilotIntent(action(value))).toThrow();
    expect(() => parseCopilotIntent({ ...action(supply), version: '2' })).toThrow();
    expect(() => parseCopilotIntent({ version: '1', kind: 'EXECUTE', action: supply })).toThrow();
  });

  it('rejects malformed amounts, slippage, addresses and ranges', () => {
    for (const amount of ['1e3', '-1', '01', '1,5', '1.', '.5', ' 1', '1'.repeat(41), 100])
      expect(() => parseCopilotIntent(action({ ...supply, amount }))).toThrow();
    for (const slippageBps of ['0.5', '-1', '123456', '1%', 50]) expect(() => parseCopilotIntent(action({ ...swap, slippageBps }))).toThrow();
    for (const recipient of ['0x123', 'vitalik.eth', '0x' + 'g'.repeat(40)]) expect(() => parseCopilotIntent(action({ ...bridge, recipient }))).toThrow();
    expect(() => parseCopilotIntent(action({ ...liquidity, lower: '2,000' }))).toThrow();
    expect(() => parseCopilotIntent(action({ ...liquidity, deposits: [...liquidity.deposits, { asset: 'SOL', maxAmount: '1' }] }))).toThrow();
  });

  it('limits a composition to the action budget and requires at least two steps', () => {
    expect(() => parseCopilotIntent({ version: '1', kind: 'COMPOSITION', actions: [supply, supply, supply, supply] })).toThrow('COPILOT_TOO_MANY_ACTIONS');
    expect(() => parseCopilotIntent({ version: '1', kind: 'COMPOSITION', actions: [supply] })).toThrow('COPILOT_INTENT_INVALID');
    const sparse = [supply, supply];
    (sparse as unknown as Record<string, unknown>).extra = 1;
    expect(() => parseCopilotIntent({ version: '1', kind: 'COMPOSITION', actions: sparse })).toThrow();
    expect(COPILOT_LIMITS.maxActions).toBe(3);
  });

  it('bounds displayed prose and refuses control and bidirectional characters', () => {
    const clarify = (question: string, options: unknown[] = []) => ({ version: '1', kind: 'CLARIFICATION_REQUIRED', missing: ['amount'], question, options });
    expect(() => parseCopilotIntent(clarify('x'.repeat(301)))).toThrow();
    expect(() => parseCopilotIntent(clarify('How much?\u202e'))).toThrow();
    expect(() => parseCopilotIntent(clarify('How much?', ['a', 'b', 'c', 'd', 'e']))).toThrow();
    expect(() => parseCopilotIntent(clarify('How much?', ['x'.repeat(61)]))).toThrow();
    expect(() => parseCopilotIntent({ ...clarify('How much?'), missing: ['amount', 'amount'] })).toThrow();
    expect(() => parseCopilotIntent({ ...clarify('How much?'), missing: ['privateKey'] })).toThrow();
    expect(() => parseCopilotIntent({ version: '1', kind: 'UNSUPPORTED', reason: '   ' })).toThrow();
  });

  it('withholds model prose that carries links, addresses or execution claims', () => {
    expect(safeCopilotProse('Which network should the USDC be sent to?')).toBe('Which network should the USDC be sent to?');
    for (const text of ['Visit https://example.invalid to continue', 'Send it to 0x1111111111111111111111111111111111111111', 'see www.example.invalid',
      'Your swap was executed.', 'The bridge has been sent.', 'A transação foi enviada.', 'Signed and done', '7EYnhQoR9YM3N7UoaKRoA44Uy8JeaZV3qyouov87awMs'])
      expect(safeCopilotProse(text)).toBeNull();
  });
});

describe('structured-output schema', () => {
  type Node = Record<string, unknown>;
  const objects: Node[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const value = node as Node;
    if (value.type === 'object') objects.push(value);
    Object.values(value).forEach(walk);
  };
  walk(COPILOT_OUTPUT_SCHEMA);

  it('is strict-mode compatible: every object is closed and requires all of its properties', () => {
    expect(COPILOT_OUTPUT_SCHEMA.type).toBe('object');
    expect(objects.length).toBeGreaterThan(5);
    for (const node of objects) {
      expect(node.additionalProperties).toBe(false);
      expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as Node).sort());
    }
  });

  it('uses only conservative keywords and declares no execution, calldata or transfer field', () => {
    const text = JSON.stringify(COPILOT_OUTPUT_SCHEMA);
    for (const keyword of ['"pattern"', '"maxLength"', '"maxItems"', '"format"', '"$ref"', '"const"']) expect(text).not.toContain(keyword);
    for (const field of ['calldata', '"data"', '"to"', 'signature', 'privateKey', 'nonce', 'TRANSFER', 'execute']) expect(text).not.toContain(field);
  });
});
