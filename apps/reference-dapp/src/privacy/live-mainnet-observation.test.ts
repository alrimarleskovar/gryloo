// SPDX-License-Identifier: AGPL-3.0-only
/** Actual SDK PDA/note/merkle/refund primitives, with entirely mocked finalized RPC observations. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addressBytes, computeSwapRefundCommitment, computeUtxoCommitment, computeUtxoNullifier, createUtxo,
  generateUtxoKeypair, getNkFromUtxoPrivateKey, getShieldPoolPDAs, getSwapStatePDA, MerkleTree, pubkeyToFieldElement, toAddress } from '@cloak.dev/sdk';
import { buildCloakPrivateState, CLOAK_RUNTIME, restorePrivateNote } from './cloak-adapter';
import { bytesBase64, cloakSwapExternalDataHash, CLOAK_ROUTING_DISCLOSURE, fieldHex, type CloakProperties, type CloakSwapRequest } from './provider-contract';
import { cloakOwnerUsdcAta } from './live-proof';
import { inspectCloakMainnet, type CloakChainTransaction } from './live-observer';
const net = vi.hoisted(() => ({ genesis: '', root: 0n, tree: null as unknown, transactions: new Map<string, unknown>(), merkle: '',
  input: '', inputUnspent: false, outputSpent: false, foreignNullifier: false, rootMismatch: false, rpc: vi.fn() }));
vi.mock('@cloak.dev/sdk', async original => {
  const actual = await original<typeof import('@cloak.dev/sdk')>();
  const rpc = { getGenesisHash: () => ({ send: async () => net.genesis }),
    getSignaturesForAddress: (...args: unknown[]) => { net.rpc(...args); return { send: async () => [...net.transactions.keys()].map(signature => ({ signature, err: null })) }; },
    getTransaction: (signature: string, options: unknown) => { net.rpc(signature, options); return { send: async () => net.transactions.get(signature) }; } };
  return { ...actual, createCloakRpc: () => rpc, buildMerkleTreeFromRelay: async () => net.tree,
    fetchAccountBytes: async (_rpc: unknown, address: string, commitment: string) => {
      net.rpc(address, commitment);
      if (address !== net.merkle) return { data: new Uint8Array(), executable: false, owner: net.foreignNullifier ? actual.NATIVE_SOL_MINT : actual.CLOAK_PROGRAM_ID };
      const data = new Uint8Array(1096); data.set(Uint8Array.from(fieldHex(net.root + (net.rootMismatch ? 1n : 0n)).match(/../g)!, h => parseInt(h, 16)), 1064);
      return { data, executable: false, owner: actual.CLOAK_PROGRAM_ID };
    }, verifyUtxos: async (notes: { commitment: bigint }[]) => {
      const isInput = fieldHex(notes[0]!.commitment) === net.input, spent = isInput ? !net.inputUnspent : net.outputSpent;
      return { spent: spent ? notes : [], unspent: spent ? [] : notes, skipped: [] };
    } };
});
const fields = (n: bigint) => Uint8Array.from(fieldHex(n).match(/../g)!, h => parseInt(h, 16));
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let value = BigInt('0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')), s = '';
  while (value) { s = alphabet[Number(value % 58n)]! + s; value /= 58n; } return s;
}
async function fixture() {
  const owner = '11111111111111111111111111111111', key = await generateUtxoKeypair(), input = await createUtxo(30_000_000n, key, CLOAK_RUNTIME.nativeMint); input.index = 0;
  const state = await buildCloakPrivateState({ identity: { runId: 'cloak-' + 'a'.repeat(32), owner, genesisHash: CLOAK_RUNTIME.genesisHash,
    programId: CLOAK_RUNTIME.programId, manifestHash: '0x' + 'b'.repeat(64) }, inputUtxos: [input], swapAmount: 20_000_000n,
    viewingKeyNk: getNkFromUtxoPrivateKey(key.privateKey) });
  const change = await restorePrivateNote(state.outputNotes[0]!); change.index = 1;
  const tree = await MerkleTree.create(32, [input.commitment!, await computeUtxoCommitment(change)]), now = Date.now();
  net.tree = tree; net.root = tree.root(); net.input = fieldHex(input.commitment!);
  const pdas = await getShieldPoolPDAs(CLOAK_RUNTIME.programId, CLOAK_RUNTIME.nativeMint); net.merkle = pdas.merkleTree;
  const nullifier = await computeUtxoNullifier(input), [swapState] = await getSwapStatePDA(pdas.pool, fields(nullifier), CLOAK_RUNTIME.programId);
  const p: CloakProperties = { provider: 'cloak', owner, recipientAta: await cloakOwnerUsdcAta(owner), genesisHash: CLOAK_RUNTIME.genesisHash, programId: CLOAK_RUNTIME.programId,
    inputMint: CLOAK_RUNTIME.nativeMint, outputMint: CLOAK_RUNTIME.usdcMint, grossInputLamports: '20000000', minimumOutput: '1000000', maximumProtocolFeeLamports: '5060000',
    privateChange: { commitment: state.outputNotes[0]!.commitment, amount: '10000000', mint: CLOAK_RUNTIME.nativeMint }, inputNullifiers: [fieldHex(nullifier)],
    refundPublicKey: state.refund.publicKey, refundBlinding: state.refund.blinding, slippageBps: 50, reviewedAt: now, expiresAt: now + 60_000, routing: CLOAK_ROUTING_DISCLOSURE };
  const pi = new Uint8Array(264); pi.set(fields(tree.root())); new DataView(pi.buffer).setBigInt64(32, -20_000_000n, true);
  [await cloakSwapExternalDataHash(p), pubkeyToFieldElement(toAddress(p.inputMint)), nullifier, 11n, BigInt('0x' + p.privateChange.commitment), 12n, 13n]
    .forEach((v, i) => pi.set(fields(v), 40 + 32 * i));
  const body: CloakSwapRequest = { proof_bytes: bytesBase64(new Uint8Array(256)), public_inputs: bytesBase64(pi), output_mint: p.outputMint,
    recipient_ata: p.recipientAta, recipient: p.owner, min_output_amount: p.minimumOutput, max_fee: p.maximumProtocolFeeLamports,
    slippage_bps: p.slippageBps, refund_pubkey: bytesBase64(fields(BigInt('0x' + p.refundPublicKey))), refund_blinding: bytesBase64(fields(BigInt('0x' + p.refundBlinding))),
    encrypted_notes: ['SYNTHETIC'], route_retry_attempts: 0, swap_max_retries: 1 };
  const source = new Uint8Array(593); source[0] = 1; source.set(pi, 257); source.set(addressBytes(toAddress(p.outputMint)), 521);
  source.set(addressBytes(toAddress(p.recipientAta)), 553); new DataView(source.buffer).setBigUint64(585, 1_000_000n, true);
  const tx = (data: Uint8Array, slot: bigint): CloakChainTransaction => ({ slot,
    transaction: { message: { accountKeys: [p.programId, swapState, p.recipientAta], instructions: [{ programIdIndex: 0, accounts: [1, 2], data: base58(data) }] } },
    meta: { err: null, logMessages: [], preTokenBalances: [], postTokenBalances: [{ accountIndex: 2, owner, mint: p.outputMint, uiTokenAmount: { decimals: 6, amount: '1000000' } }] } });
  const sourceTx = tx(source, 100n), settlementTx = tx(new Uint8Array([4]), 101n);
  net.transactions.set('1'.repeat(64), sourceTx); net.transactions.set('2'.repeat(64), settlementTx);
  return { state, p, body, sourceTx, settlementTx, input, change, tx, inspect: () => inspectCloakMainnet(state, p, body) };
}
beforeEach(() => { net.genesis = CLOAK_RUNTIME.genesisHash; net.transactions.clear(); net.inputUnspent = false;
  net.outputSpent = false; net.foreignNullifier = false; net.rootMismatch = false; net.rpc.mockClear(); });
describe('full Cloak finalized observation orchestration / MOCKED chain only', () => {
  it('proves every required observation independently of a relay success string', async () => {
    const f = await fixture(), result = await f.inspect(); expect(result.state).toBe('SWAPPED');
    expect(result.publicObservation).toMatchObject({ tx1: 'FINALIZED', tx2: 'FINALIZED', settlement: 'SWAPPED', inputNullifiersSpent: true, outputAmount: '1000000' });
    expect(result.change!.index).toBe(1); expect(net.rpc.mock.calls.some(call => (call[1] as { commitment?: string })?.commitment === 'finalized')).toBe(true);
  });
  it.each(['unspentInput', 'foreignNullifier', 'unfinalizedRoot', 'spentChange', 'missingChange', 'duplicateSource'])('requires recovery on %s', async mode => {
    const f = await fixture();
    if (mode === 'unspentInput') net.inputUnspent = true;
    if (mode === 'foreignNullifier') net.foreignNullifier = true;
    if (mode === 'unfinalizedRoot') net.rootMismatch = true;
    if (mode === 'spentChange') net.outputSpent = true;
    if (mode === 'missingChange') { const tree = await MerkleTree.create(32, [f.input.commitment!]); net.tree = tree; net.root = tree.root(); }
    if (mode === 'duplicateSource') net.transactions.set('3'.repeat(64), f.sourceTx);
    expect((await f.inspect()).state).toBe('UNKNOWN');
  });
  it('rejects missing or mismatched public output and never treats source finality as success', async () => {
    const f = await fixture(); f.settlementTx.meta!.postTokenBalances![0]!.mint = CLOAK_RUNTIME.nativeMint;
    expect((await f.inspect()).state).toBe('SOURCE_FINALIZED');
    net.transactions.delete('2'.repeat(64)); expect((await f.inspect()).state).toBe('SOURCE_FINALIZED');
  });
  it('fails on a different genesis and never falls back to another RPC', async () => {
    const f = await fixture(); net.genesis = CLOAK_RUNTIME.nativeMint; await expect(f.inspect()).rejects.toThrow('CLOAK_RPC_GENESIS_CHANGED');
  });
  it('reconstructs the private principal refund from authenticated close logs and current unspent leaf state', async () => {
    const f = await fixture(), amount = 14_940_000n, commitment = await computeSwapRefundCommitment(amount, BigInt('0x' + f.p.refundPublicKey), BigInt('0x' + f.p.refundBlinding));
    const tree = await MerkleTree.create(32, [f.input.commitment!, f.change.commitment!, commitment]); net.tree = tree; net.root = tree.root();
    const u64 = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return bytesBase64(b); };
    const phase1 = new Uint8Array(41); phase1[0] = 13; phase1.set(fields(commitment), 1);
    const close = f.tx(phase1, 101n); close.meta!.logMessages = [`Program ${f.p.programId} invoke [1]`,
      'Program data: ' + bytesBase64(new TextEncoder().encode('cloak/refund_leaf/v1')) + ' ' + u64(2n) + ' ' + u64(amount) + ' ' + bytesBase64(fields(commitment)),
      `Program ${f.p.programId} success`]; net.transactions.set('2'.repeat(64), close);
    const observed = await f.inspect(); expect(observed.state).toBe('REFUNDED'); expect(observed.refundNote).toMatchObject({ amount, index: 2, commitment });
    close.transaction.message.instructions[0]!.data = base58(new Uint8Array([5]));
    expect((await f.inspect()).state).toBe('SOURCE_FINALIZED'); // Generic close overview alone cannot prove a private refund.
    close.transaction.message.instructions[0]!.data = base58(new Uint8Array([13]));
    expect((await f.inspect()).state).toBe('UNKNOWN');
    const changed = phase1.slice(); changed[1] = changed[1]! ^ 1; close.transaction.message.instructions[0]!.data = base58(changed);
    expect((await f.inspect()).state).toBe('UNKNOWN');
    close.transaction.message.instructions[0]!.data = base58(phase1);
    close.slot = 99n; expect((await f.inspect()).state).toBe('UNKNOWN');
  });
});
