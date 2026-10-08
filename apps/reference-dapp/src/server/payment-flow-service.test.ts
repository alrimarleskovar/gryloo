// SPDX-License-Identifier: AGPL-3.0-only
// The durable stablecoin → Pix runtime against a fake of Woovi's published API and a fake Base read client. No network, no
// credentials, no wallet and no money: every source transfer and payout below is fabricated test data.
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPaymentFlowService, paymentNeedsObservation, PAYMENT_SOURCE_CONFIRMATIONS, type PaymentRecord } from './payment-flow-service';
import { paymentMode, paymentRuntime } from './payment-runtime';
import { DEPOSIT, ENV, fakeWoovi, NOW, OWNER, PIX_KEY, request, USDC_BASE } from '../test-utils/woovi-fake';

const OTHER = '0x3333333333333333333333333333333333333333';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SOURCE_AMOUNT = 18_518_519n; // the fake quote's 18.518519 USDC, rounded up to native units
const word = (value: string | bigint) => (typeof value === 'bigint' ? value.toString(16) : value.toLowerCase().replace(/^0x/, '')).padStart(64, '0');
const TX = `0x${'ab'.repeat(32)}`;

/** A fake Base read client: only the three reads the runtime may make, with receipts the test mines explicitly. */
function fakeBase(chainId = '0x2105') {
  let head = 100n;
  const receipts = new Map<string, unknown>(), calls: string[] = [];
  const rpc = async (method: string, params: readonly unknown[]) => {
    calls.push(method);
    if (method === 'eth_chainId') return chainId;
    if (method === 'eth_blockNumber') return `0x${head.toString(16)}`;
    if (method === 'eth_getTransactionReceipt') return receipts.get(String(params[0])) ?? null;
    throw new Error('PUBLIC_RPC_METHOD_DENIED');
  };
  const mine = (hash: string, transfer: { from?: string; to?: string; amount?: bigint; status?: string; token?: string } = {}) => receipts.set(hash, {
    status: transfer.status ?? '0x1', blockNumber: `0x${head.toString(16)}`, from: transfer.from ?? OWNER.address,
    logs: [{ address: transfer.token ?? USDC_BASE.address, topics: [TRANSFER_TOPIC, `0x${word(transfer.from ?? OWNER.address)}`, `0x${word(transfer.to ?? DEPOSIT)}`],
      data: `0x${word(transfer.amount ?? SOURCE_AMOUNT)}` }] });
  return { rpc, calls, mine, advance: (blocks: number) => { head += BigInt(blocks); } };
}
function setup(options: { executionEnabled?: boolean; adapters?: ReturnType<typeof fakeWoovi>['adapters'] } = {}) {
  const woovi = fakeWoovi(), base = fakeBase(), dir = mkdtempSync(join(tmpdir(), 'flofi-payment-'));
  let clock = NOW * 1000;
  const make = () => createPaymentFlowService({ journalDir: dir, rpc: base.rpc, adapters: options.adapters ?? woovi.adapters, provenance: 'MOCKED',
    executionEnabled: options.executionEnabled ?? true, now: () => clock });
  return { woovi, base, dir, service: make(), reopen: make, tick: (seconds: number) => { clock += seconds * 1000; } };
}
const posts = (woovi: ReturnType<typeof fakeWoovi>) => woovi.seen.filter(call => call.method === 'POST');
async function authorized(env: ReturnType<typeof setup>) {
  const simulated = await env.service.simulate(request(), OWNER.address);
  return env.service.review(simulated.id, simulated.commitment);
}
async function submitted(env: ReturnType<typeof setup>) {
  const run = await authorized(env);
  await env.service.begin(run.id, OWNER.address);
  await env.service.handoff(run.id);
  return env.service.report(run.id, { kind: 'HASH', hash: TX });
}

