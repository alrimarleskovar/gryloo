// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { engineeringUiAllowed } from './engineering-ui';
const request = vi.hoisted(() => ({ host: '127.0.0.1:3108' }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: request.host }) }));
beforeEach(() => {
  request.host = '127.0.0.1:3108';
  for (const key of ['VERCEL', 'RAILWAY_PROJECT_ID', 'FLOFI_DEPLOYMENT', 'FLOFI_ENGINEERING_UI']) vi.stubEnv(key, '');
});
afterEach(() => vi.unstubAllEnvs());
describe('explicit local engineering UI boundary', () => {
  it('requires the explicit opt-in even on loopback', async () => {
    expect(await engineeringUiAllowed()).toBe(false);
    vi.stubEnv('FLOFI_ENGINEERING_UI', 'LOOPBACK_ONLY'); expect(await engineeringUiAllowed()).toBe(true);
  });
  it.each(['localhost:3108', '127.0.0.1:3108', '[::1]:3108'])('allows an opted-in loopback host: %s', async host => {
    request.host = host; vi.stubEnv('FLOFI_ENGINEERING_UI', 'LOOPBACK_ONLY'); expect(await engineeringUiAllowed()).toBe(true);
  });
  it.each(['flofi.xyz', '127.0.0.1.attacker.example', '192.168.1.10:3108'])('refuses a non-loopback host: %s', async host => {
    request.host = host; vi.stubEnv('FLOFI_ENGINEERING_UI', 'LOOPBACK_ONLY'); expect(await engineeringUiAllowed()).toBe(false);
  });
  it.each([['VERCEL', '1'], ['RAILWAY_PROJECT_ID', 'hosted-project'], ['FLOFI_DEPLOYMENT', 'hosted']])('refuses hosted deployment: %s', async (key, value) => {
    vi.stubEnv('FLOFI_ENGINEERING_UI', 'LOOPBACK_ONLY'); vi.stubEnv(key, value); expect(await engineeringUiAllowed()).toBe(false);
  });
});
