// SPDX-License-Identifier: AGPL-3.0-only
/** Finalized mainnet account/transaction observations. Relay status is a hint, never settlement evidence. */
import { addressBytes, buildMerkleTreeFromRelay, computeUtxoCommitment, createCloakRpc, deriveInputNullifierPdas,
  fetchAccountBytes, getShieldPoolPDAs, getSwapStatePDA, matchSwapRefundLeaf, toAddress, verifyUtxos, type Utxo } from '@cloak.dev/sdk';
import type { CloakPublicObservation } from '@defi-workflow-engine/reference-reconciler';
import { CLOAK_RUNTIME, restorePrivateNote } from './cloak-adapter';
import { CLOAK_READ_RPC } from './live-proof';
import { assertCloakBoundRequest, bytesBase64, decodeExactBase64, fieldHex, type CloakProperties, type CloakSwapRequest } from './provider-contract';
import type { PrivateState } from './vault';

type Instruction = { programIdIndex: number; accounts: number[]; data: string };
export type CloakChainTransaction = { slot: bigint | number; meta: { err: unknown; logMessages: string[] | null;
  loadedAddresses?: { writable: string[]; readonly: string[] }; preTokenBalances: TokenBalance[] | null; postTokenBalances: TokenBalance[] | null } | null;
  transaction: { message: { accountKeys: string[]; instructions: Instruction[] } } };
type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };
const fail = (code: string): never => { throw new Error(code); };
const be = (bytes: Uint8Array) => BigInt('0x' + Array.from(bytes, v => v.toString(16).padStart(2, '0')).join(''));
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// SDK 0.2.5 dist/index.js:4164–4167, private refund Phase 1 (not the overview's generic close tag 5).
const PRIVATE_REFUND_PHASE1_TAG = 13, PRIVATE_REFUND_PHASE1_WIRE_LENGTH = 41;
export function decodeCloakInstruction(text: string): Uint8Array {
  if (typeof text !== 'string' || !text || text.length > 4096) return fail('CLOAK_CHAIN_INSTRUCTION_INVALID');
  let value = 0n;
  for (const c of text) { const n = alphabet.indexOf(c); if (n < 0) return fail('CLOAK_CHAIN_INSTRUCTION_INVALID'); value = value * 58n + BigInt(n); }
  const bytes: number[] = []; while (value) { bytes.unshift(Number(value & 255n)); value >>= 8n; }
  return Uint8Array.from([...Array<number>(text.length - text.replace(/^1+/, '').length).fill(0), ...bytes]);
}
const keysOf = (tx: CloakChainTransaction) => [...tx.transaction.message.accountKeys,
  ...tx.meta?.loadedAddresses?.writable ?? [], ...tx.meta?.loadedAddresses?.readonly ?? []];
