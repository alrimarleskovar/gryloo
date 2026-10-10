// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicTestnetProvider, usePublicTestnet } from './public-testnet-store';
import { publicAvailability, publicBegin, publicPrepare, publicRefresh, publicReview, publicStatus } from '../app/public-testnet-action';
import type { PublicRun } from '../server/public-testnet-service';
import type { Workflow } from '../domain/initial-workflow';
import { initialEditor } from '../domain/editor';
import { deferred, HookHarness } from '../test-utils/hook-harness';
import { reviewFixture } from '../test-utils/review-fixture';

vi.mock('react', async original => ({ ...await original<typeof import('react')>(), ...(await import('../test-utils/hook-harness')).hookMocks }));
const f = vi.hoisted(() => ({ workflow: null as Workflow | null, restore: vi.fn() }));
vi.mock('./workflow-store', () => ({ useWorkflow: () => ({ state: { workflow: f.workflow }, restoreWorkflow: f.restore }) }));
vi.mock('./build009-wallet-store', () => ({ useBuild009Wallet: () => ({}), injected: () => null }));
vi.mock('../app/public-testnet-action', () => ({ publicAvailability: vi.fn(), publicStatus: vi.fn(), publicPrepare: vi.fn(), publicRefresh: vi.fn(),
  publicReview: vi.fn(), publicBegin: vi.fn(), publicObserve: vi.fn(), publicReport: vi.fn() }));
let host: HookHarness, store: ReturnType<typeof usePublicTestnet>, run: PublicRun;
function Probe() { store = usePublicTestnet(); return null; }
const read = () => host.render(() => renderToStaticMarkup(<PublicTestnetProvider><Probe/></PublicTestnetProvider>));
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); read(); }
beforeEach(() => {
  vi.clearAllMocks(); host = new HookHarness(); f.workflow = initialEditor().workflow;
  f.restore.mockImplementation(workflow => { f.workflow = workflow as Workflow; });
  const fixture = reviewFixture();
  if (fixture.source.kind !== 'public') throw Error('fixture');
  run = { ...fixture.source.state.run!, attempts: [{ step: 'approval', state: 'CONFIRMED' }] } as unknown as PublicRun;
  const values = new Map([['gryloo:public-testnet-execution-id', run.quote.executionId]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.mocked(publicAvailability).mockResolvedValue(true);
  vi.mocked(publicStatus).mockResolvedValue({ ok: true, value: run });
  vi.mocked(publicRefresh).mockResolvedValue({ ok: true, value: { ...run, quote: { ...run.quote, manifestHash: 'fresh-manifest' }, reviewedManifestHash: null } });
  vi.mocked(publicReview).mockImplementation(async () => ({ ok: true, value: { ...run, reviewedManifestHash: 'fresh-manifest' } }));
});
afterEach(() => { host.unmount(); vi.unstubAllGlobals(); });

describe('public swap durable recovery and explicit fresh Review', () => {
  it('restores the recorded canonical workflow over the untouched template without granting execution authority', async () => {
    read(); await settle();
    expect(f.restore).toHaveBeenCalledExactlyOnceWith(run.workflow);
    expect(store).toMatchObject({ run, recoveryOnly: true, retired: true });
    expect(publicPrepare).not.toHaveBeenCalled(); expect(publicBegin).not.toHaveBeenCalled(); expect(publicReview).not.toHaveBeenCalled();
  });
  it('refreshes and reviews the existing run after confirmed approval, preserving its attempt', async () => {
    read(); await settle(); store.simulate(); await settle();
    expect(publicRefresh).toHaveBeenCalledExactlyOnceWith(run.quote.executionId); expect(publicPrepare).not.toHaveBeenCalled();
    expect(store).toMatchObject({ recoveryOnly: false, retired: false, run: { attempts: run.attempts, reviewedManifestHash: null } });
    store.review(); await settle();
    expect(publicReview).toHaveBeenCalledExactlyOnceWith(run.quote.executionId, 'fresh-manifest'); expect(publicBegin).not.toHaveBeenCalled();
  });
  it('does not overwrite an owner edit while the status response is pending', async () => {
    const response = deferred<Awaited<ReturnType<typeof publicStatus>>>(); vi.mocked(publicStatus).mockReturnValue(response.promise);
    read(); f.workflow = reviewFixture().workflow; read(); response.resolve({ ok: true, value: run }); await settle();
    expect(f.restore).not.toHaveBeenCalled(); expect(store.recoveryOnly).toBe(true); expect(publicBegin).not.toHaveBeenCalled();
  });
  it('does not replace a non-template workflow that was already open on mount', async () => {
    f.workflow = reviewFixture().workflow; read(); await settle(); expect(f.restore).not.toHaveBeenCalled();
  });
  it('keeps uncertain submission closed after recovery and refuses a duplicate preparation', async () => {
    run = { ...run, attempts: [{ step: 'swap', state: 'UNKNOWN' }] } as unknown as PublicRun;
    vi.mocked(publicStatus).mockResolvedValue({ ok: true, value: run });
    read(); await settle(); store.simulate(); await settle();
    expect(store.error).toContain('transaction is already in progress');
    expect(publicPrepare).not.toHaveBeenCalled(); expect(publicRefresh).not.toHaveBeenCalled(); expect(publicBegin).not.toHaveBeenCalled();
  });
});
