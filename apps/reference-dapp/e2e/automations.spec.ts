// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: Automations in a real browser, under `next start` on the embedded PostgreSQL runtime, with the FIXTURE price
 * source, the deterministic test clock of the bearer-only scheduler endpoint and the synthetic loopback Base Sepolia read harness
 * (nothing reaches a price provider, a chat or a public chain; no transaction is ever sent):
 *
 *   the owner proves a wallet → creates a weekly DCA ("Every Monday 09:00 Europe/Lisbon, buy 50 USDC of WETH, ask me each time") →
 *   it is ACTIVE → the scheduler, at the test clock's slot, creates ONE occurrence → "Waiting for you" → Review in FloFi → /approve
 *   ("FROM FLOFI AUTOMATIONS", nothing authorized) → Load proposal (the exact workflow, PR #72) → a reload re-opens it for the same
 *   wallet, and PR #72's recovery by reference restores it for that claimant only, reissuing nothing → Continue to simulation →
 *   FloFi's own Simulate and Strategy Manifest Review are reached → the spec
 *   stops before approving: no wallet transaction or typed-data signature was ever requested.
 *
 * And a price trigger ("If ETH falls below $3,000, ask me to buy 100 USDC") fires once on the crossing, never again while the price stays
 * below; a BTC purchase shows FloFi's honest capability blocker.
 */
import { createTestWallet } from '../../../packages/reference-reconciler/test/test-wallet.ts';
import { assertAutomationHarness, dispatch, occurrencesOf, query, ruleOf, setPrices } from './automation-fixtures';
import { test, expect, chooseWallet } from './fixtures';
import { installJourneyWallet, walletRequests } from './journey-fixtures';
import type { Page } from '@playwright/test';

const SIGNING = ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_signTypedData_v4', 'eth_signTransaction'];
async function proveOwner(page: Page) {
  await page.goto('/app/automations');
  const workspace = page.getByRole('region', { name: 'Automations', exact: true });
  await workspace.getByRole('button', { name: 'Connect wallet and prove ownership', exact: true }).click();
  await chooseWallet(page, 'Browser wallet');
  await expect(workspace.getByRole('heading', { name: 'Create an automation', exact: true })).toBeVisible();
  return workspace;
}
const form = (page: Page) => page.getByRole('form', { name: 'Create an automation', exact: true });

test.describe('BUILD-AUTOMATION-001 Automations (fixture prices, test clock, loopback reads; no transaction)', () => {
  test.beforeAll(() => assertAutomationHarness());

  test('weekly DCA → due by the test clock → one pending proposal → Review in FloFi → the owner’s Simulate and Review; nothing signed', async ({ page, networkGuard }) => {
    test.setTimeout(120_000);
    const owner = createTestWallet(), errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await installJourneyWallet(page, [owner], { chain: '0x14a34' });
    const workspace = await proveOwner(page);

    // 1–3. Create the weekly DCA; it is ACTIVE and asks before every execution.
    const f = form(page);
    await f.getByRole('textbox', { name: 'Name', exact: true }).fill('Weekly ETH');
    await f.getByLabel('Day', { exact: true }).selectOption('1');
    await f.getByLabel('Time', { exact: true }).fill('09:00');
    await f.getByRole('combobox', { name: 'Time zone', exact: true }).fill('Europe/Lisbon');
    await f.getByLabel('Network', { exact: true }).selectOption('base-sepolia');
    await f.getByRole('textbox', { name: 'Amount (USDC)', exact: true }).fill('50');
    await expect(f).toContainText('Execution: Ask me before every execution');
    await f.getByRole('button', { name: 'Create automation', exact: true }).click();
    const card = workspace.getByRole('article', { name: 'Automation Weekly ETH', exact: true });
    await expect(card).toContainText('Active');
    await expect(card).toContainText('Every Monday at 09:00 (Europe/Lisbon)');
    await expect(card).toContainText('Prepare 50 USDC → WETH on Base Sepolia');
    await expect(card).toContainText('Max 50 per execution');
    const rule = await ruleOf(owner.address, 'Weekly ETH');
    expect(rule.state).toBe('ACTIVE');
    expect(await occurrencesOf(rule.rule_id)).toEqual([]);

    // 4. The deterministic test clock makes the slot due; a duplicate scheduler call changes nothing; a wrong bearer gets nothing.
    expect((await dispatch(undefined, 'not-the-scheduler-token-at-all')).status).toBe(401);
    const due = new Date(new Date(rule.next_evaluation_at).getTime() + 30_000);
    expect((await dispatch(due)).status).toBe(200);
    expect((await dispatch(due)).status).toBe(200);
    const [occurrence] = await occurrencesOf(rule.rule_id);
    expect(await occurrencesOf(rule.rule_id)).toEqual([{ occurrence_id: expect.stringMatching(/^occ_/), state: 'PENDING_OWNER', trigger_key: expect.stringMatching(/^slot:\d{4}-\d{2}-\d{2}T09:00$/), handoff_id: null }]);

    // 5. The pending proposal appears for the owner.
    await workspace.getByRole('button', { name: 'Refresh', exact: true }).click();
    const pending = workspace.getByRole('article', { name: 'Proposal from Weekly ETH', exact: true });
    await expect(pending).toContainText('Awaiting you');
    await expect(pending).toContainText('Prepare 50 USDC → WETH on Base Sepolia');
    await expect(pending).toContainText('Nothing is authorized yet.');

    // So far the only wallet signature was the owner's sign-in message (the wallet's log resets with the page).
    const beforeReview = await walletRequests(page);
    expect(beforeReview.filter(m => SIGNING.includes(m))).toEqual([]);
    expect(beforeReview.filter(m => m === 'personal_sign')).toHaveLength(1);

    // 6–7. Review in FloFi enters the shared approval flow.
    await pending.getByRole('button', { name: 'Review in FloFi', exact: true }).click();
    const approval = page.getByRole('region', { name: 'External proposal', exact: true });
    await expect(approval).toContainText('EXTERNAL PROPOSAL · FROM FLOFI AUTOMATIONS');
    expect(new URL(page.url()).pathname).toBe('/approve');
    await expect(approval).toContainText('Nothing is authorized yet.');
    await expect(approval).toContainText('Prepared by your FloFi automation');
    await expect(approval.getByRole('checkbox')).toHaveCount(0);
    expect(page.url()).not.toContain('flofi_auhs_');
    await expect(approval).toContainText(`Signed in as ${owner.address.toLowerCase()}`);
    await approval.getByRole('button', { name: 'Load proposal', exact: true }).click();
    await expect(approval.getByRole('status')).toContainText('Ready for your review.');
    const handoffOf = () => query<{ handoff_id: string; status: string; requester_kind: string }>('SELECT handoff_id, status, requester_kind FROM mcp_handoffs WHERE handoff_id = (SELECT handoff_id FROM automation_occurrences WHERE occurrence_id = $1)',
      [occurrence!.occurrence_id]);
    const applied = (await handoffOf())[0]!;
    expect(applied).toMatchObject({ status: 'APPLIED', requester_kind: 'AUTOMATION_RULE' });

    // A reload keeps the approval link (only MCP's short-lived session link is consumed on apply): the same proven wallet re-opens its
    // own applied proposal idempotently. PR #72's recovery by the public `apr_` reference restores it for that claimant only. Neither
    // creates an approval or an occurrence, changes the handoff or asks the wallet for anything.
    const unchanged = async () => {
      expect(await handoffOf()).toEqual([applied]);
      expect(await query<{ n: number }>('SELECT count(*)::int AS n FROM mcp_handoffs WHERE requester_kind = $1', ['AUTOMATION_RULE'])).toEqual([{ n: 1 }]);
      expect((await occurrencesOf(rule.rule_id)).map(o => o.occurrence_id)).toEqual([occurrence!.occurrence_id]);
    };
    await page.reload();
    await expect(approval.getByLabel('Approval status', { exact: true })).toHaveText('In your FloFi workflow');
    await approval.getByRole('button', { name: 'Load proposal', exact: true }).click();
    await expect(approval.getByRole('status')).toContainText('Ready for your review.');
    await unchanged();
    await page.goto(new URL(`/approve#${applied.handoff_id}`, page.url()).href);
    await page.reload();
    await approval.getByRole('button', { name: 'Load proposal', exact: true }).click();
    await expect(approval).toContainText('Proposal restored for its proven owner.');
    await expect(approval.getByRole('status')).toContainText('Ready for your review.');
    await unchanged();

    // FloFi's own fresh simulation and Strategy Manifest Review: reached, not approved by the test.
    await approval.getByRole('button', { name: 'Continue to simulation', exact: true }).click();
    await page.getByRole('button', { name: 'Simulate workflow', exact: true }).click();
    const summary = page.getByRole('complementary', { name: 'Simulation Summary', exact: true });
    await expect(summary.getByRole('region', { name: 'Expected result' })).toContainText('0.025 WETH');
    const review = page.getByRole('region', { name: 'Review & Authorization', exact: true });
    await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeVisible();

    // 8. No automatic signature: on /approve, Simulate and Review nothing was signed or sent (the session was already proven).
    const requests = await walletRequests(page);
    expect(requests.filter(m => SIGNING.includes(m) || m === 'personal_sign')).toEqual([]);
    // The scheduler marks the occurrence COMPLETED once the proposal is in the owner's workflow.
    expect((await dispatch(due)).status).toBe(200);
    expect((await occurrencesOf(rule.rule_id))[0]!.state).toBe('COMPLETED');
    expect(errors).toEqual([]);
    networkGuard.assertClean();
  });

  test('price trigger fires once on the crossing; BTC purchases show the honest capability blocker', async ({ page, networkGuard }) => {
    test.setTimeout(90_000);
    const owner = createTestWallet();
    await installJourneyWallet(page, [owner], { chain: '0x14a34' });
    const workspace = await proveOwner(page);
    const f = form(page);
    // BTC can be watched, but FloFi has no BTC swap route: nothing is substituted and nothing can be created.
    await f.getByLabel('Asset', { exact: true }).selectOption('BTC');
    await expect(f).toContainText('FloFi has no BTC swap route yet');
    await expect(f.getByRole('button', { name: 'Create automation', exact: true })).toBeDisabled();
    await f.getByLabel('Asset', { exact: true }).selectOption('ETH');

    await f.getByRole('radio', { name: 'Price trigger', exact: true }).check();
    await f.getByRole('textbox', { name: 'Name', exact: true }).fill('ETH dip');
    await f.getByLabel('Condition', { exact: true }).selectOption('PRICE_BELOW');
    await f.getByRole('textbox', { name: 'Threshold (USD)', exact: true }).fill('3000');
    await f.getByRole('combobox', { name: 'Time zone', exact: true }).fill('Europe/Lisbon');
    await f.getByRole('textbox', { name: 'Amount (USDC)', exact: true }).fill('100');
    await f.getByRole('button', { name: 'Create automation', exact: true }).click();
    const card = workspace.getByRole('article', { name: 'Automation ETH dip', exact: true });
    await expect(card).toContainText('If ETH falls below $3,000 · checked every 15 min');
    const rule = await ruleOf(owner.address, 'ETH dip');

    // Above the threshold: armed. Below: one proposal. Still below on later checks: none more.
    await setPrices({ ETH: '3100' });
    let at = new Date(new Date(rule.next_evaluation_at).getTime() + 1_000);
    expect((await dispatch(at)).status).toBe(200);
    for (const price of ['2950', '2900', '2800']) {
      await setPrices({ ETH: price });
      at = new Date(Math.ceil((at.getTime() + 1) / 900_000) * 900_000 + 1_000);
      expect((await dispatch(at)).status).toBe(200);
    }
    expect((await occurrencesOf(rule.rule_id)).map(o => o.trigger_key)).toEqual(['price:1']);
    await workspace.getByRole('button', { name: 'Refresh', exact: true }).click();
    const pending = workspace.getByRole('article', { name: 'Proposal from ETH dip', exact: true });
    await expect(pending).toContainText('If ETH falls below $3,000 — met: ETH $2,950 · fixture · MOCKED');
    await expect(pending).toContainText('Prepare 100 USDC → WETH on Base Sepolia');
    await card.getByRole('button', { name: 'History', exact: true }).click();
    const history = workspace.getByRole('region', { name: 'History of ETH dip', exact: true });
    await expect(history).toContainText('Triggered — proposal created');
    await expect(history).toContainText('Condition still met — no new proposal');
    await expect(history).toContainText('Evaluations and proposals are not transaction evidence.');
    // Dismissing ends it; nothing was signed.
    await pending.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(workspace.getByRole('article', { name: 'Proposal from ETH dip', exact: true })).toHaveCount(0);
    expect((await occurrencesOf(rule.rule_id))[0]!.state).toBe('DISMISSED');
    expect((await walletRequests(page)).filter(m => SIGNING.includes(m))).toEqual([]);
    networkGuard.assertClean();
  });
});
