// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the Developer Platform's persistence (migration 0007) on a disposable loopback PostgreSQL. Keys authenticate
 * only while they and their project are ACTIVE and only by keyed digest; strategies are immutable; the database itself binds every
 * DEVELOPER_PROJECT approval handoff to an immutable strategy of the same project with the same workflow hash (and leaves MCP and
 * channel handoffs alone); events are deduplicated and fanned out only to the project's own subscribed endpoints; deliveries are
 * leased and settled by their lease holder only; every read is scoped to the project, environment and tenant.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { ensureTenant } from '@defi-workflow-engine/cloud-runtime';
import { composeStrategy } from '../engine/strategy-engine';
import { ENGINE_VERSION, type ExecutionPlan } from '../mcp/execution.ts';
import { newId } from '../mcp/oauth/crypto.ts';
import { createPgHandoffStore, typedId, type HandoffStore, type NewHandoff } from '../platform/index.ts';
import { createProject, developerRequesterRef, disableProject, issueSandboxKey, listDeliveries, listKeys, revokeKey, type AdminDeps } from './admin.ts';
import { developerKey } from './config.ts';
import { apiKeyDigest } from './keys.ts';
import { createPgDeveloperStore } from './pg-store.ts';
import type { DeveloperStore, ProjectScope } from './store.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); await ensureTenant(t.db, 'other'); });
afterAll(async () => { await t?.drop(); });

const KEYS = { apiKey: developerKey('k'.repeat(40), 'api-key'), handoff: developerKey('k'.repeat(40), 'handoff'), webhook: developerKey('k'.repeat(40), 'webhook') };
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const composed = (strategy: unknown) => { const c = composeStrategy(strategy); if (!c.ok) throw new Error(c.code); return c; };
const PLAN: ExecutionPlan = { kind: 'SINGLE_FLOW', flow: 'crosschain-router-testnet', reason: null, steps: [], networks: ['base-sepolia', 'arbitrum-sepolia'],
  networkEnvironment: 'PUBLIC_TESTNET', fundsClass: 'TEST_FUNDS' } as unknown as ExecutionPlan;
const at = (iso: string) => new Date(iso);
const deps = (tenant = 'default', now = () => new Date()): AdminDeps & { store: DeveloperStore; handoffs: HandoffStore } =>
  ({ store: createPgDeveloperStore(t.db, tenant), handoffs: createPgHandoffStore(t.db, tenant), config: { keys: KEYS }, now });
async function project(name = 'Acme Wallet', tenant = 'default') {
  const d = deps(tenant), { projectId } = await createProject(d, name), scope: ProjectScope = { projectId, environment: 'sandbox' };
  return { d, projectId, scope };
}
async function strategyFor(store: DeveloperStore, scope: ProjectScope, strategy: unknown = BRIDGE) {
  const c = composed(strategy);
  return store.createStrategy({ strategyId: typedId('str'), projectId: scope.projectId, environment: scope.environment, strategy: c.strategy, workflowHash: c.workflowHash,
    engineVersion: ENGINE_VERSION, fundsClass: 'TEST_FUNDS', networkEnvironment: 'PUBLIC_TESTNET', plan: PLAN }, new Date());
}
const developerHandoff = (scope: ProjectScope, strategyId: string, workflowHash: string, name = 'Acme Wallet'): NewHandoff => ({ handoffId: newId('apr'),
  requester: { kind: 'DEVELOPER_PROJECT', ref: developerRequesterRef(scope.projectId, scope.environment) }, grantId: null, requesterContext: { strategyId },
  clientId: scope.projectId, clientName: name, secretDigest: randomBytes(32), strategy: composed(BRIDGE).strategy, workflowHash, engineVersion: ENGINE_VERSION,
  networkEnvironment: 'PUBLIC_TESTNET', fundsClass: 'TEST_FUNDS', plan: PLAN, expiresAt: new Date(Date.now() + 900_000) });
const RULES = { maxPending: 100, supersedeSameWorkflow: false };

