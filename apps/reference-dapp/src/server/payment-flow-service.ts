// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The durable runtime of one stablecoin → Pix payment, with the same method shape and storage as every other owner-signed flow
 * (simulate → review → begin → handoff → report → observe → status). Channels (chat, MCP, WhatsApp) only draft and quote through
 * `payment-service.ts`; this service is reached only through the owner-bound server action and cloud flow.
 *
 * - `simulate` authors the canonical payment node from untrusted input, quotes it with the provider the node names and records
 *   the Strategy Manifest commitment the owner reviews. Nothing is authorized.
 * - `review` records the owner's acceptance of exactly that commitment. Only here does a `ReviewedPaymentAuthorization` exist,
 *   built by the server from its own durable record, never from caller input.
 * - `begin` (deployment opt-in) returns the unsigned USDC transfer to the provider's deposit address for the owner's own wallet.
 * - `report` records the owner's transaction hash; `observe` verifies that transfer on-chain (from the owner, to the instructed
 *   address, the instructed asset and amount) before the provider is asked to pay out, then reconciles from the provider's
 *   record. Source confirmation is never settlement, and Evidence holds only verified source and provider facts.
 * Any change to the payment needs a new run: the reviewed facts, quote and commitment of a run never change.
 */
import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { assertPaymentTransition, hashRawBytes, paymentManifestFacts, type PaymentChannel, type PaymentDestinationSummary, type PaymentDraftRequest,
  type PaymentEvidence, type PaymentManifestFacts, type PaymentState, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createFileExecutionStorage, logMissing, utf8, type ExecutionStorage } from '@defi-workflow-engine/reference-executor';
import type { PaymentAdapter, PaymentOrder, PaymentProgress, PaymentQuote, ReviewedPaymentAuthorization, SourceConfirmation } from './payment-adapter.ts';
import { initiatePayment, reconcilePayment, submitPayment } from './payment-execution.ts';
import type { PaymentProvenance } from './payment-runtime.ts';
import { preparePayment } from './payment-service.ts';
import type { Rpc } from './public-testnet-service.ts';

type Node = SemanticWorkflow['nodes'][number];
export const PAYMENT_RUN_ID = /^pay-[a-f0-9]{32}$/;
/** Base blocks the owner's transfer must be buried under before the provider is asked to pay out. */
export const PAYMENT_SOURCE_CONFIRMATIONS = 3;
const CHAINS: Readonly<Record<string, string>> = Object.freeze({ 'eip155:8453': '0x2105' });
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ACCOUNT = /^0x[0-9a-fA-F]{40}$/, HASH = /^0x[0-9a-fA-F]{64}$/, COMMITMENT = /^0x[0-9a-f]{64}$/, CODE = /^[A-Z][A-Z0-9_]{1,80}$/;
const TERMINAL: readonly PaymentState[] = ['PAYMENT_SETTLED', 'FAILED', 'EXPIRED', 'CANCELLED'];
/** States in which the run waits on the chain or the provider; workers and webhooks only re-read. */
export const PAYMENT_OBSERVABLE: readonly PaymentState[] = ['SOURCE_SUBMITTED', 'SOURCE_CONFIRMED', 'PAYMENT_PENDING', 'UNKNOWN'];

export type PaymentAttempt = { readonly state: 'PREPARED' | 'SUBMITTING' | 'SUBMISSION_RESULT_UNKNOWN' | 'SUBMITTED' | 'REFUSED';
  readonly order: PaymentOrder; readonly transactionHash: string | null; readonly source: SourceConfirmation | null };
export type PaymentEvidenceBundle = { readonly bundle: { readonly kind: 'flofi/payment-evidence/v1'; readonly runId: string; readonly environment: PaymentProvenance;
  readonly outcome: 'PAYMENT_SETTLED'; readonly manifestHash: string; readonly rail: PaymentManifestFacts['rail']; readonly destinationCommitment: string;
  readonly amountCents: string; readonly provider: PaymentManifestFacts['provider']; readonly owner: PaymentManifestFacts['owner'];
  readonly quote: Pick<PaymentQuote, 'providerQuoteId' | 'feeCents' | 'sourceAmount'>; readonly source: SourceConfirmation; readonly settlement: PaymentEvidence };
  readonly bundleHash: string };
