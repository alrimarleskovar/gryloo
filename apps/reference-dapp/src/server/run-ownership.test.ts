// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { assertRunOwnership, normalizePrincipal, PAYMENT_OWNERSHIP, ROUTER_OWNERSHIP } from './run-ownership.ts';
import { FLOWS } from '../../backend/flows.ts';

/** BUILD-JOURNEY-001: one ownership rule for the API and local server actions. */
const A = '0x' + 'a1'.repeat(20), B = '0x' + 'b2'.repeat(20), RUN = 'xroute-' + 'c'.repeat(32);
const ownerOf = async (id: string) => { if (id !== RUN) throw new Error('ROUTER_RUN_NOT_FOUND'); return A; };
const check = (method: string, args: unknown[], principal: string | null) => assertRunOwnership(ROUTER_OWNERSHIP, method, args, principal, ownerOf);

describe('BUILD-JOURNEY-001 run ownership', () => {
  it('lets the owner call every Router method on its own run', async () => {
    await check('simulate', [{}, A], A);
    for (const method of ROUTER_OWNERSHIP.runArgument) await check(method, method === 'begin' ? [RUN, A, {}] : [RUN], A);
    await check('info', [], null);
    await check('mode', [], null);
  });
  it('refuses another wallet on every run method, a claimed owner that is not the principal, and a missing session', async () => {
    for (const method of ROUTER_OWNERSHIP.runArgument)
      await expect(check(method, method === 'begin' ? [RUN, B, {}] : [RUN], B)).rejects.toThrow('RUN_OWNER_MISMATCH');
    await expect(check('simulate', [{}, A], B)).rejects.toThrow('RUN_OWNER_MISMATCH');
    await expect(check('begin', [RUN, B, {}], A)).rejects.toThrow('RUN_OWNER_MISMATCH');
    for (const method of ['simulate', ...ROUTER_OWNERSHIP.runArgument]) await expect(check(method, [RUN, A], null)).rejects.toThrow('WALLET_SESSION_REQUIRED');
    await expect(check('status', [RUN], 'not-an-address')).rejects.toThrow('WALLET_SESSION_REQUIRED');
    await expect(check('status', ['xroute-' + 'd'.repeat(32)], A)).rejects.toThrow('ROUTER_RUN_NOT_FOUND');
  });
  it('fails closed for a method the policy does not declare', async () => {
    await expect(check('somethingNew', [RUN], A)).rejects.toThrow('RUN_OWNERSHIP_UNDECLARED');
  });
  it('covers every method of both Router flows and the payment flow and leaves other flows unchanged', () => {
    for (const [flow, policy] of [['crosschain-router', ROUTER_OWNERSHIP], ['crosschain-router-testnet', ROUTER_OWNERSHIP], ['pix-payment', PAYMENT_OWNERSHIP]] as const) {
      const definition = FLOWS[flow];
      expect(definition.ownership?.policy).toBe(policy);
      for (const method of Object.keys(definition.methods))
        expect(policy.open.includes(method) || Object.hasOwn(policy.ownerArgument, method) || policy.runArgument.includes(method)).toBe(true);
    }
    expect(Object.values(FLOWS).filter(f => f.ownership).map(f => f.name).sort()).toEqual(['crosschain-router', 'crosschain-router-testnet', 'pix-payment']);
  });
  it('accepts only lower-case EVM principals', () => {
    expect(normalizePrincipal(A)).toBe(A);
    expect(normalizePrincipal(A.toUpperCase().replace('0X', '0x'))).toBeNull();
    expect(normalizePrincipal(undefined)).toBeNull();
    expect(normalizePrincipal([A])).toBeNull();
  });
});
