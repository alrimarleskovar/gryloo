// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: request_user_approval and the trusted handoff on a disposable loopback PostgreSQL. A consumer signs in with
 * OAuth, composes, and asks for its owner's approval; the handoff carries authority NONE, no calldata, transaction, signature,
 * token or key; it is bound to the workflow hash, tenant and account; mainnet is refused by policy and accepted (same schema,
 * REAL_FUNDS intact) when an isolated policy lists the network; claims need a wallet, never revive, and nothing executes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';
import type { FlowName } from '../../../backend/flows.ts';
import { composeStrategy } from '../../engine/strategy-engine';
import { readHandoffPolicy, type HandoffPolicy } from '../execution.ts';
import { credential, gatewayEnv, session } from '../gateway.test-harness.ts';
import { deriveKey } from '../oauth/config.ts';
import { credentialDigest, credentialOf, newId } from '../oauth/crypto.ts';
import { oauthClient, oauthEnv, ORIGIN, OAUTH_SECRET, signIn } from '../oauth/oauth-test-harness.ts';
import { createPgOAuthStore } from '../oauth/pg-store.ts';
import { stateOf } from '../oauth/state.ts';
import type { McpRuntime } from '../runtime.ts';
import { approvalView, CLAIM_SECONDS, verifyHandoff } from './service.ts';
import { createPgHandoffStore, type WalletRef } from './store.ts';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); await t.db.query(`INSERT INTO tenants (tenant_id) VALUES ('other')`); });
afterAll(async () => { await t?.drop(); });
const HANDOFF_KEY = deriveKey(OAUTH_SECRET, 'handoff');
const env = (extra: Record<string, string> = {}) => ({ FLOFI_MCP: 'enabled', ...oauthEnv(extra) });
const state = (tenant = 'default') => stateOf({ db: t.db, tenantId: tenant });
const store = (tenant = 'default') => createPgHandoffStore(t.db, tenant);
/** The deployment as the gates see it: MOCKED-harness flows, every call recorded (only mode/info may ever be called here). */
function runtime(calls: string[] = []): McpRuntime {
  const modes: Partial<Record<FlowName, 'live' | 'harness'>> = { 'crosschain-router-testnet': 'harness', 'jupiter-swap': 'harness', 'aave-supply': 'harness',
    'lending-composition': 'harness', 'solana-devnet-swap': 'harness' };
  const never = async (): Promise<never> => { calls.push('EXECUTION_PATH'); throw new Error('NEVER'); };
  return { kind: 'embedded', mode: async flow => { calls.push(`mode:${flow}`); return modes[flow] ?? 'off'; },
    info: async flow => { calls.push(`info:${flow}`); return { executionEnabled: true }; }, preview: never, run: never, journal: never, evidence: never };
}
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const JUPITER = { action: 'swap', network: 'solana', inputAsset: 'USDC', outputAsset: 'SOL', amount: '1' };
const hashOf = (strategy: unknown) => { const c = composeStrategy(strategy); if (!c.ok) throw new Error(c.code); return c.workflowHash; };
async function consumer(scope = 'flofi.strategy flofi.approval', extra: Record<string, string> = {}, calls: string[] = []) {
  const tokens = await signIn(oauthClient({ env: env(), store: createPgOAuthStore(t.db, 'default') }), { scope });
  const client = session({ env: env(extra), token: tokens.access_token, state: state(), runtime: runtime(calls) });
  const approve = (strategy: unknown, workflowHash = hashOf(strategy)) => client.callTool('request_user_approval', { strategy, workflowHash });
  return { tokens, client, approve };
}
const secretOf = (url: string) => credentialOf('handoff', decodeURIComponent(new URL(url).hash.slice(1)))!;
const evm = (n: number): WalletRef => ({ namespace: 'eip155', address: '0x' + String(n).repeat(40).slice(0, 40) });
const policy: HandoffPolicy = readHandoffPolicy({});

