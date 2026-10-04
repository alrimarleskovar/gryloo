// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashArtifactBytes, hashJournalBytes, hashRawBytes, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
import { digestPayload } from '../src/artifact-digest.js';
import { digestCloakFinancialArtifact, digestCloakJournal } from '../src/cloak-financial-digest.js';
const read = (name: string) => JSON.parse(readFileSync(new URL('../../../tests/compatibility/v1/' + name + '.json', import.meta.url), 'utf8'));
function fixture(kind: 'authorization-policy' | 'strategy-manifest' | 'execution-plan') {
  const v = read(kind);
  if (kind === 'execution-plan') {
    v.segments[0].steps[0].adapter = { id: 'cloak.solana', version: '0.2.5' };
    v.segments[0].steps[0].requiredAuthorizationClass = 'MODE_A';
  } else { v.providers.providerId = 'cloak'; v[kind === 'strategy-manifest' ? 'authorizationMode' : 'requiredAuthorizationClass'] = 'MODE_A'; }
  return v;
}
describe('Cloak browser financial hashes preserve frozen Node ingress and hashes', () => {
  it.each(['authorization-policy', 'strategy-manifest', 'execution-plan'] as const)('matches the frozen %s implementation', async kind => {
    const value = fixture(kind);
    expect(await digestCloakFinancialArtifact(kind, value)).toBe(hashArtifactBytes(kind, new TextEncoder().encode(JSON.stringify(value))));
    await expect(digestCloakFinancialArtifact(kind, { ...value, bypass: true })).rejects.toThrow();
  });
  it('preserves set normalization and rejects invalid financial scope', async () => {
    const p = fixture('authorization-policy'); p.allowlists.chains = ['eip155:2', 'eip155:1'];
    expect(await digestCloakFinancialArtifact('authorization-policy', p)).toBe(hashArtifactBytes('authorization-policy', new TextEncoder().encode(JSON.stringify(p))));
    for (const mutation of [{ ...p, nonce: (1n << 256n).toString() }, { ...p, deadline: '2026-09-31T00:00:00.000Z' },
      { ...p, providers: { kind: 'FIXED', providerId: 'jupiter' } }, { ...p, requiredAuthorizationClass: 'MODE_C' }])
      await expect(digestCloakFinancialArtifact('authorization-policy', mutation)).rejects.toThrow();
    const getter = structuredClone(p); Object.defineProperty(getter, 'nonce', { get() { throw new Error('GETTER_CALLED'); }, enumerable: true });
    await expect(digestCloakFinancialArtifact('authorization-policy', getter)).rejects.not.toThrow('GETTER_CALLED');
  });
  it('matches journal hashes and rejects broken links, transitions and identities', async () => {
    const journal = read('execution-journal') as ExecutionJournal;
    expect(await digestCloakJournal(journal)).toEqual(hashJournalBytes(new TextEncoder().encode(JSON.stringify(journal))));
    for (const key of ['previousEntryHash', 'workflowId', 'entityId', 'fromState'] as const) {
      const bad = structuredClone(journal); Object.assign(bad.entries[1]!, { [key]: 'changed' });
      await expect(digestCloakJournal(bad)).rejects.toThrow();
    }
  });
  it('uses the existing payload domain and bounded byte ingress', async () => {
    const bytes = new TextEncoder().encode('actual SDK authorization preimage');
    expect(await digestPayload(bytes)).toBe(hashRawBytes('payload', bytes));
    await expect(digestPayload(new Uint8Array(1_048_577))).rejects.toThrow();
    await expect(digestPayload('bad' as unknown as Uint8Array)).rejects.toThrow();
  });
});
