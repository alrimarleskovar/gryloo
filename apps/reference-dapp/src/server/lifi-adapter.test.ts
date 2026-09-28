import { describe, expect, it } from 'vitest';
import { normalizeLifiQuote, resolveUsdcTokens, requestLifiQuote } from './lifi-adapter';
const owner = '0x' + '1'.repeat(40);
const source = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const destination = '0x0b2c639c533813f4aa9d7837caf62653d097ff85';
const spender = '0x' + '2'.repeat(40);
const token = (chainId: number, address: string) => ({ chainId, address, symbol: 'USDC', coinKey: 'USDC', decimals: 6 });
export const catalog = { tokens: { '8453': [token(8453, source)], '10': [token(10, destination)] } };
export const rawQuote = () => ({ id: 'lifi-route:0', type: 'lifi', tool: 'across',
  action: { fromChainId: 8453, toChainId: 10, fromAmount: '1000000', slippage: 0.005,
    fromAddress: owner, toAddress: owner, fromToken: token(8453, source), toToken: token(10, destination) },
  estimate: { toAmount: '998000', toAmountMin: '995000', approvalAddress: spender,
    feeCosts: [{ name: 'Bridge fee', amount: '2000', token: token(8453, source), included: true }],
    gasCosts: [{ type: 'SEND', amount: '5000000000000', token: { chainId: 8453,
      address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 } }] },
  includedSteps: [{ type: 'protocol', tool: 'feeCollection' }, { type: 'cross', tool: 'across' }],
  transactionRequest: { from: owner, to: spender, value: '0x0', chainId: 8453,
    data: '0x12345678', gasLimit: '0x30d40', gasPrice: '0x989680' } });
describe('LI.FI adapter contract', () => {
  it('resolves canonical USDC from both live-catalog shapes', () => {
    expect(resolveUsdcTokens(catalog)).toEqual({ source, destination });
  });
  it('accepts one cross step with an internal protocol fee step and preserves provider metadata', async () => {
    const requests: string[] = [];
    const quote = await requestLifiQuote(owner, '1000000', 50, async url => {
      requests.push(url); return requests.length === 1 ? catalog : rawQuote();
    }, Date.now());
    expect(quote.provider).toBe('across');
    expect(quote.includedSteps).toEqual([{ type: 'protocol', tool: 'feeCollection' }, { type: 'cross', tool: 'across' }]);
    expect(requests[1]).toContain('allowDestinationCall=false');
    expect(requests[1]).toContain('fromChain=8453');
    expect(quote.rawHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it('rejects recipient drift, extra bridge step and native value', () => {
    const base = rawQuote(), now = Date.now();
    expect(() => normalizeLifiQuote({ ...base, action: { ...base.action, toAddress: spender } }, owner, '1000000', 50, now)).toThrow();
    expect(() => normalizeLifiQuote({ ...base, includedSteps: [...base.includedSteps, { type: 'cross', tool: 'other' }] }, owner, '1000000', 50, now)).toThrow();
    expect(() => normalizeLifiQuote({ ...base, transactionRequest: { ...base.transactionRequest, value: '0x1' } }, owner, '1000000', 50, now)).toThrow();
  });
});
