// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardWorkspace } from './dashboard-workspace';
import { runDetailFixture } from '../../test-utils/run-detail-fixture';
import { reviewFixture, reviewOwner } from '../../test-utils/review-fixture';
import type { ExecutionRecovery } from '../../domain/execution-recovery';

vi.mock('../../state/build009-wallet-store', () => ({ useBuild009Wallet: () => ({}), injected: () => null }));
vi.mock('../../app/dashboard-action', () => ({ dashboardSnapshot: vi.fn(), dashboardRunDetail: vi.fn() }));
vi.mock('../../app/wallet-session-action', () => ({ walletSignInChallenge: vi.fn(), walletSignIn: vi.fn() }));
const noop = () => undefined;
function workspace(account: string | null, runId = 'fixture-detail-run') {
  const fixture = reviewFixture(), { view } = runDetailFixture();
  return renderToStaticMarkup(<DashboardWorkspace workflowName="Owned current workflow" progress={view.progress!} recovery={{ contextIssue: null, action: null } as ExecutionRecovery}
    wallet={{ ...fixture.wallet, account }} context={fixture.context} runId={runId} build={noop} execute={noop} navigate={noop}/>);
}
describe('Run Details preserves the existing wallet-owner boundary', () => {
  it.each([reviewOwner, reviewOwner.toUpperCase()])('shows the current owned execution for its matching wallet (%s)', account => {
    const html = workspace(account);
    expect(html).toContain('Owned current workflow'); expect(html).toContain('CURRENT EXECUTION'); expect(html).toContain('View result in Execute');
  });
  it.each([null, '0x' + '2'.repeat(40)])('cannot reveal a current execution to a disconnected or unrelated wallet (%s)', account => {
    const html = workspace(account);
    expect(html).not.toContain('Owned current workflow'); expect(html).not.toContain('fixture-evidence-bundle');
    expect(html).not.toContain('0.0243 WETH'); expect(html).not.toContain('Open current execution'); expect(html).not.toContain('View result in Execute');
  });
  it('does not substitute the current execution for an unrelated deep-link ID', () => {
    const html = workspace(reviewOwner, 'unrelated-run');
    expect(html).not.toContain('Owned current workflow'); expect(html).not.toContain('fixture-evidence-bundle'); expect(html).toContain('Loading execution');
  });
});
