// SPDX-License-Identifier: AGPL-3.0-only
// The payment server action is the runtime boundary FloFi calls: it runs as the signed-in wallet, on the same service and
// gates as the cloud flow. Fake Woovi endpoints and a disposable journal only: no network, no credentials, no money.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV, fakeWoovi, NOW, OWNER, request } from '../test-utils/woovi-fake';

const principal = vi.hoisted(() => ({ current: null as string | null }));
vi.mock('../server/session-principal', () => ({ currentWalletPrincipal: async () => principal.current }));

const OTHER = '0x3333333333333333333333333333333333333333';
// Deployment variables that would move the flow to a cloud runtime or another mode; the test runs the local runtime only.
const CLEARED = ['API_BASE_URL', 'DATABASE_URL', 'FLOFI_RUNTIME', 'VERCEL', 'VERCEL_ENV', 'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'FLOFI_DEPLOYMENT',
  'GRYLOO_PAYMENT', 'GRYLOO_PAYMENT_OWNER_EXECUTION', 'GRYLOO_PAYMENT_JOURNAL', 'WOOVI_APP_ID', 'WOOVI_ENVIRONMENT', 'GRYLOO_BASE_RPC_URL'];
type Actions = typeof import('./payment-action');
async function actions(env: Record<string, string>): Promise<Actions> {
  for (const name of CLEARED) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  return import('./payment-action');
}
let woovi: ReturnType<typeof fakeWoovi>;
beforeEach(() => {
  principal.current = null;
  woovi = fakeWoovi();
  vi.useFakeTimers({ now: NOW * 1000, toFake: ['Date'] });
  // The action builds its adapter from the environment and calls the global `fetch`: route it to the fake Woovi API.
  vi.stubGlobal('fetch', ((input: string | URL, init?: RequestInit) => woovi.fetch(input, init)) as typeof fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const live = () => ({ ...ENV, GRYLOO_PAYMENT: 'live', GRYLOO_PAYMENT_JOURNAL: mkdtempSync(join(tmpdir(), 'flofi-payment-action-')) });

describe('payment server action', () => {
  it('runs simulate and Review for the signed-in owner and never begins on a sandbox deployment', async () => {
    const payments = await actions({ ...live(), GRYLOO_PAYMENT_OWNER_EXECUTION: 'MAINNET_OWNER_APPROVED' });
    principal.current = OWNER.address;
    expect(await payments.paymentFlowMode()).toBe('live');
    expect(await payments.paymentInfo()).toEqual({ ok: true, value: { executionEnabled: false } });
    const simulated = await payments.paymentSimulate(request(), OWNER.address);
    if (!simulated.ok) throw new Error(simulated.code);
    expect(simulated.value).toMatchObject({ state: 'SIMULATED', provenance: 'PROVIDER_SANDBOX' });
    const reviewed = await payments.paymentReview(simulated.value.id, simulated.value.commitment);
    expect(reviewed.ok && reviewed.value.state).toBe('AUTHORIZED');
    // A sandbox account's deposit address would receive real USDC on Base: begin is refused whatever the opt-in says.
    expect(await payments.paymentBegin(simulated.value.id, OWNER.address)).toEqual({ ok: false, code: 'PAYMENT_EXECUTION_NOT_ENABLED' });
    expect(woovi.seen.filter(call => call.method === 'POST')).toEqual([]);
    // The provider credential went only to Woovi, from the server.
    expect(new Set(woovi.seen.map(call => call.authorization))).toEqual(new Set([ENV.WOOVI_APP_ID]));
  });

  it('binds every run to the wallet session that created it', async () => {
    const payments = await actions(live());
    expect(await payments.paymentSimulate(request(), OWNER.address)).toEqual({ ok: false, code: 'WALLET_SESSION_REQUIRED' });
    principal.current = OTHER;
    expect(await payments.paymentSimulate(request(), OWNER.address)).toEqual({ ok: false, code: 'RUN_OWNER_MISMATCH' });
    principal.current = OWNER.address;
    const simulated = await payments.paymentSimulate(request(), OWNER.address);
    if (!simulated.ok) throw new Error(simulated.code);
    principal.current = OTHER;
    expect(await payments.paymentStatus(simulated.value.id)).toEqual({ ok: false, code: 'RUN_OWNER_MISMATCH' });
    expect(await payments.paymentReview(simulated.value.id, simulated.value.commitment)).toEqual({ ok: false, code: 'RUN_OWNER_MISMATCH' });
    expect(await payments.paymentBegin(simulated.value.id, OTHER)).toEqual({ ok: false, code: 'RUN_OWNER_MISMATCH' });
  });

  it('fails closed when payments, storage or the provider are not configured', async () => {
    principal.current = OWNER.address;
    const off = await actions(ENV);
    expect(await off.paymentFlowMode()).toBe('off');
    expect(await off.paymentSimulate(request(), OWNER.address)).toEqual({ ok: false, code: 'PAYMENT_NOT_ENABLED' });
    const noStorage = await actions({ ...ENV, GRYLOO_PAYMENT: 'live' });
    expect(await noStorage.paymentSimulate(request(), OWNER.address)).toEqual({ ok: false, code: 'PAYMENT_STORAGE_NOT_CONFIGURED' });
    const noProvider = await actions({ GRYLOO_PAYMENT: 'live', GRYLOO_PAYMENT_JOURNAL: live().GRYLOO_PAYMENT_JOURNAL });
    expect(await noProvider.paymentSimulate(request(), OWNER.address)).toEqual({ ok: false, code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' });
    const hosted = await actions({ ...live(), VERCEL: '1', VERCEL_ENV: 'preview' });
    expect(await hosted.paymentSimulate(request(), OWNER.address)).toEqual({ ok: false, code: 'CLOUD_RUNTIME_NOT_CONFIGURED' });
  });
});
