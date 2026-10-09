// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the BFF boundary of Automations on the remote runtime (Vercel → Railway API), without a database: only a wallet
 * this request proved is forwarded, as the server-to-server owner header; automation approval links (and only those) are forwarded with
 * the proven wallets; an API without automations, a broken body or a transport failure fail closed. (The full path against the real API
 * server and PostgreSQL is `automations/remote.pg.test.ts`.)
 */
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowOwner } from '../domain/saved-workflow';
import { automationAvailability, automationOperation, remoteApproval, remoteAutomationApproval } from './automation-operation';

const evm: WorkflowOwner = { namespace: 'eip155', address: '0x' + 'a'.repeat(40) };
const solana: WorkflowOwner = { namespace: 'solana', address: 'So11111111111111111111111111111111111111112' };
const REMOTE = { API_BASE_URL: 'https://api.flofi.example/', API_AUTH_TOKEN: 'api-token' };
const reply = (body: unknown, status = 200) => vi.fn().mockResolvedValue(Response.json(body, { status }));

describe('BUILD-AUTOMATION-001 Automations BFF on the remote runtime', () => {
  it.each([evm, solana])('never forwards an unproven owner %j (no transport call)', async owner => {
    const transport = reply({ ok: true, value: null });
    expect(await automationOperation('overview', [], owner, { principals: async () => [], env: REMOTE, transport })).toEqual({ ok: false, code: 'WALLET_SESSION_REQUIRED' });
    expect(await automationOperation('overview', [], owner, { principals: async () => [owner === evm ? solana : evm], env: REMOTE, transport }))
      .toEqual({ ok: false, code: 'WALLET_SESSION_REQUIRED' });
    expect(await automationOperation('runFlow' as never, [], owner, { principals: async () => [owner], env: REMOTE, transport })).toEqual({ ok: false, code: 'WALLET_SESSION_REQUIRED' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([evm, solana])('forwards the verified owner %j as the owner header, with an idempotency key only for create', async owner => {
    const transport = reply({ ok: true, value: { rules: [] } });
    expect(await automationOperation('overview', [], owner, { principals: async () => [owner], env: REMOTE, transport })).toEqual({ ok: true, value: { rules: [] } });
    await automationOperation('create', [{ name: 'x' }], owner, { principals: async () => [owner], env: REMOTE, transport });
    const [[overviewUrl, overview], [createUrl, create]] = transport.mock.calls as unknown as [[URL, RequestInit], [URL, RequestInit]];
    expect([overviewUrl.href, createUrl.href]).toEqual(['https://api.flofi.example/v1/automations/overview', 'https://api.flofi.example/v1/automations/create']);
    expect(overview.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer api-token', 'x-flofi-workflow-owner': `${owner.namespace}:${owner.address}` });
    expect(create.headers).toMatchObject({ 'x-flofi-workflow-owner': `${owner.namespace}:${owner.address}`, 'idempotency-key': expect.any(String) });
    expect(JSON.parse(String(create.body))).toEqual({ args: [{ name: 'x' }] });
  });

  it('fails closed: an API without automations, a malformed answer, a transport failure, no runtime', async () => {
    const as = (transport: typeof fetch, env: Record<string, string> = REMOTE) => automationOperation('overview', [], evm, { principals: async () => [evm], env, transport });
    expect(await as(reply({ ok: false, code: 'FLOW_NOT_FOUND' }, 404))).toEqual({ ok: false, code: 'AUTOMATIONS_NOT_ENABLED' });
    expect(await as(reply({ value: 'not a result' }))).toEqual({ ok: false, code: 'AUTOMATION_UNAVAILABLE' });
    expect(await as(reply({ ok: false, code: 'lowercase is not a code' }))).toEqual({ ok: false, code: 'AUTOMATION_UNAVAILABLE' });
    expect(await as(vi.fn().mockRejectedValue(new Error('offline')))).toEqual({ ok: false, code: 'AUTOMATION_UNAVAILABLE' });
    expect(await as(reply({}), { API_BASE_URL: 'http://api.flofi.example/' })).toEqual({ ok: false, code: 'CLOUD_API_CONFIGURATION_INVALID' });
    expect(await automationOperation('overview', [], evm, { principals: async () => [evm], env: { VERCEL: '1' } })).toEqual({ ok: false, code: 'AUTOMATIONS_NOT_ENABLED' });
  });

  it('asks the API whether automations are served (it names nobody)', async () => {
    const transport = reply({ ok: true, value: { enabled: true, code: null } });
    expect(await automationAvailability({ env: REMOTE, transport })).toEqual({ enabled: true, code: null });
    expect((transport.mock.calls[0] as [URL, RequestInit])[1].headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer api-token' });
    expect(await automationAvailability({ env: REMOTE, transport: reply({}, 404) })).toEqual({ enabled: false, code: 'AUTOMATIONS_NOT_ENABLED' });
  });

  it('forwards only automation approval links, with the proven wallets, and throws the API’s closed code', async () => {
    const link = 'flofi_auhs_' + 'A'.repeat(43);
    expect(remoteAutomationApproval(link, REMOTE)).toBe(true);
    for (const other of ['flofi_hs_' + 'A'.repeat(43), 'flofi_dvhs_' + 'A'.repeat(43), null, 42]) expect(remoteAutomationApproval(other, REMOTE)).toBe(false);
    expect(remoteAutomationApproval(link, { FLOFI_RUNTIME: 'embedded', DATABASE_URL: 'postgres://x' })).toBe(false);
    const transport = reply({ ok: true, value: { status: 'PENDING' } });
    expect(await remoteApproval('view', [link], { env: REMOTE, transport, principals: async () => [evm, solana] })).toEqual({ status: 'PENDING' });
    expect((transport.mock.calls[0] as [URL, RequestInit])[1].headers)
      .toMatchObject({ 'x-flofi-wallet-principals': `eip155:${evm.address},solana:${solana.address}`, authorization: 'Bearer api-token' });
    // PR #72's recovery by approval id goes to the same route family, with the same proven wallets and nothing else.
    const resume = reply({ ok: true, value: { workflowHash: 'h' } });
    expect(await remoteApproval('resume', ['apr_' + 'a'.repeat(26)], { env: REMOTE, transport: resume, principals: async () => [evm] })).toEqual({ workflowHash: 'h' });
    const [resumeUrl, resumeInit] = resume.mock.calls[0] as unknown as [URL, RequestInit];
    expect([resumeUrl.href, JSON.parse(String(resumeInit.body))]).toEqual(['https://api.flofi.example/v1/approvals/resume', { args: ['apr_' + 'a'.repeat(26)] }]);
    expect(resumeInit.headers).toMatchObject({ 'x-flofi-wallet-principals': `eip155:${evm.address}`, authorization: 'Bearer api-token' });
    expect(resumeInit.headers).not.toHaveProperty('x-flofi-workflow-owner');
    await expect(remoteApproval('claim', [link, false], { env: REMOTE, transport: reply({ ok: false, code: 'AUTOMATION_OWNER_MISMATCH' }), principals: async () => [evm] }))
      .rejects.toThrow('AUTOMATION_OWNER_MISMATCH');
    await expect(remoteApproval('view', [link], { env: REMOTE, transport: vi.fn().mockRejectedValue(new Error('offline')), principals: async () => [] }))
      .rejects.toThrow('APPROVAL_STORE_UNAVAILABLE');
    await expect(remoteApproval('view', [link], { env: REMOTE, transport: reply({}, 404), principals: async () => [] })).rejects.toThrow('APPROVALS_NOT_ENABLED');
  });
});
