// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunDetailView } from './run-detail-view';
import { runDetailFixture, detailHash, detailApprovalHash, detailDestinationHash, detailOrderId, type RunDetailCase } from '../../test-utils/run-detail-fixture';

const noop = () => undefined;
function render(mode: RunDetailCase = 'completed', props: Partial<Parameters<typeof RunDetailView>[0]> = {}) {
  return renderToStaticMarkup(<RunDetailView {...runDetailFixture(mode)} connection="CONNECTED" loading={false} back={noop} build={noop} execute={noop} refresh={noop} {...props}/>);
}
describe('Run Details reuses the UX-005 execution and evidence truth', () => {
  it('gives a completed saved run a summary, timeline, visible evidence and one closed technical disclosure', () => {
    const html = render();
    expect(html).toContain('SAVED EXECUTION'); expect(html).toContain('Execution completed'); expect(html).toContain('SAVED RUN RESULT');
    expect(html).toContain('Run summary'); expect(html).toContain('RECORDED EXECUTION PROOF'); expect(html).toContain('Archive integrity verified');
    expect(html.match(/<details/g)).toHaveLength(1); expect(html).not.toContain('<details open');
    expect(html).toContain('Saved execution record'); expect(html).not.toContain('Current execution record');
    expect(html).not.toContain('current execution record'); expect(html).not.toContain('Back to Build');
  });
  it('keeps known actual output separate from the planned amount and only reports recorded costs', () => {
    const html = render();
    expect(html).toContain('0.0243 WETH'); expect(html).toContain('0.025 WETH'); expect(html).toContain('Planned and actual values');
    expect(html).toContain('0.0003 ETH'); expect(html).not.toMatch(/\$|APY|PnL/);
    const unknown = render('unresolved');
    expect(unknown).not.toContain('Actual received'); expect(unknown).not.toContain('0.0243 WETH'); expect(unknown).not.toContain('0 ETH');
    expect(unknown).toContain('Actual amounts are unavailable'); expect(unknown).toContain('Network costs are not recorded');
  });
  it('retains approval/action identifiers, their full values and the existing correct explorer links', () => {
    const html = render();
    expect(html).toContain('Approval transaction'); expect(html).toContain(detailApprovalHash); expect(html).toContain('Action transaction'); expect(html).toContain(detailHash);
    expect(html).toContain(`https://sepolia.basescan.org/tx/${detailHash}`); expect(html).toContain('Copy transaction');
  });
  it('keeps earlier completed actions and downstream waiting steps visible in a partial run', () => {
    const html = render('partial');
    expect(html).toContain('Partially completed'); expect(html).toContain('Execution partially completed');
    expect(html).toContain('1. Supply'); expect(html).toContain('2. Borrow'); expect(html).toContain('3. Swap');
    expect(html).toContain('Reconciled'); expect(html).toContain('Transaction reverted'); expect(html).toContain('Waiting');
    expect(html).toContain('Earlier confirmed actions remain recorded'); expect(html).not.toContain('Execution completed');
  });
  it.each(['failed', 'declined', 'unresolved'] as const)('preserves the definitive %s meaning', mode => {
    const html = render(mode);
    expect(html).toContain(mode === 'failed' ? 'Execution failed' : mode === 'declined' ? 'Transaction not submitted' : 'Execution status unresolved');
    expect(html).toContain(mode === 'failed' ? 'Transaction reverted' : mode === 'declined' ? 'Wallet confirmation was declined' : 'Unresolved');
    expect(html).not.toContain('Execution completed'); expect(html).not.toContain('Retry');
    if (mode === 'declined') expect(html).not.toContain('Transaction reverted');
  });
  it('requires recorded recovery and reconciliation facts rather than restoration alone', () => {
    const restored = render('restored'), recovered = render('recovered');
    expect(restored).toContain('Saved result restored'); expect(restored).not.toContain('>Recovered<'); expect(restored).not.toContain('>Reconciled<');
    expect(recovered).toContain('>Recovered<'); expect(recovered).toContain('>Reconciled<'); expect(recovered).toContain('No action was repeated');
  });
  it('keeps bridge source confirmation distinct from destination settlement and verified amounts', () => {
    const pending = render('bridge-pending'), settled = render('bridge-completed');
    for (const html of [pending, settled]) {
      expect(html).toContain('Source transaction'); expect(html).toContain(detailHash);
      expect(html).toContain('Destination transaction'); expect(html).toContain(detailDestinationHash); expect(html).toContain('Provider reference · Deposit ID');
      expect(html).toContain('Across'); expect(html).toContain('Arbitrum Sepolia');
      expect(html).toContain(`https://sepolia.arbiscan.io/tx/${detailDestinationHash}`);
    }
    expect(pending).toContain('In progress'); expect(pending).not.toContain('4.89 USDC'); expect(pending).not.toContain('Execution completed');
    expect(settled).toContain('4.89 USDC'); expect(settled).toContain('4.9 USDC'); expect(settled).toContain('Execution completed');
  });
  it.each(['cow-pending', 'cow-reconciled', 'cow-cancelled'] as const)('preserves %s order identity and the existing scripted limitations', mode => {
    const html = render(mode);
    expect(html).toContain('Order ID'); expect(html).toContain(detailOrderId); expect(html).toContain('CoW Protocol');
    expect(html).not.toContain('Action transaction'); expect(html).not.toContain('View transaction');
    expect(html).toContain('CoW orderbook and settlement are scripted');
    if (mode === 'cow-pending') { expect(html).toContain('Orderbook reports bought'); expect(html).toContain('await settlement verification'); }
    if (mode === 'cow-reconciled') expect(html).toContain('Scripted received');
    if (mode === 'cow-cancelled') expect(html).toContain('Cancellation requested');
  });
  it('degrades legacy records without reconstructing a title, graph, count or actual amounts', () => {
    const html = render('legacy');
    expect(html).toContain('original title not recorded'); expect(html).toContain('Original workflow details are unavailable');
    expect(html).toContain('Recorded requests'); expect(html).not.toContain('Workflow step progression');
    expect(html).not.toContain('Steps confirmed'); expect(html).not.toContain('<time'); expect(html).not.toContain('Actual received');
    expect(html).toContain('Approval transaction'); expect(html).toContain('Unresolved');
  });
  it('distinguishes not-found, unavailable, disconnected, verification, and unconfigured sources', () => {
    for (const [connection, label] of [['NOT_FOUND', 'Run not found'], ['UNAVAILABLE', 'Execution details temporarily unavailable'],
      ['DISCONNECTED', 'Connect the wallet used for this execution'], ['SIGN_IN_REQUIRED', 'Verify your wallet'], ['NOT_CONFIGURED', 'Execution history unavailable']] as const) {
      const html = render('completed', { view: null, detail: null, connection });
      expect(html).toContain(label); expect(html).toContain('Back to Dashboard'); expect(html).not.toContain(detailHash);
      if (connection === 'UNAVAILABLE') { expect(html).toContain('Reload details'); expect(html).not.toContain('Run not found'); }
    }
    expect(render('completed', { view: null, detail: null, loading: true })).toContain('Loading execution');
  });
  it('retains real results when detailed records or archived evidence are unavailable', () => {
    expect(render('record-unavailable')).toContain('The saved summary remains visible');
    const archive = render('archive-unavailable');
    expect(archive).toContain('Execution completed'); expect(archive).toContain('0.0243 WETH'); expect(archive).toContain('Archived evidence could not be loaded');
    const unverified = render('archive-unverified');
    expect(unverified).toContain('Archive verification unavailable'); expect(unverified).not.toContain('Archive integrity verified');
  });
  it.each<RunDetailCase>(['completed', 'pending', 'partial', 'failed', 'declined', 'unresolved', 'recovered', 'legacy'])('%s saved records contain no execution mutation controls', mode => {
    const html = render(mode);
    expect(html).not.toMatch(/Execute workflow|Open current execution|Retry|Continue execution|<input|<select|<textarea/);
  });
  it('only offers navigation to Execute for the current run', () => {
    const saved = runDetailFixture('pending');
    expect(render('pending', { view: { ...saved.view, current: true } })).toContain('Open current execution');
    expect(render('pending')).not.toContain('Open current execution');
  });
});
