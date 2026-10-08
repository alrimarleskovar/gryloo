// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertSchemaCurrent, ensureTenant, loadMigrations, migrate, SHIPPED_MIGRATIONS } from '@defi-workflow-engine/cloud-runtime';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from '../domain/editor';
import { editorHistoryReducer, initialEditorHistory } from '../domain/editor-history';
import { savedWorkflowHash, validateSavedWorkflow, type WorkflowOwner } from '../domain/saved-workflow';
import { createSavedWorkflowStore } from './saved-workflow-store';
let t: TestDatabase;
const owner: WorkflowOwner = { namespace: 'eip155', address: '0x' + 'a'.repeat(40) };
const other: WorkflowOwner = { namespace: 'eip155', address: '0x' + 'b'.repeat(40) };
const solana: WorkflowOwner = { namespace: 'solana', address: 'So11111111111111111111111111111111111111112' };
const workflow = (amount = '2') => validateSavedWorkflow(editorReducer(initialEditor(), { type: 'ADD_TESTNET_SWAP', direction: 'USDC_TO_WETH', amount, slippage: '50', source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext()).workflow);
const store = (who = owner, tenant = 'default') => createSavedWorkflowStore(t.db, tenant, who);
beforeAll(async () => { t = await createTestDatabase(); await ensureTenant(t.db, 'other-tenant'); });
afterAll(async () => t?.drop());
beforeEach(async () => { await t.db.query('TRUNCATE saved_workflows, execution_runs, execution_logs, workflows CASCADE'); });
describe('durable saved-workflow documents and compare-and-swap', () => {
  it('creates a canonical document and reopens/restores its exact semantic workflow', async () => {
    const w = workflow(), saved = await store().save({ workflow: w, name: '  My workflow  ', expectedVersion: 0 });
    expect(saved).toMatchObject({ workflow: w, name: 'My workflow', version: 1, revision: w.revision });
    const reopened = await store().get(w.workflowId); expect(reopened).toEqual(saved);
    const restored = editorHistoryReducer(initialEditorHistory(), { type: 'RESTORE_WORKFLOW', workflow: reopened!.workflow });
    expect(restored.editor.workflow).toEqual(w); expect(restored.past).toEqual([]);
    expect(restored).not.toHaveProperty('authorization');
  });
  it('isolates ownership, tenant and EVM/Solana namespace', async () => {
    const w = workflow(); await store().save({ workflow: w, name: 'EVM', expectedVersion: 0 });
    expect(await store(other).get(w.workflowId)).toBeNull(); expect((await store(other).list()).items).toEqual([]);
    expect(await store(owner, 'other-tenant').get(w.workflowId)).toBeNull(); expect(await store(solana).get(w.workflowId)).toBeNull();
    await store(solana).save({ workflow: w, name: 'Solana', expectedVersion: 0 });
    expect((await store(solana).get(w.workflowId))?.name).toBe('Solana'); expect((await store().get(w.workflowId))?.name).toBe('EVM');
  });
  it('increments versions and rejects stale writes without overwriting committed data', async () => {
    const w = workflow(); await store().save({ workflow: w, name: 'First', expectedVersion: 0 });
    const updated = await store().save({ workflow: w, name: 'Second', expectedVersion: 1 }); expect(updated.version).toBe(2);
    await expect(store().save({ workflow: w, name: 'Stale', expectedVersion: 1 })).rejects.toThrow('WORKFLOW_VERSION_CONFLICT');
    expect((await store().get(w.workflowId))?.name).toBe('Second');
  });
  it('requires a fresh semantic revision for changed content', async () => {
    const w = workflow(); await store().save({ workflow: w, name: 'First', expectedVersion: 0 });
    await expect(store().save({ workflow: workflow('3'), name: 'Changed', expectedVersion: 1 })).rejects.toThrow('WORKFLOW_REVISION_CONFLICT');
    const next = { ...workflow('3'), revision: w.revision + 1 };
    expect((await store().save({ workflow: next, name: 'Changed', expectedVersion: 1 })).revision).toBe(next.revision);
  });
  it('allows exactly one concurrent stale-version writer on independent database sessions', async () => {
    const w = workflow(); await store().save({ workflow: w, name: 'First', expectedVersion: 0 });
    const a = createSavedWorkflowStore(t.open(), 'default', owner), b = createSavedWorkflowStore(t.open(), 'default', owner);
    const results = await Promise.allSettled([a.save({ workflow: w, name: 'A', expectedVersion: 1 }), b.save({ workflow: w, name: 'B', expectedVersion: 1 })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(r => r.status === 'rejected'); expect(failed?.status === 'rejected' && failed.reason.message).toBe('WORKFLOW_VERSION_CONFLICT');
    expect((await store().get(w.workflowId))?.version).toBe(2);
  });
  it('allows exactly one concurrent create', async () => {
    const w = workflow(), input = { workflow: w, name: 'New', expectedVersion: 0 };
    const results = await Promise.allSettled([store().save(input), store().save(input)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  });
  it('persists after the saving session closes and another session reopens', async () => {
    const w = workflow(), session = t.open(); await createSavedWorkflowStore(session, 'default', owner).save({ workflow: w, name: 'Durable', expectedVersion: 0 }); await session.close();
    expect((await createSavedWorkflowStore(t.open(), 'default', owner).get(w.workflowId))?.workflow).toEqual(w);
  });
  it('rejects corrupt stored hashes and invalid names without trusting the document', async () => {
    const w = workflow();
    for (const name of ['', 'bad\nname', 'x'.repeat(81)]) await expect(store().save({ workflow: w, name, expectedVersion: 0 })).rejects.toThrow('WORKFLOW_INVALID');
    await store().save({ workflow: w, name: 'Good', expectedVersion: 0 });
    await t.db.query('UPDATE saved_workflows SET workflow_hash=$1', ['0x' + '0'.repeat(64)]);
    await expect(store().get(w.workflowId)).rejects.toThrow('WORKFLOW_STORE_CORRUPT');
    expect(savedWorkflowHash(w)).not.toBe('0x' + '0'.repeat(64));
  });
  it('groups saved documents and owned executed history by workflow without exposing another owner', async () => {
    const w = workflow(); await store().save({ workflow: w, name: 'Saved name', expectedVersion: 0 });
    async function run(id: string, workflowId: string, who = owner.address) {
      await t.db.query('INSERT INTO workflows (tenant_id,workflow_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', ['default', workflowId]);
      await t.db.query(`INSERT INTO execution_logs (tenant_id,namespace,name,kind,version,segment_count,byte_length,content_sha256) VALUES ('default','aave-supply',$1,'RUN',1,1,1,repeat('0',64))`, [id + '.jsonl']);
      await t.db.query(`INSERT INTO execution_runs (tenant_id,run_id,namespace,log_name,workflow_id,flow,status,provenance,owner_account,needs_observation,has_evidence,log_version) VALUES ('default',$1,'aave-supply',$2,$3,'aave-supply','RECONCILED','PUBLIC_TESTNET',$4,false,true,1)`, [id, id + '.jsonl', workflowId, who]);
    }
    await run('one', w.workflowId); await run('two', w.workflowId); await run('history', 'executed-only'); await run('other', 'other-workflow', other.address);
    const list = await store().list();
    expect(list.items).toHaveLength(2);
    expect(list.items.find(item => item.workflowId === w.workflowId)).toMatchObject({ name: 'Saved name', saved: true, runCount: 2, hasEvidence: true });
    expect(list.items.find(item => item.workflowId === 'executed-only')).toMatchObject({ saved: false, version: null, runCount: 1, lastRunId: 'history' });
    expect(list.items.some(item => item.workflowId === 'other-workflow')).toBe(false);
  });
});
describe('migration 0008 upgrade', () => {
  it('upgrades schema 0007 once, preserves existing schema, and enforces saved-document constraints', async () => {
    const fresh = await createTestDatabase({ migrated: false });
    try {
      const all = await loadMigrations(); await migrate(fresh.db, all.slice(0, 7));
      expect((await fresh.db.query(`SELECT to_regclass('saved_workflows') AS saved`)).rows[0]?.saved).toBeNull();
      expect(await migrate(fresh.db, all)).toEqual([8]); expect(await migrate(fresh.db, all)).toEqual([]);
      expect(await assertSchemaCurrent(fresh.db, SHIPPED_MIGRATIONS)).toBe(8);
      const w = workflow(); await createSavedWorkflowStore(fresh.db, 'default', owner).save({ workflow: w, name: 'Migrated', expectedVersion: 0 });
      await expect(fresh.db.query('UPDATE saved_workflows SET version=0')).rejects.toMatchObject({ code: '23514' });
      await expect(fresh.db.query(`UPDATE saved_workflows SET owner_namespace='unknown'`)).rejects.toMatchObject({ code: '23514' });
      expect((await fresh.db.query(`SELECT count(*)::int AS n FROM tenants WHERE tenant_id='default'`)).rows[0]?.n).toBe(1);
    } finally { await fresh.drop(); }
  });
});
