// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createExactInputSwapNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { JUPITER_SOLANA_MAINNET as profile, SOLANA_MAINNET_TOKENS as T, type SolanaTokenSymbol } from '@defi-workflow-engine/action-registry';
import { associatedTokenAddress, base58Decode, base58Encode, compileMessageV0, findProgramAddress, fromBase64, parseMessageV0, serializeMessageV0,
  toBase64, parseTransaction, serializeTransaction } from '../src/solana.js';
import { assertJupiterReview, assertMessageRoundTrip, decodeJupiterSwap, inspectJupiterInstructions, jupiterInstructions, jupiterIntent,
  parseJupiterBuild, simulateJupiterSwap, verifySignedJupiterTransaction, type JupiterIntent } from '../src/jupiter.js';
import { createMockedSolanaJupiter, createMockedSolanaWallet } from '../src/jupiter-mock.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as { response: Record<string, unknown> };
const chain = profile.chain;
export function solanaWorkflow(from: SolanaTokenSymbol, to: SolanaTokenSymbol, amount: string, slippageBps = 50, revision = 1): SemanticWorkflow {
  const asset = (s: SolanaTokenSymbol) => ({ chainId: chain, address: T[s].mint, decimals: T[s].decimals });
  return { schemaVersion: '1.0.0', workflowId: 'workflow-local', revision, resourceEdges: [],
    nodes: [createExactInputSwapNode('node-002', { chain, input: asset(from), output: asset(to), amount, slippageBps, protocols: ['jupiter'], maximumAmount: T[from].maximumAmount })] };
}
const usdcSol: JupiterIntent = { owner: 'GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ', input: T.USDC, output: T.SOL, amount: '10000000', slippageBps: 50 };
const usdcUsdt: JupiterIntent = { owner: '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S', input: T.USDC, output: T.USDT, amount: '1000000', slippageBps: 50 };
const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;

describe('Solana codec and mint identity', () => {
  it('round-trips base58 and rejects non-canonical keys', () => {
    for (const k of [profile.programs.jupiter, profile.programs.system, T.USDC.mint]) expect(base58Encode(base58Decode(k))).toBe(k);
    expect(() => base58Decode('0OIl')).toThrow('SOLANA_BASE58_INVALID');
  });
  it('derives owner token accounts and Jupiter PDAs exactly as observed on mainnet-beta', () => {
    const ata = (o: string, m: string) => associatedTokenAddress(o, m, profile.programs.token, profile.programs.associatedToken);
    expect(ata(usdcSol.owner, T.USDC.mint)).toBe('GWWjoZ2bZikAhhMAH5V3Mp6goHqnWAT6KqCZSHmqtoZ');
    expect(ata(usdcSol.owner, T.SOL.mint)).toBe('GSFbPvFTbfcRNGs4EEZVF8tBjV6ChcTaBrTYGGsDAq8o');
    expect(findProgramAddress([new TextEncoder().encode('__event_authority')], profile.programs.jupiter)).toBe(profile.programs.jupiterEventAuthority);
    expect(findProgramAddress([new TextEncoder().encode('authority'), Uint8Array.of(2)], profile.programs.jupiter)).toBe('BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV');
  });
  it('identifies Solana assets by cluster, mint and decimals, never by ticker', () => {
    const node = solanaWorkflow('USDC', 'SOL', '10000000').nodes[0]!;
    expect(node.actionType).toBe('asset.swap.exact-input');
    expect(node.inputs[0]).toEqual({ name: 'amount-in', kind: 'QUANTITY', value: { asset: { chainId: chain, address: T.USDC.mint, decimals: 6 }, amount: '10000000' } });
    expect(JSON.stringify(node)).not.toContain('"USDC"');
  });
});