describe('stablecoin → Pix runtime (Woovi through the existing flow boundary)', () => {
  it('runs Review → owner-signed source → verified payout → reconciliation → settlement Evidence', async () => {
    const env = setup();
    const simulated = await env.service.simulate(request(), OWNER.address);
    expect(simulated).toMatchObject({ state: 'SIMULATED', authorization: null, attempt: null, provenance: 'MOCKED', channel: 'WHATSAPP' });
    expect(simulated.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    // Simulation only reads the provider: deposit wallets and a quote. Nothing is created at Woovi.
    expect(env.woovi.seen.map(call => call.method)).toEqual(['GET', 'GET']);

    const reviewed = await env.service.review(simulated.id, simulated.commitment);
    expect(reviewed.state).toBe('AUTHORIZED');
    expect(reviewed.authorization).toMatchObject({ origin: 'FLOFI_REVIEW', manifestHash: simulated.commitment, facts: simulated.facts, quote: simulated.quote });

    const { transaction } = await env.service.begin(simulated.id, OWNER.address);
    // ERC-20 transfer(deposit, amount) on Base for the owner's wallet: Flofi builds it, never signs or sends it.
    expect(transaction).toEqual({ chainId: '0x2105', from: OWNER.address, to: USDC_BASE.address, value: '0x0',
      data: `0xa9059cbb${word(DEPOSIT)}${word(SOURCE_AMOUNT)}` });
    expect(posts(env.woovi)).toEqual([]);
    await env.service.handoff(simulated.id);
    expect((await env.service.report(simulated.id, { kind: 'HASH', hash: TX })).state).toBe('SOURCE_SUBMITTED');

    // Not yet mined, then mined but not buried: the provider is never asked to pay out.
    expect((await env.service.observe(simulated.id)).state).toBe('SOURCE_SUBMITTED');
    env.base.mine(TX); env.base.advance(PAYMENT_SOURCE_CONFIRMATIONS - 2);
    expect((await env.service.observe(simulated.id)).state).toBe('SOURCE_SUBMITTED');
    expect(posts(env.woovi)).toEqual([]);

    env.base.advance(1);
    const pending = await env.service.observe(simulated.id);
    expect(pending.state).toBe('PAYMENT_PENDING');
    expect(pending.attempt?.source).toMatchObject({ transactionHash: TX, from: OWNER.address, to: DEPOSIT, amount: SOURCE_AMOUNT.toString(),
      confirmations: PAYMENT_SOURCE_CONFIRMATIONS });
    const correlationId = pending.attempt!.order.providerOrderId;
    expect(posts(env.woovi).map(call => [call.path.replace(/^https:\/\/[^/]+/, ''), call.body])).toEqual([
      ['/api/v1/stablecoin/payout', { value: 10_000, currency: 'USDC', pixKey: PIX_KEY, correlationId }],
      ['/api/v1/stablecoin/payout/approve', { correlationId }]]);
    // Source confirmation is not settlement.
    expect(pending.evidence).toBeNull();
    expect(paymentNeedsObservation(pending)).toBe(true);
    expect((await env.service.observe(simulated.id)).state).toBe('PAYMENT_PENDING');
    expect(env.woovi.approvals()).toBe(1);

    Object.assign(env.woovi.payouts.get(correlationId)!, { status: 'COMPLETED', endToEndId: 'E00038166202610081200abcdef12345' });
    const settled = await env.service.observe(simulated.id);
    expect(settled.state).toBe('PAYMENT_SETTLED');
    expect(settled.journal.map(step => step.to)).toEqual(['QUOTED', 'SIMULATED', 'REVIEWED', 'AUTHORIZED', 'SOURCE_SUBMITTED', 'SOURCE_CONFIRMED',
      'PAYMENT_PENDING', 'PAYMENT_SETTLED']);
    expect(settled.evidence?.bundleHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(settled.evidence?.bundle).toMatchObject({ outcome: 'PAYMENT_SETTLED', environment: 'MOCKED', manifestHash: simulated.commitment,
      destinationCommitment: simulated.facts.destinationCommitment, amountCents: '10000', source: { transactionHash: TX },
      settlement: { railStatus: 'SETTLED', railReference: 'E00038166202610081200abcdef12345', settledAmountCents: '10000', providerOrderId: correlationId } });
    // Evidence commits to the recipient; it does not carry the Pix key itself.
    expect(JSON.stringify(settled.evidence)).not.toContain(PIX_KEY);
    expect(paymentNeedsObservation(settled)).toBe(false);

    // Settled is final: re-observation and a restarted process change nothing and never approve again.
    expect(await env.service.observe(simulated.id)).toEqual(settled);
    expect(await env.reopen().load(simulated.id)).toEqual(settled);
    expect(env.woovi.approvals()).toBe(1);
  });

  it('cannot reach the provider payout around Review, the reviewed owner or the single attempt', async () => {
    const env = setup();
    const simulated = await env.service.simulate(request(), OWNER.address);
    await expect(env.service.begin(simulated.id, OWNER.address)).rejects.toThrow('PAYMENT_REVIEW_REQUIRED');
    await expect(env.service.report(simulated.id, { kind: 'HASH', hash: TX })).rejects.toThrow('PAYMENT_REPORT_INVALID');
    await expect(env.service.review(simulated.id, `0x${'00'.repeat(32)}`)).rejects.toThrow('PAYMENT_AUTHORIZATION_REPLACED');
    await env.service.review(simulated.id, simulated.commitment);
    await expect(env.service.review(simulated.id, simulated.commitment)).rejects.toThrow('PAYMENT_AUTHORIZATION_REPLACED');
    await expect(env.service.begin(simulated.id, OTHER)).rejects.toThrow('PAYMENT_OWNER_MISMATCH');
    await env.service.begin(simulated.id, OWNER.address);
    await expect(env.service.begin(simulated.id, OWNER.address)).rejects.toThrow('PAYMENT_ATTEMPT_EXISTS');

    // A withdrawn Review cannot be executed; a changed payment is a new run with a new commitment.
    const second = await env.service.simulate(request({ destination: 'outra@example.com' }), OWNER.address);
    expect(second.commitment).not.toBe(simulated.commitment);
    await env.service.review(second.id, second.commitment);
    expect((await env.service.invalidate(second.id)).state).toBe('CANCELLED');
    await expect(env.service.begin(second.id, OWNER.address)).rejects.toThrow('PAYMENT_REVIEW_REQUIRED');
    expect(posts(env.woovi)).toEqual([]);
  });

  it('expires the Review with the quote and the instruction', async () => {
    const env = setup();
    const simulated = await env.service.simulate(request(), OWNER.address);
    env.tick(61);
    await expect(env.service.review(simulated.id, simulated.commitment)).rejects.toThrow('PAYMENT_QUOTE_EXPIRED');
    const late = setup();
    const run = await authorized(late);
    late.tick(61);
    await expect(late.service.begin(run.id, OWNER.address)).rejects.toThrow('PAYMENT_QUOTE_EXPIRED');
  });

  it('rejects a durable log whose reviewed facts were rewritten', async () => {
    const env = setup();
    const run = await authorized(env);
    const path = join(env.dir, `${run.id}.jsonl`), last = JSON.parse(readFileSync(path, 'utf8').trimEnd().split('\n').at(-1)!) as PaymentRecord;
    appendFileSync(path, JSON.stringify({ ...last, facts: { ...last.facts, amountCents: '1' } }) + '\n');
    await expect(env.service.load(run.id)).rejects.toThrow('PAYMENT_STORE_CORRUPT');
  });

  it('pays out only for the exact instructed source transfer', async () => {
    for (const [transfer, state, code] of [[{ to: OTHER }, 'UNKNOWN', 'PAYMENT_SOURCE_NOT_AS_INSTRUCTED'], [{ amount: SOURCE_AMOUNT - 1n }, 'UNKNOWN', 'PAYMENT_SOURCE_NOT_AS_INSTRUCTED'],
      [{ from: OTHER }, 'UNKNOWN', 'PAYMENT_SOURCE_NOT_AS_INSTRUCTED'], [{ token: OTHER }, 'UNKNOWN', 'PAYMENT_SOURCE_NOT_AS_INSTRUCTED'],
      [{ status: '0x0' }, 'FAILED', 'PAYMENT_SOURCE_REVERTED']] as const) {
      const env = setup();
      const run = await submitted(env);
      env.base.mine(TX, transfer); env.base.advance(PAYMENT_SOURCE_CONFIRMATIONS);
      const observed = await env.service.observe(run.id);
      expect([observed.state, observed.error]).toEqual([state, code]);
      expect(posts(env.woovi)).toEqual([]);
      // A divergent source never turns into a payout on later observation either.
      expect((await env.service.observe(run.id)).state).toBe(state);
      expect(posts(env.woovi)).toEqual([]);
    }
  });

  it('refuses a read client on another chain without changing the run', async () => {
    const env = setup();
    const run = await submitted(env);
    const wrong = createPaymentFlowService({ journalDir: env.dir, rpc: fakeBase('0x1').rpc, adapters: env.woovi.adapters, provenance: 'MOCKED', executionEnabled: true,
      now: () => NOW * 1000 });
    await expect(wrong.observe(run.id)).rejects.toThrow('PAYMENT_SOURCE_CHAIN_MISMATCH');
    expect((await env.service.load(run.id)).state).toBe('SOURCE_SUBMITTED');
  });

  it('ends on a pre-broadcast wallet refusal and never re-opens begin after an unknown wallet result', async () => {
    const refused = setup();
    const run = await authorized(refused);
    await refused.service.begin(run.id, OWNER.address);
    expect((await refused.service.report(run.id, { kind: 'REJECTED', code: 'USER_REJECTED' })).state).toBe('CANCELLED');

    const unknown = setup();
    const other = await authorized(unknown);
    await unknown.service.begin(other.id, OWNER.address);
    await unknown.service.handoff(other.id);
    const waiting = await unknown.service.report(other.id, { kind: 'UNKNOWN' });
    expect([waiting.state, waiting.attempt?.state]).toEqual(['AUTHORIZED', 'SUBMISSION_RESULT_UNKNOWN']);
    await expect(unknown.service.begin(other.id, OWNER.address)).rejects.toThrow('PAYMENT_ATTEMPT_EXISTS');
    expect((await unknown.service.report(other.id, { kind: 'HASH', hash: TX })).state).toBe('SOURCE_SUBMITTED');
  });

  it('keeps execution off unless the deployment enabled it', async () => {
    const env = setup({ executionEnabled: false });
    const run = await authorized(env);
    await expect(env.service.begin(run.id, OWNER.address)).rejects.toThrow('PAYMENT_EXECUTION_NOT_ENABLED');
  });

  it('fails closed when no provider is configured for the payment', async () => {
    const env = setup({ adapters: new Map() });
    await expect(env.service.simulate(request(), OWNER.address)).rejects.toThrow('PAYMENT_PROVIDER_NOT_CONFIGURED');
  });
});

describe('payment runtime gates', () => {
  const PRODUCTION = { WOOVI_APP_ID: ENV.WOOVI_APP_ID, WOOVI_ENVIRONMENT: 'production', VERCEL: '1', VERCEL_ENV: 'production' };
  it('is off unless explicitly enabled', () => {
    expect(paymentMode({})).toBe('off');
    expect(paymentMode({ GRYLOO_PAYMENT: 'on' })).toBe('off');
    expect(paymentMode({ GRYLOO_PAYMENT: 'live' })).toBe('live');
  });
  it('selects a provider only from valid deployment configuration', () => {
    expect(paymentRuntime({}).adapters.size).toBe(0);
    expect(paymentRuntime({ WOOVI_APP_ID: ENV.WOOVI_APP_ID }).adapters.size).toBe(0);
    expect(paymentRuntime({ ...ENV, WOOVI_ENVIRONMENT: 'staging' }).adapters.size).toBe(0);
    expect(paymentRuntime({ ...ENV, WOOVI_APP_ID: 'short' }).adapters.size).toBe(0);
    // Sandbox and production never mix with the deployment environment.
    expect(paymentRuntime({ ...PRODUCTION, VERCEL_ENV: 'preview' }).adapters.size).toBe(0);
    expect(paymentRuntime({ ...ENV, VERCEL: '1', VERCEL_ENV: 'production' }).adapters.size).toBe(0);
    expect([...paymentRuntime(ENV).adapters.keys()]).toEqual(['woovi']);
  });
  it('never lets a sandbox deployment begin a payment, and production only with the owner-execution opt-in', () => {
    expect(paymentRuntime({ ...ENV, GRYLOO_PAYMENT_OWNER_EXECUTION: 'MAINNET_OWNER_APPROVED' })).toMatchObject({ provenance: 'PROVIDER_SANDBOX', executionEnabled: false });
    expect(paymentRuntime(PRODUCTION)).toMatchObject({ provenance: 'PUBLIC_MAINNET', executionEnabled: false });
    expect(paymentRuntime({ ...PRODUCTION, GRYLOO_PAYMENT_OWNER_EXECUTION: 'yes' }).executionEnabled).toBe(false);
    expect(paymentRuntime({ ...PRODUCTION, GRYLOO_PAYMENT_OWNER_EXECUTION: 'MAINNET_OWNER_APPROVED' })).toMatchObject({ provenance: 'PUBLIC_MAINNET', executionEnabled: true });
  });
  it('reads Base only through an HTTPS endpoint', () => {
    expect(() => paymentRuntime({ GRYLOO_BASE_RPC_URL: 'http://base.example' })).toThrow('ROUTER_RPC_CONFIGURATION_INVALID');
  });
});
