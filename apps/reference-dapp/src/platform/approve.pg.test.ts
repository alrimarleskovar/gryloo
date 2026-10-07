// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: `/approve` as FloFi's approval surface for any requester kind, on a disposable loopback PostgreSQL. A
 * non-MCP requester (a test channel conversation; no channel logic ships here) hands a proposal to its owner with no MCP OAuth
 * configuration at all. A wallet proof of the workflow's namespace stays mandatory; the requester kind's claim policy (here: an
 * intended wallet) is enforced inside the claim; the claim yields an authoring proposal only, so the fresh simulation, the Strategy
 * Manifest Review and the wallet signature remain FloFi's existing flow; changed, revoked or stale proposals cannot be reused; policy
 * is re-checked at claim time; and one surface's links never resolve another surface's handoffs. Nothing executes.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../../packages/cloud-runtime/test/pg-harness.ts';
import type { FlowName } from '../../backend/flows.ts';
import { composeWorkflow } from '../engine/strategy-engine';
import { readHandoffPolicy } from '../mcp/execution.ts';
import type { McpRuntime } from '../mcp/runtime.ts';
import { applyApproval, approvalLinkScheme, approvalSecretDigest, assembleApprovalSurface, claimApproval, createPgHandoffStore, newId, openApprovalSession, PlatformRefusal, requestApproval,
  shareApproval, viewApproval, type ApprovalDeps, type ApprovalRequester, type ClaimPolicy, type HandoffPolicy, type HandoffRules, type WalletRef } from './index.ts';

const ORIGIN = 'https://flofi.test';
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });

const scheme = approvalLinkScheme('flofi_chs_', randomBytes(32), ['CHANNEL_CONVERSATION']);
const RULES: HandoffRules = { handoffSeconds: 900, maxPending: 20, rate: [100, 3_600], supersedeSameWorkflow: false };
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const DEVNET_SWAP = { action: 'swap', network: 'solana-devnet', inputAsset: 'devUSDC', outputAsset: 'SOL', amount: '1' };
const evm = (n: number): WalletRef => ({ namespace: 'eip155', address: '0x' + String(n).repeat(40).slice(0, 40) });
const SOLANA: WalletRef = { namespace: 'solana', address: 'So11111111111111111111111111111111111111112' };
/** MOCKED-harness flows; anything beyond reading flow enablement would be an execution path and is recorded as such. */
function runtime(calls: string[]): McpRuntime {
  const modes: Partial<Record<FlowName, 'harness'>> = { 'crosschain-router-testnet': 'harness', 'solana-devnet-swap': 'harness' };
  const never = async (): Promise<never> => { calls.push('EXECUTION_PATH'); throw new Error('NEVER'); };
  return { kind: 'embedded', mode: async flow => { calls.push(`mode:${flow}`); return modes[flow] ?? 'off'; }, info: async flow => { calls.push(`info:${flow}`); return { executionEnabled: true }; },
    preview: never, run: never, journal: never, evidence: never };
}
/** An intended-wallet rule of the kind a channel might register (test-only). */
const intendedWallet: ClaimPolicy = (handoff, wallet) => {
  const want = (handoff.requesterContext as { intendedWallet?: WalletRef }).intendedWallet;
  return !want || want.namespace === wallet.namespace && want.address === wallet.address ? { ok: true } : { ok: false, code: 'HANDOFF_WALLET_NOT_INTENDED' };
};
function setup(options: { policy?: HandoffPolicy; claimPolicy?: ClaimPolicy } = {}) {
  const calls: string[] = [], handoffs = createPgHandoffStore(t.db, 'default'), rt = runtime(calls);
  const surface = assembleApprovalSurface([{ scheme, profiles: { CHANNEL_CONVERSATION: { policy: options.policy ?? readHandoffPolicy({}),
    ...options.claimPolicy ? { claimPolicy: options.claimPolicy } : {} } } }], handoffs, rt);
  const deps = (): ApprovalDeps => ({ origin: ORIGIN, scheme, handoffs, allow: async () => true, runtime: rt, policy: readHandoffPolicy({}), rules: RULES, now: new Date() });
  const requester = (context: Record<string, unknown> = {}): ApprovalRequester => ({ kind: 'CHANNEL_CONVERSATION', ref: `chc_${randomBytes(6).toString('hex')}`,
    clientId: 'channel:test', displayName: 'Test channel', context });
  const request = async (strategy: Record<string, unknown> = BRIDGE, context: Record<string, unknown> = {}) => {
    const workflow = composeWorkflow(strategy);
    if (!workflow.ok) throw new Error(workflow.code);
    const who = requester(context), result = await requestApproval(deps(), who, strategy, workflow.workflowHash);
    if (!result.ok) throw new Error(result.code);
    return { ...result.value, secret: decodeURIComponent(new URL(result.value.approvalUrl).hash.slice(1)), requester: who, workflow: workflow.steps[0]!.workflow };
  };
  return { calls, handoffs, surface, deps, request };
}
const refusal = async (work: Promise<unknown>) => { try { await work; return 'NO_REFUSAL'; } catch (error) { return error instanceof PlatformRefusal ? error.message : String(error); } };

