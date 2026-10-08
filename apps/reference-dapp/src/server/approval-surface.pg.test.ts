// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the deployment's approval surface. `/approve` is enabled by its contributing surfaces (today MCP, while its
 * OAuth server is enabled), never without the durable store, and serves BUILD-MCP-002 links unchanged through the shared path: the
 * same `flofi_hs_` secrets, the same view, claim and application, and status sharing on by default only in the creating MCP account's
 * own browser (its sealed account cookie, read through the request's cookie reader).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import type { FlowName } from '../../backend/flows.ts';
import { composeWorkflow } from '../engine/strategy-engine';
import { session } from '../mcp/gateway.test-harness.ts';
import { deriveKey } from '../mcp/oauth/config.ts';
import { sealValue } from '../mcp/oauth/crypto.ts';
import { oauthClient, oauthEnv, ORIGIN, OAUTH_SECRET, signIn } from '../mcp/oauth/oauth-test-harness.ts';
import { createPgOAuthStore } from '../mcp/oauth/pg-store.ts';
import { ACCOUNT_COOKIE } from '../mcp/oauth/server.ts';
import { stateOf } from '../mcp/oauth/state.ts';
import type { McpRuntime } from '../mcp/runtime.ts';
import { applyApproval, claimApproval, viewApproval, type WalletRef } from '../platform/index.ts';
import { approvalContributors, approvalSurface } from './approval-surface.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
const env = { FLOFI_MCP: 'enabled', ...oauthEnv() };
const host = () => ({ db: t.db, tenantId: 'default' });
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const composed = composeWorkflow(BRIDGE);
if (!composed.ok) throw new Error(composed.code);
const HASH = composed.workflowHash, WORKFLOW = composed.steps[0]!.workflow;
const evm = (n: number): WalletRef => ({ namespace: 'eip155', address: '0x' + String(n).repeat(40).slice(0, 40) });
function runtime(calls: string[] = []): McpRuntime {
  const never = async (): Promise<never> => { calls.push('EXECUTION_PATH'); throw new Error('NEVER'); };
  return { kind: 'embedded', mode: async (flow: FlowName) => { calls.push(`mode:${flow}`); return flow === 'crosschain-router-testnet' ? 'harness' : 'off'; },
    info: async () => ({ executionEnabled: true }), preview: never, run: never, journal: never, evidence: never };
}
/** A consumer's approval request through MCP (BUILD-MCP-002, unchanged), with its secret and the creating account. */
async function mcpApproval() {
  const tokens = await signIn(oauthClient({ env, store: createPgOAuthStore(t.db, 'default') }), { scope: 'flofi.strategy flofi.approval' });
  const client = session({ env, token: tokens.access_token, state: stateOf(host()), runtime: runtime() });
  const out = (await client.callTool('request_user_approval', { strategy: BRIDGE, workflowHash: HASH })).output as
    { approvalId: string; approvalUrl: string };
  const account = (await t.db.query<{ account_id: string }>('SELECT account_id FROM mcp_handoffs WHERE handoff_id = $1', [out.approvalId])).rows[0]!.account_id;
  return { ...out, secret: decodeURIComponent(new URL(out.approvalUrl).hash.slice(1)), account };
}
const accountCookie = (account: string) => sealValue('ma1', { a: account, d: new URL(ORIGIN).host, e: Math.floor(Date.now() / 1000) + 3_600 },
  deriveKey(OAUTH_SECRET, 'account-session'));
const surfaceWith = (cookie: string | undefined, calls: string[] = []) =>
  approvalSurface(env, name => name === ACCOUNT_COOKIE ? cookie : undefined, { host: host(), runtime: runtime(calls) });

describe('BUILD-DEVELOPER-001 the deployment approval surface', () => {
  it('is enabled only by a contributing surface, and never without the durable store', async () => {
    expect(approvalContributors({})).toEqual([]);
    expect(approvalContributors({ FLOFI_MCP: 'enabled' })).toEqual([]);
    await expect(approvalSurface({}, () => undefined)).rejects.toThrow('APPROVALS_NOT_ENABLED');
    // MCP OAuth configured, but no embedded PostgreSQL runtime: fail closed (never memory, a file or /tmp).
    await expect(approvalSurface(env, () => undefined)).rejects.toThrow('APPROVAL_STORE_UNAVAILABLE');
    expect(approvalContributors(env)).toHaveLength(1);
  });

  it('serves BUILD-MCP-002 approval links through the shared /approve path, unchanged', async () => {
    const calls: string[] = [], a = await mcpApproval(), surface = await surfaceWith(undefined, calls);
    expect(surface.schemes.map(s => [s.prefix, s.kinds])).toEqual([['flofi_hs_', ['MCP_ACCOUNT']]]);
    expect(a.secret).toMatch(/^flofi_hs_[A-Za-z0-9_-]{43}$/);
    expect(await viewApproval(surface, a.secret, [])).toMatchObject({ approvalId: a.approvalId, status: 'PENDING', requesterKind: 'MCP_ACCOUNT', clientName: 'Claude',
      external: true, authorized: false, sameAccount: false, refusal: null });
    const claimed = await claimApproval(surface, a.secret, [evm(1)], true);
    expect(claimed).toMatchObject({ workflowHash: HASH, command: { type: 'ADD_ROUTER_BRIDGE' }, view: { status: 'CLAIMED', statusShared: true } });
    expect((await applyApproval(surface, a.secret, [evm(1)], WORKFLOW)).status).toBe('APPLIED');
    expect(calls.filter(c => !c.startsWith('mode:'))).toEqual([]);
  });

  it('defaults status sharing on only in the creating MCP account\'s own browser', async () => {
    const a = await mcpApproval(), b = await mcpApproval();
    expect((await viewApproval(await surfaceWith(accountCookie(a.account)), a.secret, [])).sameAccount).toBe(true);
    expect((await viewApproval(await surfaceWith(accountCookie(b.account)), a.secret, [])).sameAccount).toBe(false);
    expect((await viewApproval(await surfaceWith(undefined), a.secret, [])).sameAccount).toBe(false);
    expect((await viewApproval(await surfaceWith('ma1.e30.forged'), a.secret, [])).sameAccount).toBe(false);
  });
});