function cloakInstructions(tx: CloakChainTransaction, state: string, tag: number) {
  if (!tx.meta || tx.meta.err !== null || !Number.isSafeInteger(Number(tx.slot)) || Number(tx.slot) <= 0) return [];
  const keys = keysOf(tx);
  return tx.transaction.message.instructions.filter(ix => keys[ix.programIdIndex] === CLOAK_RUNTIME.programId &&
    ix.accounts.some(i => keys[i] === state)).map(ix => ({ ix, bytes: decodeCloakInstruction(ix.data) })).filter(ix => ix.bytes[0] === tag);
}
export function matchesCloakSource(tx: CloakChainTransaction, state: string, body: CloakSwapRequest): boolean {
  const prefix = new Uint8Array(521); prefix[0] = 1; prefix.set(decodeExactBase64(body.proof_bytes, 256), 1);
  prefix.set(decodeExactBase64(body.public_inputs, 264), 257);
  return cloakInstructions(tx, state, 1).filter(({ bytes }) => bytes.length >= 593 &&
    bytesBase64(bytes.slice(0, 521)) === bytesBase64(prefix) &&
    bytesBase64(bytes.slice(521, 553)) === bytesBase64(addressBytes(toAddress(body.output_mint))) &&
    bytesBase64(bytes.slice(553, 585)) === bytesBase64(addressBytes(toAddress(body.recipient_ata))) &&
    new DataView(bytes.buffer, bytes.byteOffset + 585, 8).getBigUint64(0, true).toString() === body.min_output_amount).length === 1;
}
export function cloakSettlementOutput(tx: CloakChainTransaction, state: string, p: CloakProperties): string | null {
  const calls = cloakInstructions(tx, state, 4), keys = keysOf(tx);
  if (calls.length !== 1 || !calls[0]!.ix.accounts.some(i => keys[i] === p.recipientAta) || !tx.meta) return null;
  // A second top-level instruction touching the recipient could contaminate the transaction-wide delta.
  if (tx.transaction.message.instructions.some(ix => ix !== calls[0]!.ix && ix.accounts.some(i => keys[i] === p.recipientAta))) return null;
  const index = keys.indexOf(p.recipientAta); if (index < 0 || keys.lastIndexOf(p.recipientAta) !== index) return null;
  const pre = (tx.meta.preTokenBalances ?? []).filter(v => v.accountIndex === index);
  const post = (tx.meta.postTokenBalances ?? []).filter(v => v.accountIndex === index);
  if (pre.length > 1 || post.length !== 1 || [...pre, ...post].some(v => v.mint !== p.outputMint || v.owner !== p.owner ||
    v.uiTokenAmount.decimals !== 6 || !/^(?:0|[1-9][0-9]{0,19})$/.test(v.uiTokenAmount.amount))) return null;
  const amount = BigInt(post[0]!.uiTokenAmount.amount) - BigInt(pre[0]?.uiTokenAmount.amount ?? '0');
  return amount >= BigInt(p.minimumOutput) && amount < 1n << 64n ? amount.toString() : null;
}
export type CloakRefundEvent = { index: number; amount: bigint; commitment: bigint };
/** Same authenticated runtime log framing as the SDK. Truncated/unbalanced/foreign logs cannot prove a refund. */
export function cloakRefundEvents(logs: readonly string[]): CloakRefundEvent[] {
  const stack: string[] = [], events: CloakRefundEvent[] = [];
  for (const line of logs) {
    if (line.startsWith('Log truncated')) return fail('CLOAK_REFUND_LOGS_INCOMPLETE');
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[(\d+)\]$/.exec(line);
    if (invoke) { stack.push(invoke[1]!); if (Number(invoke[2]) !== stack.length) fail('CLOAK_REFUND_LOGS_INCOMPLETE'); continue; }
    const exit = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (?:success|failed:.*)$/.exec(line);
    if (exit) { if (stack.pop() !== exit[1]) fail('CLOAK_REFUND_LOGS_INCOMPLETE'); continue; }
    if (stack.at(-1) !== CLOAK_RUNTIME.programId || !line.startsWith('Program data: ')) continue;
    const fields = line.slice(14).trim().split(/\s+/);
    if (fields.length !== 4 || new TextDecoder().decode(Uint8Array.from(atob(fields[0]!), c => c.charCodeAt(0))) !== 'cloak/refund_leaf/v1') continue;
    const i = decodeExactBase64(fields[1], 8), amount = decodeExactBase64(fields[2], 8), commitment = decodeExactBase64(fields[3], 32);
    const index = Number(new DataView(i.buffer).getBigUint64(0, true)), value = new DataView(amount.buffer).getBigUint64(0, true);
    if (!Number.isSafeInteger(index) || index < 0 || index >= 2 ** 32 || !value || !be(commitment)) fail('CLOAK_REFUND_EVENT_INVALID');
    events.push({ index, amount: value, commitment: be(commitment) });
  }
  if (stack.length) fail('CLOAK_REFUND_LOGS_INCOMPLETE'); return events;
}
export type CloakLiveObservation = { state: 'UNKNOWN' | 'SOURCE_FINALIZED' | 'SWAPPED' | 'REFUNDED'; swapState: string;
  sourceSignature: string | null; settlementSignature: string | null; outputAmount: string | null; change: Utxo | null;
  refundNote: Utxo | null; publicObservation: CloakPublicObservation | null; inspectedAt: string };
