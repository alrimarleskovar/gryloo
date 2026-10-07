// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: one approval-handoff model for every requester kind, on a disposable loopback PostgreSQL (migration 0006). An
 * MCP account, a developer project and a channel conversation are stored in the same table with the same state machine; each is
 * isolated by (kind, ref) in every requester-scoped operation and by the resolving scheme's kinds in every secret lookup; caps and
 * supersession follow each requester's rules; the database itself enforces the requester model and immutability; and no approval
 * secret is ever written in plaintext. Since migration 0007 the database also binds every DEVELOPER_PROJECT handoff to an immutable
 * strategy of its project (`src/developer/store.pg.test.ts`); this test's store writes that strategy before creating such a handoff.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import { composeStrategy } from '../engine/strategy-engine';
import { newId } from '../mcp/oauth/crypto.ts';
import { approvalLinkScheme, createPgHandoffStore, ENGINE_VERSION, executionPlan, mintApprovalSecret, typedId, type ApprovalLinkScheme, type HandoffCreateRules,
  type HandoffStore, type NewHandoff, type RequesterScope, type WalletRef } from './index.ts';

let t: TestDatabase;
const ACCOUNT = newId('mcpacct'), GRANT = newId('grt'), PROJECT_ID = typedId('prj'), CAPS_ID = typedId('prj');
beforeAll(async () => {
  t = await createTestDatabase();
  await t.db.query(`INSERT INTO tenants (tenant_id) VALUES ('other')`);
  await t.db.query(`INSERT INTO mcp_accounts (tenant_id, account_id) VALUES ('default', $1)`, [ACCOUNT]);
  await t.db.query(`INSERT INTO mcp_oauth_grants (tenant_id, grant_id, account_id, client_id, client_name, scopes, resource) VALUES ('default', $1, $2,
    'https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude', ARRAY['flofi.strategy'], 'https://flofi.test/api/mcp')`, [GRANT, ACCOUNT]);
  for (const project of [PROJECT_ID, CAPS_ID]) await t.db.query(`INSERT INTO developer_projects (tenant_id, project_id, display_name) VALUES ('default', $1, 'Example')`, [project]);
});
afterAll(async () => { await t?.drop(); });

/** The developer strategy a DEVELOPER_PROJECT handoff names (migration 0007 refuses an unbound one). */
async function bindStrategy(tenant: string, h: NewHandoff) {
  if (h.requester.kind !== 'DEVELOPER_PROJECT') return;
  const [project, environment] = h.requester.ref.split('.');
  await t.db.query(`INSERT INTO developer_strategies (tenant_id, strategy_id, project_id, environment, strategy, workflow_hash, engine_version, funds_class, network_environment,
    plan) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`, [tenant, h.requesterContext.strategyId, project, environment, JSON.stringify(h.strategy),
    h.workflowHash, h.engineVersion, h.fundsClass, h.networkEnvironment, JSON.stringify(h.plan)]);
}
const store = (tenant = 'default'): HandoffStore => {
  const s = createPgHandoffStore(t.db, tenant);
  return { ...s, create: async (h, now, rules) => { await bindStrategy(tenant, h); return s.create(h, now, rules); } };
};
const schemes: Record<RequesterScope['kind'], ApprovalLinkScheme> = { MCP_ACCOUNT: approvalLinkScheme('flofi_hs_', randomBytes(32), ['MCP_ACCOUNT']),
  DEVELOPER_PROJECT: approvalLinkScheme('flofi_dhs_', randomBytes(32), ['DEVELOPER_PROJECT']),
  CHANNEL_CONVERSATION: approvalLinkScheme('flofi_chs_', randomBytes(32), ['CHANNEL_CONVERSATION']) };
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const OPEN: HandoffCreateRules = { maxPending: 10, supersedeSameWorkflow: false };
const evm = (n: number): WalletRef => ({ namespace: 'eip155', address: '0x' + String(n).repeat(40).slice(0, 40) });
/** A handoff for `requester` (an MCP one carries the test account's grant); returns the secret too, for leak checks. */
function handoff(requester: RequesterScope, strategy: Record<string, unknown> = BRIDGE, context: Record<string, unknown> = {}) {
  const c = composeStrategy(strategy);
  if (!c.ok) throw new Error(c.code);
  const { secret, digest } = mintApprovalSecret(schemes[requester.kind]), mcp = requester.kind === 'MCP_ACCOUNT';
  const own = requester.kind === 'DEVELOPER_PROJECT' ? { strategyId: typedId('str'), ...context } : context;
  const value: NewHandoff = { handoffId: newId('apr'), requester, grantId: mcp ? GRANT : null, requesterContext: mcp ? {} : own, clientId: mcp ? 'https://claude.ai/oauth/x'
    : `${requester.kind.toLowerCase()}:client`, clientName: mcp ? 'Claude' : 'Example', secretDigest: digest, strategy: c.strategy, workflowHash: c.workflowHash,
  engineVersion: ENGINE_VERSION, networkEnvironment: 'PUBLIC_TESTNET', fundsClass: 'TEST_FUNDS', plan: executionPlan(c), expiresAt: new Date(Date.now() + 15 * 60_000) };
  return { value, secret, digest };
}
const MCP: RequesterScope = { kind: 'MCP_ACCOUNT', ref: ACCOUNT }, PROJECT: RequesterScope = { kind: 'DEVELOPER_PROJECT', ref: `${PROJECT_ID}.sandbox` };
const CONVERSATION: RequesterScope = { kind: 'CHANNEL_CONVERSATION', ref: 'chc_example' };