describe('BUILD-DEVELOPER-001 /approve for any requester kind', () => {
  it('serves a non-MCP requester\'s proposal with no MCP OAuth configured, showing its origin and never its private context', async () => {
    expect(process.env.FLOFI_MCP_OAUTH).toBeUndefined();
    const { surface, request } = setup(), a = await request(BRIDGE, { intendedWallet: evm(1) });
    expect(a.approvalUrl).toMatch(new RegExp(`^${ORIGIN}/approve#flofi_chs_[A-Za-z0-9_-]{43}$`));
    const view = await viewApproval(surface, a.secret, []);
    expect(view).toMatchObject({ approvalId: a.approvalId, status: 'PENDING', clientName: 'Test channel', requesterKind: 'CHANNEL_CONVERSATION', external: true,
      authorized: false, authority: 'NONE', sameAccount: false, claimedByYou: false, refusal: null, walletNamespace: 'eip155',
      requires: ['Open FloFi', 'Prove wallet ownership', 'Fresh simulation', 'Strategy Manifest Review', 'Explicit wallet signature'] });
    expect(JSON.stringify(view)).not.toMatch(/intendedWallet|flofi_chs_|calldata|"signature|privateKey/);
  });

  it('keeps the wallet proof mandatory: the workflow\'s namespace, proven server-side', async () => {
    const { surface, request } = setup(), evmProposal = await request(), solanaProposal = await request(DEVNET_SWAP);
    expect(await refusal(claimApproval(surface, evmProposal.secret, [], false))).toBe('EVM_WALLET_PROOF_REQUIRED');
    expect(await refusal(claimApproval(surface, evmProposal.secret, [SOLANA], false))).toBe('EVM_WALLET_PROOF_REQUIRED');
    expect(await refusal(claimApproval(surface, solanaProposal.secret, [evm(1)], false))).toBe('SOLANA_WALLET_PROOF_REQUIRED');
    expect((await viewApproval(surface, evmProposal.secret, [])).status).toBe('PENDING');
  });

  it('enforces the requester kind\'s claim policy inside the claim, and hands over an authoring proposal only', async () => {
    const { surface, request, calls } = setup({ claimPolicy: intendedWallet }), a = await request(BRIDGE, { intendedWallet: evm(1) });
    expect(await refusal(claimApproval(surface, a.secret, [evm(2)], false))).toBe('HANDOFF_WALLET_NOT_INTENDED');
    expect((await viewApproval(surface, a.secret, [])).status).toBe('PENDING');
    const claimed = await claimApproval(surface, a.secret, [evm(1)], false);
    expect(claimed.workflowHash).toBe(a.workflowHash);
    expect(claimed.command).toMatchObject({ type: 'ADD_ROUTER_BRIDGE', source: 'CHAT' });
    expect(claimed.view).toMatchObject({ status: 'CLAIMED', claimedByYou: true, authorized: false, authority: 'NONE', statusShared: false });
    expect(JSON.stringify(claimed)).not.toMatch(/calldata|"transaction|unsignedTransaction|"signature|privateKey|flofi_chs_/);
    // Only flow enablement was read; nothing was simulated, reviewed, signed or sent here: that is FloFi's flow, after this.
    expect(calls.filter(c => !c.startsWith('mode:') && !c.startsWith('info:'))).toEqual([]);
    // The same wallet may re-open its claim; another wallet may not take it.
    expect((await claimApproval(surface, a.secret, [evm(1)], false)).view.status).toBe('CLAIMED');
    expect(await refusal(claimApproval(surface, a.secret, [evm(3)], false))).toBe('HANDOFF_ALREADY_CLAIMED');
  });

  it('applies only the exact proposal: an edited workflow cannot reuse the claim', async () => {
    const { surface, request } = setup(), a = await request();
    await claimApproval(surface, a.secret, [evm(1)], false);
    const edited = composeWorkflow({ ...BRIDGE, amount: '4' });
    if (!edited.ok) throw new Error(edited.code);
    expect(await refusal(applyApproval(surface, a.secret, [evm(1)], edited.steps[0]!.workflow))).toBe('HANDOFF_WORKFLOW_MISMATCH');
    expect(await refusal(applyApproval(surface, a.secret, [evm(2)], a.workflow))).toBe('HANDOFF_NOT_FOUND');
    expect((await viewApproval(surface, a.secret, [])).status).toBe('CLAIMED');
    expect((await applyApproval(surface, a.secret, [evm(1)], a.workflow)).status).toBe('APPLIED');
  });

  it('refuses revoked and stale proposals for good, and re-checks policy at claim time', async () => {
    const { surface, request, handoffs, deps } = setup(), revoked = await request();
    expect((await handoffs.revokeForRequester(revoked.approvalId, { kind: 'CHANNEL_CONVERSATION', ref: revoked.requester.ref }, new Date()))?.status).toBe('REVOKED');
    expect(await refusal(claimApproval(surface, revoked.secret, [evm(1)], false))).toBe('HANDOFF_REVOKED');
    expect(await refusal(openApprovalSession(deps(), revoked.requester, revoked.approvalId))).toBe('APPROVAL_REVOKED');
    // A proposal the current engine no longer reproduces is STALE, terminally.
    const stale = randomBytes(32).toString('base64url'), secret = `flofi_chs_${stale}`, id = newId('apr');
    await t.db.query(`INSERT INTO mcp_handoffs (tenant_id, handoff_id, requester_kind, requester_id, client_id, client_name, secret_digest, strategy, workflow_hash,
      engine_version, network_environment, funds_class, plan, status, expires_at) VALUES ('default', $1, 'CHANNEL_CONVERSATION', 'chc_stale', 'channel:test', 'Test channel',
      $2, $3, $4, 'flofi-engine-0', 'PUBLIC_TESTNET', 'TEST_FUNDS', $5, 'PENDING', now() + interval '10 minutes')`, [id, approvalSecretDigest(scheme, secret),
      JSON.stringify(BRIDGE), '0x' + 'e'.repeat(64), JSON.stringify({ kind: 'SINGLE_FLOW', flow: 'crosschain-router-testnet', reason: null, steps: [],
        networks: ['base-sepolia', 'arbitrum-sepolia'], networkEnvironment: 'PUBLIC_TESTNET', fundsClass: 'TEST_FUNDS' })]);
    expect((await viewApproval(surface, secret, [])).refusal).toBe('HANDOFF_STALE');
    expect(await refusal(claimApproval(surface, secret, [evm(1)], false))).toBe('HANDOFF_STALE');
    expect((await viewApproval(surface, secret, [])).status).toBe('STALE');
    // A policy change after the request is honoured at claim time; the proposal stays open.
    const later = setup({ policy: readHandoffPolicy({ FLOFI_MCP_HANDOFF_TEST_FUNDS: 'disabled' }) }), open = await request();
    expect(await refusal(claimApproval(later.surface, open.secret, [evm(1)], false))).toBe('TEST_FUNDS_HANDOFF_DISABLED_BY_POLICY');
    expect((await viewApproval(surface, open.secret, [])).status).toBe('PENDING');
  });

  it('lets only the claimant change status sharing, which is off unless the owner turns it on', async () => {
    const { surface, request } = setup(), a = await request();
    expect((await claimApproval(surface, a.secret, [evm(1)], false)).view.statusShared).toBe(false);
    expect(await refusal(shareApproval(surface, a.secret, [evm(2)], true))).toBe('HANDOFF_NOT_FOUND');
    expect(await shareApproval(surface, a.secret, [evm(1)], true)).toEqual({ statusShared: true });
  });

  it('never resolves one surface\'s links to another surface\'s handoffs, and refuses inconsistent surfaces', async () => {
    const { request, handoffs } = setup(), a = await request(), rt = runtime([]);
    const mcpOnly = assembleApprovalSurface([{ scheme: approvalLinkScheme('flofi_hs_', randomBytes(32), ['MCP_ACCOUNT']), profiles: { MCP_ACCOUNT: { policy: readHandoffPolicy({}) } } }],
      handoffs, rt);
    expect(await refusal(viewApproval(mcpOnly, a.secret, []))).toBe('HANDOFF_NOT_FOUND');
    // The right key but a scheme without a profile for the kind: still not found.
    expect(await refusal(viewApproval(assembleApprovalSurface([{ scheme, profiles: {} }], handoffs, rt), a.secret, []))).toBe('HANDOFF_NOT_FOUND');
    // A scheme for another kind with the same prefix can never claim it (the lookup is limited to the scheme's kinds).
    const sameKeyOtherKind = approvalLinkScheme('flofi_chs_', scheme.key, ['DEVELOPER_PROJECT']);
    expect(await refusal(viewApproval(assembleApprovalSurface([{ scheme: sameKeyOtherKind, profiles: { DEVELOPER_PROJECT: { policy: readHandoffPolicy({}) } } }], handoffs, rt),
      a.secret, []))).toBe('HANDOFF_NOT_FOUND');
    const other = approvalLinkScheme('flofi_dhs_', randomBytes(32), ['DEVELOPER_PROJECT']);
    for (const contributions of [[{ scheme, profiles: {} }, { scheme, profiles: {} }], [{ scheme, profiles: {} }, { scheme: approvalLinkScheme('flofi_xhs_', randomBytes(32),
      ['CHANNEL_CONVERSATION']), profiles: {} }], [{ scheme: other, profiles: { CHANNEL_CONVERSATION: { policy: readHandoffPolicy({}) } } }]])
      expect(() => assembleApprovalSurface(contributions, handoffs, rt)).toThrow('APPROVAL_SURFACE_INVALID');
  });

  it('mints approval sessions per requester and stores neither the approval nor the session secret', async () => {
    const { surface, request, deps } = setup(), a = await request();
    const session = await openApprovalSession(deps(), a.requester, a.approvalId);
    expect(session.approvalUrl).toMatch(/#flofi_chs_[A-Za-z0-9_-]{43}$/);
    const sessionSecret = decodeURIComponent(new URL(session.approvalUrl).hash.slice(1));
    expect((await viewApproval(surface, sessionSecret, [])).approvalId).toBe(a.approvalId);
    expect(await refusal(openApprovalSession(deps(), { ...a.requester, ref: 'chc_someone_else' }, a.approvalId))).toBe('APPROVAL_NOT_FOUND');
    const dump = (await t.db.query<{ row: string }>(`SELECT row_to_json(h)::text AS row FROM mcp_handoffs h`)).rows.map(r => r.row).join('\n');
    for (const secret of [a.secret, sessionSecret]) { expect(dump).not.toContain(secret); expect(dump).not.toContain(secret.slice('flofi_chs_'.length)); }
  });
});
