// SPDX-License-Identifier: AGPL-3.0-only
/** Opt-in public-mainnet PREPARATION check. Every financial network method is forbidden. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCircuitsPath } from '@cloak.dev/sdk';
import { writeFile } from 'node:fs/promises';
import { prepareOwnerDeposit } from './owner-proof-deposit';
import { PrivateStateVault } from './vault';
describe.runIf(process.env.CLOAK_OWNER_PROOF_READONLY === '1')('owner deposit: genuine SDK/public mainnet, never signing/submitting', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('prepares the exact minimum deposit with a capture-only signer and encrypted synthetic-session storage', async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://api.cloak.ag') && (init?.method ?? 'GET') !== 'GET') throw new Error('READONLY_RELAY_WRITE_DENIED');
      if (url.startsWith('https://api.mainnet-beta.solana.com') && typeof init?.body === 'string') {
        const request = JSON.parse(init.body) as { method: string };
        if (/send|requestAirdrop/i.test(request.method)) throw new Error('READONLY_FINANCIAL_RPC_DENIED');
      }
      return realFetch(input, init);
    });
    if (process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY) setCircuitsPath(process.env.CLOAK_VERIFIED_CIRCUITS_DIRECTORY);
    const records = new Map<string, string>(), vault = new PrivateStateVault({ get: async k => records.get(k) ?? null,
      putNew: async (k, value) => { if (records.has(k)) throw new Error('DUPLICATE'); records.set(k, value); } }, crypto.randomUUID());
    const owner = process.env.CLOAK_OWNER_PROOF_PUBLIC_OWNER;
    if (!owner) throw new Error('PUBLIC_OWNER_REQUIRED');
    const p = await prepareOwnerDeposit(vault, owner);
    const publicResult = { owner, depositLamports: p.manifest.depositLamports, program: p.manifest.programId,
      simulation: p.simulation, networkFeeLamports: p.networkFeeLamports, totalWalletDebitLamports: p.simulatedWalletDebitLamports,
      messageDigest: p.messageDigest, manifestHash: p.manifestHash, unsignedBytes: atob(p.unsignedTransaction).length,
      transactionCount: 1, signaturesRequested: 0, submissions: 0 };
    await writeFile('.turbo/privacy-owner-deposit-readonly.json', JSON.stringify(publicResult, null, 2));
    expect(p.manifest.depositLamports).toBe('10000000'); expect(p.messageDigest).toMatch(/^0x[a-f0-9]{64}$/);
    expect(records.size).toBe(3); expect([...records.values()].every(v => !v.includes('viewingKeyNk'))).toBe(true);
  }, 240_000);
});