describe('BUILD-MCP-002 request_user_approval', () => {
  it('returns an approval object with authority NONE and nothing executable, bound to the re-composed workflow', async () => {
    const calls: string[] = [], { approve } = await consumer(undefined, {}, calls), result = await approve(BRIDGE);
    expect(result.isError).toBe(false);
    const out = result.output as Record<string, unknown>;
    expect(out).toMatchObject({ ok: true, approvalId: expect.stringMatching(/^apr_[a-z2-7]{26}$/), workflowHash: hashOf(BRIDGE), status: 'PENDING',
      networkEnvironment: 'PUBLIC_TESTNET', fundsClass: 'TEST_FUNDS', executionPlan: 'SINGLE_FLOW', authority: 'NONE', walletNamespace: 'eip155',
      requires: ['Open FloFi', 'Prove wallet ownership', 'Fresh simulation', 'Strategy Manifest Review', 'Explicit wallet signature'],
      steps: [{ index: 0, action: 'bridge', network: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia' }], preExecution: ['ROUTER_ROUTE_REQUIRED'] });
    expect(String(out.approvalUrl)).toMatch(new RegExp(`^${ORIGIN}/approve#flofi_hs_[A-Za-z0-9_-]{43}$`));
    expect(Date.parse(String(out.expiresAt)) - Date.now()).toBeGreaterThan(14 * 60_000);
    const text = JSON.stringify(out);
    for (const forbidden of [/calldata/i, /unsigned/i, /"signature/i, /privateKey/i, /flofi_(at|rt|code)_/, /0x[0-9a-f]{67,}/, /"transaction/i]) expect(text).not.toMatch(forbidden);
    // Only the digest of the secret is stored.
    const row = (await t.db.query<{ secret_digest: Buffer; strategy: unknown; status: string }>('SELECT secret_digest, strategy, status FROM mcp_handoffs WHERE handoff_id = $1',
      [out.approvalId])).rows[0]!;
    expect(row.secret_digest.equals(credentialDigest(HANDOFF_KEY, secretOf(String(out.approvalUrl))))).toBe(true);
    expect(JSON.stringify(row)).not.toContain(secretOf(String(out.approvalUrl)));
    // Nothing executed: the gates read flow enablement only.
    expect(calls.every(c => c.startsWith('mode:') || c.startsWith('info:'))).toBe(true);
  });

  it('fails closed on a stale hash or a modified strategy', async () => {
    const { approve } = await consumer();
    expect((await approve(BRIDGE, '0x' + '1'.repeat(64))).output).toMatchObject({ ok: false, code: 'STRATEGY_WORKFLOW_HASH_MISMATCH' });
    expect((await approve({ ...BRIDGE, amount: '4' }, hashOf(BRIDGE))).output).toMatchObject({ ok: false, code: 'STRATEGY_WORKFLOW_HASH_MISMATCH' });
    expect((await approve({ ...BRIDGE, extra: 'x' }, hashOf(BRIDGE))).isError).toBe(true);
  });

  it('refuses mainnet by policy, showing that code and deployment support it; an isolated policy accepts the same schema', async () => {
    const refused = (await (await consumer()).approve(JUPITER)).output as { ok: boolean; code: string; gates: Record<string, Record<string, unknown>> };
    expect(refused).toMatchObject({ ok: false, code: 'MAINNET_HANDOFF_DISABLED_BY_POLICY', gates: { supportedByCode: { execute: true, flow: 'jupiter-swap' },
      enabledByDeployment: { enabled: true, mockedHarness: true }, enabledByPolicy: { enabled: false, fundsClass: 'REAL_FUNDS', reason: 'MAINNET_HANDOFF_DISABLED_BY_POLICY' },
      demonstratedEvidence: 'NONE_DEMONSTRATED' } });
    const allowed = (await (await consumer(undefined, { FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'solana' })).approve(JUPITER)).output;
    expect(allowed).toMatchObject({ ok: true, status: 'PENDING', networkEnvironment: 'MAINNET', fundsClass: 'REAL_FUNDS', walletNamespace: 'solana', authority: 'NONE',
      requires: expect.arrayContaining(['Explicit wallet signature']) });
  });

  it('refuses what no existing flow executes with the owner wallet, and review blockers', async () => {
    const { approve } = await consumer(undefined, { FLOFI_MCP_HANDOFF_MAINNET_NETWORKS: 'base' });
    expect((await approve({ action: 'swap', network: 'base', inputAsset: 'USDC', outputAsset: 'WETH', amount: '2' })).output)
      .toMatchObject({ ok: false, code: 'OWNER_EXECUTION_NOT_IMPLEMENTED' });
  });

  it('supersedes the same workflow, caps open requests per account, and keeps accounts apart', async () => {
    const a = await consumer(), b = await consumer();
    const first = (await a.approve(BRIDGE)).output as { approvalId: string }, second = (await a.approve(BRIDGE)).output as { approvalId: string };
    expect((await a.client.callTool('get_approval_status', { approvalId: first.approvalId })).output).toMatchObject({ status: 'SUPERSEDED' });
    expect((await a.client.callTool('get_approval_status', { approvalId: second.approvalId })).output).toMatchObject({ status: 'PENDING', claimed: false, authority: 'NONE' });
    // Another account cannot see it: indistinguishable from an unknown id.
    expect((await b.client.callTool('get_approval_status', { approvalId: second.approvalId })).output).toEqual({ ok: false, code: 'APPROVAL_NOT_FOUND' });
    expect((await b.client.callTool('get_approval_status', { approvalId: newId('apr') })).output).toEqual({ ok: false, code: 'APPROVAL_NOT_FOUND' });
    for (const amount of ['1', '2', '3', '4']) expect((await a.approve({ ...BRIDGE, amount })).output).toMatchObject({ ok: true });
    expect((await a.approve({ ...BRIDGE, amount: '4.5' })).output).toEqual({ ok: false, code: 'MCP_HANDOFF_LIMIT' });
  });

  it('needs the flofi.approval scope and an OAuth account; static credentials never see approval tools', async () => {
    const narrow = await consumer('flofi.strategy');
    const refused = await narrow.client.post({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'request_user_approval', arguments: { strategy: BRIDGE, workflowHash: hashOf(BRIDGE) } } });
    expect(refused.status).toBe(403);
    const dev = { principal: 'dev-alice', token: credential() };
    const tools = ((await session({ env: { ...gatewayEnv([dev]), ...oauthEnv() }, token: dev.token }).request('tools/list')).result as { tools: { name: string }[] }).tools.map(x => x.name);
    expect(tools).not.toEqual(expect.arrayContaining(['request_user_approval']));
    const oauthTools = ((await narrow.client.request('tools/list')).result as { tools: { name: string; _meta?: Record<string, unknown> }[] }).tools;
    expect(oauthTools.map(x => x.name)).toEqual(expect.arrayContaining(['request_user_approval', 'get_approval_status', 'open_approval_session', 'get_execution_progress']));
    for (const name of ['open_approval_session', 'get_execution_progress']) expect(oauthTools.find(x => x.name === name)?._meta).toMatchObject({ ui: { visibility: ['app'] } });
    // The model-visible approval tool carries the panel pointer only (no visibility restriction).
    expect(oauthTools.find(x => x.name === 'request_user_approval')?._meta?.ui).toEqual({ resourceUri: 'ui://flofi/approval-panel.html' });
  });
});

describe('BUILD-MCP-002 handoff claim lifecycle', () => {
  async function pending(strategy: unknown = BRIDGE, extra: Record<string, string> = {}) {
    const { client, approve, tokens } = await consumer(undefined, extra), out = (await approve(strategy)).output as { approvalId: string; approvalUrl: string };
    return { client, tokens, approvalId: out.approvalId, digest: credentialDigest(HANDOFF_KEY, secretOf(out.approvalUrl)) };
  }
  const claim = async (digest: Buffer, wallet: WalletRef, at = new Date(), p = policy) => {
    const h = await store().bySecret(digest, at);
    const verified = h ? await verifyHandoff(h, runtime(), p) : null;
    return store().claim(digest, wallet, at, CLAIM_SECONDS, () => verified?.ok ? { ok: true, share: false } : { ok: false, code: verified?.code ?? 'X', ...verified && 'stale' in verified && verified.stale ? { stale: true } : {} });
  };

  it('a proven wallet claims once; the same wallet may re-open; any other wallet is refused; nothing revives', async () => {
    const { digest } = await pending();
    expect((await claim(digest, evm(1))).ok).toBe(true);
    expect((await claim(digest, evm(1))).ok).toBe(true);
    expect(await claim(digest, evm(2))).toEqual({ ok: false, code: 'HANDOFF_ALREADY_CLAIMED', handoff: null });
    expect((await store().apply(digest, evm(2), new Date())).ok).toBe(false);
    const applied = await store().apply(digest, evm(1), new Date());
    expect(applied).toMatchObject({ ok: true, handoff: { status: 'APPLIED' } });
    expect(await claim(digest, evm(3))).toMatchObject({ ok: false, code: 'HANDOFF_ALREADY_CLAIMED' });
  });

  it('expires unclaimed and unapplied handoffs and refuses them afterwards', async () => {
    const { digest } = await pending(), later = new Date(Date.now() + 16 * 60_000);
    expect(await claim(digest, evm(1), later)).toMatchObject({ ok: false, code: 'HANDOFF_EXPIRED' });
    expect((await store().bySecret(digest, new Date()))?.status).toBe('EXPIRED');
    const second = await pending({ ...BRIDGE, amount: '3' });
    expect((await claim(second.digest, evm(1))).ok).toBe(true);
    expect(await store().apply(second.digest, evm(1), new Date(Date.now() + (CLAIM_SECONDS + 1) * 1000))).toMatchObject({ ok: false, code: 'HANDOFF_EXPIRED' });
  });

  it('a proposal the current engine no longer reproduces becomes STALE (terminal)', async () => {
    const { client } = await consumer(), accountRow = (await t.db.query<{ account_id: string; grant_id: string }>(
      `SELECT account_id, grant_id FROM mcp_oauth_grants ORDER BY created_at DESC LIMIT 1`)).rows[0]!;
    void client;
    const digest = credentialDigest(HANDOFF_KEY, 'flofi_hs_' + 'S'.repeat(43)), id = newId('apr');
    await t.db.query(`INSERT INTO mcp_handoffs (tenant_id, handoff_id, account_id, grant_id, client_id, client_name, secret_digest, strategy, workflow_hash, engine_version,
      network_environment, funds_class, plan, status, expires_at) VALUES ('default', $1, $2, $3, 'https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude', $4, $5, $6,
      'flofi-engine-0', 'PUBLIC_TESTNET', 'TEST_FUNDS', $7, 'PENDING', now() + interval '10 minutes')`,
    [id, accountRow.account_id, accountRow.grant_id, digest, JSON.stringify(BRIDGE), '0x' + 'e'.repeat(64), JSON.stringify({ kind: 'SINGLE_FLOW', flow: 'crosschain-router-testnet',
      reason: null, steps: [], networks: ['base-sepolia', 'arbitrum-sepolia'], networkEnvironment: 'PUBLIC_TESTNET', fundsClass: 'TEST_FUNDS' })]);
    expect(await claim(digest, evm(1))).toMatchObject({ ok: false, code: 'HANDOFF_STALE', handoff: { status: 'STALE' } });
    expect(await claim(digest, evm(1))).toMatchObject({ ok: false, code: 'HANDOFF_STALE' });
  });

  it('is tenant-bound and account-bound: another tenant cannot find it; the creating account can revoke it', async () => {
    const { digest, approvalId } = await pending();
    expect(await store('other').bySecret(digest, new Date())).toBeNull();
    const account = (await t.db.query<{ account_id: string }>('SELECT account_id FROM mcp_handoffs WHERE handoff_id = $1', [approvalId])).rows[0]!.account_id;
    expect(await store().revoke(approvalId, newId('mcpacct'), new Date())).toBeNull();
    expect(await store().revoke(approvalId, account, new Date())).toMatchObject({ status: 'REVOKED' });
    expect(await claim(digest, evm(1))).toMatchObject({ ok: false, code: 'HANDOFF_REVOKED' });
  });

  it('opens short-lived approval sessions for an open handoff only, and the view never authorizes anything', async () => {
    const { client, digest, approvalId } = await pending();
    const opened = (await client.callTool('open_approval_session', { approvalId })).output as { approvalUrl: string; walletLinks: Record<string, string>; authority: string };
    expect(opened.authority).toBe('NONE');
    const sessionDigest = credentialDigest(HANDOFF_KEY, secretOf(opened.approvalUrl));
    expect((await store().bySecret(sessionDigest, new Date()))?.handoffId).toBe(approvalId);
    expect(await store().bySecret(sessionDigest, new Date(Date.now() + 6 * 60_000))).toBeNull();
    expect(opened.walletLinks.phantom).toMatch(/^https:\/\/phantom\.app\/ul\/browse\/https%3A%2F%2Fflofi\.test%2Fapprove%23flofi_hs_/);
    expect(opened.walletLinks.metamask).toMatch(/^https:\/\/metamask\.app\.link\/dapp\/flofi\.test\/approve#flofi_hs_/);
    const h = (await store().bySecret(digest, new Date()))!;
    const view = approvalView(h, await verifyHandoff(h, runtime(), policy), { wallets: [], accountId: null });
    expect(view).toMatchObject({ external: true, authorized: false, authority: 'NONE', sameAccount: false, claimedByYou: false, refusal: null, walletNamespace: 'eip155' });
    expect(JSON.stringify(view)).not.toMatch(/calldata|"signature|privateKey|flofi_hs_/);
    expect((await claim(digest, evm(4))).ok).toBe(true);
    await store().apply(digest, evm(4), new Date());
    expect((await client.callTool('open_approval_session', { approvalId })).output).toEqual({ ok: false, code: 'APPROVAL_APPLIED' });
  });
});