export type PaymentRecord = {
  readonly id: string; readonly provenance: PaymentProvenance; readonly createdAt: string; readonly channel: PaymentChannel;
  readonly node: Node; readonly destination: PaymentDestinationSummary; readonly facts: PaymentManifestFacts; readonly quote: PaymentQuote;
  /** The Strategy Manifest commitment the owner reviews and accepts (`review`). */
  readonly commitment: string;
  readonly state: PaymentState; readonly authorization: ReviewedPaymentAuthorization | null; readonly attempt: PaymentAttempt | null;
  readonly progress: PaymentProgress | null; readonly evidence: PaymentEvidenceBundle | null;
  readonly journal: readonly { readonly from: PaymentState; readonly to: PaymentState; readonly code: string | null; readonly at: string }[];
  readonly error: string | null };
export type PaymentTransaction = { readonly chainId: string; readonly from: string; readonly to: string; readonly value: '0x0'; readonly data: string };
export type PaymentWalletResult = { kind: 'HASH'; hash: string } | { kind: 'UNKNOWN' | 'REJECTED'; code?: string };

function fail(code: string): never { throw new Error(code); }
const idCheck = (id: string) => PAYMENT_RUN_ID.test(id) ? id : fail('PAYMENT_ID_INVALID');
/** Sorted-key JSON, so a commitment or bundle hash does not depend on property order. */
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
  : JSON.stringify(value);
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const digest = (value: unknown) => hashRawBytes('intent', new TextEncoder().encode(stable(value)));
const word = (hex: string) => hex.toLowerCase().replace(/^0x/, '').padStart(64, '0');
/** The provider payout id a webhook names, mapped back to its run (written once, at `begin`). */
export const paymentOrderIndex = (providerOrderId: string) => `${/^[A-Za-z0-9-]{8,96}$/.test(providerOrderId) ? providerOrderId : fail('PAYMENT_ORDER_MISMATCH')}.payment`;

