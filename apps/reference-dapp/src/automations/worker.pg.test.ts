// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the Railway worker as the automation scheduler, on a disposable loopback PostgreSQL. It is wired exactly as
 * `backend/main.ts worker` wires it (its own handlers merged with the automation handlers, a claim scoped to those kinds, the
 * automation sweep added to its sweep) and it races the web deployment's protected dispatch on the same rule: one occurrence per
 * trigger event, whoever wins. It needs no automation secret, mints no approval, and without Telegram on its process it leaves chat
 * notifications to a process that can deliver them.
 */
import { createLogger, createPostgresWorkQueue, createWorker, type WorkHandler } from '@defi-workflow-engine/cloud-runtime';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { automationHarness, ethDip, OWNER_A, ORIGIN, weeklyDca, type Harness } from './automation.test-harness.ts';
import { dispatchAutomations } from './dispatch.ts';
import { automationWorkerParts, type AutomationWorkerParts } from './worker.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
beforeEach(async () => { await t.db.query('TRUNCATE automation_notifications, automation_evaluations, automation_occurrences, automation_rules, automation_link_codes, automation_notification_targets, channel_conversations, work_items, mcp_handoffs, mcp_rate_limits CASCADE'); });

const silent = createLogger({ service: 'test', sink: () => undefined });
const WORKER_ENV = { FLOFI_AUTOMATIONS: 'enabled', FLOFI_PUBLIC_ORIGIN: ORIGIN, FLOFI_AUTOMATION_PRICE_SOURCE: 'off' };
const count = async (sql: string, values: unknown[] = []) => (await t.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values)).rows[0]!.n;

function parts(h: Harness, db = t.db): AutomationWorkerParts {
  const p = automationWorkerParts(WORKER_ENV, db, 'default', silent, { now: h.now, price: h.prices.source });
  if ('disabled' in p) throw new Error(p.disabled);
  return p;
}
/** The Railway worker as `main.ts` builds it: a flow handler of its own plus the automation handlers; kind-scoped claim; merged sweep. */
function railway(h: Harness, db = t.db, workerId = 'railway') {
  const automations = parts(h, db), seen: string[] = [];
  const own: Record<string, WorkHandler> = { reconcile: async (item, settle) => { seen.push(item.kind); await settle({ outcome: 'DONE' }); } };
  const handlers = { ...own, ...automations.handlers };
  const tenantQueue = createPostgresWorkQueue({ db, ownerId: workerId, tenantId: 'default' });
  const queue = { ...tenantQueue, claim: (limit: number) => tenantQueue.claim(limit, Object.keys(handlers)) };
  const worker = createWorker({ queue, handlers, logger: silent, workerId, concurrency: 4, sweep: () => automations.sweep() });
  return { automations, seen, async pass() { await automations.sweep(); let total = 0, n: number; do { n = await worker.drainOnce(); total += n; } while (n > 0); return total; } };
}

describe('BUILD-AUTOMATION-001 Railway worker hosting automations', () => {
  it('needs no automation secret and registers evaluation only, without Telegram on its process', () => {
    const h = automationHarness(t.db), p = parts(h);
    expect(Object.keys(p.handlers)).toEqual(['automation.evaluate']);
    expect(p.telegram).toBe(false);
    expect(automationWorkerParts({ ...WORKER_ENV, TENANT_ID: 'other' }, t.db, 'default', silent)).toEqual({ disabled: 'AUTOMATION_TENANT_MISMATCH', reason: null });
    expect(automationWorkerParts({}, t.db, 'default', silent)).toEqual({ disabled: 'AUTOMATIONS_NOT_ENABLED', reason: null });
  });

  it('its sweep is the scheduler heartbeat: a due slot becomes one occurrence, and a second pass changes nothing', async () => {
    const h = automationHarness(t.db), rule = await h.service().create(OWNER_A, weeklyDca());
    const w = railway(h);
    h.set('2026-10-12T07:59:00Z');
    expect(await w.pass()).toBe(0);
    h.set('2026-10-12T08:00:40Z');
    expect(await w.pass()).toBe(1);
    expect(await w.pass()).toBe(0);
    const rows = (await t.db.query('SELECT trigger_key, state, handoff_id FROM automation_occurrences WHERE rule_id = $1', [rule.ruleId])).rows;
    expect(rows).toEqual([{ trigger_key: 'slot:2026-10-12T09:00', state: 'PENDING_OWNER', handoff_id: null }]);
    // The worker never created an approval: proposals reach the shared approval flow only when the owner opens them in FloFi.
    expect(await count('mcp_handoffs')).toBe(0);
    expect(w.seen).toEqual([]);
  });

  it('racing the web deployment’s dispatch on the same rule still yields one occurrence per trigger event', async () => {
    const h = automationHarness(t.db);
    const dca = await h.service().create(OWNER_A, weeklyDca()), dip = await h.service().create(OWNER_A, ethDip());
    // The price trigger arms above the threshold first (edge-triggered), then ETH falls below it at the DCA's slot.
    h.prices.set('ETH', '3100', new Date('2026-10-12T07:45:00Z'));
    h.set('2026-10-12T07:45:30Z');
    await railway(h).pass();
    expect(await count('automation_occurrences')).toBe(0);
    h.prices.set('ETH', '2900', new Date('2026-10-12T08:00:00Z'));
    h.set('2026-10-12T08:00:45Z');
    const web = () => dispatchAutomations(h.rt(t.open(3)), createPostgresWorkQueue({ db: t.open(3), ownerId: 'web', tenantId: 'default' }), silent, 'web');
    await Promise.all([railway(h, t.open(3), 'railway-1').pass(), web(), railway(h, t.open(3), 'railway-2').pass(), web()]);
    await railway(h).pass();
    for (const rule of [dca, dip]) expect(await count('automation_occurrences WHERE rule_id = $1', [rule.ruleId])).toBe(1);
    expect(await count(`work_items WHERE kind = 'automation.evaluate' AND state NOT IN ('DONE')`)).toBe(0);
    expect(await count(`automation_evaluations WHERE outcome = 'DUPLICATE_TRIGGER'`)).toBe(0);
  });

  it('leaves chat notifications unclaimed when Telegram does not run on its process, and never dead-letters them', async () => {
    const h = automationHarness(t.db), rule = await h.service().create(OWNER_A, weeklyDca());
    const conversation = 'chc_' + 'b'.repeat(26);
    await t.db.query(`INSERT INTO channel_conversations (tenant_id, conversation_id, channel, business_id, subject_digest) VALUES ('default', $1, 'TELEGRAM', '7000000001', $2)`,
      [conversation, Buffer.alloc(32, 7)]);
    await t.db.query(`INSERT INTO automation_notification_targets (tenant_id, owner_namespace, owner_account, channel, conversation_id, linked_at, expires_at)
      VALUES ('default', $1, $2, 'TELEGRAM', $3, '2026-10-01T00:00:00Z', '2026-12-31T00:00:00Z')`, [OWNER_A.namespace, OWNER_A.address, conversation]);
    h.set('2026-10-12T08:00:50Z');
    await railway(h).pass();
    expect(await count('automation_occurrences WHERE rule_id = $1', [rule.ruleId])).toBe(1);
    expect((await t.db.query(`SELECT state FROM work_items WHERE kind = 'automation.notify'`)).rows).toEqual([{ state: 'READY' }]);
  });
});
