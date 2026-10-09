// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the approval handoff behind a requester-neutral boundary, on a disposable loopback PostgreSQL. For the same
 * requester, the platform service and MCP's `request_user_approval` produce the same approval and the same stored handoff, share the
 * same limits and lookups, and differ only in how a limit is named: the platform says HANDOFF_PENDING_LIMIT, HANDOFF_RATE_LIMITED and
 * SIMULATION_RATE_LIMITED, MCP keeps MCP_HANDOFF_LIMIT, MCP_HANDOFF_RATE_LIMITED and MCP_SIMULATION_RATE_LIMITED. Nothing executes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import type { FlowName } from '../../backend/flows.ts';
import { composeStrategy } from '../engine/strategy-engine';
import { readHandoffPolicy } from '../mcp/execution.ts';
import { session } from '../mcp/gateway.test-harness.ts';
import { oauthClient, oauthEnv, ORIGIN, signIn } from '../mcp/oauth/oauth-test-harness.ts';
import { createPgOAuthStore } from '../mcp/oauth/pg-store.ts';
import { stateOf } from '../mcp/oauth/state.ts';
import type { McpRuntime } from '../mcp/runtime.ts';
import { SIMULATIONS_PER_ACCOUNT_HOUR } from '../mcp/tools.ts';
import { MCP_HANDOFF_RULES, mcpApprovalLinkScheme } from '../mcp/approval-profile.ts';
import { readOAuthConfig, type OAuthConfig } from '../mcp/oauth/config.ts';
import { assembleApprovalSurface, openBrowserApproval, approvalForRequester, approvalProgress, HANDOFF_RATE, MAX_PENDING_HANDOFFS, openApprovalSession, PlatformRefusal, requestApproval, simulatePreview,
  type ApprovalDeps, type ApprovalRequester } from './index.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
const env = { FLOFI_MCP: 'enabled', ...oauthEnv() };
const state = () => stateOf({ db: t.db, tenantId: 'default' });
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const hashOf = (strategy: unknown) => { const c = composeStrategy(strategy); if (!c.ok) throw new Error(c.code); return c.workflowHash; };
/** MOCKED-harness flows; any call beyond mode/info/preview would be an execution path and fails the test. */
function runtime(calls: string[] = []): McpRuntime {
  const modes: Partial<Record<FlowName, 'harness'>> = { 'crosschain-router-testnet': 'harness' };
  const never = async (): Promise<never> => { calls.push('EXECUTION_PATH'); throw new Error('NEVER'); };
  return { kind: 'embedded', mode: async flow => { calls.push(`mode:${flow}`); return modes[flow] ?? 'off'; }, info: async () => ({ executionEnabled: true }),
    preview: async () => ({ ok: false, code: 'PREVIEW_DONE' }), run: never, journal: never, evidence: never };
}
/** One OAuth account: its MCP client, its requester (read back from the handoff MCP created) and the platform's dependencies. */
async function account(calls: string[] = []) {
  const tokens = await signIn(oauthClient({ env, store: createPgOAuthStore(t.db, 'default') }), { scope: 'flofi.strategy flofi.approval' });
  const client = session({ env, token: tokens.access_token, state: state(), runtime: runtime(calls) });
  const result = await client.callTool('request_user_approval', { strategy: BRIDGE, workflowHash: hashOf(BRIDGE) });
  expect(result.text).not.toContain('flofi_hs_');
  const first = { ...result.output, ...result.meta['flofi/approval'] as Record<string, unknown> };
  const row = (await t.db.query<{ account_id: string; grant_id: string; client_id: string; client_name: string }>(
    'SELECT account_id, grant_id, client_id, client_name FROM mcp_handoffs WHERE handoff_id = $1', [first.approvalId])).rows[0]!;
  const requester: ApprovalRequester = { kind: 'MCP_ACCOUNT', ref: row.account_id, grantId: row.grant_id, clientId: row.client_id, displayName: row.client_name };
  const s = state(), deps = (): ApprovalDeps => ({ origin: ORIGIN, scheme: mcpApprovalLinkScheme(readOAuthConfig(env) as OAuthConfig), handoffs: s.handoffs,
    allow: (bucket, limit, windowSeconds, now) => s.oauth.allow(bucket, limit, windowSeconds, now), runtime: runtime(calls), policy: readHandoffPolicy({}),
    rules: MCP_HANDOFF_RULES, now: new Date() });
  return { client, first, requester, deps };
}
const comparable = (value: Record<string, unknown>) => ({ ...value, approvalId: 'ID', approvalUrl: String(value.approvalUrl).replace(/flofi_hs_[A-Za-z0-9_-]{43}$/, 'SECRET'), expiresAt: 'T' });
const refusal = async (work: Promise<unknown>) => { try { await work; return 'NO_REFUSAL'; } catch (error) { return error instanceof PlatformRefusal ? error.message : 'UNEXPECTED'; } };

