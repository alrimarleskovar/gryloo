// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001 on a disposable loopback PostgreSQL: owner isolation and optimistic concurrency of rules; and the scheduler's
 * guarantee — at-least-once infrastructure, at most one logical occurrence per trigger event — under competing evaluators, duplicate
 * scheduler calls, a crash before or after the commit, an expired worker lease, a pause while the evaluation is queued, missed runs,
 * repeated price observations, stale observations, limits, rule expiry and saved-workflow edits.
 */
import { createLogger, createPostgresWorkQueue, type Database } from '@defi-workflow-engine/cloud-runtime';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { editorReducer, initialEditor } from '../domain/editor';
import { validateSavedWorkflow } from '../domain/saved-workflow';
import { createSavedWorkflowStore } from '../server/saved-workflow-store';
import { automationHarness, ethDip, OWNER_A, OWNER_B, weeklyDca, type Harness } from './automation.test-harness.ts';
import { dispatchAutomations } from './dispatch.ts';
import { evaluateRule } from './evaluator.ts';
import { newAutomationId } from './runtime.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
beforeEach(async () => { await t.db.query('TRUNCATE automation_notifications, automation_evaluations, automation_occurrences, automation_rules, automation_link_codes, automation_notification_targets, channel_conversations, work_items, saved_workflows, mcp_handoffs, mcp_rate_limits CASCADE'); });

const silent = createLogger({ service: 'test', sink: () => undefined });
const count = async (sql: string, values: unknown[] = []) => (await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values)).rows[0]!.n;
const occurrences = (ruleId: string) => t.db.query<{ trigger_key: string; state: string; kind: string; spend_amount: string }>(
  'SELECT trigger_key, state, kind, spend_amount::text FROM automation_occurrences WHERE rule_id = $1 ORDER BY created_at', [ruleId]).then(r => r.rows);
const outcomes = (ruleId: string) => t.db.query<{ outcome: string }>('SELECT outcome FROM automation_evaluations WHERE rule_id = $1 ORDER BY evaluation_id', [ruleId])
  .then(r => r.rows.map(row => row.outcome));
const evaluator = (h: Harness, db: Database = t.db) => { const rt = h.rt(db); return { store: rt.store, price: rt.price, log: rt.log, now: rt.now, newId: newAutomationId }; };
const dispatch = (h: Harness, db: Database = t.db, worker = 'w1') => dispatchAutomations(h.rt(db), createPostgresWorkQueue({ db, ownerId: worker, tenantId: 'default' }), silent, worker);
/** A linked chat of `owner` (an ACTIVE channel conversation and its notification target) until `expiresAt`. */
async function linkChat(owner: { namespace: string; address: string }, expiresAt: Date) {
  const conversation = newAutomationId('occ').replace(/^occ_/, 'chc_');
  await t.db.query(`INSERT INTO channel_conversations (tenant_id, conversation_id, channel, business_id, subject_digest) VALUES ('default', $1, 'TELEGRAM', '7000000001', $2)`,
    [conversation, Buffer.alloc(32, owner.address.slice(2, 4))]);
  await t.db.query(`INSERT INTO automation_notification_targets (tenant_id, owner_namespace, owner_account, channel, conversation_id, linked_at, expires_at)
    VALUES ('default', $1, $2, 'TELEGRAM', $3, '2026-10-01T00:00:00Z', $4)`, [owner.namespace, owner.address, conversation, expiresAt]);
}
/** Monday 2026-10-12 09:00 Europe/Lisbon (WEST) = 08:00Z. */
const MONDAY = '2026-10-12T08:00:00Z';