export function createPaymentFlowService(input: { storage?: ExecutionStorage; journalDir?: string; rpc: Rpc; adapters: ReadonlyMap<string, PaymentAdapter>;
  provenance: PaymentProvenance; executionEnabled: boolean; now?: () => number }) {
  // Local mode keeps a journal directory; cloud mode supplies shared durable storage instead.
  if (!input.storage && (!input.journalDir || !isAbsolute(input.journalDir) || input.journalDir.includes('/.git/'))) fail('PAYMENT_STORAGE_INVALID');
  const { log, leases } = input.storage ?? createFileExecutionStorage(input.journalDir!, 'PAYMENT_BUSY');
  const now = input.now ?? Date.now, seconds = () => Math.floor(now() / 1000), at = () => new Date(now()).toISOString();
  const path = (id: string) => idCheck(id) + '.jsonl';
  /** Append-only history: every line is a run of the same reviewed payment and never rewrites what an earlier line established. */
  const validate = (bytes: Uint8Array) => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.endsWith('\n') || bytes.length > 4_194_304) fail('PAYMENT_STORE_CORRUPT');
    let prior: PaymentRecord | null = null;
    for (const line of text.trimEnd().split('\n')) {
      const record = JSON.parse(line) as PaymentRecord;
      if (!PAYMENT_RUN_ID.test(record.id) || record.provenance !== input.provenance || !COMMITMENT.test(record.commitment)
        || record.evidence && record.state !== 'PAYMENT_SETTLED' || record.authorization && record.authorization.manifestHash !== record.commitment) fail('PAYMENT_STORE_CORRUPT');
      if (prior) {
        const a = prior.attempt, b = record.attempt;
        if (record.id !== prior.id || record.commitment !== prior.commitment || !same(record.facts, prior.facts) || !same(record.quote, prior.quote)
          || !same(record.destination, prior.destination) || record.journal.length < prior.journal.length || !same(record.journal.slice(0, prior.journal.length), prior.journal)
          || TERMINAL.includes(prior.state) && record.state !== prior.state || prior.authorization && !same(prior.authorization, record.authorization)
          || prior.evidence && !same(prior.evidence, record.evidence)
          || a && (!b || !same(a.order, b.order) || a.transactionHash && a.transactionHash !== b.transactionHash || a.source && !same(a.source, b.source))) fail('PAYMENT_STORE_CORRUPT');
      }
      prior = record;
    }
  };
  const load = async (id: string): Promise<PaymentRecord> => {
    const bytes = await log.read(path(id)); if (!bytes) throw logMissing(path(id)); validate(bytes);
    return JSON.parse(utf8(bytes).trimEnd().split('\n').at(-1)!) as PaymentRecord;
  };
  const save = async (record: PaymentRecord): Promise<PaymentRecord> => {
    const prior = await log.read(path(record.id)), next = new TextEncoder().encode(utf8(prior) + JSON.stringify(record) + '\n');
    if (prior === null) { if (!await log.create(path(record.id), next)) fail('PAYMENT_STORE_CORRUPT'); } else await log.extend(path(record.id), next, validate);
    return record;
  };
  const locked = <T,>(id: string, action: () => Promise<T>): Promise<T> => leases.hold(idCheck(id), action);
  /** One transition, checked against the canonical lifecycle and the evidence each claim needs. */
  const move = (record: PaymentRecord, to: PaymentState, code: string | null, evidence?: PaymentEvidence): PaymentRecord => {
    if (to === record.state) return record;
    assertPaymentTransition(record.state, to, evidence);
    return { ...record, state: to, journal: [...record.journal, { from: record.state, to, code, at: at() }] };
  };

  /** The owner's transfer as the chain records it, or why it cannot (yet) count as the instructed source transfer. */
  async function verifySource(record: PaymentRecord, attempt: PaymentAttempt & { transactionHash: string }):
    Promise<{ kind: 'PENDING' } | { kind: 'REVERTED' } | { kind: 'DIVERGENT' } | { kind: 'CONFIRMED'; source: SourceConfirmation }> {
    const transfer = attempt.order.sourceTransfer, owner = record.facts.owner.address.toLowerCase();
    if (await input.rpc('eth_chainId', []) !== CHAINS[transfer.chainId]) fail('PAYMENT_SOURCE_CHAIN_MISMATCH');
    const receipt = await input.rpc('eth_getTransactionReceipt', [attempt.transactionHash]) as { status?: unknown; blockNumber?: unknown; from?: unknown;
      logs?: unknown } | null;
    if (!receipt) return { kind: 'PENDING' };
    if (receipt.status === '0x0') return { kind: 'REVERTED' };
    if (receipt.status !== '0x1' || typeof receipt.blockNumber !== 'string' || !Array.isArray(receipt.logs)) fail('PAYMENT_SOURCE_RECEIPT_INVALID');
    const asset = transfer.asset as { address?: string };
    const moved = (receipt.logs as { address?: unknown; topics?: unknown; data?: unknown }[]).filter(entry => typeof entry.address === 'string'
      && entry.address.toLowerCase() === asset.address?.toLowerCase() && Array.isArray(entry.topics) && entry.topics[0] === TRANSFER_TOPIC);
    const exact = moved.length === 1 && String(receipt.from).toLowerCase() === owner && (moved[0]!.topics as string[])[1]?.toLowerCase() === '0x' + word(owner)
      && (moved[0]!.topics as string[])[2]?.toLowerCase() === '0x' + word(transfer.to) && typeof moved[0]!.data === 'string'
      && /^0x[0-9a-fA-F]{1,64}$/.test(moved[0]!.data) && BigInt(moved[0]!.data) === BigInt(transfer.amount);
    // Funds moved, but not as instructed: never paid out, never called a plain failure.
    if (!exact) return { kind: 'DIVERGENT' };
    const head = await input.rpc('eth_blockNumber', []);
    if (typeof head !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(head) || !/^0x[0-9a-fA-F]{1,16}$/.test(receipt.blockNumber)) fail('PAYMENT_SOURCE_RECEIPT_INVALID');
    const confirmations = Number(BigInt(head) - BigInt(receipt.blockNumber) + 1n);
    if (confirmations < PAYMENT_SOURCE_CONFIRMATIONS) return { kind: 'PENDING' };
    return { kind: 'CONFIRMED', source: { chainId: transfer.chainId, transactionHash: attempt.transactionHash.toLowerCase(), from: owner,
      to: transfer.to.toLowerCase(), asset: transfer.asset, amount: transfer.amount, confirmations } };
  }
  function evidenceOf(record: PaymentRecord, source: SourceConfirmation, settlement: PaymentEvidence): PaymentEvidenceBundle {
    const bundle: PaymentEvidenceBundle['bundle'] = { kind: 'flofi/payment-evidence/v1', runId: record.id, environment: record.provenance, outcome: 'PAYMENT_SETTLED',
      manifestHash: record.commitment, rail: record.facts.rail, destinationCommitment: record.facts.destinationCommitment, amountCents: record.facts.amountCents,
      provider: record.facts.provider, owner: record.facts.owner,
      quote: { providerQuoteId: record.quote.providerQuoteId, feeCents: record.quote.feeCents, sourceAmount: record.quote.sourceAmount }, source, settlement };
    return { bundle, bundleHash: digest(bundle) };
  }
  /** Applies the provider's view; settlement is recorded with Evidence built only from the verified source and provider facts. */
  function apply(record: PaymentRecord, progress: PaymentProgress, source: SourceConfirmation): PaymentRecord {
    let next = record;
    // A provider that settled when first observed after confirmation went through PAYMENT_PENDING (it accepted the order).
    if (record.state === 'SOURCE_CONFIRMED' && progress.state === 'PAYMENT_SETTLED') next = move(next, 'PAYMENT_PENDING', null, progress.evidence);
    next = { ...move(next, progress.state, progress.code, progress.evidence), progress, error: progress.code };
    return progress.state === 'PAYMENT_SETTLED' ? { ...next, evidence: evidenceOf(next, source, progress.evidence) } : next;
  }

  return {
    load,
    get executionEnabled() { return input.executionEnabled; },
    /** Read-only: drafts, validates and quotes the payment and records the commitment to review. Nothing is authorized. */
    async simulate(request: PaymentDraftRequest, owner: string): Promise<PaymentRecord> {
      if (typeof owner !== 'string' || !ACCOUNT.test(owner)) fail('PAYMENT_OWNER_REQUIRED');
      const id = 'pay-' + randomBytes(16).toString('hex'), when = new Date(now());
      const account = { chainId: String(request?.sourceAsset?.chainId ?? ''), address: owner.toLowerCase() };
      const prepared = await preparePayment(id, request, account, { now: when, adapters: input.adapters });
      if (prepared.status !== 'QUOTED') fail(prepared.code);
      const facts = paymentManifestFacts(prepared.draft.node, account);
      const commitment = digest({ kind: 'flofi/payment-review/v1', id, facts, quote: prepared.quote });
      let record: PaymentRecord = { id, provenance: input.provenance, createdAt: when.toISOString(), channel: prepared.draft.channel, node: prepared.draft.node,
        destination: prepared.draft.destination, facts, quote: prepared.quote, commitment, state: 'DRAFT', authorization: null, attempt: null, progress: null,
        evidence: null, journal: [], error: null };
      record = move(move(record, 'QUOTED', null), 'SIMULATED', null);
      return save(record);
    },
    /** The owner accepted the Strategy Manifest with exactly this commitment, while its quote and instruction are still live. */
    async review(id: string, commitment: string): Promise<PaymentRecord> { return locked(id, async () => {
      const record = await load(id);
      if (record.state !== 'SIMULATED' || record.commitment !== commitment) fail('PAYMENT_AUTHORIZATION_REPLACED');
      if (seconds() >= record.facts.expiresAt) return save(move(record, 'EXPIRED', 'PAYMENT_EXPIRED'));
      if (seconds() >= record.quote.expiresAt) fail('PAYMENT_QUOTE_EXPIRED');
      const authorization: ReviewedPaymentAuthorization = { origin: 'FLOFI_REVIEW', manifestHash: record.commitment, facts: record.facts, quote: record.quote,
        acceptedAt: seconds() };
      return save({ ...move(move(record, 'REVIEWED', null), 'AUTHORIZED', null), authorization, error: null });
    }); },
    /** Withdraws the Review before anything was signed. A changed payment is simulated again as a new run. */
    async invalidate(id: string): Promise<PaymentRecord> { return locked(id, async () => {
      const record = await load(id);
      if (record.state === 'CANCELLED') return record;
      if (record.attempt && record.attempt.state !== 'PREPARED' || !['SIMULATED', 'REVIEWED', 'AUTHORIZED'].includes(record.state)) fail('PAYMENT_INVALIDATE_TOO_LATE');
      return save({ ...move(record, 'CANCELLED', 'PAYMENT_AUTHORIZATION_INVALIDATED'), error: 'PAYMENT_AUTHORIZATION_INVALIDATED' });
    }); },
    /** The unsigned source transfer for the owner's wallet. Re-checks the Review against the run; one economic attempt per run. */
    async begin(id: string, owner: string): Promise<{ record: PaymentRecord; transaction: PaymentTransaction }> { return locked(id, async () => {
      if (!input.executionEnabled) fail('PAYMENT_EXECUTION_NOT_ENABLED');
      const record = await load(id);
      if (record.state !== 'AUTHORIZED' || !record.authorization) fail('PAYMENT_REVIEW_REQUIRED');
      if (record.attempt) fail('PAYMENT_ATTEMPT_EXISTS');
      if (typeof owner !== 'string' || owner.toLowerCase() !== record.facts.owner.address) fail('PAYMENT_OWNER_MISMATCH');
      const order = await initiatePayment({ authorization: record.authorization, current: record.facts, destination: record.destination, adapters: input.adapters,
        now: seconds() });
      const chainHex = CHAINS[order.sourceTransfer.chainId], asset = order.sourceTransfer.asset as { address?: string };
      if (!chainHex || !asset.address || !ACCOUNT.test(asset.address) || !ACCOUNT.test(order.sourceTransfer.to)) fail('PAYMENT_SOURCE_UNSUPPORTED_BY_PROVIDER');
      // The webhook names only the provider's payout id: map it back to this run once, before anything can be signed.
      const index = paymentOrderIndex(order.providerOrderId), existing = await log.read(index);
      if (existing === null ? !await log.create(index, new TextEncoder().encode(record.id + '\n')) : utf8(existing).trim() !== record.id) fail('PAYMENT_ORDER_ALREADY_BOUND');
      const saved = await save({ ...record, attempt: { state: 'PREPARED', order, transactionHash: null, source: null }, error: null });
      return { record: saved, transaction: { chainId: chainHex, from: record.facts.owner.address, to: asset.address.toLowerCase(), value: '0x0',
        data: '0xa9059cbb' + word(order.sourceTransfer.to) + word(BigInt(order.sourceTransfer.amount).toString(16)) } };
    }); },
    /** The owner's wallet prompt is about to open; from here the run waits for the wallet's result. */
    async handoff(id: string): Promise<PaymentRecord> { return locked(id, async () => {
      const record = await load(id), attempt = record.attempt;
      if (record.state !== 'AUTHORIZED' || attempt?.state !== 'PREPARED') fail('PAYMENT_HANDOFF_INVALID');
      if (seconds() >= record.quote.expiresAt || seconds() >= record.facts.expiresAt) fail('PAYMENT_QUOTE_EXPIRED');
      return save({ ...record, attempt: { ...attempt, state: 'SUBMITTING' } });
    }); },
    /** The wallet's own result. Only a pre-broadcast refusal ends the run; an unknown result waits for the hash or observation. */
    async report(id: string, result: PaymentWalletResult): Promise<PaymentRecord> { return locked(id, async () => {
      const record = await load(id), attempt = record.attempt;
      if (!attempt || !['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(attempt.state) || record.state !== 'AUTHORIZED') fail('PAYMENT_REPORT_INVALID');
      if (result?.kind === 'HASH') {
        if (typeof result.hash !== 'string' || !HASH.test(result.hash)) fail('PAYMENT_REPORT_INVALID');
        return save({ ...move(record, 'SOURCE_SUBMITTED', null), attempt: { ...attempt, state: 'SUBMITTED', transactionHash: result.hash.toLowerCase() }, error: null });
      }
      const code = typeof result?.code === 'string' && CODE.test(result.code) ? result.code : null;
      if (result?.kind === 'REJECTED' && attempt.state !== 'SUBMISSION_RESULT_UNKNOWN')
        return save({ ...move(record, 'CANCELLED', code ?? 'PAYMENT_WALLET_REJECTED'), attempt: { ...attempt, state: 'REFUSED' }, error: code ?? 'PAYMENT_WALLET_REJECTED' });
      if (result?.kind === 'UNKNOWN' || result?.kind === 'REJECTED')
        return save({ ...record, attempt: { ...attempt, state: 'SUBMISSION_RESULT_UNKNOWN' }, error: code ?? 'PAYMENT_WALLET_RESULT_UNKNOWN' });
      return fail('PAYMENT_REPORT_INVALID');
    }); },
    /**
     * Verifies the source transfer, then has the provider pay out (idempotent by the provider's correlation id) and reconciles
     * from the provider's own record. A webhook or worker only triggers this; nothing a caller sends is taken as evidence.
     */
    async observe(id: string): Promise<PaymentRecord> { return locked(id, async () => {
      let record = await load(id);
      const attempt = record.attempt;
      if (!PAYMENT_OBSERVABLE.includes(record.state) && record.state !== 'RECOVERY_REQUIRED' || !attempt?.transactionHash || !record.authorization) return record;
      const common = { authorization: record.authorization, current: record.facts, destination: record.destination, adapters: input.adapters, now: seconds() };
      let source = attempt.source;
      if (!source) {
        const verified = await verifySource(record, attempt as PaymentAttempt & { transactionHash: string });
        if (verified.kind === 'PENDING') return record;
        if (verified.kind === 'REVERTED') return save({ ...move(record, 'FAILED', 'PAYMENT_SOURCE_REVERTED'), error: 'PAYMENT_SOURCE_REVERTED' });
        if (verified.kind === 'DIVERGENT') return record.state === 'UNKNOWN' ? record
          : save({ ...move(record, 'UNKNOWN', 'PAYMENT_SOURCE_NOT_AS_INSTRUCTED'), error: 'PAYMENT_SOURCE_NOT_AS_INSTRUCTED' });
        source = verified.source;
        const confirmed: PaymentEvidence = { providerOrderId: attempt.order.providerOrderId, sourceTransaction: { chainId: source.chainId, hash: source.transactionHash,
          confirmations: source.confirmations }, railStatus: 'NOT_STARTED', railReference: null, settledAmountCents: null, feesCents: null, observedAt: at(),
          reconciliation: 'NONE' };
        record = await save({ ...move(record, 'SOURCE_CONFIRMED', null, confirmed), attempt: { ...attempt, source }, error: null });
      }
      // Pay-out happens only from a verified source; a provider that already holds the payout is only re-read (never re-approved).
      const progress = record.state === 'SOURCE_CONFIRMED' || record.state === 'UNKNOWN'
        ? await submitPayment({ ...common, order: attempt.order, source, previous: record.state })
        : await reconcilePayment({ current: record.facts, providerOrderId: attempt.order.providerOrderId, source, adapters: input.adapters, now: seconds(),
          previous: record.state });
      return save(apply(record, progress, source));
    }); },
    /** Provider identity of a payout id from a verified webhook, mapped to its run (null when FloFi never created it). */
    async runForOrder(providerOrderId: string): Promise<string | null> {
      const bytes = await log.read(paymentOrderIndex(providerOrderId)), id = bytes ? utf8(bytes).trim() : null;
      return id && PAYMENT_RUN_ID.test(id) ? id : null;
    },
    adapter: (providerId: string) => input.adapters.get(providerId) ?? null,
  };
}
export type PaymentFlowService = ReturnType<typeof createPaymentFlowService>;
/** Runs whose source or provider state can still change without the owner. */
export const paymentNeedsObservation = (value: unknown) => {
  const record = value as PaymentRecord;
  return PAYMENT_OBSERVABLE.includes(record.state) && !!record.attempt?.transactionHash && !(record.state === 'UNKNOWN' && !record.attempt.source);
};
