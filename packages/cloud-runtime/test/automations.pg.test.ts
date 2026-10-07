// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAutomationStore, createPostgresWorkQueue, sweepAutomationWork, type Database } from '../src/index.js';
import { createTestDatabase, type TestDatabase } from './pg-harness.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const HASH = '0x' + '1'.repeat(64);

describe('AUTOMATION-001A PostgreSQL schedules', () => {
  let t: TestDatabase, db: Database;
  beforeAll(async () => { t = await createTestDatabase(); db = t.db; });
  afterAll(async () => { await t.drop(); });

  it('creates owner-scoped rules and fires one event for one exact occurrence', async () => {
    const store = createAutomationStore(db, 'default'), due = new Date('2026-10-07T08:00:00Z');
    const created = await store.create({ ownerAccount: OWNER, spec: { version: 1, marker: 'dca' }, workflowHash: HASH, nextEvaluationAt: due });
    expect((await store.list(OWNER)).map(r => r.automationId)).toContain(created.automationId);
    const first = await store.fire({ automationId: created.automationId, expectedDueAt: due.toISOString(),
      nextDueAt: new Date('2026-10-08T08:00:00Z'), expiresAt: new Date('2026-10-08T08:00:00Z'),
      strategy: { action: 'swap' }, workflowHash: HASH });
    expect(first.fired).toBe(true);
    expect(first.event).toMatchObject({ ownerAccount: OWNER, status: 'PENDING_OWNER', workflowHash: HASH });
    const replay = await store.fire({ automationId: created.automationId, expectedDueAt: due.toISOString(),
      nextDueAt: new Date('2026-10-08T08:00:00Z'), expiresAt: new Date('2026-10-08T08:00:00Z'),
      strategy: { action: 'swap' }, workflowHash: HASH });
    expect(replay).toEqual({ fired: false, event: null });
    const opened = await store.open(OWNER, first.event!.eventId);
    expect(opened?.status).toBe('OPENED');
    expect(await store.dismiss(OWNER, first.event!.eventId)).toBe(true);
    expect((await store.events(OWNER))[0]?.status).toBe('DISMISSED');
  });

  it('sweeps a due rule into the existing durable work queue exactly once', async () => {
    const store = createAutomationStore(db, 'default');
    const created = await store.create({ ownerAccount: OWNER, spec: { version: 1 }, workflowHash: HASH,
      nextEvaluationAt: new Date(Date.now() - 60_000) });
    const first = await sweepAutomationWork(db, 'default'), second = await sweepAutomationWork(db, 'default');
    expect(first.queued).toBeGreaterThanOrEqual(1);
    expect(second.queued).toBe(0);
    const queue = createPostgresWorkQueue({ db, ownerId: 'automation-test', tenantId: 'default' });
    const claimed = await queue.claim(100);
    const item = claimed.find(work => work.kind === 'automation.fire' && work.payload.automationId === created.automationId);
    expect(item).toBeTruthy();
    expect(item?.runId).toBeNull();
  });
});
