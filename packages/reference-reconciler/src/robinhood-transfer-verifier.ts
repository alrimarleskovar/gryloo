// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RH-DEMO-001 strictly read-only independent verifier. It takes an archived execution record and proves it
 * against public Robinhood Testnet state using only allowlisted read methods. It has no wallet, no signing
 * and no submission path. It recomputes artifact hashes and recovers the transaction signer from the raw
 * signature, so the claim does not rest on any application-generated result.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hashArtifactBytes, hashJournalBytes, hashSupplyValue, type EvidenceBundle, type ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
import { rlpEncode, rlpInteger, fromHex, toHex, type NativeTransferReview } from '@defi-workflow-engine/reference-compiler';

export const TRANSFER_VERIFIER_METHODS = Object.freeze(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_getBalance', 'eth_getTransactionCount', 'eth_getCode'] as const);
export type TransferVerifierMethod = typeof TRANSFER_VERIFIER_METHODS[number];
export type TransferVerifierRpc = (method: TransferVerifierMethod, params: readonly unknown[]) => Promise<unknown>;
/** The allowlist; a transport calls this immediately before any egress. */
export function assertTransferVerifierMethod(method: string): asserts method is TransferVerifierMethod {
  if (!(TRANSFER_VERIFIER_METHODS as readonly string[]).includes(method)) throw new Error('READ_ONLY_METHOD_REQUIRED');
}
export type ArchivedTransfer = { bundle: EvidenceBundle; bundleHash: string; publicExecution: Record<string, unknown>;
  artifacts: { journal: ExecutionJournal; review: NativeTransferReview } };
export type TransferVerification = { status: 'INDEPENDENTLY_RECONCILED'; evidence: 'TESTNET_EXECUTED' | 'MOCKED'; chainId: number;
  transactionHash: string; signer: string; blockNumber: number; blockHash: string; finality: 'L2_INCLUDED' | 'L1_SAFE' | 'L1_FINALIZED';
  fee: string; balanceBefore: string; balanceAfter: string; nonce: string; economicSubmissions: 1; checks: readonly string[] };

const fail = (code: string): never => { throw new Error(code); };
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/, HASH = /^0x[0-9a-f]{64}$/;
const q = (value: unknown): bigint => typeof value === 'string' && QUANTITY.test(value.toLowerCase()) ? BigInt(value) : fail('VERIFIER_RPC_INVALID');
const h = (value: unknown): string => typeof value === 'string' && HASH.test(value.toLowerCase()) ? value.toLowerCase() : fail('VERIFIER_RPC_INVALID');
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('VERIFIER_RPC_INVALID');
const hex = (value: unknown): Uint8Array => typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/.test(value.toLowerCase()) ? fromHex(value.toLowerCase()) : fail('VERIFIER_RPC_INVALID');

/** Recovers the signer from the raw fields and proves the fields hash to the transaction hash. */
export function recoverTransferSigner(tx: Record<string, unknown>, chainId: number): string {
  const type = typeof tx.type === 'string' ? tx.type.toLowerCase() : '';
  const to = hex(tx.to), data = hex(tx.input), r = q(tx.r), s = q(tx.s);
  if (to.length !== 20 || r <= 0n || s <= 0n || s > secp256k1.Point.CURVE().n / 2n) fail('VERIFIER_SIGNATURE_INVALID');
  let unsigned: Uint8Array, signed: Uint8Array, parity: bigint;
  if (type === '0x2') {
    if (!Array.isArray(tx.accessList) || tx.accessList.length) fail('VERIFIER_TRANSACTION_SHAPE');
    parity = q(tx.yParity ?? tx.v);
    const fields = [rlpInteger(BigInt(chainId)), rlpInteger(q(tx.nonce)), rlpInteger(q(tx.maxPriorityFeePerGas)), rlpInteger(q(tx.maxFeePerGas)),
      rlpInteger(q(tx.gas)), to, rlpInteger(q(tx.value)), data, []];
    unsigned = Uint8Array.of(2, ...rlpEncode(fields));
    signed = Uint8Array.of(2, ...rlpEncode([...fields, rlpInteger(parity), rlpInteger(r), rlpInteger(s)]));
  } else if (type === '0x0') {
    const v = q(tx.v);
    parity = v - BigInt(chainId) * 2n - 35n;
    const common = [rlpInteger(q(tx.nonce)), rlpInteger(q(tx.gasPrice)), rlpInteger(q(tx.gas)), to, rlpInteger(q(tx.value)), data];
    unsigned = rlpEncode([...common, rlpInteger(BigInt(chainId)), rlpInteger(0n), rlpInteger(0n)]);
    signed = rlpEncode([...common, rlpInteger(v), rlpInteger(r), rlpInteger(s)]);
  } else return fail('VERIFIER_TRANSACTION_TYPE_UNSUPPORTED');
  if (parity !== 0n && parity !== 1n) fail('VERIFIER_SIGNATURE_INVALID');
  if (toHex(keccak_256(signed)) !== h(tx.hash)) fail('VERIFIER_TRANSACTION_HASH_MISMATCH');
  const digest = keccak_256(unsigned), word = (n: bigint) => n.toString(16).padStart(64, '0');
  const signature = secp256k1.Signature.fromBytes(fromHex('0x' + word(r) + word(s)), 'compact').addRecoveryBit(Number(parity));
  const publicKey = signature.recoverPublicKey(digest).toBytes(false);
  if (!secp256k1.verify(signature.toBytes('compact'), digest, publicKey, { prehash: false })) fail('VERIFIER_SIGNATURE_INVALID');
  return toHex(keccak_256(publicKey.subarray(1)).subarray(12));
}

/** Static checks of the archive: hashes, commitment, and a journal with exactly one economic submission. */
function verifyArchive(archive: ArchivedTransfer, expected: 'TESTNET_EXECUTED' | 'MOCKED'): string[] {
  const { bundle, artifacts: { review, journal } } = archive, encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  if (hashArtifactBytes('evidence-bundle', encode(bundle)) !== archive.bundleHash) fail('VERIFIER_BUNDLE_HASH_MISMATCH');
  if (bundle.environment !== expected || bundle.outcome !== 'RECONCILED') fail('VERIFIER_EVIDENCE_LEVEL_MISMATCH');
  const { commitment, ...content } = review;
  if (hashSupplyValue(content) !== commitment) fail('VERIFIER_REVIEW_COMMITMENT_MISMATCH');
  if (hashArtifactBytes('strategy-manifest', encode(review.manifest)) !== bundle.manifestHash ||
      hashArtifactBytes('execution-plan', encode(review.plan)) !== bundle.executionPlanHash ||
      hashArtifactBytes('semantic-workflow', encode(review.workflow)) !== bundle.semanticWorkflowHash ||
      journal.manifestHash !== bundle.manifestHash || journal.executionPlanHash !== bundle.executionPlanHash) fail('VERIFIER_ARTIFACT_HASH_MISMATCH');
  const payload = hashSupplyValue({ ...review.transaction, nonce: review.nonce }, 'payload');
  const steps = review.plan.segments.flatMap(s => s.steps);
  if (steps.length !== 1 || steps[0]!.executionKind !== 'DIRECT_TRANSACTION' || !('payloadHash' in steps[0]!) || steps[0].payloadHash !== payload) fail('VERIFIER_PLAN_MISMATCH');
  // The journal hash chain is re-derived; its head must be the bundle's.
  if (hashJournalBytes(encode(journal)).at(-1) !== bundle.journalHeadHash) fail('VERIFIER_JOURNAL_MISMATCH');
  const attempts = journal.entries.filter(e => e.level === 'attempt'), path = attempts.map(e => e.toState);
  if (new Set(attempts.map(e => e.entityId)).size !== 1 || path.filter(s => s === 'SUBMITTING').length !== 1 || path[0] !== 'PREPARED' || path[1] !== 'SUBMITTING' ||
      path.at(-1) !== 'CONFIRMED') fail('VERIFIER_SUBMISSION_COUNT_MISMATCH');
  return ['evidence bundle hash recomputed', 'review commitment recomputed', 'manifest, plan and workflow hashes match the bundle',
    'plan payload hash binds the exact reviewed transaction and nonce', 'journal hash chain recomputed; head matches the bundle',
    'journal holds exactly one attempt with exactly one SUBMITTING transition (PREPARED → SUBMITTING → … → CONFIRMED)'];
}

export async function verifyArchivedNativeTransfer(archive: ArchivedTransfer, transport: TransferVerifierRpc,
  options: { expectedEnvironment?: 'TESTNET_EXECUTED' | 'MOCKED'; chainId?: number; minimumConfirmations?: number } = {}): Promise<TransferVerification> {
  const rpc: TransferVerifierRpc = (method, params) => { assertTransferVerifierMethod(method); return transport(method, params); };
  const expected = options.expectedEnvironment ?? 'TESTNET_EXECUTED', chainId = options.chainId ?? 46630, review = archive.artifacts.review;
  const checks = verifyArchive(archive, expected);
  const claim = archive.publicExecution, hash = h(claim.transactionHash);
  if (review.chainId !== chainId || claim.chainId !== chainId) fail('VERIFIER_WRONG_CHAIN');
  if (q(await rpc('eth_chainId', [])) !== BigInt(chainId)) fail('VERIFIER_WRONG_CHAIN');
  const [txValue, receiptValue] = await Promise.all([rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash])]);
  const tx = record(txValue), receipt = record(receiptValue);
  const signer = recoverTransferSigner(tx, chainId);
  if (signer !== review.account || String(tx.from).toLowerCase() !== signer) fail('VERIFIER_SIGNER_MISMATCH');
  if (String(tx.to).toLowerCase() !== review.recipient || q(tx.value) !== BigInt(review.value) || tx.input !== '0x' ||
      q(tx.nonce) !== BigInt(review.nonce) || q(tx.chainId) !== BigInt(chainId)) fail('VERIFIER_TRANSACTION_MISMATCH');
  const offered = String(tx.type).toLowerCase() === '0x2' ? q(tx.maxFeePerGas) : q(tx.gasPrice);
  if (q(tx.gas) > BigInt(review.gasLimit) || offered > BigInt(review.maxFeePerGas)) fail('VERIFIER_FEE_BOUND_MISMATCH');
  if (h(receipt.transactionHash) !== hash || q(receipt.status) !== 1n || !Array.isArray(receipt.logs) || receipt.logs.length ||
      String(receipt.from).toLowerCase() !== signer || String(receipt.to).toLowerCase() !== review.recipient) fail('VERIFIER_RECEIPT_MISMATCH');
  const blockNumber = Number(q(receipt.blockNumber)), blockHash = h(receipt.blockHash);
  const canonical = record(await rpc('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, false]));
  if (h(canonical.hash) !== blockHash || h(tx.blockHash) !== blockHash || !Array.isArray(canonical.transactions) ||
      !canonical.transactions.some(item => typeof item === 'string' && item.toLowerCase() === hash)) fail('VERIFIER_NOT_CANONICAL');
  const latest = Number(q(await rpc('eth_blockNumber', [])));
  if (latest < blockNumber + (options.minimumConfirmations ?? 2)) fail('VERIFIER_AWAITING_CONFIRMATIONS');
  const fee = q(receipt.gasUsed) * q(receipt.effectiveGasPrice);
  if (q(receipt.gasUsed) > q(tx.gas) || q(receipt.effectiveGasPrice) > offered || fee > BigInt(review.feeBudget)) fail('VERIFIER_FEE_BOUND_MISMATCH');
  const before = `0x${(blockNumber - 1).toString(16)}`, after = `0x${blockNumber.toString(16)}`, owner = review.account;
  const [b0, b1, n0, n1, code] = await Promise.all([rpc('eth_getBalance', [owner, before]).then(q), rpc('eth_getBalance', [owner, after]).then(q),
    rpc('eth_getTransactionCount', [owner, before]).then(q), rpc('eth_getTransactionCount', [owner, after]).then(q), rpc('eth_getCode', [owner, after])]);
  if (n0 !== BigInt(review.nonce) || n1 !== n0 + 1n) fail('VERIFIER_NONCE_MISMATCH');
  if (code !== '0x') fail('VERIFIER_OWNER_NOT_EOA');
  if (b0 - b1 !== fee) fail('VERIFIER_BALANCE_MISMATCH');
  // Every archived claim must equal the independently derived value.
  const derived: Record<string, unknown> = { account: owner, recipient: review.recipient, value: review.value, nonce: review.nonce, transactionHash: hash,
    blockNumber, blockHash, fee: fee.toString(), gasUsed: q(receipt.gasUsed).toString(), effectiveGasPrice: q(receipt.effectiveGasPrice).toString(),
    balanceBefore: b0.toString(), balanceAfter: b1.toString(), nonceBefore: n0.toString(), nonceAfter: n1.toString(), submissions: 1 };
  for (const [key, value] of Object.entries(derived)) if (claim[key] !== value) fail('VERIFIER_CLAIM_MISMATCH_' + key.replace(/[A-Z]/g, c => '_' + c).toUpperCase());
  const bundleFee = archive.bundle.reconciliation.fees[0]?.amount, bundleBalance = archive.bundle.reconciliation.balances[0]?.amount;
  if (bundleFee !== fee.toString() || bundleBalance !== b1.toString()) fail('VERIFIER_CLAIM_MISMATCH_BUNDLE');
  const tag = async (name: 'safe' | 'finalized') => { try { return Number(q(record(await rpc('eth_getBlockByNumber', [name, false])).number)); } catch { return -1; } };
  const [safe, finalized] = [await tag('safe'), await tag('finalized')];
  const finality = finalized >= blockNumber ? 'L1_FINALIZED' : safe >= blockNumber ? 'L1_SAFE' : 'L2_INCLUDED';
  return { status: 'INDEPENDENTLY_RECONCILED', evidence: expected, chainId, transactionHash: hash, signer, blockNumber, blockHash, finality,
    fee: fee.toString(), balanceBefore: b0.toString(), balanceAfter: b1.toString(), nonce: review.nonce, economicSubmissions: 1,
    checks: [...checks, 'chain ID read from the public RPC', 'signer recovered from the raw signature; fields re-hash to the transaction hash',
      'recipient, value, empty calldata, nonce and chain match the Review', 'gas limit and fee price within the reviewed bounds',
      'successful receipt with no logs', 'inclusion block is canonical and contains the transaction', `at least ${options.minimumConfirmations ?? 2} confirmations`,
      'owner nonce moved exactly N → N+1 in the inclusion block', 'owner balance moved by exactly gasUsed × effectiveGasPrice', 'owner is still an EOA',
      'every archived claim equals the independently derived value', `finality: ${finality}`] };
}
