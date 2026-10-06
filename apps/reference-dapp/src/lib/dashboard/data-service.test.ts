// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudApiBaseUrl, callCloudFlow } from '../../server/cloud-api-client';
import { currentWalletPrincipal } from '../../server/session-principal';
import { loadDashboardRunDetail, loadDashboardSnapshot } from './data-service';

vi.mock('../../server/cloud-api-client', () => ({ cloudApiBaseUrl: vi.fn(), callCloudFlow: vi.fn() }));
vi.mock('../../server/session-principal', () => ({ currentWalletPrincipal: vi.fn() }));
const account = '0x' + 'a'.repeat(40), other = '0x' + 'b'.repeat(40);
const run = (ownerAccount = account, runId = 'owned-run') => ({ runId, ownerAccount, flow: 'aave-supply', status: 'RECONCILED', hasEvidence: true });
const response = (value: unknown, status = 200) => new Response(JSON.stringify({ ok: status === 200, value }), { status });
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
function setup() {
  vi.mocked(currentWalletPrincipal).mockResolvedValue(account);
  vi.mocked(cloudApiBaseUrl).mockReturnValue(new URL('http://127.0.0.1:9999/'));
  vi.mocked(callCloudFlow).mockResolvedValue({ ok: true, value: { id: 'owned-run' } });
}
describe('Dashboard owner-scoped query boundary', () => {
  it.each([null, other])('requires a matching signed principal (%s) before querying any records', async principal => {
    vi.mocked(currentWalletPrincipal).mockResolvedValue(principal);
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    expect(await loadDashboardSnapshot(account)).toMatchObject({ connection: 'SIGN_IN_REQUIRED', runs: [], account: null });
    expect(transport).not.toHaveBeenCalled(); expect(callCloudFlow).not.toHaveBeenCalled();
  });
  it('returns a source-unavailable state rather than an empty fabricated history without configuration', async () => {
    setup(); vi.mocked(cloudApiBaseUrl).mockReturnValue(null);
    expect(await loadDashboardSnapshot(account)).toMatchObject({ connection: 'NOT_CONFIGURED', runs: [] });
  });
  it('keeps API failure distinct from a connected new wallet with no runs', async () => {
    setup(); const transport = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', transport);
    expect((await loadDashboardSnapshot(account)).connection).toBe('UNAVAILABLE');
    transport.mockResolvedValue(response({ items: [], next: null }));
    expect(await loadDashboardSnapshot(account)).toMatchObject({ connection: 'CONNECTED', runs: [], hasMore: false });
  });
  it('filters unexpected owners from the real index and keeps the true pagination limit', async () => {
    setup(); const transport = vi.fn().mockResolvedValue(response({ items: [run(), run(other, 'other-run'), null], next: 'cursor' })); vi.stubGlobal('fetch', transport);
    expect(await loadDashboardSnapshot(account)).toMatchObject({ connection: 'CONNECTED', runs: [{ runId: 'owned-run' }], hasMore: true });
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', cache: 'no-store', headers: { 'x-flofi-wallet-principal': account } });
  });
  it('resolves a real owned ID and reuses only the existing read-only status method', async () => {
    setup(); const transport = vi.fn().mockImplementation((url: URL) => Promise.resolve(response(url.pathname.endsWith('/evidence') ? [{ bundleHash: 'recorded-hash', outcome: 'RECONCILED', verified: true }] : { ...run(), attempts: [{ attemptId: 'a', step: 'SUPPLY', state: 'CONFIRMED', transactionHash: 'real-hash', reconciled: true }] }))); vi.stubGlobal('fetch', transport);
    expect(await loadDashboardRunDetail(account, 'owned-run')).toMatchObject({ connection: 'CONNECTED', detail: { run: { runId: 'owned-run' }, attempts: [{ transactionHash: 'real-hash' }], evidence: [{ bundleHash: 'recorded-hash', verified: true }], record: { id: 'owned-run' } } });
    expect(callCloudFlow).toHaveBeenCalledExactlyOnceWith('aave-supply', 'status', ['owned-run'], { principal: account });
  });
  it.each([run(other), run(account, 'other-id')])('rejects a mis-scoped/mismatched detail before requesting evidence or status', async item => {
    setup(); const transport = vi.fn().mockResolvedValue(response(item)); vi.stubGlobal('fetch', transport);
    expect(await loadDashboardRunDetail(account, 'owned-run')).toMatchObject({ connection: 'NOT_FOUND', detail: null });
    expect(transport).toHaveBeenCalledTimes(1); expect(callCloudFlow).not.toHaveBeenCalled();
  });
  it('rejects invalid IDs and shows real not-found without fabricating a record', async () => {
    setup(); const transport = vi.fn().mockResolvedValue(response(null, 404)); vi.stubGlobal('fetch', transport);
    expect((await loadDashboardRunDetail(account, '../other')).connection).toBe('NOT_FOUND');
    expect(transport).not.toHaveBeenCalled();
    expect((await loadDashboardRunDetail(account, 'absent')).connection).toBe('NOT_FOUND');
  });
  it('retains the owned summary when detailed evidence/status are unavailable', async () => {
    setup(); const transport = vi.fn().mockResolvedValueOnce(response(run())).mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', transport);
    vi.mocked(callCloudFlow).mockResolvedValue({ ok: false, code: 'CLOUD_API_UNAVAILABLE' });
    expect(await loadDashboardRunDetail(account, 'owned-run')).toMatchObject({ detail: { run: { runId: 'owned-run' }, evidence: [], record: null, evidenceUnavailable: true, recordUnavailable: true } });
  });
});