export async function inspectCloakMainnet(stateInput: PrivateState, pInput: CloakProperties, bodyInput: CloakSwapRequest): Promise<CloakLiveObservation> {
  const state = structuredClone(stateInput), p = structuredClone(pInput), body = structuredClone(bodyInput);
  // Historical validation is inspection-only; it never renews authorization or enables resubmission after expiry.
  await assertCloakBoundRequest(p, body, p.reviewedAt);
  const rpc = createCloakRpc(CLOAK_READ_RPC);
  if (await rpc.getGenesisHash().send() !== p.genesisHash) fail('CLOAK_RPC_GENESIS_CHANGED');
  const pdas = await getShieldPoolPDAs(CLOAK_RUNTIME.programId, CLOAK_RUNTIME.nativeMint);
  const [swapState] = await getSwapStatePDA(pdas.pool, Uint8Array.from(p.inputNullifiers[0]!.match(/../g)!, h => parseInt(h, 16)), CLOAK_RUNTIME.programId);
  const unknown: CloakLiveObservation = { state: 'UNKNOWN', swapState, sourceSignature: null, settlementSignature: null,
    outputAmount: null, change: null, refundNote: null, publicObservation: null, inspectedAt: new Date().toISOString() };
  const signatures = await rpc.getSignaturesForAddress(swapState, { commitment: 'finalized', limit: 100 }).send();
  const transactions: { signature: string; tx: CloakChainTransaction }[] = [];
  for (const entry of signatures) {
    if (entry.err) continue;
    const tx = await rpc.getTransaction(entry.signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1 }).send();
    if (tx) transactions.push({ signature: entry.signature, tx: tx as unknown as CloakChainTransaction });
  }
  const source = transactions.filter(entry => matchesCloakSource(entry.tx, swapState, body));
  if (source.length !== 1) return unknown;
  const inputs = await Promise.all(state.inputNotes.map(restorePrivateNote));
  const spent = await verifyUtxos(inputs, rpc, CLOAK_RUNTIME.programId, 'finalized');
  if (spent.skipped.length || spent.unspent.length || spent.spent.length !== inputs.length) return unknown;
  const nullifierPdas = await deriveInputNullifierPdas(CLOAK_RUNTIME.programId, CLOAK_RUNTIME.nativeMint,
    p.inputNullifiers.map(n => BigInt('0x' + n)));
  for (const address of nullifierPdas) {
    const account = await fetchAccountBytes(rpc, address, 'finalized');
    if (!account || account.owner !== p.programId || account.executable) return unknown;
  }
  const tree = await buildMerkleTreeFromRelay(CLOAK_RUNTIME.relayUrl, { mint: CLOAK_RUNTIME.nativeMint, requireCanonical: true, maxRetries: 0 });
  const account = await fetchAccountBytes(rpc, pdas.merkleTree, 'finalized');
  if (!account || account.owner !== p.programId || account.executable || account.data.length < 1096 || be(account.data.slice(1064, 1096)) !== tree.root()) return unknown;
  const leaves = tree.leaves(), change = await restorePrivateNote(state.outputNotes[0]!);
  const commitment = await computeUtxoCommitment(change), indices = leaves.flatMap((leaf, index) => leaf === commitment ? [index] : []);
  if (indices.length !== 1 || fieldHex(commitment) !== p.privateChange.commitment || change.amount.toString() !== p.privateChange.amount || change.mintAddress !== p.inputMint) return unknown;
  change.index = indices[0]!;
  const unspent = await verifyUtxos([change], rpc, CLOAK_RUNTIME.programId, 'finalized');
  if (unspent.unspent.length !== 1 || unspent.skipped.length || unspent.spent.length) return unknown;
  const opened = { ...unknown, state: 'SOURCE_FINALIZED' as const, sourceSignature: source[0]!.signature, change };
  const settlements = transactions.flatMap(entry => { const amount = cloakSettlementOutput(entry.tx, swapState, p); return amount === null ? [] : [{ ...entry, amount }]; });
  const refundEvents: { signature: string; tx: CloakChainTransaction; event: CloakRefundEvent }[] = [];
  for (const entry of transactions) {
    const closes = cloakInstructions(entry.tx, swapState, PRIVATE_REFUND_PHASE1_TAG);
    if (!closes.length) continue;
    const events = cloakRefundEvents(entry.tx.meta?.logMessages ?? []);
    if (closes.length !== 1 || closes[0]!.bytes.length !== PRIVATE_REFUND_PHASE1_WIRE_LENGTH || events.length !== 1 ||
        be(closes[0]!.bytes.slice(1, 33)) !== events[0]!.commitment) return unknown;
    // The trailing eight bytes are not guessed; the authenticated amount event and SDK note derivation establish economics.
    refundEvents.push({ ...entry, event: events[0]! });
  }
  if (settlements.length > 1 || refundEvents.length > 1 || settlements.length && refundEvents.length) return unknown;
  if (settlements.length === 1) {
    const settlement = settlements[0]!;
    if (Number(settlement.tx.slot) < Number(source[0]!.tx.slot)) return unknown;
    const observation: CloakPublicObservation = { runId: state.runId, manifestHash: state.manifestHash, owner: p.owner,
      genesisHash: p.genesisHash, programId: p.programId, tx1: 'FINALIZED', tx2: 'FINALIZED', settlement: 'SWAPPED',
      recipientAta: p.recipientAta, outputMint: p.outputMint, outputAmount: settlement.amount, inputNullifiersSpent: true,
      privateOutputs: [{ commitment: p.privateChange.commitment, index: change.index, amount: p.privateChange.amount, mint: p.inputMint, state: 'UNSPENT' }] };
    return { ...opened, state: 'SWAPPED', settlementSignature: settlement.signature, outputAmount: settlement.amount, publicObservation: observation };
  }
  if (refundEvents.length === 1) {
    const { event, signature, tx } = refundEvents[0]!;
    if (Number(tx.slot) < Number(source[0]!.tx.slot)) return unknown;
    if (event.amount > BigInt(p.grossInputLamports) || event.amount < BigInt(p.grossInputLamports) - BigInt(p.maximumProtocolFeeLamports) || leaves[event.index] !== event.commitment) return unknown;
    const nk = Uint8Array.from(state.viewingKeyNk.match(/../g)!, h => parseInt(h, 16));
    const refund = await matchSwapRefundLeaf({ viewingKeyNk: nk, inputNullifier: BigInt('0x' + p.inputNullifiers[0]!),
      amountAfterFee: event.amount, commitment: event.commitment });
    if (!refund) return unknown;
    const refundNote: Utxo = { ...refund, mintAddress: CLOAK_RUNTIME.nativeMint, index: event.index };
    const result = await verifyUtxos([refundNote], rpc, CLOAK_RUNTIME.programId, 'finalized');
    if (result.unspent.length !== 1 || result.spent.length || result.skipped.length) return unknown;
    return { ...opened, state: 'REFUNDED', settlementSignature: signature, refundNote };
  }
  return opened;
}
