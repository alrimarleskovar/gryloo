// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: an occurrence enters FloFi's ONE approval model and nothing else. On a disposable loopback PostgreSQL with the
 * real shared platform (handoff store, claim/apply on the /approve surface) and an engine runtime with no execution path:
 *
 *   due schedule → occurrence → the owner opens it → AUTOMATION_RULE handoff (authority NONE, secret only in the URL, digest stored)
 *   → claim by the owner's proven wallet only (wallet B refused) → the re-composed command is FloFi's own authoring command → applied
 *   in the owner's workflow (exact hash) → the scheduler marks the occurrence COMPLETED.
 *
 * Plus: pause, expiry, dismissal, a stale approval, a saved-workflow edit after the occurrence, and another owner guessing ids.
 */
import { createLogger, createPostgresWorkQueue } from '@defi-workflow-engine/cloud-runtime';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { composeStrategy } from '../engine/strategy-engine';
import { applyApproval, claimApproval, PlatformRefusal, resumeApproval, viewApproval, type WalletRef } from '../platform/index.ts';
import { automationHarness, OWNER_A, OWNER_B, weeklyDca, type Harness } from './automation.test-harness.ts';
import { dispatchAutomations } from './dispatch.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
beforeEach(async () => { await t.db.query('TRUNCATE automation_notifications, automation_evaluations, automation_occurrences, automation_rules, work_items, saved_workflows, mcp_handoffs, mcp_rate_limits CASCADE'); });

const silent = createLogger({ service: 'test', sink: () => undefined });
const dispatch = (h: Harness) => dispatchAutomations(h.rt(), createPostgresWorkQueue({ db: t.db, ownerId: 'w', tenantId: 'default' }), silent, 'w');
const wallet = (owner: typeof OWNER_A): WalletRef => ({ namespace: owner.namespace, address: owner.address });
const secretOf = (url: string) => decodeURIComponent(new URL(url).hash.slice(1));
const refusal = async (work: Promise<unknown>) => { try { await work; return 'NO_REFUSAL'; } catch (e) { return e instanceof PlatformRefusal || e instanceof Error ? e.message : String(e); } };
const counts = () => t.db.query<{ handoffs: number; occurrences: number }>(`SELECT (SELECT count(*)::int FROM mcp_handoffs) AS handoffs,
  (SELECT count(*)::int FROM automation_occurrences) AS occurrences`).then(r => r.rows[0]!);
/** A weekly DCA with a pending occurrence (Monday 2026-10-12 09:00 Europe/Lisbon). */
async function pending(h: Harness) {
  const rule = await h.service().create(OWNER_A, weeklyDca());
  h.set('2026-10-12T08:00:30Z');
  await dispatch(h);
  const [occurrence] = (await h.service().overview(OWNER_A)).pending;
  return { rule, occurrence: occurrence! };
}