describe('BUILD-AUTOMATION-001 rules: owner isolation and optimistic concurrency', () => {
  it('creates an ACTIVE CONFIRM_EACH_TIME rule bound by value, scheduled at the next local slot', async () => {
    const h = automationHarness(t.db), rule = await h.service().create(OWNER_A, weeklyDca());
    expect(rule).toMatchObject({ state: 'ACTIVE', executionMode: 'CONFIRM_EACH_TIME', kind: 'SCHEDULED_DCA', version: 1, nextEvaluationAt: '2026-10-12T08:00:00.000Z',
      action: { network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50', side: 'BUY', fundsClass: 'TEST_FUNDS' } });
    const row = (await t.db.query('SELECT execution_mode, action_strategy, action_workflow_hash, engine_version FROM automation_rules WHERE rule_id = $1', [rule.ruleId])).rows[0]!;
    expect(row).toMatchObject({ execution_mode: 'CONFIRM_EACH_TIME', engine_version: 'flofi-engine-2', action_workflow_hash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      action_strategy: { version: 1, action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50', slippageBps: 50 } });
    // The database admits no other execution mode.
    await expect(t.db.query(`UPDATE automation_rules SET execution_mode = 'AUTOMATIC' WHERE rule_id = $1`, [rule.ruleId])).rejects.toThrow();
  });

  it('never lets wallet B see or change wallet A’s automation, even with its id', async () => {
    const h = automationHarness(t.db), a = await h.service().create(OWNER_A, weeklyDca());
    expect((await h.service().overview(OWNER_B)).rules).toEqual([]);
    await expect(h.service().history(OWNER_B, a.ruleId)).rejects.toThrow('AUTOMATION_NOT_FOUND');
    await expect(h.service().setState(OWNER_B, a.ruleId, a.version, 'PAUSE')).rejects.toThrow('AUTOMATION_NOT_FOUND');
    await expect(h.service().setState(OWNER_B, a.ruleId, a.version, 'ARCHIVE')).rejects.toThrow('AUTOMATION_NOT_FOUND');
    await expect(h.service().rebind(OWNER_B, a.ruleId, a.version)).rejects.toThrow('AUTOMATION_NOT_FOUND');
    expect((await h.service().overview(OWNER_A)).rules.map(r => r.ruleId)).toEqual([a.ruleId]);
    // The same address in another namespace or tenant is another owner.
    expect(await h.store.getRule({ namespace: 'solana', address: 'So11111111111111111111111111111111111111112' }, a.ruleId)).toBeNull();
  });

  it('pauses, resumes and archives by compare-and-set; a stale version and a concurrent change lose cleanly', async () => {
    const h = automationHarness(t.db), a = await h.service().create(OWNER_A, weeklyDca());
    const paused = await h.service().setState(OWNER_A, a.ruleId, a.version, 'PAUSE');
    expect(paused).toMatchObject({ state: 'PAUSED', version: 2, nextEvaluationAt: null });
    await expect(h.service().setState(OWNER_A, a.ruleId, a.version, 'RESUME')).rejects.toThrow('AUTOMATION_VERSION_CONFLICT');
    const racing = await Promise.allSettled([h.service(t.open(2)).setState(OWNER_A, a.ruleId, 2, 'RESUME'), h.service(t.open(2)).setState(OWNER_A, a.ruleId, 2, 'ARCHIVE')]);
    expect(racing.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(racing.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason.message)).toEqual(['AUTOMATION_VERSION_CONFLICT']);
    const final = await h.store.getRule(OWNER_A, a.ruleId);
    expect(final?.version).toBe(3);
    if (final?.state === 'ACTIVE') await h.service().setState(OWNER_A, a.ruleId, 3, 'ARCHIVE');
    // ARCHIVED is terminal (the database refuses any further change).
    await expect(t.db.query(`UPDATE automation_rules SET state = 'ACTIVE' WHERE rule_id = $1`, [a.ruleId])).rejects.toThrow(/AUTOMATION_RULE_ARCHIVED/);
    expect(await outcomes(a.ruleId)).toEqual(expect.arrayContaining(['AUTOMATION_CREATED', 'AUTOMATION_PAUSED', 'AUTOMATION_ARCHIVED']));
  });

  it('caps the rules of one owner', async () => {
    const h = automationHarness(t.db);
    for (let i = 0; i < 25; i++) await h.service().create(OWNER_A, weeklyDca({ name: `DCA ${i}` }));
    await expect(h.service().create(OWNER_A, weeklyDca())).rejects.toThrow('AUTOMATION_RULE_LIMIT');
    expect((await h.service().create(OWNER_B, weeklyDca())).state).toBe('ACTIVE');
  });

  it('refuses actions FloFi cannot honestly execute, and assets its price source cannot observe', async () => {
    const h = automationHarness(t.db);
    await expect(h.service().create(OWNER_A, weeklyDca({ action: { kind: 'ROUTE', asset: 'BTC', side: 'BUY', network: 'base-sepolia', amount: '50', slippageBps: 50 } })))
      .rejects.toThrow('BTC_EXECUTION_ROUTE_UNAVAILABLE');
    await expect(h.service().create(OWNER_A, weeklyDca({ action: { kind: 'ROUTE', asset: 'ETH', side: 'BUY', network: 'base', amount: '50', slippageBps: 50 } })))
      .rejects.toThrow('OWNER_EXECUTION_NOT_IMPLEMENTED');
    await expect(h.service().create(OWNER_A, weeklyDca({ limits: { ...weeklyDca().limits, maxAmountPerExecution: '49' } }))).rejects.toThrow('LIMIT_AMOUNT_PER_EXECUTION');
    // A Solana route needs a Solana wallet to claim: never offered to (or created for) an EVM owner.
    await expect(h.service().create(OWNER_A, weeklyDca({ action: { kind: 'ROUTE', asset: 'SOL', side: 'BUY', network: 'solana-devnet', amount: '1', slippageBps: 50 } })))
      .rejects.toThrow('AUTOMATION_WALLET_NAMESPACE_MISMATCH');
    expect((await h.service().overview(OWNER_A)).capabilities.routes.find(r => r.network === 'solana-devnet')).toMatchObject({ executable: false,
      reason: 'AUTOMATION_WALLET_NAMESPACE_MISMATCH' });
    expect((await h.service().overview(OWNER_A)).capabilities.routes.find(r => r.network === 'base-sepolia')).toMatchObject({ executable: true, reason: null });
    expect((await h.service().overview(OWNER_A)).capabilities.unavailable).toEqual([{ asset: 'BTC', code: 'BTC_EXECUTION_ROUTE_UNAVAILABLE' }]);
    const btcAlert = await h.service().create(OWNER_A, ethDip({ condition: { type: 'PERCENT_DROP', asset: 'BTC', reference: '100000', percent: '5', checkEveryMinutes: 60 }, action: null }));
    expect(btcAlert).toMatchObject({ kind: 'PRICE_TRIGGER', action: null, condition: { effectiveThreshold: '95000' } });
  });
});

describe('BUILD-AUTOMATION-001 scheduler: at most one occurrence per trigger event', () => {
  it('competing evaluators of a due slot create exactly one occurrence and, for an owner with a linked chat, one notification item', async () => {
    const h = automationHarness(t.db), rule = await h.service().create(OWNER_A, weeklyDca());
    await linkChat(OWNER_A, new Date('2026-12-31T00:00:00Z'));
    h.set('2026-10-12T08:00:30Z');
    const results = await Promise.all(Array.from({ length: 8 }, () => evaluateRule(evaluator(h, t.open(2)), rule.ruleId)));
    expect(results.filter(r => r.kind === 'COMMITTED' && r.occurrence)).toHaveLength(1);
    expect(results.filter(r => r.kind === 'SKIPPED')).toHaveLength(7);
    expect(await occurrences(rule.ruleId)).toEqual([{ trigger_key: 'slot:2026-10-12T09:00', state: 'PENDING_OWNER', kind: 'SCHEDULE', spend_amount: '50.000000000000000000' }]);
    expect(await count(`work_items WHERE kind = 'automation.notify'`)).toBe(1);
    expect((await h.store.ruleById(rule.ruleId))?.nextEvaluationAt?.toISOString()).toBe('2026-10-19T08:00:00.000Z');
  });

  it('queues no chat notification for an owner without a live linked chat (the proposal is in the app either way)', async () => {
    const h = automationHarness(t.db), a = await h.service().create(OWNER_A, weeklyDca()), b = await h.service().create(OWNER_B, weeklyDca());
    await linkChat(OWNER_B, new Date('2026-10-10T00:00:00Z')); // expired before the slot
    h.set('2026-10-12T08:00:30Z');
    for (const rule of [a, b]) expect((await evaluateRule(evaluator(h), rule.ruleId)).kind).toBe('COMMITTED');
    expect((await occurrences(a.ruleId)).map(o => o.state)).toEqual(['PENDING_OWNER']);
    expect((await occurrences(b.ruleId)).map(o => o.state)).toEqual(['PENDING_OWNER']);
    expect(await count(`work_items WHERE kind = 'automation.notify'`)).toBe(0);
  });

  it('duplicate scheduler calls enqueue one evaluation and still produce one occurrence', async () => {
    const h = automationHarness(t.db), rule = await h.service().create(OWNER_A, weeklyDca());
    h.set('2026-10-12T08:01:00Z');
    const enqueued = await Promise.all(Array.from({ length: 5 }, () => h.rt(t.open(2)).store.enqueueDue(h.now(), 100)));
    expect(enqueued.reduce((a, b) => a + b, 0)).toBe(1);
    const passes = await Promise.all([dispatch(h, t.open(3), 'w1'), dispatch(h, t.open(3), 'w2'), dispatch(h, t.open(3), 'w3')]);
    expect(passes.reduce((a, p) => a + p.processed, 0)).toBe(1); // the one evaluation (no chat is linked, so no notification item)
    await dispatch(h);
    expect(await occurrences(rule.ruleId)).toHaveLength(1);
    expect(await count(`work_items WHERE kind = 'automation.evaluate' AND state <> 'DONE'`)).toBe(0);
  });

  it('a crash before the commit changes nothing; a retry after the commit does nothing', async () => {
    const h = automationHarness(t.db), rule = await h.service().create(OWNER_A, weeklyDca());
    h.set('2026-10-12T08:00:10Z');
    await expect(h.store.evaluate(rule.ruleId, h.now(), async () => { throw new Error('WORKER_CRASHED'); })).rejects.toThrow('WORKER_CRASHED');
    expect(await occurrences(rule.ruleId)).toEqual([]);
    expect((await h.store.ruleById(rule.ruleId))?.nextEvaluationAt?.toISOString()).toBe(MONDAY.replace('Z', '.000Z'));
    expect((await evaluateRule(evaluator(h), rule.ruleId)).kind).toBe('COMMITTED');
    // The work item is delivered again (its worker died after the commit): the rule has advanced, nothing happens.
    expect(await evaluateRule(evaluator(h), rule.ruleId)).toEqual({ kind: 'SKIPPED', reason: 'NOT_DUE' });
    expect(await occurrences(rule.ruleId)).toHaveLength(1);
  });

  it('a worker whose lease expired cannot settle; the next worker finishes the item once', async () => {
    const h = automationHarness(t.db), rule = await h.service().create(OWNER_A, weeklyDca());
    h.set('2026-10-12T08:02:00Z');
    await h.store.enqueueDue(h.now(), 10);
    const first = createPostgresWorkQueue({ db: t.db, ownerId: 'dead-worker', tenantId: 'default', leaseMs: 1_000 });
    const [item] = await first.claim(5, ['automation.evaluate']);
    expect(item).toBeDefined();
    await t.db.query(`UPDATE work_items SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [item!.id]);
    expect((await dispatch(h)).processed).toBeGreaterThanOrEqual(1);
    expect(await first.complete(item!)).toBe(false);
    expect(await occurrences(rule.ruleId)).toHaveLength(1);
  });

  it('a worker of another service (kind-scoped claim) never takes automation work', async () => {
    const h = automationHarness(t.db);
    await h.service().create(OWNER_A, weeklyDca());
    h.set('2026-10-12T08:00:20Z');
    expect(await h.store.enqueueDue(h.now(), 10)).toBe(1);
    const railway = createPostgresWorkQueue({ db: t.db, ownerId: 'railway', tenantId: 'default' });
    expect(await railway.claim(10, ['reconcile', 'evidence.archive'])).toEqual([]);
    await expect(railway.claim(10, [])).rejects.toThrow('WORK_CLAIM_KINDS_INVALID');
    expect(await count(`work_items WHERE kind = 'automation.evaluate' AND state = 'READY'`)).toBe(1);
  });

  it('a pause while the evaluation is queued wins: nothing is proposed', async () => {
    const h = automationHarness(t.db), rule = await h.service().create(OWNER_A, weeklyDca());
    h.set('2026-10-12T08:00:05Z');
    expect(await h.store.enqueueDue(h.now(), 10)).toBe(1);
    await h.service().setState(OWNER_A, rule.ruleId, rule.version, 'PAUSE');
    await dispatch(h);
    expect(await occurrences(rule.ruleId)).toEqual([]);
    expect(await count(`work_items WHERE kind = 'automation.evaluate' AND state = 'DONE'`)).toBe(1);
  });

  it('after ten weeks of downtime proposes only the current slot and reports the nine missed ones', async () => {
    const h = automationHarness(t.db), rule = await h.service().create(OWNER_A, weeklyDca());
    h.set('2026-12-14T09:30:00Z'); // Monday 09:30 WET, 30 minutes after that day's slot
    await dispatch(h);
    expect(await occurrences(rule.ruleId)).toMatchObject([{ trigger_key: 'slot:2026-12-14T09:00' }]);
    const missed = (await t.db.query(`SELECT detail FROM automation_evaluations WHERE rule_id = $1 AND outcome = 'MISSED'`, [rule.ruleId])).rows;
    expect(missed).toEqual([{ detail: { count: 9, policy: 'LATEST_WITHIN_GRACE' } }]);
    // Back long after the grace window: nothing at all is proposed for that week.
    const late = await h.service().create(OWNER_A, weeklyDca({ name: 'late' }));
    h.set('2026-12-21T20:00:00Z');
    await dispatch(h);
    expect(await occurrences(late.ruleId)).toEqual([]);
    expect(await outcomes(late.ruleId)).toEqual(['AUTOMATION_CREATED', 'MISSED']);
  });

  it('expires an unanswered proposal at the next slot, so slots never stack', async () => {
    const h = automationHarness(t.db), rule = await h.service().create(OWNER_A, weeklyDca());
    h.set('2026-10-12T08:00:01Z'); await dispatch(h);
    h.set('2026-10-19T08:00:01Z'); await dispatch(h);
    expect((await occurrences(rule.ruleId)).map(o => [o.trigger_key, o.state])).toEqual([['slot:2026-10-12T09:00', 'EXPIRED'], ['slot:2026-10-19T09:00', 'PENDING_OWNER']]);
  });

  it('enforces the per-period count and amount limits when creating occurrences', async () => {
    const h = automationHarness(t.db);
    const daily = await h.service().create(OWNER_A, weeklyDca({ schedule: { frequency: 'DAILY', weekday: null, time: '09:00', timezone: 'Europe/Lisbon' },
      limits: { maxAmountPerExecution: '50', maxAmountPerPeriod: { amount: '100', period: 'WEEK' }, maxOccurrencesPerPeriod: null, cooldownMinutes: 0, maxSlippageBps: null } }));
    for (const day of ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) {
      h.set(`${day}T08:00:05Z`); await dispatch(h);
      // The owner opens each proposal (it then counts even after it expires: its approval may have been used).
      for (const o of (await h.service().overview(OWNER_A)).pending) await h.service().open(OWNER_A, o.occurrenceId);
    }
    // Fri + Sat use the week's 100 USDC; Sunday is refused; Monday starts a new local week.
    expect((await occurrences(daily.ruleId)).map(o => o.trigger_key)).toEqual(['slot:2026-10-09T09:00', 'slot:2026-10-10T09:00', 'slot:2026-10-12T09:00', 'slot:2026-10-13T09:00']);
    expect((await t.db.query(`SELECT detail FROM automation_evaluations WHERE rule_id = $1 AND outcome = 'LIMIT_BLOCKED'`, [daily.ruleId])).rows)
      .toEqual([{ detail: { code: 'LIMIT_PERIOD_AMOUNT' } }]);
  });

  it('an expired automation stops evaluating and its rule becomes EXPIRED', async () => {
    const h = automationHarness(t.db), rule = await h.service().create(OWNER_A, weeklyDca({ expiresAt: '2026-10-11T00:00:00Z' }));
    h.set('2026-10-12T08:00:05Z');
    await dispatch(h);
    expect(await occurrences(rule.ruleId)).toEqual([]);
    expect((await h.store.ruleById(rule.ruleId))?.state).toBe('EXPIRED');
    await expect(h.service().setState(OWNER_A, rule.ruleId, 1, 'RESUME')).rejects.toThrow('AUTOMATION_EXPIRED');
  });
});

describe('BUILD-AUTOMATION-001 price triggers on repeated observations', () => {
  async function priceRule(h: Harness, patch: Record<string, unknown> = {}) {
    h.prices.set('ETH', '3100', h.now());
    return h.service().create(OWNER_A, ethDip(patch));
  }
  const tick = async (h: Harness, price: string | null, minutes = 15) => {
    h.advance(minutes * 60_000);
    if (price === null) h.prices.fail('ETH', 'PRICE_SOURCE_TIMEOUT'); else h.prices.set('ETH', price, h.now());
    await dispatch(h);
  };

  it('fires once per crossing; ten checks below the threshold are not ten proposals; a clear and a new crossing is a new one', async () => {
    const h = automationHarness(t.db), rule = await priceRule(h);
    await dispatch(h);                                     // arms on the first fresh observation ($3,100)
    for (const p of ['2950', '2900', '2800', '2850', '2700', '2950', '2999', '2500', '2600', '2900', '2950']) await tick(h, p);
    expect((await occurrences(rule.ruleId)).map(o => o.trigger_key)).toEqual(['price:1']);
    await tick(h, '3050'); await tick(h, '2990');
    expect((await occurrences(rule.ruleId)).map(o => o.trigger_key)).toEqual(['price:1', 'price:2']);
    // History records state changes only, not every identical check.
    expect(await outcomes(rule.ruleId)).toEqual(['AUTOMATION_CREATED', 'ARMED', 'TRIGGERED', 'CONDITION_STILL_MET', 'REARMED', 'TRIGGERED']);
    const stored = (await t.db.query(`SELECT observation, spend_amount::text AS amount FROM automation_occurrences WHERE rule_id = $1 ORDER BY created_at LIMIT 1`, [rule.ruleId])).rows[0]!;
    expect(stored).toEqual({ observation: { asset: 'ETH', priceUsd: '2950', observedAt: expect.any(String), source: 'FIXTURE', evidence: 'MOCKED' }, amount: '100.000000000000000000' });
  });

  it('ignores failed and stale observations without changing the trigger state', async () => {
    const h = automationHarness(t.db), rule = await priceRule(h);
    await dispatch(h);
    await tick(h, null);
    h.advance(15 * 60_000); h.prices.set('ETH', '2500', new Date(h.now().getTime() - 2 * 3_600_000)); await dispatch(h);   // two hours old
    expect(await occurrences(rule.ruleId)).toEqual([]);
    expect((await h.store.ruleById(rule.ruleId))?.triggerState).toMatchObject({ armed: true, epoch: 1 });
    expect(await outcomes(rule.ruleId)).toEqual(['AUTOMATION_CREATED', 'ARMED', 'PRICE_SOURCE_TIMEOUT', 'PRICE_STALE']);
    await tick(h, '2500');
    expect((await occurrences(rule.ruleId)).map(o => o.trigger_key)).toEqual(['price:1']);
  });

  it('a limit consumes the crossing instead of proposing; the next day proposes again', async () => {
    const h = automationHarness(t.db), rule = await priceRule(h, { limits: { maxAmountPerExecution: '100', maxAmountPerPeriod: null,
      maxOccurrencesPerPeriod: { count: 1, period: 'DAY' }, cooldownMinutes: 0, maxSlippageBps: null } });
    await dispatch(h);
    await tick(h, '2900'); await tick(h, '3100'); await tick(h, '2900');
    expect((await occurrences(rule.ruleId)).map(o => o.trigger_key)).toEqual(['price:1']);
    expect(await outcomes(rule.ruleId)).toContain('LIMIT_BLOCKED');
    h.set('2026-10-09T09:00:00Z'); h.prices.set('ETH', '3100', h.now()); await dispatch(h);
    await tick(h, '2900');
    expect((await occurrences(rule.ruleId)).map(o => o.trigger_key)).toEqual(['price:1', 'price:3']);
  });

  it('resuming after a pause re-arms from a fresh observation instead of firing on a stale arm', async () => {
    const h = automationHarness(t.db), rule = await priceRule(h);
    await dispatch(h);
    const paused = await h.service().setState(OWNER_A, rule.ruleId, rule.version, 'PAUSE');
    await tick(h, '2800');
    await h.service().setState(OWNER_A, rule.ruleId, paused.version, 'RESUME');
    await tick(h, '2800');
    expect(await occurrences(rule.ruleId)).toEqual([]);
    expect(await outcomes(rule.ruleId)).toContain('CONDITION_ALREADY_MET');
  });
});

describe('BUILD-AUTOMATION-001 saved-workflow binding: an edit never changes what an automation proposes', () => {
  const saved = (amount: string) => validateSavedWorkflow(editorReducer(initialEditor(), { type: 'ADD_TESTNET_SWAP', direction: 'USDC_TO_WETH', amount, slippage: '50',
    source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext()).workflow);
  it('flags WORKFLOW_CHANGED, proposes nothing until the owner rebinds, and re-checks the limits on rebind', async () => {
    const h = automationHarness(t.db), workflows = createSavedWorkflowStore(t.db, 'default', OWNER_A);
    const w = saved('50'), doc = await workflows.save({ workflow: w, name: 'Weekly buy', expectedVersion: 0 });
    const rule = await h.service().create(OWNER_A, weeklyDca({ action: { kind: 'SAVED_WORKFLOW', workflowId: w.workflowId } }));
    expect(rule).toMatchObject({ source: { workflowId: w.workflowId, version: 1 }, action: { amount: '50' } });
    // "weekly buy 50" edited to "weekly buy 500" in the saved workflow.
    const edited = { ...saved('500'), workflowId: w.workflowId, revision: w.revision + 1 };
    await workflows.save({ workflow: edited, name: 'Weekly buy', expectedVersion: doc.version });
    h.set('2026-10-12T08:00:05Z'); await dispatch(h);
    expect(await occurrences(rule.ruleId)).toEqual([]);
    expect(await h.store.ruleById(rule.ruleId)).toMatchObject({ attention: 'WORKFLOW_CHANGED', binding: { strategy: { amount: '50' } } });
    // The rebind sees 500 > the 50 USDC limit: refused, binding unchanged.
    await expect(h.service().rebind(OWNER_A, rule.ruleId, rule.version)).rejects.toThrow('LIMIT_AMOUNT_PER_EXECUTION');
    // Back to an amount within the limit: the owner's explicit rebind accepts it.
    const third = await workflows.save({ workflow: { ...saved('40'), workflowId: w.workflowId, revision: w.revision + 2 }, name: 'Weekly buy', expectedVersion: 2 });
    const rebound = await h.service().rebind(OWNER_A, rule.ruleId, rule.version);
    expect(rebound).toMatchObject({ attention: null, version: 2, action: { amount: '40' }, source: { version: third.version } });
    h.set('2026-10-19T08:00:05Z'); await dispatch(h);
    expect(await occurrences(rule.ruleId)).toMatchObject([{ trigger_key: 'slot:2026-10-19T09:00', spend_amount: '40.000000000000000000' }]);
  });
});