describe('BUILD-DEVELOPER-001 developer store: projects and keys', () => {
  it('authenticates an ACTIVE key of an ACTIVE project by digest only; revoked, disabled and foreign keys are indistinguishable', async () => {
    const { d, projectId } = await project();
    const issued = await issueSandboxKey(d, projectId);
    expect(issued).toMatchObject({ environment: 'sandbox', scopes: ['strategies', 'approvals', 'executions', 'webhooks'] });
    const digest = apiKeyDigest({ keys: KEYS }, issued.key);
    expect(await d.store.authenticate(digest, new Date())).toEqual({ projectId, projectName: 'Acme Wallet', environment: 'sandbox', keyId: issued.keyId,
      scopes: ['strategies', 'approvals', 'executions', 'webhooks'], plan: 'free' });
    // Only the digest is stored: the key text appears nowhere in the database.
    const dump = JSON.stringify((await t.db.query('SELECT * FROM developer_api_keys')).rows);
    expect(dump).not.toContain(issued.key.slice(14));
    // Another tenant never sees this project's key, and a key digested under another secret is unknown.
    expect(await deps('other').store.authenticate(digest, new Date())).toBeNull();
    expect(await d.store.authenticate(apiKeyDigest({ keys: { ...KEYS, apiKey: developerKey('z'.repeat(40), 'api-key') } }, issued.key), new Date())).toBeNull();

    const narrow = await issueSandboxKey(d, projectId, ['strategies', 'strategies']);
    expect(narrow.scopes).toEqual(['strategies']);
    await expect(issueSandboxKey(d, projectId, [])).rejects.toThrow('SCOPES_INVALID');
    await expect(issueSandboxKey(d, projectId, ['execute' as never])).rejects.toThrow('SCOPES_INVALID');
    expect(await revokeKey(d, issued.keyId)).toEqual({ revoked: true });
    expect(await revokeKey(d, issued.keyId)).toEqual({ revoked: false });
    expect(await d.store.authenticate(digest, new Date())).toBeNull();
    expect(await d.store.authenticate(apiKeyDigest({ keys: KEYS }, narrow.key), new Date())).toMatchObject({ scopes: ['strategies'] });
    const listed = await listKeys(d, projectId);
    expect(listed.map(k => k.status).sort()).toEqual(['ACTIVE', 'REVOKED']);
    expect(JSON.stringify(listed)).not.toContain('flofi_sk_');

    const { revokedApprovals } = await disableProject(d, projectId);
    expect(revokedApprovals).toBe(0);
    expect(await d.store.authenticate(apiKeyDigest({ keys: KEYS }, narrow.key), new Date())).toBeNull();
    await expect(issueSandboxKey(d, projectId)).rejects.toThrow('PROJECT_NOT_ACTIVE');
    await expect(createProject(d, ' padded')).rejects.toThrow('PROJECT_NAME_INVALID');
  });

  it('records last use at most once a minute (an operator signal, never an access rule)', async () => {
    const { d, projectId } = await project();
    const issued = await issueSandboxKey(d, projectId), digest = apiKeyDigest({ keys: KEYS }, issued.key);
    const lastUsed = async () => (await t.db.query<{ last_used_at: Date | null }>('SELECT last_used_at FROM developer_api_keys WHERE key_id = $1', [issued.keyId])).rows[0]!.last_used_at;
    await d.store.authenticate(digest, at('2026-10-07T10:00:00Z'));
    expect(await lastUsed()).toEqual(at('2026-10-07T10:00:00Z'));
    await d.store.authenticate(digest, at('2026-10-07T10:00:30Z'));
    expect(await lastUsed()).toEqual(at('2026-10-07T10:00:00Z'));
    await d.store.authenticate(digest, at('2026-10-07T10:01:01Z'));
    expect(await lastUsed()).toEqual(at('2026-10-07T10:01:01Z'));
  });

  it('refuses impossible rows at the database', async () => {
    const { projectId } = await project();
    await expect(t.db.query(`INSERT INTO developer_api_keys (tenant_id, key_id, project_id, environment, key_digest, hint, scopes) VALUES ('default', $1, $2, 'sandbox', $3,
      'abcd', ARRAY['execute'])`, [typedId('key'), projectId, randomBytes(32)])).rejects.toThrow(/check constraint/);
    await expect(t.db.query(`INSERT INTO developer_api_keys (tenant_id, key_id, project_id, environment, key_digest, hint, scopes) VALUES ('default', $1, $2, 'sandbox', $3,
      'abcd', ARRAY['strategies'])`, [typedId('key'), projectId, randomBytes(16)])).rejects.toThrow(/check constraint/);
    await expect(t.db.query(`INSERT INTO developer_projects (tenant_id, project_id, display_name) VALUES ('default', $1, 'bad\nname')`, [typedId('prj')])).rejects.toThrow(/check constraint/);
  });
});

