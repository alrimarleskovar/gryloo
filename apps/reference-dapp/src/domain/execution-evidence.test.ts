// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { projectExecutionEvidence } from './execution-evidence';
import { projectExecutionLifecycle, type ExecutionLifecycleSource } from './execution-lifecycle';
import { reviewFixture } from '../test-utils/review-fixture';
import { baseAssetRegistry } from '@defi-workflow-engine/action-registry';

const approvalHash = '0x' + 'a'.repeat(64), actionHash = '0x' + 'b'.repeat(64), destinationHash = '0x' + 'c'.repeat(64);
const bundle = { evidenceBundleId: 'recorded-evidence', manifestHash: 'recorded-manifest', outcome: 'RECONCILED', receipts: [], reconciliation: { limitations: ['Existing evidence limitation'] } };
function source(kind: ExecutionLifecycleSource['kind'], state: unknown) { return { kind, state } as ExecutionLifecycleSource; }
function project(current: ExecutionLifecycleSource) {
  const fixture = reviewFixture(), progress = projectExecutionLifecycle(fixture.workflow, fixture.context, current);
  return projectExecutionEvidence(current, progress);
}
function publicSource(outcome: unknown = null, attempts: unknown = [
  { step: 'approval', state: 'CONFIRMED', txHash: approvalHash, account: 'recorded-wallet', receipt: { transactionHash: approvalHash, gasCostWei: '100000000000000' } },
  { step: 'swap', state: 'CONFIRMED', txHash: actionHash, receipt: { transactionHash: actionHash, gasCostWei: '200000000000000' } },
]) {
  const fixture = reviewFixture();
  return source('public', { ...fixture.source.state, run: { ...('run' in fixture.source.state ? fixture.source.state.run : {}), attempts, outcome } });
}
describe('recorded execution evidence projection', () => {
  it('keeps real approval and action identifiers distinct and uses the existing explorer mapping', () => {
    const result = project(publicSource());
    expect(result.operations.approval?.identifiers[0]).toMatchObject({ label: 'Approval transaction', value: approvalHash, explorer: `https://sepolia.basescan.org/tx/${approvalHash}` });
    expect(result.operations.swap?.identifiers[0]).toMatchObject({ label: 'Action transaction', value: actionHash });
    expect(result.wallet).toBe('recorded-wallet');
    expect(result.knownCosts[0]?.value).toBe('0.0003 ETH');
  });
  it('does not fabricate identifiers, actual values, or fees from a quote', () => {
    const result = project(publicSource(null, [{ step: 'swap', state: 'UNKNOWN', txHash: null }]));
    expect(result.operations.swap).toBeUndefined(); expect(result.knownCosts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('0.025 WETH');
  });
  it('uses reconciled actual values, rather than the simulated expected output or aggregate fee twice', () => {
    const result = project(publicSource({ evidence: bundle, evidenceBundleHash: 'existing-hash', inputSpent: '100000000', outputReceived: '24300000000000000', gasCostWei: '200000000000000' }));
    expect(result.operations.swap?.values).toEqual([{ label: 'Executed input', value: '100 USDC' }, { label: 'Actual received', value: '0.0243 WETH' }]);
    expect(result.knownCosts[0]?.value).toBe('0.0003 ETH'); expect(result.limitations).toEqual(['Existing evidence limitation']);
  });
  it.each([null, undefined, '-1', 'invalid'])('omits unknown/invalid cost %s instead of displaying zero', gasCostWei => {
    const result = project(publicSource(null, [{ step: 'swap', state: 'CONFIRMED', txHash: actionHash, receipt: { transactionHash: actionHash, gasCostWei } }]));
    expect(result.knownCosts).toEqual([]);
  });
  it('preserves a real zero cost, and counts a shared receipt only once', () => {
    const attempts = ['approval', 'swap'].map(step => ({ step, state: 'CONFIRMED', txHash: actionHash, receipt: { transactionHash: actionHash, gasCostWei: '0' } }));
    expect(project(publicSource(null, attempts)).knownCosts[0]?.value).toBe('0 ETH');
    attempts.forEach(attempt => { attempt.receipt.gasCostWei = '200000000000000'; });
    expect(project(publicSource(null, attempts)).knownCosts[0]?.value).toBe('0.0002 ETH');
  });
  it('retains a reverted transaction and distinguishes pre-submission wallet rejection', () => {
    const reverted = project(publicSource(null, [{ step: 'swap', state: 'REVERTED', txHash: actionHash }]));
    expect(reverted.operations.swap).toMatchObject({ failure: 'reverted', identifiers: [{ value: actionHash }] });
    const declined = project(publicSource(null, [{ step: 'swap', state: 'REJECTED', txHash: null }]));
    expect(declined.operations.swap).toMatchObject({ failure: 'declined', identifiers: [] });
  });
  function router(verdict = 'PENDING') {
    const fixture = reviewFixture();
    return source('router', { record: { id: 'bridge-run', workflow: fixture.workflow, provenance: 'PUBLIC_TESTNET', owner: 'bridge-wallet', verdict, phase: verdict === 'RECONCILED' ? 'RECONCILED' : 'IN_FLIGHT',
      review: { nodeId: fixture.workflow.nodes[0]!.nodeId, intent: { sourceChain: 'eip155:84532', destinationChain: 'eip155:421614', amount: '5000000' },
        quote: { expectedOutput: '4900000', feeTotal: '100000' }, route: { inputToken: { symbol: 'USDC', decimals: 6 }, outputToken: { symbol: 'USDC', decimals: 6 } }, calls: [{ purpose: 'BRIDGE_DEPOSIT' }] },
      attempts: [{ step: 'DEPOSIT', state: 'CONFIRMED', transactionHash: actionHash, reconciled: true }], source: { transactionHash: actionHash, depositId: 'real-provider-deposit', inputAmount: '5000000', safe: true },
      destination: { transactionHash: destinationHash, transferAmount: '4890000', safe: true },
    } });
  }
  it('keeps bridge source, destination and provider reference distinct without claiming pending destination amounts', () => {
    const result = project(router());
    expect(result.operations.DEPOSIT?.identifiers).toEqual(expect.arrayContaining([expect.objectContaining({ value: actionHash, label: 'Source transaction' }), expect.objectContaining({ value: 'real-provider-deposit', kind: 'reference' })]));
    expect(result.operations.destination?.identifiers[0]).toMatchObject({ value: destinationHash, label: 'Destination transaction', chain: 'eip155:421614' });
    expect(result.operations.destination?.values).toEqual([]); expect(result.knownCosts).toEqual([]);
    expect(result.operations.DEPOSIT?.values[0]?.value).toBe('5 USDC');
  });
  it('renders actual bridge settlement only after reconciliation and never calls a provider quote an actual fee', () => {
    const result = project(router('RECONCILED'));
    expect(result.operations.destination?.comparisons).toEqual([{ label: 'Actual received', planned: '4.9 USDC', actual: '4.89 USDC' }]);
    expect(result.knownCosts).toEqual([]);
  });
  it('retains original and replacement transaction identifiers', () => {
    const current = router();
    if (current.kind !== 'router') throw Error('fixture');
    const attempt = { ...current.state.record!.attempts[0]!, replacementHash: approvalHash };
    const result = project(source('router', { ...current.state, record: { ...current.state.record, attempts: [attempt] } }));
    expect(result.operations.DEPOSIT?.identifiers.filter(item => item.kind === 'transaction').map(item => item.value)).toEqual(expect.arrayContaining([approvalHash, actionHash]));
  });
  function cow(state: string) {
    return source('cow', { recoveryOnly: true, execution: { record: { executionId: 'cow-run', state, history: [], compiled: { orderUid: '0x' + 'd'.repeat(112) },
      quote: { chainId: 'eip155:8453', quoteId: 'provider-quote', sellToken: 'address' in baseAssetRegistry.USDC.asset ? baseAssetRegistry.USDC.asset.address : '', buyToken: 'address' in baseAssetRegistry.WETH.asset ? baseAssetRegistry.WETH.asset.address : '', sellAmount: '100000000', buyAmount: '25000000000000000' },
      observed: { uid: '0x' + 'd'.repeat(112), executedSellAmount: '100000000', executedBuyAmount: '24300000000000000' },
    }, evidence: { bundle } } });
  }
  it.each(['OPEN', 'FULFILLED', 'RECONCILIATION_REQUIRED'])('keeps CoW %s order identity separate from a settlement transaction or actual amounts', state => {
    const result = project(cow(state));
    expect(result.operations.order?.identifiers[0]).toMatchObject({ label: 'Order ID', kind: 'order', explorer: null });
    expect(result.operations.order?.identifiers.some(item => item.kind === 'transaction')).toBe(false);
    expect(result.operations.order?.comparisons).toEqual([]); expect(result.knownCosts).toEqual([]);
    expect(result.operations.order?.values).toContainEqual({ label: 'Orderbook reports bought', value: '0.0243 WETH' });
    expect(result.operations.order?.note).toContain('await settlement verification');
  });
  it('projects reconciled CoW observations with explicit scripted provenance, without inventing settlement hashes/fees', () => {
    const result = project(cow('RECONCILED'));
    expect(result.operations.order?.values).toContainEqual({ label: 'Scripted received', value: '0.0243 WETH' });
    expect(result.limitations.join(' ')).toContain('scripted'); expect(result.knownCosts).toEqual([]);
  });
  it('does not mutate the runtime record or add submission behavior', () => {
    const current = publicSource(), before = JSON.stringify(current); project(current); expect(JSON.stringify(current)).toBe(before);
  });
  function observed(kind: ExecutionLifecycleSource['kind'], state: unknown) {
    const fixture = reviewFixture(), progress = projectExecutionLifecycle(fixture.workflow, fixture.context, publicSource());
    return projectExecutionEvidence(source(kind, state), { ...progress, local: kind.startsWith('fork-'), runKey: 'recorded-run' });
  }
  it.each(['SUPPLY', 'BORROW', 'REPAY', 'WITHDRAW'])('uses real %s token balance changes rather than requested amounts', step => {
    const result = observed('supply', { record: { review: { account: 'wallet', chain: 'eip155:84532', amount: '100000000' },
      attempts: [{ step, state: 'CONFIRMED', transactionHash: actionHash, reconciled: true }],
      observations: [{ receipt: { transactionHash: actionHash }, verdict: 'RECONCILED', cost: '100000000000000', delta: '99000000', prePosition: { balance: '200000000' }, postPosition: { balance: step === 'BORROW' || step === 'WITHDRAW' ? '299000000' : '101000000' } }],
    } });
    const label = step === 'SUPPLY' ? 'Actual supplied' : step === 'BORROW' ? 'Actual borrowed' : step === 'REPAY' ? 'Actual repaid' : 'Actual withdrawn';
    expect(result.operations[step]?.comparisons).toContainEqual({ label, planned: '100 USDC', actual: '99 USDC' });
  });
  it('requires a reconciled observation for actual Solana values and keeps fees separate from rent', () => {
    const review = { owner: 'wallet', chain: 'solana:mainnet', input: { decimals: 6, symbol: 'USDC' }, output: { decimals: 9, symbol: 'SOL' }, amount: '100000000', quote: { outAmount: '1010000000' } };
    const observation = { signature: 'real-signature', verdict: 'RECONCILED', inputSpent: '100000000', outputReceived: '1000000000', feeLamports: '5000', accountCreationLamports: '2039280' };
    const record = { review, attempt: { signature: 'real-signature', reconciled: true }, observations: [observation] };
    const result = observed('solana-swap', { record });
    expect(result.operations.transaction?.comparisons).toContainEqual({ label: 'Actual received', planned: '1.01 SOL', actual: '1 SOL' });
    expect(result.knownCosts[0]?.value).toBe('0.000005 SOL');
    expect(result.operations.transaction?.values).toContainEqual({ label: 'Account creation cost', value: '0.00203928 SOL' });
    expect(observed('solana-swap', { record: { ...record, attempt: { signature: 'real-signature', reconciled: false } } }).operations.transaction?.values ?? []).toEqual([]);
  });
  it('uses real liquidity deposits and distinct token approvals', () => {
    const result = observed('uniswap-pool', { record: { review: { chainId: 84532, token0: { decimals: 6, symbol: 'USDC' }, token1: { decimals: 18, symbol: 'WETH' }, expected: { amount0: '100000000', amount1: '25000000000000000' } },
      attempts: [{ step: 'APPROVE_TOKEN0', transactionHash: approvalHash, state: 'CONFIRMED' }, { step: 'MINT', transactionHash: actionHash, state: 'CONFIRMED' }], verdict: 'RECONCILED', position: { amount0: '99000000', amount1: '24300000000000000', tokenId: '42' },
    } });
    expect(result.operations.APPROVE_TOKEN0?.identifiers[0]?.label).toBe('Approval transaction');
    expect(result.operations.MINT?.comparisons[0]?.actual).toBe('99 USDC'); expect(result.operations.MINT?.identifiers).toContainEqual(expect.objectContaining({ label: 'Position ID', value: '42' }));
    expect(result.knownCosts).toEqual([]);
  });
  it('shows the actual native transfer value from the observed transaction and not its reviewed amount', () => {
    const result = observed('transfer', { record: { review: { account: 'wallet', chain: 'eip155:46630', value: '1000000000000000' }, attempt: { reconciled: true, transactionHash: actionHash },
      observations: [{ verdict: 'RECONCILED', transaction: { value: '0x38d7ea4c68000' }, receipt: { transactionHash: actionHash }, facts: { fee: '21000000000000' } }],
    } });
    expect(result.operations.transfer?.values[0]?.value).toBe('0.001 ETH'); expect(result.knownCosts[0]?.value).toBe('0.000021 ETH');
  });
  it('does not present a local aggregate cost as a single step fee or link fork hashes to a public explorer', () => {
    const result = observed('fork-pool', { prepared: { owner: 'wallet' }, status: { transactionHash: actionHash, journal: { attempts: [{ stepId: 'approve-usdc', state: 'CONFIRMED', transactionHash: approvalHash }, { stepId: 'mint', state: 'CONFIRMED', transactionHash: actionHash }] },
      reconciliation: { outcome: 'RECONCILED', totalEthFee: '300000000000000', amountWeth: '-24300000000000000', amountUsdc: '-99000000', positionTokenId: '42' },
    } });
    expect(result.knownCosts[0]?.value).toBe('0.0003 ETH'); expect(result.operations.liquidity?.fees).toEqual([]);
    expect(result.operations.liquidity?.identifiers.every(item => item.explorer === null)).toBe(true);
    expect(result.operations.liquidity?.values).toContainEqual({ label: 'Actual liquidity deposited', value: '0.0243 WETH' });
  });
});