describe('BUILD-DEVELOPER-001 generic approval-handoff persistence', () => {
  it('stores every requester kind in one model: MCP keeps its account and grant, the others carry only their own identity', async () => {
    const created = [MCP, PROJECT, CONVERSATION].map(r => ({ r, h: handoff(r, { ...BRIDGE, amount: '1.1' }, r.kind === 'CHANNEL_CONVERSATION' ? { intendedWallet: evm(1) } : {}) }));
    for (const { h } of created) expect(await store().create(h.value, new Date(), OPEN)).toEqual({ ok: true });
    const rows = (await t.db.query(`SELECT handoff_id, requester_kind, requester_id, requester_ref, requester_context, account_id, grant_id FROM mcp_handoffs
      WHERE handoff_id = ANY($1) ORDER BY requester_kind`, [created.map(c => c.h.value.handoffId)])).rows;
    expect(rows.map(r => [r.requester_kind, r.requester_id, r.requester_ref, r.requester_context, r.account_id, r.grant_id])).toEqual([
      ['CHANNEL_CONVERSATION', 'chc_example', 'chc_example', { intendedWallet: evm(1) }, null, null],
      ['DEVELOPER_PROJECT', PROJECT.ref, PROJECT.ref, { strategyId: expect.stringMatching(/^str_[a-z2-7]{26}$/) }, null, null],
      ['MCP_ACCOUNT', null, ACCOUNT, {}, ACCOUNT, GRANT]]);
    for (const { r, h } of created) {
      const found = await store().forRequester(h.value.handoffId, r, new Date());
      expect(found).toMatchObject({ requesterKind: r.kind, requesterRef: r.ref, status: 'PENDING', accountId: r.kind === 'MCP_ACCOUNT' ? ACCOUNT : null });
    }
    // The BUILD-MCP-002 forms see the MCP account's handoff exactly as before, and nothing else.
    expect((await store().forAccount(created[0]!.h.value.handoffId, ACCOUNT, new Date()))?.handoffId).toBe(created[0]!.h.value.handoffId);
    expect(await store().forAccount(created[1]!.h.value.handoffId, ACCOUNT, new Date())).toBeNull();
  });

  it('isolates requesters by kind and ref in every requester-scoped operation, and tenants entirely', async () => {
    const twin: RequesterScope = { kind: 'CHANNEL_CONVERSATION', ref: PROJECT.ref };
    const mine = handoff(PROJECT, { ...BRIDGE, amount: '1.2' }), theirs = handoff(twin, { ...BRIDGE, amount: '1.2' });
    await store().create(mine.value, new Date(), OPEN);
    await store().create(theirs.value, new Date(), OPEN);
    const strangers: RequesterScope[] = [twin, { kind: 'DEVELOPER_PROJECT', ref: 'prj_other.sandbox' }, MCP, CONVERSATION];
    for (const other of strangers) {
      expect(await store().forRequester(mine.value.handoffId, other, new Date()), JSON.stringify(other)).toBeNull();
      expect(await store().openSession(mine.value.handoffId, other, mintApprovalSecret(schemes.DEVELOPER_PROJECT).digest, new Date(Date.now() + 60_000), new Date())).toBeNull();
      expect(await store().revokeForRequester(mine.value.handoffId, other, new Date())).toBeNull();
      expect((await store().listForRequester(other, new Date(), 50)).map(h => h.handoffId)).not.toContain(mine.value.handoffId);
    }
    expect(await store('other').forRequester(mine.value.handoffId, PROJECT, new Date())).toBeNull();
    expect(await store('other').bySecret(mine.digest, new Date())).toBeNull();
    expect((await store().forRequester(mine.value.handoffId, PROJECT, new Date()))?.status).toBe('PENDING');
    expect((await store().listForRequester(PROJECT, new Date(), 50)).map(h => h.handoffId)).toContain(mine.value.handoffId);
    expect((await store().revokeForRequester(theirs.value.handoffId, twin, new Date()))?.status).toBe('REVOKED');
    expect((await store().forRequester(mine.value.handoffId, PROJECT, new Date()))?.status).toBe('PENDING');
  });

  it('limits secret lookups, claims, applications and sharing to the resolving scheme\'s requester kinds', async () => {
    const h = handoff(CONVERSATION, { ...BRIDGE, amount: '1.3' }), wallet = evm(2), decide = () => ({ ok: true as const, share: false });
    await store().create(h.value, new Date(), OPEN);
    expect(await store().bySecret(h.digest, new Date(), ['MCP_ACCOUNT', 'DEVELOPER_PROJECT'])).toBeNull();
    expect(await store().claim(h.digest, wallet, new Date(), 600, decide, ['MCP_ACCOUNT'])).toEqual({ ok: false, code: 'HANDOFF_NOT_FOUND', handoff: null });
    expect((await store().bySecret(h.digest, new Date()))?.handoffId).toBe(h.value.handoffId);
    expect((await store().claim(h.digest, wallet, new Date(), 600, decide, ['CHANNEL_CONVERSATION'])).ok).toBe(true);
    expect(await store().setSharing(h.digest, wallet, true, new Date(), ['DEVELOPER_PROJECT'])).toBeNull();
    expect((await store().apply(h.digest, wallet, new Date(), ['MCP_ACCOUNT'])).ok).toBe(false);
    expect((await store().apply(h.digest, wallet, new Date(), ['CHANNEL_CONVERSATION'])).handoff?.status).toBe('APPLIED');
  });

  it('applies each requester\'s own cap and supersession rules, per (kind, ref)', async () => {
    const r: RequesterScope = { kind: 'DEVELOPER_PROJECT', ref: `${CAPS_ID}.sandbox` }, same: RequesterScope = { kind: 'CHANNEL_CONVERSATION', ref: r.ref };
    const first = handoff(r), second = handoff(r);
    await store().create(first.value, new Date(), { maxPending: 2, supersedeSameWorkflow: false });
    await store().create(second.value, new Date(), { maxPending: 2, supersedeSameWorkflow: false });
    expect((await store().listForRequester(r, new Date(), 10)).map(h => h.status)).toEqual(['PENDING', 'PENDING']);
    expect(await store().create(handoff(r).value, new Date(), { maxPending: 2, supersedeSameWorkflow: false })).toEqual({ ok: false, code: 'HANDOFF_PENDING_LIMIT' });
    // Another kind with the same ref string is another requester: its own cap.
    expect(await store().create(handoff(same).value, new Date(), { maxPending: 2, supersedeSameWorkflow: false })).toEqual({ ok: true });
    // A requester whose rules supersede (MCP's) keeps one open request per workflow.
    const a = handoff(MCP, { ...BRIDGE, amount: '2.5' }), b = handoff(MCP, { ...BRIDGE, amount: '2.5' });
    await store().create(a.value, new Date(), { maxPending: 5, supersedeSameWorkflow: true });
    await store().create(b.value, new Date(), { maxPending: 5, supersedeSameWorkflow: true });
    expect((await store().forRequester(a.value.handoffId, MCP, new Date()))?.status).toBe('SUPERSEDED');
    expect((await store().forRequester(b.value.handoffId, MCP, new Date()))?.status).toBe('PENDING');
  });

  it('enforces the requester model and immutability in the database itself', async () => {
    const insert = (kind: string, requesterId: string | null, accountId: string | null, grantId: string | null, context = '{}') => t.db.query(`INSERT INTO mcp_handoffs
      (tenant_id, handoff_id, requester_kind, requester_id, requester_context, account_id, grant_id, client_id, client_name, secret_digest, strategy, workflow_hash,
      engine_version, network_environment, funds_class, plan, status, expires_at) VALUES ('default', $1, $2, $3, $4::jsonb, $5, $6, 'example:client', 'Example', $7, '{}', $8,
      'flofi-engine-2', 'PUBLIC_TESTNET', 'TEST_FUNDS', '{}', 'PENDING', now() + interval '10 minutes')`,
    [newId('apr'), kind, requesterId, context, accountId, grantId, randomBytes(32), '0x' + '1'.repeat(64)]);
    await expect(insert('MCP_ACCOUNT', null, null, null)).rejects.toThrow(/mcp_handoffs_requester_identity/);
    await expect(insert('MCP_ACCOUNT', 'chc_x', ACCOUNT, GRANT)).rejects.toThrow(/mcp_handoffs_requester_identity/);
    await expect(insert('MCP_ACCOUNT', null, ACCOUNT, GRANT, '{"intendedWallet":1}')).rejects.toThrow(/mcp_handoffs_requester_identity/);
    await expect(insert('DEVELOPER_PROJECT', 'prj_x.sandbox', ACCOUNT, GRANT)).rejects.toThrow(/mcp_handoffs_requester_identity/);
    await expect(insert('DEVELOPER_PROJECT', null, null, null)).rejects.toThrow(/mcp_handoffs_requester_identity/);
    await expect(insert('CHANNEL_CONVERSATION', 'Upper.Case', null, null)).rejects.toThrow(/check constraint/);
    await expect(insert('SOMEONE', 'chc_x', null, null)).rejects.toThrow(/check constraint/);
    await expect(insert('CHANNEL_CONVERSATION', 'chc_x', null, null, '[1]')).rejects.toThrow(/check constraint/);
    await expect(insert('CHANNEL_CONVERSATION', 'chc_x', null, null, JSON.stringify({ blob: 'x'.repeat(5_000) }))).rejects.toThrow(/check constraint/);
    const h = handoff(CONVERSATION, { ...BRIDGE, amount: '3.5' }, { intendedWallet: evm(3) });
    await store().create(h.value, new Date(), OPEN);
    const update = (set: string) => t.db.query(`UPDATE mcp_handoffs SET ${set} WHERE tenant_id = 'default' AND handoff_id = $1`, [h.value.handoffId]);
    await expect(update(`requester_kind = 'DEVELOPER_PROJECT'`)).rejects.toThrow('MCP_HANDOFF_IMMUTABLE');
    await expect(update(`requester_id = 'chc_other'`)).rejects.toThrow('MCP_HANDOFF_IMMUTABLE');
    await expect(update(`requester_context = '{"intendedWallet":null}'`)).rejects.toThrow('MCP_HANDOFF_IMMUTABLE');
    await expect(update(`requester_ref = 'chc_other'`)).rejects.toThrow(/can only be updated to DEFAULT|generated/);
    await store().revokeForRequester(h.value.handoffId, CONVERSATION, new Date());
    await expect(update(`status = 'PENDING'`)).rejects.toThrow('MCP_HANDOFF_TERMINAL');
  });

  it('never writes an approval or approval-session secret in plaintext, for any requester kind', async () => {
    const secrets: string[] = [];
    for (const r of [MCP, PROJECT, CONVERSATION]) {
      const h = handoff(r, { ...BRIDGE, amount: '4.5' }, r.kind === 'MCP_ACCOUNT' ? {} : { intendedWallet: evm(4) });
      await store().create(h.value, new Date(), OPEN);
      const session = mintApprovalSecret(schemes[r.kind]);
      expect(await store().openSession(h.value.handoffId, r, session.digest, new Date(Date.now() + 300_000), new Date())).not.toBeNull();
      secrets.push(h.secret, session.secret);
    }
    const dump = (await t.db.query<{ row: string }>(`SELECT row_to_json(h)::text AS row FROM mcp_handoffs h`)).rows.map(r => r.row).join('\n');
    for (const secret of secrets) { expect(dump).not.toContain(secret); expect(dump).not.toContain(secret.slice(secret.indexOf('hs_') + 3)); }
    const digests = (await t.db.query<{ a: number; b: number | null }>(`SELECT octet_length(secret_digest) AS a, octet_length(signing_digest) AS b FROM mcp_handoffs`)).rows;
    expect(digests.every(d => d.a === 32 && (d.b === null || d.b === 32))).toBe(true);
  });
});
