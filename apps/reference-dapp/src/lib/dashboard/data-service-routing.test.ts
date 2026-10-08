// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { embeddedRuntime } from '../../server/flow-runtime';
import { callCloudFlow } from '../../server/cloud-api-client';
import { currentWalletPrincipal, currentWalletPrincipals } from '../../server/session-principal';
import { loadDashboardRunDetail, loadDashboardSnapshot } from './data-service';
vi.mock('../../server/session-principal', () => ({ currentWalletPrincipal: vi.fn(), currentWalletPrincipals: vi.fn() }));
vi.mock('../../server/flow-runtime', async original => ({ ...await original<typeof import('../../server/flow-runtime')>(), embeddedRuntime: vi.fn() }));
vi.mock('../../server/cloud-api-client', async original => ({ ...await original<typeof import('../../server/cloud-api-client')>(), callCloudFlow: vi.fn() }));
const evm = '0x' + 'a'.repeat(40), solana = 'So11111111111111111111111111111111111111112';
const run = (account: string) => ({ runId: 'owned-run', workflowId: 'saved-workflow', ownerAccount: account, flow: account === evm ? 'aave-supply' : 'jupiter-swap', status: 'RECONCILED', hasEvidence: true });
let transport: ReturnType<typeof vi.fn>, handler: ReturnType<typeof vi.fn>;
const body = (path: string, account: string) => path.endsWith('/evidence') ? [{ bundleHash: 'saved-evidence', verified: true }] : path.endsWith('/record') ? { id: 'owned-run' } : path === '/v1/runs' ? { items: [run(account)], next: null } : run(account);
beforeEach(() => {
  vi.stubEnv('API_BASE_URL', undefined); vi.stubEnv('DATABASE_URL', undefined); vi.stubEnv('FLOFI_RUNTIME', undefined); vi.stubEnv('VERCEL', undefined);
  transport = vi.fn(); handler = vi.fn(); vi.stubGlobal('fetch', transport);
  vi.mocked(callCloudFlow).mockResolvedValue({ ok: true, value: { id: 'owned-run' } });
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function setup(mode: 'embedded' | 'cloud', account: string) {
  vi.mocked(currentWalletPrincipal).mockResolvedValue(account === evm ? evm : null);
  vi.mocked(currentWalletPrincipals).mockResolvedValue([{ namespace: account === evm ? 'eip155' : 'solana', address: account }]);
  if (mode === 'embedded') {
    vi.stubEnv('FLOFI_RUNTIME', 'embedded'); vi.stubEnv('DATABASE_URL', 'postgres://test-only');
    handler.mockImplementation(async request => ({ body: { value: body(request.path, account) } }));
    vi.mocked(embeddedRuntime).mockResolvedValue({ backend: { routes: [{ method: 'GET', pattern: /^\/v1\/runs(?:\/owned-run(?:\/(?:evidence|record))?)?$/, handler }] } } as unknown as Awaited<ReturnType<typeof embeddedRuntime>>);
  } else {
    vi.stubEnv('API_BASE_URL', 'https://cloud.example/base/');
    transport.mockImplementation(async (url: URL) => new Response(JSON.stringify({ ok: true, value: body(url.pathname.replace('/base', ''), account) })));
  }
}
describe.each(['embedded', 'cloud'] as const)('Dashboard %s routing', mode => {
  it.each([evm, solana])('loads owned history for %s through the selected runtime', async account => {
    setup(mode, account);
    expect(await loadDashboardSnapshot(account)).toMatchObject({ connection: 'CONNECTED', account, runs: [{ runId: 'owned-run', workflowId: 'saved-workflow' }] });
    const header = account === evm ? { 'x-flofi-wallet-principal': evm } : { 'x-flofi-workflow-owner': `solana:${solana}` };
    if (mode === 'embedded') { expect(handler.mock.calls[0]![0]).toMatchObject({ method: 'GET', path: '/v1/runs', headers: header }); expect(transport).not.toHaveBeenCalled(); }
    else { expect(transport.mock.calls[0]![0].href).toBe('https://cloud.example/base/v1/runs?limit=100'); expect(transport.mock.calls[0]![1].headers).toMatchObject(header); expect(embeddedRuntime).not.toHaveBeenCalled(); }
  });
  it.each([evm, solana])('keeps record/evidence reads owner scoped for %s', async account => {
    setup(mode, account);
    expect(await loadDashboardRunDetail(account, 'owned-run')).toMatchObject({ connection: 'CONNECTED', detail: { record: { id: 'owned-run' }, evidence: [{ bundleHash: 'saved-evidence' }] } });
    if (mode === 'embedded' || account === solana) {
      expect(callCloudFlow).not.toHaveBeenCalled();
      const paths = mode === 'embedded' ? handler.mock.calls.map(([r]) => r.path) : transport.mock.calls.map(([u]) => u.pathname);
      expect(paths.some(path => path.endsWith('/record'))).toBe(true);
    } else expect(callCloudFlow).toHaveBeenCalledExactlyOnceWith('aave-supply', 'status', ['owned-run'], { principal: evm });
  });
});
it('requires a matching Solana principal before reading any runtime', async () => {
  setup('cloud', solana); vi.mocked(currentWalletPrincipals).mockResolvedValue([{ namespace: 'solana', address: '11111111111111111111111111111111' }]);
  expect(await loadDashboardSnapshot(solana)).toMatchObject({ connection: 'SIGN_IN_REQUIRED', runs: [] }); expect(transport).not.toHaveBeenCalled();
});
it('maps embedded missing records to NOT_FOUND while preserving the caught cause', async () => {
  setup('embedded', evm); handler.mockRejectedValue({ status: 404 });
  expect(await loadDashboardRunDetail(evm, 'owned-run')).toMatchObject({ connection: 'NOT_FOUND', detail: null });
});