describe('BUILD-DEVELOPER-001 platform approval service', () => {
  it('opens the nonsecret MCP fallback only for its creating browser account and never revives a withdrawn approval', async () => {
    const a = await account(), b = await account();
    const surface = (ref: string | null) => assembleApprovalSurface([{ scheme: a.deps().scheme, profiles: { MCP_ACCOUNT: { policy: a.deps().policy,
      viewerRequester: async () => ref ? { kind: 'MCP_ACCOUNT', ref } : null } } }], a.deps().handoffs, a.deps().runtime);
    const id = String(a.first.approvalId);
    expect(await refusal(openBrowserApproval(surface(null), id, ORIGIN))).toBe('APPROVAL_ACCOUNT_REQUIRED');
    expect(await refusal(openBrowserApproval(surface(b.requester.ref), id, ORIGIN))).toBe('HANDOFF_NOT_FOUND');
    const session = await openBrowserApproval(surface(a.requester.ref), id, ORIGIN);
    expect(session).toMatchObject({ approvalId: id, authority: 'NONE' });
    expect(session.approvalUrl).toMatch(/#flofi_hs_[A-Za-z0-9_-]{43}$/);
    await a.deps().handoffs.revokeForRequester(id, { kind: 'MCP_ACCOUNT', ref: a.requester.ref }, new Date());
    expect(await refusal(openBrowserApproval(surface(a.requester.ref), id, ORIGIN))).toBe('APPROVAL_REVOKED');
  });

  it('produces the same approval and stored handoff as MCP for the same requester, and nothing executes', async () => {
    const calls: string[] = [], a = await account(calls);
    const platform = await requestApproval(a.deps(), a.requester, BRIDGE, hashOf(BRIDGE));
    if (!platform.ok) throw new Error(platform.code);
    const { message, ...mcp } = a.first;
    expect(typeof message).toBe('string');
    expect(comparable({ ok: true, ...platform.value })).toEqual(comparable(mcp));
    expect(platform.value.approvalUrl).toMatch(new RegExp(`^${ORIGIN}/approve#flofi_hs_[A-Za-z0-9_-]{43}$`));
    const rows = (await t.db.query(`SELECT account_id, grant_id, client_id, client_name, strategy, workflow_hash, engine_version, network_environment, funds_class, plan, status
      FROM mcp_handoffs WHERE handoff_id = ANY($1) ORDER BY created_at`, [[a.first.approvalId, platform.value.approvalId]])).rows;
    // The platform's newer request supersedes MCP's, exactly as a second MCP request for the same workflow would.
    expect(rows.map(r => r.status)).toEqual(['SUPERSEDED', 'PENDING']);
    expect({ ...rows[0], status: null }).toEqual({ ...rows[1], status: null });
    expect(calls.filter(c => !c.startsWith('mode:'))).toEqual([]);
  });

  it('scopes lookups and approval sessions to the requester, as MCP does', async () => {
    const a = await account(), b = await account();
    const own = await approvalForRequester(a.deps().handoffs, a.requester, String(a.first.approvalId), new Date());
    expect((await approvalProgress(own, a.deps().runtime, a.deps().handoffs)).status).toBe('PENDING');
    expect(await refusal(approvalForRequester(b.deps().handoffs, b.requester, String(a.first.approvalId), new Date()))).toBe('APPROVAL_NOT_FOUND');
    expect((await b.client.callTool('get_approval_status', { approvalId: a.first.approvalId })).output).toEqual({ ok: false, code: 'APPROVAL_NOT_FOUND' });
    const opened = await openApprovalSession(a.deps(), a.requester, String(a.first.approvalId));
    expect(opened).toMatchObject({ approvalId: a.first.approvalId, authority: 'NONE', walletLinks: { phantom: expect.stringContaining('phantom.com'), metamask: expect.any(String) } });
    expect(opened.approvalUrl).toMatch(/#flofi_hs_[A-Za-z0-9_-]{43}$/);
    expect(await refusal(openApprovalSession(b.deps(), b.requester, String(a.first.approvalId)))).toBe('APPROVAL_NOT_FOUND');
    await a.deps().handoffs.revoke(String(a.first.approvalId), a.requester.ref, new Date());
    expect(await refusal(openApprovalSession(a.deps(), a.requester, String(a.first.approvalId)))).toBe('APPROVAL_REVOKED');
    expect((await a.client.callTool('open_approval_session', { approvalId: a.first.approvalId })).output).toEqual({ ok: false, code: 'APPROVAL_REVOKED' });
  });

  it('shares the pending cap with MCP and names it neutrally (MCP keeps MCP_HANDOFF_LIMIT)', async () => {
    const a = await account();
    for (let i = 1; i < MAX_PENDING_HANDOFFS; i++) expect((await requestApproval(a.deps(), a.requester, { ...BRIDGE, amount: `4.${i}` }, hashOf({ ...BRIDGE, amount: `4.${i}` }))).ok).toBe(true);
    const over = { ...BRIDGE, amount: '3.5' };
    expect(await requestApproval(a.deps(), a.requester, over, hashOf(over))).toEqual({ ok: false, code: 'HANDOFF_PENDING_LIMIT' });
    expect((await a.client.callTool('request_user_approval', { strategy: over, workflowHash: hashOf(over) })).output).toEqual({ ok: false, code: 'MCP_HANDOFF_LIMIT' });
  });

  it('shares the hourly request budget with MCP and names it neutrally (MCP keeps MCP_HANDOFF_RATE_LIMITED)', async () => {
    const a = await account();
    // MCP already made one request; requests for the same workflow supersede each other, so only the hourly budget can stop them.
    for (let i = 1; i < HANDOFF_RATE[0]; i++) expect((await requestApproval(a.deps(), a.requester, BRIDGE, hashOf(BRIDGE))).ok).toBe(true);
    expect(await requestApproval(a.deps(), a.requester, BRIDGE, hashOf(BRIDGE))).toEqual({ ok: false, code: 'HANDOFF_RATE_LIMITED' });
    expect((await a.client.callTool('request_user_approval', { strategy: BRIDGE, workflowHash: hashOf(BRIDGE) })).output).toEqual({ ok: false, code: 'MCP_HANDOFF_RATE_LIMITED' });
  });

  it('lets a surface\'s simulation budget run on the shared preview, named neutrally (MCP keeps MCP_SIMULATION_RATE_LIMITED)', async () => {
    const a = await account(), s = state(), request = { strategy: BRIDGE, workflowHash: hashOf(BRIDGE), simulationSubject: '0x' + 'a'.repeat(40) };
    const budget = () => s.oauth.allow(`simulate:account:${a.requester.ref}`, SIMULATIONS_PER_ACCOUNT_HOUR, 3_600, new Date());
    for (let i = 0; i < SIMULATIONS_PER_ACCOUNT_HOUR; i++) expect(await refusal(simulatePreview(runtime(), request, { budget }))).toBe('PREVIEW_DONE');
    expect(await refusal(simulatePreview(runtime(), request, { budget }))).toBe('SIMULATION_RATE_LIMITED');
    expect((await a.client.callTool('simulate_strategy', request)).output).toEqual({ ok: false, code: 'MCP_SIMULATION_RATE_LIMITED' });
  });
});