describe('BUILD-DEVELOPER-001 developer store: immutable strategies and approval binding', () => {
  it('stores strategies immutably, scoped to their project and environment; sandbox strategies are test funds only', async () => {
    const a = await project('A'), b = await project('B');
    const s = await strategyFor(a.d.store, a.scope);
    expect(await a.d.store.strategy(a.scope, s.strategyId)).toMatchObject({ strategyId: s.strategyId, workflowHash: s.workflowHash, strategy: s.strategy, plan: PLAN });
    expect(await b.d.store.strategy(b.scope, s.strategyId)).toBeNull();
    expect(await a.d.store.strategy({ ...a.scope, environment: 'production' }, s.strategyId)).toBeNull();
    expect(await deps('other').store.strategy(a.scope, s.strategyId)).toBeNull();
    for (const set of [`strategy = '{"action":"bridge"}'`, `workflow_hash = '0x${'0'.repeat(64)}'`, `created_at = now()`, `project_id = '${b.projectId}'`])
      await expect(t.db.query(`UPDATE developer_strategies SET ${set} WHERE strategy_id = $1`, [s.strategyId])).rejects.toThrow('DEVELOPER_STRATEGY_IMMUTABLE');
    await expect(a.d.store.createStrategy({ ...s, strategyId: typedId('str'), fundsClass: 'REAL_FUNDS' }, new Date())).rejects.toThrow(/check constraint/);
  });

  it('binds a DEVELOPER_PROJECT handoff to the exact hash of an immutable strategy of the same project, in the database', async () => {
    const a = await project('A'), b = await project('B');
    const s = await strategyFor(a.d.store, a.scope), other = await strategyFor(b.d.store, b.scope);
    const handoff = developerHandoff(a.scope, s.strategyId, s.workflowHash);
    expect(await a.d.handoffs.create(handoff, new Date(), RULES)).toEqual({ ok: true });
    const binding = (await t.db.query('SELECT * FROM developer_approvals WHERE handoff_id = $1', [handoff.handoffId])).rows[0];
    expect(binding).toMatchObject({ tenant_id: 'default', project_id: a.projectId, environment: 'sandbox', strategy_id: s.strategyId, workflow_hash: s.workflowHash, sync_state: 'OPEN' });

    // Another project's strategy, another hash, another environment or no strategy at all: the handoff cannot exist.
    for (const bad of [developerHandoff(a.scope, other.strategyId, other.workflowHash), developerHandoff(a.scope, s.strategyId, '0x' + 'f'.repeat(64)),
      developerHandoff({ ...a.scope, environment: 'production' }, s.strategyId, s.workflowHash), { ...developerHandoff(a.scope, s.strategyId, s.workflowHash), requesterContext: {} }])
      await expect(a.d.handoffs.create(bad, new Date(), RULES)).rejects.toThrow('DEVELOPER_APPROVAL_UNBOUND');
    expect((await t.db.query(`SELECT count(*)::int AS n FROM mcp_handoffs WHERE requester_kind = 'DEVELOPER_PROJECT' AND requester_ref LIKE $1`, [`${a.projectId}.%`])).rows[0]!.n).toBe(1);

    // The binding never changes (only its event-sync bookkeeping does); the handoff's requester and hash are immutable since 0006.
    for (const set of [`project_id = '${b.projectId}'`, `strategy_id = '${other.strategyId}'`, `workflow_hash = '0x${'f'.repeat(64)}'`])
      await expect(t.db.query(`UPDATE developer_approvals SET ${set} WHERE handoff_id = $1`, [handoff.handoffId])).rejects.toThrow('DEVELOPER_APPROVAL_IMMUTABLE');
    await a.d.store.markSynced(handoff.handoffId, false, new Date());
    await expect(t.db.query(`UPDATE mcp_handoffs SET requester_context = '{"strategyId":"${other.strategyId}"}' WHERE handoff_id = $1`, [handoff.handoffId])).rejects.toThrow('MCP_HANDOFF_IMMUTABLE');
    // A bound strategy cannot be purged from under its approval.
    await expect(t.db.query('DELETE FROM developer_strategies WHERE strategy_id = $1', [s.strategyId])).rejects.toThrow(/foreign key/);
  });

  it('leaves MCP-account and channel-conversation handoffs untouched', async () => {
    const d = deps(), base = developerHandoff({ projectId: typedId('prj'), environment: 'sandbox' }, 'str_none', '0x' + '3'.repeat(64));
    const channel: NewHandoff = { ...base, handoffId: newId('apr'), secretDigest: randomBytes(32), requester: { kind: 'CHANNEL_CONVERSATION', ref: 'telegram:conv-1' },
      requesterContext: { intendedWallet: 'x' },
      clientId: 'telegram-bot-1', clientName: 'Channel bot' };
    expect(await d.handoffs.create(channel, new Date(), RULES)).toEqual({ ok: true });
    const account = newId('mcpacct'), grant = newId('grt');
    await t.db.query(`INSERT INTO mcp_accounts (tenant_id, account_id) VALUES ('default', $1)`, [account]);
    await t.db.query(`INSERT INTO mcp_oauth_grants (tenant_id, grant_id, account_id, client_id, client_name, scopes, resource) VALUES ('default', $1, $2,
      'https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude', ARRAY['flofi.strategy', 'flofi.approval'], 'https://flofi.test/api/mcp')`, [grant, account]);
    const mcp: NewHandoff = { ...base, handoffId: newId('apr'), secretDigest: randomBytes(32), requester: { kind: 'MCP_ACCOUNT', ref: account }, grantId: grant, requesterContext: {},
      clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata', clientName: 'Claude' };
    expect(await d.handoffs.create(mcp, new Date(), { maxPending: 5, supersedeSameWorkflow: true })).toEqual({ ok: true });
    expect((await t.db.query('SELECT count(*)::int AS n FROM developer_approvals WHERE handoff_id = ANY($1)', [[channel.handoffId, mcp.handoffId]])).rows[0]!.n).toBe(0);
    expect((await d.handoffs.forRequester(channel.handoffId, channel.requester, new Date()))?.requesterContext).toEqual({ intendedWallet: 'x' });
  });

  it('disabling a project revokes its open approvals; applied ones stay the owners\' own', async () => {
    const a = await project('A'), s = await strategyFor(a.d.store, a.scope);
    const open = developerHandoff(a.scope, s.strategyId, s.workflowHash), applied = developerHandoff(a.scope, s.strategyId, s.workflowHash);
    for (const h of [open, applied]) await a.d.handoffs.create(h, new Date(), RULES);
    const wallet = { namespace: 'eip155' as const, address: '0x' + '4'.repeat(40) };
    await a.d.handoffs.claim(applied.secretDigest, wallet, new Date(), 600, () => ({ ok: true, share: true }));
    await a.d.handoffs.apply(applied.secretDigest, wallet, new Date());
    expect(await disableProject(a.d, a.projectId)).toEqual({ disabled: true, revokedApprovals: 1 });
    const statuses = (await t.db.query('SELECT handoff_id, status FROM mcp_handoffs WHERE handoff_id = ANY($1)', [[open.handoffId, applied.handoffId]])).rows;
    expect(Object.fromEntries(statuses.map(r => [r.handoff_id, r.status]))).toEqual({ [open.handoffId]: 'REVOKED', [applied.handoffId]: 'APPLIED' });
  });

  it('finds the approval of a run only when the owner applied it and shares it, for this project only', async () => {
    const a = await project('A'), b = await project('B'), s = await strategyFor(a.d.store, a.scope);
    const h = developerHandoff(a.scope, s.strategyId, s.workflowHash), wallet = { namespace: 'eip155' as const, address: '0x' + '5'.repeat(40) };
    await a.d.handoffs.create(h, new Date(), RULES);
    await a.d.handoffs.claim(h.secretDigest, wallet, new Date(), 600, () => ({ ok: true, share: false }));
    await a.d.handoffs.apply(h.secretDigest, wallet, new Date());
    await a.d.handoffs.bindRuns(h.handoffId, ['run-1']);
    expect(await a.d.store.approvalForRun(a.scope, 'run-1')).toBeNull();
    await a.d.handoffs.setSharing(h.secretDigest, wallet, true, new Date());
    expect(await a.d.store.approvalForRun(a.scope, 'run-1')).toBe(h.handoffId);
    expect(await a.d.store.approvalForRun(a.scope, 'run-2')).toBeNull();
    expect(await b.d.store.approvalForRun(b.scope, 'run-1')).toBeNull();
    expect(await a.d.store.approvalForRun({ ...a.scope, environment: 'production' }, 'run-1')).toBeNull();
  });
});

describe('BUILD-DEVELOPER-001 developer store: events, endpoints and deliveries', () => {
  it('caps endpoints per project and scopes deletion to the project', async () => {
    const a = await project('A'), b = await project('B');
    const made = [];
    for (let i = 0; i < 3; i++) made.push(await a.d.store.createEndpoint(a.scope, `https://hooks.example/${i}`, [], 3, new Date()));
    expect(made.every(e => e?.status === 'ACTIVE')).toBe(true);
    expect(await a.d.store.createEndpoint(a.scope, 'https://hooks.example/4', [], 3, new Date())).toBeNull();
    expect(await b.d.store.deleteEndpoint(b.scope, made[0]!.endpointId, new Date())).toBe(false);
    expect(await a.d.store.deleteEndpoint(a.scope, made[0]!.endpointId, new Date())).toBe(true);
    expect(await a.d.store.deleteEndpoint(a.scope, made[0]!.endpointId, new Date())).toBe(false);
    expect(await a.d.store.createEndpoint(a.scope, 'https://hooks.example/4', [], 3, new Date())).not.toBeNull();
    await expect(t.db.query(`INSERT INTO developer_webhook_endpoints (tenant_id, endpoint_id, project_id, environment, url) VALUES ('default', $1, $2, 'sandbox',
      'http://hooks.example/x')`, [typedId('whe'), a.projectId])).rejects.toThrow(/check constraint/);
  });

  it('deduplicates events, fans out to subscribed ACTIVE endpoints of the same project only, and leases deliveries to one holder', async () => {
    const a = await project('A'), b = await project('B');
    const all = (await a.d.store.createEndpoint(a.scope, 'https://hooks.example/all', [], 5, new Date()))!;
    const claimedOnly = (await a.d.store.createEndpoint(a.scope, 'https://hooks.example/claimed', ['approval.claimed'], 5, new Date()))!;
    const gone = (await a.d.store.createEndpoint(a.scope, 'https://hooks.example/gone', [], 5, new Date()))!;
    await a.d.store.deleteEndpoint(a.scope, gone.endpointId, new Date());
    const foreign = (await b.d.store.createEndpoint(b.scope, 'https://hooks.example/b', [], 5, new Date()))!;
    const events = [{ type: 'approval.claimed' as const, dedupeKey: 'approval.claimed:apr_1', approvalId: 'apr_1', data: { approvalId: 'apr_1' } },
      { type: 'approval.applied' as const, dedupeKey: 'approval.applied:apr_1', approvalId: 'apr_1', data: { approvalId: 'apr_1' } }];
    const now = at('2026-10-07T12:00:00Z');
    const recorded = await a.d.store.recordEvents(a.scope, events, now);
    expect(recorded.map(e => e.type)).toEqual(['approval.claimed', 'approval.applied']);
    expect(recorded.every(e => /^evt_[a-z2-7]{26}$/.test(e.eventId))).toBe(true);
    expect(await a.d.store.recordEvents(a.scope, events, now)).toEqual([]);
    const rows = (await t.db.query('SELECT endpoint_id, event_id FROM developer_webhook_deliveries WHERE project_id = $1', [a.projectId])).rows;
    expect(rows.filter(r => r.endpoint_id === all.endpointId)).toHaveLength(2);
    expect(rows.filter(r => r.endpoint_id === claimedOnly.endpointId)).toHaveLength(1);
    expect(rows.filter(r => r.endpoint_id === gone.endpointId || r.endpoint_id === foreign.endpointId)).toHaveLength(0);

    // Claims: one lease per delivery; others see nothing until it lapses; only the lease holder settles.
    expect(await b.d.store.claimDeliveries({ scope: b.scope }, 10, now, 60_000)).toEqual([]);
    const first = await a.d.store.claimDeliveries({ scope: a.scope }, 10, now, 60_000);
    expect(first).toHaveLength(3);
    expect(first.every(c => c.attempts === 1 && c.endpointActive && c.url.startsWith('https://hooks.example/'))).toBe(true);
    expect(await a.d.store.claimDeliveries({}, 10, now, 60_000)).toEqual([]);
    const one = first.find(c => c.endpointId === all.endpointId)!, two = first.find(c => c.endpointId === claimedOnly.endpointId)!;
    const third = first.find(c => c !== one && c !== two)!;
    expect(await a.d.store.settleDelivery(one.deliveryId, 'f'.repeat(32), { status: 'SUCCEEDED', lastStatus: 200, lastError: null, nextAttemptAt: null }, now)).toBe(false);
    expect(await a.d.store.settleDelivery(one.deliveryId, one.leaseToken, { status: 'SUCCEEDED', lastStatus: 200, lastError: null, nextAttemptAt: null }, now)).toBe(true);
    expect(await a.d.store.settleDelivery(one.deliveryId, one.leaseToken, { status: 'DEAD', lastStatus: 500, lastError: 'X_ERROR', nextAttemptAt: null }, now)).toBe(false);
    const retryAt = at('2026-10-07T12:00:30Z');
    expect(await a.d.store.settleDelivery(two.deliveryId, two.leaseToken, { status: 'PENDING', lastStatus: 500, lastError: 'HTTP_STATUS', nextAttemptAt: retryAt }, now)).toBe(true);
    expect(await a.d.store.claimDeliveries({ scope: a.scope }, 10, at('2026-10-07T12:00:10Z'), 60_000)).toEqual([]);
    // The third lease lapses without settlement (a crashed dispatcher): it is claimed again, as a new attempt.
    const later = await a.d.store.claimDeliveries({ scope: a.scope }, 10, at('2026-10-07T12:01:01Z'), 60_000);
    expect(later.map(c => `${c.deliveryId}:${c.attempts}`).sort()).toEqual([`${third.deliveryId}:2`, `${two.deliveryId}:2`].sort());

    // Deleting an endpoint ends its pending deliveries, leased or not; the lease holder can no longer settle them.
    await a.d.store.deleteEndpoint(a.scope, all.endpointId, at('2026-10-07T12:02:00Z'));
    const relet = later.find(c => c.deliveryId === third.deliveryId)!;
    expect(await a.d.store.settleDelivery(relet.deliveryId, relet.leaseToken, { status: 'SUCCEEDED', lastStatus: 200, lastError: null, nextAttemptAt: null }, now)).toBe(false);
    const after = await listDeliveries(a.d, a.projectId);
    expect(after.filter(d => d.endpointId === all.endpointId).map(d => d.status).sort()).toEqual(['DEAD', 'SUCCEEDED']);
    expect(after.find(d => d.endpointId === all.endpointId && d.status === 'DEAD')?.lastError).toBe('ENDPOINT_DELETED');
    expect(JSON.stringify(after)).not.toContain('hooks.example');
  });

  it('claims OPEN approval bindings least recently synced first, and stops at DONE', async () => {
    const a = await project('A'), s = await strategyFor(a.d.store, a.scope);
    const hs = [developerHandoff(a.scope, s.strategyId, s.workflowHash), developerHandoff(a.scope, s.strategyId, s.workflowHash)];
    for (const h of hs) await a.d.handoffs.create(h, new Date(), RULES);
    const first = await a.d.store.approvalsToSync({ scope: a.scope }, 1, at('2026-10-07T13:00:00Z'));
    expect(first).toHaveLength(1);
    const second = await a.d.store.approvalsToSync({ scope: a.scope }, 1, at('2026-10-07T13:00:01Z'));
    expect(second[0]!.handoffId).not.toBe(first[0]!.handoffId);
    await a.d.store.markSynced(first[0]!.handoffId, true, at('2026-10-07T13:00:02Z'));
    const rest = await a.d.store.approvalsToSync({ scope: a.scope }, 10, at('2026-10-07T13:00:03Z'));
    expect(rest.map(r => r.handoffId)).toEqual([second[0]!.handoffId]);
    expect(await a.d.store.approvalsToSync({ handoffId: first[0]!.handoffId }, 10, new Date())).toEqual([]);
    expect(await deps('other').store.approvalsToSync({}, 10, new Date())).toEqual([]);
  });

  it('meters usage per day and purges old events and unreferenced strategies', async () => {
    const a = await project('A');
    await a.d.store.incrementUsage(a.scope, 'strategy.create', '', at('2026-10-07T01:00:00Z'));
    await a.d.store.incrementUsage(a.scope, 'strategy.create', '', at('2026-10-07T23:00:00Z'));
    await a.d.store.incrementUsage(a.scope, 'simulation.run', 'base-sepolia', at('2026-10-08T00:00:00Z'), 3);
    expect(await a.d.store.usage(a.scope, '2026-10-07', '2026-10-08')).toEqual([{ day: '2026-10-07', metric: 'strategy.create', dimension: '', count: 2 },
      { day: '2026-10-08', metric: 'simulation.run', dimension: 'base-sepolia', count: 3 }]);

    const old = await strategyFor(a.d.store, a.scope), kept = await strategyFor(a.d.store, a.scope);
    await a.d.handoffs.create(developerHandoff(a.scope, kept.strategyId, kept.workflowHash), new Date(), RULES);
    await t.db.query(`ALTER TABLE developer_strategies DISABLE TRIGGER developer_strategies_immutable`);
    await t.db.query(`UPDATE developer_strategies SET created_at = now() - interval '100 days' WHERE strategy_id = ANY($1)`, [[old.strategyId, kept.strategyId]]);
    await t.db.query(`ALTER TABLE developer_strategies ENABLE TRIGGER developer_strategies_immutable`);
    const endpoint = (await a.d.store.createEndpoint(a.scope, 'https://hooks.example/p', [], 5, new Date()))!;
    await a.d.store.recordEvents(a.scope, [{ type: 'approval.ended', dedupeKey: 'approval.ended:apr_old', approvalId: 'apr_old', data: {} }], new Date(Date.now() - 31 * 86_400_000));
    await a.d.store.purge(new Date());
    expect(await a.d.store.strategy(a.scope, old.strategyId)).toBeNull();
    expect(await a.d.store.strategy(a.scope, kept.strategyId)).not.toBeNull();
    expect((await t.db.query('SELECT count(*)::int AS n FROM developer_webhook_deliveries WHERE endpoint_id = $1', [endpoint.endpointId])).rows[0]!.n).toBe(0);
  });
});