describe('BUILD-AUTOMATION-001 occurrence → shared approval → the owner’s existing flow', () => {
  it('hands the owner a handoff with no authority; only the owner’s wallet claims it; applying it completes the occurrence', async () => {
    const h = automationHarness(t.db), { rule, occurrence } = await pending(h);
    expect(occurrence).toMatchObject({ state: 'PENDING_OWNER', kind: 'SCHEDULE', action: { amount: '50', inputAsset: 'USDC', outputAsset: 'WETH', network: 'base-sepolia' } });
    const opened = await h.service().open(OWNER_A, occurrence.occurrenceId);
    expect(opened.approvalUrl).toMatch(/^http:\/\/127\.0\.0\.1:3999\/approve#flofi_auhs_[A-Za-z0-9_-]{43}$/);
    const row = (await t.db.query(`SELECT requester_kind, requester_id, requester_context, client_name, status, secret_digest FROM mcp_handoffs`)).rows[0]!;
    expect(row).toMatchObject({ requester_kind: 'AUTOMATION_RULE', requester_id: rule.ruleId, client_name: 'FloFi Automations', status: 'PENDING',
      requester_context: { owner: { namespace: 'eip155', address: OWNER_A.address }, occurrenceId: occurrence.occurrenceId } });
    // Only the keyed digest of the secret is stored.
    expect(JSON.stringify(row)).not.toContain(secretOf(opened.approvalUrl).slice(11));
    expect((await h.service().overview(OWNER_A)).pending[0]).toMatchObject({ state: 'APPROVAL_CREATED', approval: { status: 'PENDING' } });

    const surface = h.surface(), secret = secretOf(opened.approvalUrl);
    const view = await viewApproval(surface, secret, [], h.now());
    expect(view).toMatchObject({ requesterKind: 'AUTOMATION_RULE', clientName: 'FloFi Automations', authorized: false, authority: 'NONE', status: 'PENDING' });
    // Wallet B, even proven, cannot claim A's automation proposal; nor can an unproven browser.
    expect(await refusal(claimApproval(surface, secret, [wallet(OWNER_B)], false, h.now()))).toBe('AUTOMATION_OWNER_MISMATCH');
    expect(await refusal(claimApproval(surface, secret, [], false, h.now()))).toBe('EVM_WALLET_PROOF_REQUIRED');
    const claimed = await claimApproval(surface, secret, [wallet(OWNER_A)], false, h.now());
    // The re-composed proposal is exactly FloFi's own authoring command for "50 USDC → WETH on Base Sepolia": the owner's flow follows.
    expect(claimed.command).toMatchObject({ type: 'ADD_TESTNET_SWAP', direction: 'USDC_TO_WETH', amount: '50', slippage: '50' });
    const canonical = composeStrategy({ action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50', slippageBps: 50 });
    if (!canonical.ok) throw new Error(canonical.code);
    expect(claimed.workflowHash).toBe(canonical.workflowHash);
    // An edited workflow is not this proposal; the exact one is.
    expect(await refusal(applyApproval(surface, secret, [wallet(OWNER_A)], { ...canonical.workflow, revision: 99 }, h.now()))).toBe('HANDOFF_WORKFLOW_MISMATCH');
    expect((await applyApproval(surface, secret, [wallet(OWNER_A)], canonical.workflow, h.now())).status).toBe('APPLIED');
    await dispatch(h);
    const final = (await h.service().history(OWNER_A, rule.ruleId));
    expect(final.occurrences[0]).toMatchObject({ state: 'COMPLETED', outcome: 'APPROVAL_APPLIED', approval: { status: 'APPLIED', runs: [] } });
    expect(final.entries.map(e => e.outcome)).toEqual(expect.arrayContaining(['TRIGGERED', 'APPROVAL_REQUESTED', 'APPROVAL_APPLIED']));
  });

  it('PR #72 recovery: an applied automation proposal is restored only for the owner who claimed it, re-verified, with nothing reissued', async () => {
    const h = automationHarness(t.db), { occurrence } = await pending(h);
    const secret = secretOf((await h.service().open(OWNER_A, occurrence.occurrenceId)).approvalUrl), surface = h.surface();
    const { approvalId } = await viewApproval(surface, secret, [], h.now());
    await claimApproval(surface, secret, [wallet(OWNER_A)], false, h.now());
    // Recovery is for an APPLIED proposal only: a claimed one is not recoverable by id, so the claim stays the only way in.
    expect(await refusal(resumeApproval(surface, approvalId, [wallet(OWNER_A)]))).toBe('HANDOFF_NOT_FOUND');
    const canonical = composeStrategy({ action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50', slippageBps: 50 });
    if (!canonical.ok) throw new Error(canonical.code);
    await applyApproval(surface, secret, [wallet(OWNER_A)], canonical.workflow, h.now());
    const before = await counts();
    const restored = await resumeApproval(surface, approvalId, [wallet(OWNER_A)]);
    expect(restored).toMatchObject({ workflowHash: canonical.workflowHash, view: { requesterKind: 'AUTOMATION_RULE', status: 'APPLIED', authorized: false, authority: 'NONE' } });
    expect(restored.workflow).toMatchObject({ workflowId: restored.workflowId });
    // Wallet B (even proven), no wallet, or a malformed id: nothing.
    expect(await refusal(resumeApproval(surface, approvalId, [wallet(OWNER_B)]))).toBe('HANDOFF_NOT_FOUND');
    expect(await refusal(resumeApproval(surface, approvalId, []))).toBe('HANDOFF_NOT_FOUND');
    expect(await refusal(resumeApproval(surface, secret, [wallet(OWNER_A)]))).toBe('HANDOFF_NOT_FOUND');
    // No second approval, no second occurrence, no status change: the owner's own simulation, Review and signature still follow.
    expect(await counts()).toEqual(before);
    expect((await t.db.query('SELECT status FROM mcp_handoffs WHERE handoff_id = $1', [approvalId])).rows[0]).toEqual({ status: 'APPLIED' });
  });

  it('refuses a claim while the automation is paused, and lets it through once resumed', async () => {
    const h = automationHarness(t.db), { rule, occurrence } = await pending(h);
    const opened = await h.service().open(OWNER_A, occurrence.occurrenceId), secret = secretOf(opened.approvalUrl);
    const paused = await h.service().setState(OWNER_A, rule.ruleId, rule.version, 'PAUSE');
    expect(await refusal(claimApproval(h.surface(), secret, [wallet(OWNER_A)], false, h.now()))).toBe('AUTOMATION_PAUSED');
    expect(await refusal(h.service().open(OWNER_A, occurrence.occurrenceId))).toBe('AUTOMATION_PAUSED');
    await h.service().setState(OWNER_A, rule.ruleId, paused.version, 'RESUME');
    expect((await claimApproval(h.surface(), secret, [wallet(OWNER_A)], false, h.now())).view.status).toBe('CLAIMED');
  });

  it('a lapsed approval is replaced by reopening; the old link stops working', async () => {
    const h = automationHarness(t.db), { occurrence } = await pending(h);
    const first = await h.service().open(OWNER_A, occurrence.occurrenceId);
    h.advance(16 * 60_000);
    expect(await refusal(claimApproval(h.surface(), secretOf(first.approvalUrl), [wallet(OWNER_A)], false, h.now()))).toBe('HANDOFF_EXPIRED');
    const second = await h.service().open(OWNER_A, occurrence.occurrenceId);
    expect(second.approvalUrl).not.toBe(first.approvalUrl);
    // Reopening while a live approval exists withdraws it.
    const third = await h.service().open(OWNER_A, occurrence.occurrenceId);
    expect(await refusal(claimApproval(h.surface(), secretOf(second.approvalUrl), [wallet(OWNER_A)], false, h.now()))).toBe('HANDOFF_REVOKED');
    expect((await claimApproval(h.surface(), secretOf(third.approvalUrl), [wallet(OWNER_A)], false, h.now())).view.status).toBe('CLAIMED');
    expect((await t.db.query(`SELECT status FROM mcp_handoffs ORDER BY created_at`)).rows.map(r => r.status)).toEqual(['EXPIRED', 'REVOKED', 'CLAIMED']);
  });

  const canonicalSwap = () => {
    const canonical = composeStrategy({ action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50', slippageBps: 50 });
    if (!canonical.ok) throw new Error(canonical.code);
    return canonical;
  };
  const applyOccurrence = async (h: Harness, occurrenceId: string) => {
    const secret = secretOf((await h.service().open(OWNER_A, occurrenceId)).approvalUrl);
    await claimApproval(h.surface(), secret, [wallet(OWNER_A)], false, h.now());
    expect((await applyApproval(h.surface(), secret, [wallet(OWNER_A)], canonicalSwap().workflow, h.now())).status).toBe('APPLIED');
  };
  const stateOf = async (occurrenceId: string) => (await t.db.query(`SELECT state, outcome FROM automation_occurrences WHERE occurrence_id = $1`, [occurrenceId])).rows[0];

  it('one occurrence yields at most one applied proposal: reopening after Add to my workflow completes it instead', async () => {
    const h = automationHarness(t.db), { occurrence } = await pending(h);
    // Applied, and before the scheduler syncs it a stale page asks for another review: no second handoff, the occurrence is completed.
    await applyOccurrence(h, occurrence.occurrenceId);
    expect(await refusal(h.service().open(OWNER_A, occurrence.occurrenceId))).toBe('AUTOMATION_OCCURRENCE_COMPLETED');
    expect(await stateOf(occurrence.occurrenceId)).toEqual({ state: 'COMPLETED', outcome: 'APPROVAL_APPLIED' });
    expect(await refusal(h.service().dismiss(OWNER_A, occurrence.occurrenceId))).toBe('AUTOMATION_OCCURRENCE_COMPLETED');
    expect((await t.db.query(`SELECT status FROM mcp_handoffs ORDER BY created_at`)).rows.map(r => r.status)).toEqual(['APPLIED']);
  });

  it('dismissing a proposal already added to the workflow completes it instead, so it keeps counting against the limits', async () => {
    const h = automationHarness(t.db), { occurrence } = await pending(h);
    await applyOccurrence(h, occurrence.occurrenceId);
    expect(await refusal(h.service().dismiss(OWNER_A, occurrence.occurrenceId))).toBe('AUTOMATION_OCCURRENCE_COMPLETED');
    expect(await stateOf(occurrence.occurrenceId)).toEqual({ state: 'COMPLETED', outcome: 'APPROVAL_APPLIED' });
    expect((await t.db.query(`SELECT status FROM mcp_handoffs ORDER BY created_at`)).rows.map(r => r.status)).toEqual(['APPLIED']);
  });

  it('reopening a claimed review withdraws it before the new one exists: the old one can no longer be applied', async () => {
    const h = automationHarness(t.db), { occurrence } = await pending(h), canonical = canonicalSwap();
    const first = secretOf((await h.service().open(OWNER_A, occurrence.occurrenceId)).approvalUrl);
    expect((await claimApproval(h.surface(), first, [wallet(OWNER_A)], false, h.now())).view.status).toBe('CLAIMED');
    const second = secretOf((await h.service().open(OWNER_A, occurrence.occurrenceId)).approvalUrl);
    expect(await refusal(applyApproval(h.surface(), first, [wallet(OWNER_A)], canonical.workflow, h.now()))).toBe('HANDOFF_REVOKED');
    await claimApproval(h.surface(), second, [wallet(OWNER_A)], false, h.now());
    expect((await applyApproval(h.surface(), second, [wallet(OWNER_A)], canonical.workflow, h.now())).status).toBe('APPLIED');
    expect((await t.db.query(`SELECT status FROM mcp_handoffs ORDER BY created_at`)).rows.map(r => r.status)).toEqual(['REVOKED', 'APPLIED']);
  });

  it('a review opened while the owner dismisses never leaves a live approval on a dismissed occurrence', async () => {
    for (let round = 0; round < 6; round++) {
      await t.db.query('TRUNCATE automation_evaluations, automation_occurrences, automation_rules, work_items, mcp_handoffs, mcp_rate_limits CASCADE');
      const h = automationHarness(t.db), { occurrence } = await pending(h);
      await h.service().open(OWNER_A, occurrence.occurrenceId);
      const results = await Promise.all([refusal(h.service(t.open(2)).open(OWNER_A, occurrence.occurrenceId)), refusal(h.service(t.open(2)).dismiss(OWNER_A, occurrence.occurrenceId))]);
      const o = (await t.db.query(`SELECT state, handoff_id FROM automation_occurrences WHERE occurrence_id = $1`, [occurrence.occurrenceId])).rows[0]!;
      const live = (await t.db.query(`SELECT handoff_id FROM mcp_handoffs WHERE status IN ('PENDING', 'CLAIMED')`)).rows.map(r => r.handoff_id);
      if (o.state === 'DISMISSED') expect([results, live]).toEqual([[expect.any(String), 'NO_REFUSAL'], []]);
      else expect([o.state, results[1], live]).toEqual(['APPROVAL_CREATED', 'AUTOMATION_OCCURRENCE_CHANGED', [o.handoff_id]]);
    }
  });

  it('a dismissed or expired occurrence cannot be opened or claimed', async () => {
    const h = automationHarness(t.db), { occurrence } = await pending(h);
    const opened = await h.service().open(OWNER_A, occurrence.occurrenceId);
    expect((await h.service().dismiss(OWNER_A, occurrence.occurrenceId)).state).toBe('DISMISSED');
    expect(await refusal(claimApproval(h.surface(), secretOf(opened.approvalUrl), [wallet(OWNER_A)], false, h.now()))).toBe('HANDOFF_REVOKED');
    expect(await refusal(h.service().open(OWNER_A, occurrence.occurrenceId))).toBe('AUTOMATION_OCCURRENCE_DISMISSED');
    // The next week's proposal expires unanswered after 24 hours; an approval opened just before that cannot be claimed after it.
    h.set('2026-10-19T08:00:30Z'); await dispatch(h);
    const next = (await h.service().overview(OWNER_A)).pending[0]!;
    expect(next.expiresAt).toBe('2026-10-20T08:00:00.000Z');
    h.set('2026-10-20T07:55:00Z');
    const live = await h.service().open(OWNER_A, next.occurrenceId);
    h.set('2026-10-20T08:00:30Z'); await dispatch(h);
    expect(await refusal(h.service().open(OWNER_A, next.occurrenceId))).toBe('AUTOMATION_OCCURRENCE_EXPIRED');
    expect(await refusal(claimApproval(h.surface(), secretOf(live.approvalUrl), [wallet(OWNER_A)], false, h.now()))).toBe('AUTOMATION_OCCURRENCE_NOT_OPEN');
  });

  it('another owner can neither open nor dismiss an occurrence by guessing its id', async () => {
    const h = automationHarness(t.db), { occurrence } = await pending(h);
    expect(await refusal(h.service().open(OWNER_B, occurrence.occurrenceId))).toBe('AUTOMATION_OCCURRENCE_NOT_FOUND');
    expect(await refusal(h.service().dismiss(OWNER_B, occurrence.occurrenceId))).toBe('AUTOMATION_OCCURRENCE_NOT_FOUND');
    expect((await h.service().overview(OWNER_B)).pending).toEqual([]);
    expect((await h.service().overview(OWNER_A)).pending[0]!.state).toBe('PENDING_OWNER');
  });

  it('a watch report never becomes an automated proposal: Buy prepares the owner’s own authoring command', async () => {
    const h = automationHarness(t.db);
    h.prices.set('ETH', '2950.5', h.now()); h.prices.set('BTC', '100000', h.now()); h.prices.set('SOL', '150', h.now());
    await h.service().create(OWNER_A, { version: 1, kind: 'DAILY_WATCH', name: 'Morning round', schedule: { frequency: 'DAILY', weekday: null, time: '09:00',
      timezone: 'Europe/Lisbon' }, watch: { assets: ['BTC', 'ETH', 'SOL'] }, expiresAt: null });
    h.set('2026-10-09T08:00:30Z'); h.prices.set('ETH', '3010', h.now()); h.prices.set('BTC', '100000', h.now()); h.prices.fail('SOL', 'PRICE_SOURCE_TIMEOUT');
    await dispatch(h);
    const report = (await h.service().overview(OWNER_A)).pending[0]!;
    expect(report).toMatchObject({ kind: 'WATCH', action: null, observations: [{ asset: 'BTC', priceUsd: '100000' }, { asset: 'ETH', priceUsd: '3010', previousPriceUsd: null },
      { asset: 'SOL', code: 'PRICE_SOURCE_TIMEOUT' }] });
    expect(await refusal(h.service().open(OWNER_A, report.occurrenceId))).toBe('AUTOMATION_OCCURRENCE_HAS_NO_ACTION');
    expect(await refusal(h.service().prepareWatchAction(OWNER_A, report.occurrenceId, { asset: 'BTC', side: 'BUY', network: 'base-sepolia', amount: '10', slippageBps: 50 })))
      .toBe('BTC_EXECUTION_ROUTE_UNAVAILABLE');
    const prepared = await h.service().prepareWatchAction(OWNER_A, report.occurrenceId, { asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '10', slippageBps: 50 });
    expect(prepared.command).toMatchObject({ type: 'ADD_TESTNET_SWAP', direction: 'USDC_TO_WETH', amount: '10' });
    expect((await h.service().overview(OWNER_A)).pending).toEqual([]);
    expect(await t.db.query(`SELECT count(*)::int AS n FROM mcp_handoffs`).then(r => r.rows[0]!.n)).toBe(0);
  });
});