describe('Jupiter quote parsing (PUBLIC_READ_ONLY recorded responses)', () => {
  it('parses a real route_v2 USDC→SOL build and binds amount, minimum and the wrap/unwrap shape', () => {
    const parsed = parseJupiterBuild(fixture('jupiter-build-usdc-sol.json').response, usdcSol, '2026-10-01T16:08:36.000Z');
    expect(parsed.quote).toMatchObject({ inAmount: '10000000', outAmount: '85020593', otherAmountThreshold: '84595491', slippageBps: 50 });
    const inspection = inspectJupiterInstructions(parsed, usdcSol);
    expect(inspection.swap).toMatchObject({ instruction: 'route-v2', inAmount: '10000000', quotedOutAmount: '85020593', slippageBps: 50, platformFeeBps: 0 });
    expect(inspection.wrappedSolAccount).toBe('GSFbPvFTbfcRNGs4EEZVF8tBjV6ChcTaBrTYGGsDAq8o');
  });
  it('parses a real shared_accounts_route_v2 multi-hop build and compiles a verified v0 message with its lookup table', () => {
    const response = fixture('jupiter-build-usdc-usdt.json').response;
    const parsed = parseJupiterBuild(response, usdcUsdt, '2026-10-01T16:22:41.000Z');
    const inspection = inspectJupiterInstructions(parsed, usdcUsdt);
    expect(inspection.swap.instruction).toBe('shared-accounts-route-v2');
    const tables = response.addressesByLookupTableAddress as Record<string, string[]>;
    const instructions = jupiterInstructions(parsed, 300_000);
    const bytes = serializeMessageV0(compileMessageV0(usdcUsdt.owner, instructions, profile.programs.system, tables));
    expect(bytes.length).toBeLessThanOrEqual(1167);
    expect(() => assertMessageRoundTrip(bytes, instructions, usdcUsdt.owner, tables)).not.toThrow();
    expect(parseMessageV0(bytes).header[0]).toBe(1);
  });
  const response = () => clone(fixture('jupiter-build-usdc-sol.json').response);
  const parse = (r: Record<string, unknown>, intent = usdcSol) => inspectJupiterInstructions(parseJupiterBuild(r, intent, 'now'), intent);
  it.each([
    ['wrong input mint', (r: Record<string, unknown>) => { r.inputMint = T.USDT.mint; }, 'JUPITER_INPUT_MINT_MISMATCH'],
    ['wrong output mint', (r: Record<string, unknown>) => { r.outputMint = T.USDT.mint; }, 'JUPITER_OUTPUT_MINT_MISMATCH'],
    ['different exact input', (r: Record<string, unknown>) => { r.inAmount = '10000001'; }, 'JUPITER_INPUT_AMOUNT_MISMATCH'],
    ['exact output mode', (r: Record<string, unknown>) => { r.swapMode = 'ExactOut'; }, 'JUPITER_SWAP_MODE_UNSUPPORTED'],
    ['different slippage', (r: Record<string, unknown>) => { r.slippageBps = 100; }, 'JUPITER_SLIPPAGE_MISMATCH'],
    ['minimum below the slippage bound', (r: Record<string, unknown>) => { r.otherAmountThreshold = '84000000'; }, 'JUPITER_MINIMUM_OUTPUT_INVALID'],
    ['minimum above quote', (r: Record<string, unknown>) => { r.otherAmountThreshold = '85020594'; }, 'JUPITER_MINIMUM_OUTPUT_INVALID'],
    ['tip instruction', (r: Record<string, unknown>) => { r.tipInstruction = r.cleanupInstruction; }, 'JUPITER_TIP_UNSUPPORTED'],
    ['extra instruction', (r: Record<string, unknown>) => { r.otherInstructions = [r.cleanupInstruction]; }, 'JUPITER_UNEXPECTED_INSTRUCTION'],
  ])('rejects %s', (_name, mutate, code) => { const r = response(); mutate(r); expect(() => parse(r)).toThrow(code); });
  const swapData = (r: Record<string, unknown>) => fromBase64((r.swapInstruction as { data: string }).data);
  const setSwapData = (r: Record<string, unknown>, data: Uint8Array) => { (r.swapInstruction as { data: string }).data = toBase64(data); };
  it.each([
    ['instruction amount differs from the intent', 8, 'JUPITER_INPUT_AMOUNT_MISMATCH'],
    ['instruction quote differs from the reviewed quote', 16, 'JUPITER_MINIMUM_OUTPUT_INVALID'],
    ['platform fee in instruction', 26, 'JUPITER_FEE_UNEXPECTED'],
    ['unknown swap instruction', 0, 'JUPITER_SWAP_INSTRUCTION_UNSUPPORTED'],
  ])('rejects %s', (_name, offset, code) => { const r = response(), d = swapData(r); d[offset] = (d[offset]! + 1) % 256; setSwapData(r, d); expect(() => parse(r)).toThrow(code); });
  it('rejects a transaction for a different owner (wrong taker)', () => {
    expect(() => parse(response(), { ...usdcSol, owner: usdcUsdt.owner })).toThrow(/JUPITER_(OWNER_MISMATCH|SETUP_UNEXPECTED)/);
  });
  it('rejects an unexpected economic recipient for the output', () => {
    const r = response(); (r.swapInstruction as { accounts: { pubkey: string }[] }).accounts[2]!.pubkey = profile.programs.jupiterEventAuthority;
    expect(() => parse(r)).toThrow('JUPITER_RECIPIENT_UNEXPECTED');
  });
  it('rejects an extra signer and an unexpected setup program', () => {
    const r = response(); (r.swapInstruction as { accounts: { isSigner: boolean }[] }).accounts[12]!.isSigner = true;
    expect(() => parse(r)).toThrow('JUPITER_UNEXPECTED_SIGNER');
    const s = response(); (s.setupInstructions as { programId: string }[])[0]!.programId = profile.programs.computeBudget;
    expect(() => parse(s)).toThrow('JUPITER_SETUP_UNEXPECTED');
  });
  it('decodes both supported instruction layouts', () => {
    expect(decodeJupiterSwap(swapData(response())).instruction).toBe('route-v2');
    const shared = fixture('jupiter-build-usdc-usdt.json').response.swapInstruction as { data: string; accounts: { pubkey: string }[] };
    const id = decodeJupiterSwap(fromBase64(shared.data)).programAuthorityId!;
    expect(findProgramAddress([new TextEncoder().encode('authority'), Uint8Array.of(id)], profile.programs.jupiter)).toBe(shared.accounts[0]!.pubkey);
  });
});

