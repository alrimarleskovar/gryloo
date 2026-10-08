// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stablecoin → Pix on the cloud runtime: PostgreSQL run logs and projections, ownership through the API contract, and the
 * deployment gates. A fake of Woovi's published sandbox API stands in for the provider; there is no wallet, no chain write and
 * no money, and a sandbox deployment can never begin a payment.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@defi-workflow-engine/cloud-runtime';
import { createTestDatabase, type TestDatabase } from '../../../packages/cloud-runtime/test/pg-harness.ts';
import type { PaymentRecord } from '../src/server/payment-flow-service.ts';
import { ENV, fakeWoovi, NOW, OWNER, request } from '../src/test-utils/woovi-fake.ts';
import { createBackend, type FlowResult } from './app.ts';
import { flowMode } from './flows.ts';

const quiet = createLogger({ service: 'test', sink: () => undefined });
const OTHER = '0x3333333333333333333333333333333333333333';
function ok<T>(result: FlowResult): T { if (!result.ok) throw new Error(result.code); return result.value as T; }

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.drop(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('pix-payment flow on durable cloud state (fake Woovi sandbox)', () => {
  it('quotes and records the Review per owner, projects the run, and never begins in sandbox', async () => {
    const woovi = fakeWoovi();
    vi.useFakeTimers({ now: NOW * 1000, toFake: ['Date'] });
    vi.stubGlobal('fetch', ((input: string | URL, init?: RequestInit) => woovi.fetch(input, init)) as typeof fetch);
    const env = { ...ENV, GRYLOO_PAYMENT: 'live', GRYLOO_PAYMENT_OWNER_EXECUTION: 'MAINNET_OWNER_APPROVED' };
    expect(flowMode('pix-payment', env)).toBe('live');
    const db = t.open(4);
    const backend = createBackend({ db, env, logger: quiet, tenantId: 'default', holderId: 'web-test', evidenceStore: null,
      rpc: { 'pix-payment': async method => { throw new Error(`unexpected ${method}`); } }, busyRetries: 3 });
    const call = (principal: string | null, method: string, ...args: unknown[]) => backend.callFlow('pix-payment', method, args, 'default', principal);

    expect(await call(null, 'simulate', request(), OWNER.address)).toMatchObject({ ok: false, code: 'WALLET_SESSION_REQUIRED' });
    expect(await call(OTHER, 'simulate', request(), OWNER.address)).toMatchObject({ ok: false, code: 'RUN_OWNER_MISMATCH' });
    const simulated = ok<PaymentRecord>(await call(OWNER.address, 'simulate', request(), OWNER.address));
    expect(await call(OTHER, 'status', simulated.id)).toMatchObject({ ok: false, code: 'RUN_OWNER_MISMATCH' });
    const reviewed = ok<PaymentRecord>(await call(OWNER.address, 'review', simulated.id, simulated.commitment));
    expect(reviewed.state).toBe('AUTHORIZED');
    expect(ok<{ executionEnabled: boolean }>(await call(null, 'info'))).toEqual({ executionEnabled: false });
    expect(await call(OWNER.address, 'begin', simulated.id, OWNER.address)).toMatchObject({ ok: false, code: 'PAYMENT_EXECUTION_NOT_ENABLED' });
    expect(woovi.seen.filter(entry => entry.method === 'POST')).toEqual([]);

    // The run log keeps PROVIDER_SANDBOX; the projection files it under the existing valueless public-test class.
    const { rows } = await db.query<{ flow: string; status: string; provenance: string; owner_account: string; needs_observation: boolean }>(
      `SELECT flow, status, provenance, owner_account, needs_observation FROM execution_runs WHERE run_id = $1`, [simulated.id]);
    expect(rows).toEqual([{ flow: 'pix-payment', status: 'AUTHORIZED', provenance: 'PUBLIC_TESTNET', owner_account: OWNER.address, needs_observation: false }]);
    expect(reviewed.provenance).toBe('PROVIDER_SANDBOX');
  });

  it('is off until the deployment enables it', async () => {
    const backend = createBackend({ db: t.open(2), env: ENV, logger: quiet, tenantId: 'default', holderId: 'web-off', evidenceStore: null });
    expect(flowMode('pix-payment', ENV)).toBe('off');
    expect(await backend.callFlow('pix-payment', 'simulate', [request(), OWNER.address], 'default', OWNER.address)).toMatchObject({ ok: false, code: 'PAYMENT_NOT_ENABLED' });
  });
});
