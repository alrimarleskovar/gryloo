// SPDX-License-Identifier: AGPL-3.0-only
// The pix-payment cloud flow definition: strict API arguments, projection, observation work and Evidence export only for a
// settled run. Records are constructed test data; nothing here reaches a provider, a chain or a wallet.
import { describe, expect, it } from 'vitest';
import type { PaymentRecord } from '../src/server/payment-flow-service.ts';
import { disabledCode, FLOWS, flowMode } from './flows.ts';

const flow = FLOWS['pix-payment'];
const ID = `pay-${'a'.repeat(32)}`, OWNER = '0x1111111111111111111111111111111111111111', HASH = `0x${'ab'.repeat(32)}`;
const record = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({ id: ID, provenance: 'PROVIDER_SANDBOX', createdAt: '2026-10-08T12:00:00.000Z',
  channel: 'MCP', node: {} as PaymentRecord['node'], destination: {} as PaymentRecord['destination'],
  facts: { owner: { chainId: 'eip155:8453', address: OWNER } } as PaymentRecord['facts'], quote: {} as PaymentRecord['quote'], commitment: `0x${'cd'.repeat(32)}`,
  state: 'SIMULATED', authorization: null, attempt: null, progress: null, evidence: null, journal: [], error: null, ...overrides });
const bytes = (value: PaymentRecord) => new TextEncoder().encode(JSON.stringify(value) + '\n');
const attempt = { state: 'SUBMITTED', transactionHash: HASH, source: null,
  order: { providerOrderId: `flofi-${'7'.repeat(48)}`, sourceTransfer: { chainId: 'eip155:8453', to: OWNER, asset: { chainId: 'eip155:8453' }, amount: '1' } } } as unknown as PaymentRecord['attempt'];

describe('pix-payment flow definition', () => {
  it('is off by default and named consistently', () => {
    expect(flowMode('pix-payment', {})).toBe('off');
    expect(flowMode('pix-payment', { GRYLOO_PAYMENT: 'live' })).toBe('live');
    expect(disabledCode('pix-payment')).toBe('PAYMENT_NOT_ENABLED');
    expect(flow.ownership?.policy.ownerArgument).toEqual({ simulate: 1, begin: 1 });
  });

  it('accepts only the exact API arguments', () => {
    const valid = (method: string, ...args: unknown[]) => flow.methods[method]!.validate(args);
    expect(valid('simulate', { rail: 'PIX' }, OWNER)).toBe(true);
    expect(valid('simulate', 'pay R$100', OWNER)).toBe(false);
    expect(valid('simulate', { destination: 'x'.repeat(9_000) }, OWNER)).toBe(false);
    expect(valid('review', ID, `0x${'cd'.repeat(32)}`)).toBe(true);
    expect(valid('review', ID, 'approve')).toBe(false);
    expect(valid('review', ID, `0x${'cd'.repeat(32)}`, { authorization: { origin: 'FLOFI_REVIEW' } })).toBe(false);
    expect(valid('begin', ID, OWNER)).toBe(true);
    expect(valid('report', ID, { kind: 'HASH', hash: HASH })).toBe(true);
    expect(valid('report', ID, { kind: 'SETTLED' })).toBe(false);
    expect(valid('status', 'rhx-' + 'a'.repeat(32))).toBe(false);
    // No method lets a caller hand the runtime an authorization, a source confirmation or a settlement.
    expect(Object.keys(flow.methods).sort()).toEqual(['begin', 'handoff', 'info', 'invalidate', 'observe', 'report', 'review', 'simulate', 'status']);
  });

  it('projects runs, schedules observation only while the chain or provider can still move, and ignores index logs', () => {
    expect(flow.projector(`flofi-${'7'.repeat(48)}.payment`, new TextEncoder().encode(ID + '\n'))).toBeNull();
    const simulated = flow.projector(`${ID}.jsonl`, bytes(record()))!;
    expect(simulated.run).toMatchObject({ runId: ID, flow: 'pix-payment', status: 'SIMULATED', provenance: 'PUBLIC_TESTNET', ownerAccount: OWNER,
      needsObservation: false, hasEvidence: false, attempts: [] });
    expect(simulated.work).toEqual([]);
    const inFlight = flow.projector(`${ID}.jsonl`, bytes(record({ provenance: 'PUBLIC_MAINNET', state: 'SOURCE_SUBMITTED', attempt })))!;
    expect(inFlight.run).toMatchObject({ provenance: 'PUBLIC_MAINNET', needsObservation: true,
      attempts: [{ attemptId: `${ID}.SOURCE`, step: 'SOURCE', state: 'SUBMITTED', transactionHash: HASH, reconciled: false }] });
    expect(inFlight.work.map(item => item.kind)).toEqual(['reconcile']);
    // A divergent source needs a person, not a worker.
    expect(flow.projector(`${ID}.jsonl`, bytes(record({ state: 'UNKNOWN', attempt })))!.run.needsObservation).toBe(false);
  });

  it('exports Evidence only for a settled run', () => {
    expect(flow.evidence(record({ state: 'PAYMENT_PENDING', attempt }))).toBeNull();
    const evidence = { bundle: { kind: 'flofi/payment-evidence/v1' }, bundleHash: `0x${'ef'.repeat(32)}` } as unknown as PaymentRecord['evidence'];
    const settled = flow.evidence(record({ provenance: 'MOCKED', state: 'PAYMENT_SETTLED', attempt, evidence }));
    expect(settled).toMatchObject({ bundleHash: `0x${'ef'.repeat(32)}`, environment: 'MOCKED', outcome: 'PAYMENT_SETTLED' });
    expect(flow.projector(`${ID}.jsonl`, bytes(record({ provenance: 'MOCKED', state: 'PAYMENT_SETTLED', attempt, evidence })))!.work.map(item => item.kind))
      .toEqual(['evidence.archive']);
  });
});