describe('MOCKED simulation, review binding and signature binding', () => {
  async function prepared(from: SolanaTokenSymbol = 'USDC', to: SolanaTokenSymbol = 'SOL', amount = '10000000', options = {}) {
    const env = createMockedSolanaJupiter(options), wallet = createMockedSolanaWallet();
    env.fund(wallet.owner, 2_000_000_000n, { USDC: 50_000_000n });
    const workflow = solanaWorkflow(from, to, amount);
    const review = await simulateJupiterSwap(workflow, wallet.owner, env.http, env.rpc, Date.parse('2026-10-01T12:00:00.000Z'));
    return { env, wallet, workflow, review, now: Date.parse('2026-10-01T12:00:10.000Z') };
  }
  it('produces a read-only review with exact expected deltas, fee, freshness and a message commitment', async () => {
    const { env, review, workflow, wallet, now } = await prepared();
    expect(env.state.sent).toEqual([]);
    expect(review.simulationResult).toMatchObject({ inputSpent: '10000000', outputReceived: review.quote.outAmount });
    expect(review.estimatedFeeLamports).toBe(String(5000 + Math.ceil(review.computeUnitLimit * 1000 / 1e6)));
    expect(review.messageHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(review.plan.segments[0]!.steps[0]).toMatchObject({ payloadHash: review.messageHash, executionKind: 'DIRECT_TRANSACTION' });
    expect(() => assertJupiterReview(review, workflow, wallet.owner, env.state.blockHeight, now)).not.toThrow();
  });
  it('simulates SOL input with an exact wrap amount and no residual wrapped SOL', async () => {
    const { review } = await prepared('SOL', 'USDC', '100000000');
    expect(review.inspection.wrappedSolAccount).not.toBeNull();
    expect(review.simulationResult.inputSpent).toBe('100000000');
  });
  it('rejects stale quotes by time and by blockhash validity', async () => {
    const { env, review, workflow, wallet } = await prepared();
    expect(() => assertJupiterReview(review, workflow, wallet.owner, env.state.blockHeight, Date.parse(review.expiresAt))).toThrow('JUPITER_QUOTE_STALE');
    expect(() => assertJupiterReview(review, workflow, wallet.owner, review.lastValidBlockHeight - 5, Date.parse(review.quote.fetchedAt))).toThrow('JUPITER_QUOTE_STALE');
  });
  it('invalidates authorization for a wrong owner, changed semantic revision, or changed transaction', async () => {
    const { env, review, workflow, wallet, now } = await prepared();
    expect(() => assertJupiterReview(review, workflow, usdcSol.owner, env.state.blockHeight, now)).toThrow('JUPITER_WRONG_OWNER');
    expect(() => assertJupiterReview(review, solanaWorkflow('USDC', 'SOL', '10000001'), wallet.owner, env.state.blockHeight, now)).toThrow('JUPITER_SEMANTIC_REVISION_CHANGED');
    const tampered = { ...review, message: toBase64(Uint8Array.from(fromBase64(review.message).map((b, i) => i === 40 ? b ^ 1 : b))) };
    expect(() => assertJupiterReview(tampered, workflow, wallet.owner, env.state.blockHeight, now)).toThrow('JUPITER_AUTHORIZATION_INVALID');
  });
  it('accepts only the exact reviewed message signed by the owner', async () => {
    const { review, wallet } = await prepared();
    const signed = wallet.sign(review.unsignedTransaction);
    expect(verifySignedJupiterTransaction(review, signed).signature).toBe(base58Encode(parseTransaction(fromBase64(signed, 2048)).signatures[0]!));
    const { message } = parseTransaction(fromBase64(signed, 2048));
    const changed = Uint8Array.from(message); changed[changed.length - 1] ^= 1;
    expect(() => verifySignedJupiterTransaction(review, toBase64(serializeTransaction(parseTransaction(fromBase64(signed, 2048)).signatures[0]!, changed)))).toThrow('JUPITER_TRANSACTION_CHANGED');
    const other = createMockedSolanaWallet();
    expect(() => verifySignedJupiterTransaction(review, other.sign(review.unsignedTransaction))).toThrow('JUPITER_SIGNATURE_INVALID');
  });
  it('fails closed on wrong cluster, unverified lookup tables, insufficient balance and pre-existing wrapped SOL', async () => {
    await expect(prepared('USDC', 'SOL', '10000000', { cluster: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' })).rejects.toThrow('SOLANA_WRONG_CLUSTER');
    await expect(prepared('USDC', 'SOL', '10000000', { tamperBuild: (b: Record<string, unknown>) => { b.addressesByLookupTableAddress = { [profile.programs.system]: [] }; } })).rejects.toThrow('JUPITER_LOOKUP_TABLE_UNVERIFIED');
    await expect(prepared('USDC', 'SOL', '60000000')).rejects.toThrow('JUPITER_INSUFFICIENT_USDC');
    const env = createMockedSolanaJupiter(), wallet = createMockedSolanaWallet();
    env.fund(wallet.owner, 2_000_000_000n, { USDC: 50_000_000n });
    env.state.tokens.set(env.ata(wallet.owner, T.SOL.mint), { mint: T.SOL.mint, owner: wallet.owner, amount: 0n });
    await expect(simulateJupiterSwap(solanaWorkflow('USDC', 'SOL', '1000000'), wallet.owner, env.http, env.rpc)).rejects.toThrow('JUPITER_WRAPPED_SOL_ACCOUNT_PRESENT');
  });
  it('fails closed when simulated balances do not match the quote', async () => {
    await expect(prepared('USDC', 'SOL', '10000000', { extraInputDebit: 1n })).rejects.toThrow('JUPITER_SIMULATED_INPUT_MISMATCH');
    await expect(prepared('USDC', 'SOL', '10000000', { failSwap: true })).rejects.toThrow('JUPITER_SIMULATION_FAILED');
  });
  it('rejects non-Jupiter or non-Solana swap intents before any network read', () => {
    const wf = solanaWorkflow('USDC', 'SOL', '1');
    expect(() => jupiterIntent({ ...wf, nodes: [{ ...wf.nodes[0]!, adapterConstraints: { adapters: [], protocols: ['uniswap'] } }] }, usdcSol.owner)).toThrow('SOLANA_SWAP_PROVIDER_UNSUPPORTED');
    expect(() => jupiterIntent(wf, 'not-a-key')).toThrow('SOLANA_ADDRESS_INVALID');
  });
});
