// SPDX-License-Identifier: AGPL-3.0-only
import { sha256 } from '@noble/hashes/sha2.js';
import { ORCA_WHIRLPOOLS_DEVNET as profile, solanaDevnetTokenByMint } from '@defi-workflow-engine/action-registry';
import { associatedTokenAddress, base58Encode, decompileMessageV0, fromBase64, parseMessageV0, parseTransaction, publicKeyBytes, readU64, toBase64,
  u64Bytes, verifyEd25519, type SolanaInstruction } from './solana.js';
import { decodeOrcaSwapV2, orcaOracleAddress, orcaTickArrayAddress, orcaTickArrayStarts } from './orca-whirlpool.js';

/**
 * MOCKED deterministic Solana Devnet + Orca Whirlpool loopback for tests and the offline browser harness.
 * It interprets the exact compiled message at a fixed synthetic price. Nothing here is public or Devnet evidence.
 */
const P = profile.programs, POOL = profile.pool, RENT = 2_039_280n, WSOL = POOL.tokenMintA;
const SQRT_PRICE = 2_758_300_908_685_096_775n, TICK = -38_008, FEE_PPM = 2_000n;
/** Synthetic rate: 22.3 devUSDC per Devnet SOL before the 0.2% pool fee. */
const MICRO_USDC_PER_SOL = 22_300_000n;
export type MockedOrcaOptions = { actualOutput?: (quoted: bigint) => bigint; failSwap?: boolean; extraInputDebit?: bigint; extraOwnerDebit?: bigint;
  send?: 'OK' | 'RPC_ERROR_AFTER_LANDING' | 'RPC_ERROR_DROPPED' | 'DROPPED'; confirmationDelay?: number; cluster?: string; poolConfig?: string; noTradeEvent?: boolean };
type Token = { mint: string; owner: string; amount: bigint };
type Snapshot = { lamports: Map<string, bigint>; tokens: Map<string, Token>; lamportsOf: Map<string, bigint> };
type Landed = { signature: string; slot: number; bytes: string; err: unknown; fee: bigint; keys: string[]; pre: bigint[]; post: bigint[];
  preTokens: unknown[]; postTokens: unknown[]; logs: string[]; finalizedAt: number };

export function encodeMockedWhirlpool(config: string = profile.whirlpoolsConfig): Uint8Array {
  const data = new Uint8Array(653), view = new DataView(data.buffer);
  data.set(Buffer.from('3f95d10ce1806309', 'hex'), 0); data.set(publicKeyBytes(config), 8); data[40] = 255;
  view.setUint16(41, POOL.tickSpacing, true); view.setUint16(45, Number(FEE_PPM), true); view.setUint16(47, 300, true);
  view.setBigUint64(49, 811_988_777_984n, true); view.setBigUint64(65, SQRT_PRICE & ((1n << 64n) - 1n), true); view.setBigUint64(73, SQRT_PRICE >> 64n, true);
  view.setInt32(81, TICK, true);
  data.set(publicKeyBytes(POOL.tokenMintA), 101); data.set(publicKeyBytes(POOL.tokenVaultA), 133); data.set(publicKeyBytes(POOL.tokenMintB), 181); data.set(publicKeyBytes(POOL.tokenVaultB), 213);
  return data;
}
function tradedLog(aToB: boolean, input: bigint, output: bigint): string {
  const data = new Uint8Array(121), view = new DataView(data.buffer);
  data.set(Buffer.from(profile.tradedEventDiscriminator, 'hex'), 0); data.set(publicKeyBytes(POOL.address), 8); data[40] = aToB ? 1 : 0;
  view.setBigUint64(41, SQRT_PRICE & ((1n << 64n) - 1n), true); view.setBigUint64(49, SQRT_PRICE >> 64n, true);
  view.setBigUint64(57, SQRT_PRICE & ((1n << 64n) - 1n), true); view.setBigUint64(65, SQRT_PRICE >> 64n, true);
  data.set(u64Bytes(input), 73); data.set(u64Bytes(output), 81); data.set(u64Bytes(input * FEE_PPM / 1_000_000n), 105);
  return 'Program data: ' + toBase64(data);
}
export function createMockedSolanaDevnetOrca(options: MockedOrcaOptions = {}) {
  const state = { slot: 400_000_000, blockHeight: 380_000_000, lamports: new Map<string, bigint>(), tokens: new Map<string, Token>(), lamportsOf: new Map<string, bigint>(),
    transactions: new Map<string, Landed>(), sent: [] as string[] };
  const ata = (owner: string, mint: string) => associatedTokenAddress(owner, mint, P.token, P.associatedToken);
  const blockhash = (height: number) => base58Encode(sha256(new TextEncoder().encode('devnet-blockhash:' + height)));
  const issued = new Map<string, number>();
  state.tokens.set(POOL.tokenVaultA, { mint: POOL.tokenMintA, owner: POOL.address, amount: 357_303_449_041n });
  state.tokens.set(POOL.tokenVaultB, { mint: POOL.tokenMintB, owner: POOL.address, amount: 7_142_157_709n });
  const tickArrays = new Set([true, false].flatMap(aToB => orcaTickArrayStarts(TICK, POOL.tickSpacing, aToB).map(start => orcaTickArrayAddress(POOL.address, start))));
  function fund(owner: string, lamports: bigint, devUsdc = 0n) {
    state.lamports.set(owner, lamports);
    if (devUsdc > 0n) { state.tokens.set(ata(owner, POOL.tokenMintB), { mint: POOL.tokenMintB, owner, amount: devUsdc }); state.lamportsOf.set(ata(owner, POOL.tokenMintB), RENT); }
  }
  const snapshot = (): Snapshot => ({ lamports: new Map(state.lamports), tokens: new Map([...state.tokens].map(([k, v]) => [k, { ...v }])), lamportsOf: new Map(state.lamportsOf) });
  const lamportsAt = (s: Snapshot, k: string) => s.lamports.get(k) ?? s.lamportsOf.get(k) ?? 0n;
  const quoteFor = (aToB: boolean, amount: bigint) => (aToB ? amount * MICRO_USDC_PER_SOL / 1_000_000_000n : amount * 1_000_000_000n / MICRO_USDC_PER_SOL) * (1_000_000n - FEE_PPM) / 1_000_000n;
  /** Execute against a snapshot; returns an error object instead of throwing on program failure. */
  function execute(s: Snapshot, instructions: SolanaInstruction[], payer: string): { err: unknown; fee: bigint; units: number; logs: string[] } {
    const fee = 5000n, logs: string[] = [];
    if ((s.lamports.get(payer) ?? 0n) < fee) return { err: 'InsufficientFundsForFee', fee, units: 0, logs };
    s.lamports.set(payer, s.lamports.get(payer)! - fee - (options.extraOwnerDebit ?? 0n));
    const debit = (k: string, n: bigint) => { const v = s.lamports.get(k) ?? 0n; if (v < n) throw Object.assign(new Error('lamports'), { custom: { InstructionError: [0, { Custom: 1 }] } }); s.lamports.set(k, v - n); };
    try {
      instructions.forEach((i, index) => {
        const a = (n: number) => i.accounts[n]!.pubkey;
        const fault = (code: unknown) => { throw Object.assign(new Error('program'), { custom: { InstructionError: [index, code] } }); };
        logs.push(`Program ${i.programId} invoke [1]`);
        if (i.programId === P.computeBudget) return;
        if (i.programId === P.associatedToken) { if (!s.tokens.has(a(1))) { debit(a(0), RENT); s.tokens.set(a(1), { mint: a(3), owner: a(2), amount: 0n }); s.lamportsOf.set(a(1), RENT); } return; }
        if (i.programId === P.system) { const n = readU64(i.data, 4); debit(a(0), n); s.lamportsOf.set(a(1), (s.lamportsOf.get(a(1)) ?? 0n) + n); s.tokens.get(a(1))!.amount += n; return; }
        if (i.programId === P.token && i.data[0] === 17) return;
        if (i.programId === P.token && i.data[0] === 9) { const lam = s.lamportsOf.get(a(0)) ?? 0n; s.tokens.delete(a(0)); s.lamportsOf.delete(a(0)); s.lamports.set(a(1), (s.lamports.get(a(1)) ?? 0n) + lam); return; }
        if (i.programId === P.whirlpool) {
          const args = decodeOrcaSwapV2(i.data), amount = BigInt(args.amount);
          if (a(4) !== POOL.address || a(8) !== POOL.tokenVaultA || a(10) !== POOL.tokenVaultB || a(14) !== orcaOracleAddress(POOL.address) ||
              ![11, 12, 13].every(n => tickArrays.has(a(n)))) fault({ Custom: 6023 });
          const quoted = quoteFor(args.aToB, amount), actual = options.actualOutput ? options.actualOutput(quoted) : quoted;
          if (options.failSwap || actual < BigInt(args.otherAmountThreshold)) fault({ Custom: 6036 });
          const [source, target, vaultIn, vaultOut] = args.aToB ? [a(7), a(9), POOL.tokenVaultA, POOL.tokenVaultB] : [a(9), a(7), POOL.tokenVaultB, POOL.tokenVaultA];
          const from = s.tokens.get(source), to = s.tokens.get(target);
          if (!from || !to || from.amount < amount) fault({ Custom: 1 });
          from!.amount -= amount + (options.extraInputDebit ?? 0n); s.tokens.get(vaultIn)!.amount += amount; s.tokens.get(vaultOut)!.amount -= actual; to!.amount += actual;
          if (to!.mint === WSOL) s.lamportsOf.set(target, (s.lamportsOf.get(target) ?? 0n) + actual);
          if (from!.mint === WSOL) s.lamportsOf.set(source, (s.lamportsOf.get(source) ?? 0n) - amount);
          logs.push('Program log: Instruction: SwapV2', `Program ${P.token} invoke [2]`, `Program ${P.token} invoke [2]`);
          if (!options.noTradeEvent) logs.push(tradedLog(args.aToB, amount, actual));
          return;
        }
        fault('UnsupportedProgramId');
      });
    } catch (cause) { return { err: (cause as { custom?: unknown }).custom ?? 'ProgramFailed', fee, units: 40_000, logs }; }
    return { err: null, fee, units: 68_000, logs };
  }
  const accountValue = (s: Snapshot, k: string) => {
    if (k === POOL.address) { const data = encodeMockedWhirlpool(options.poolConfig); return { lamports: 5_000_000, owner: P.whirlpool, data: [toBase64(data), 'base64'], executable: false, rentEpoch: 0, space: data.length }; }
    if (tickArrays.has(k)) return { lamports: 70_000_000, owner: P.whirlpool, data: [toBase64(new Uint8Array(16)), 'base64'], executable: false, rentEpoch: 0, space: 16 };
    const token = s.tokens.get(k);
    if (token) {
      const data = new Uint8Array(165); data.set(publicKeyBytes(token.mint), 0); data.set(publicKeyBytes(token.owner), 32); new DataView(data.buffer).setBigUint64(64, token.amount, true);
      return { lamports: Number(lamportsAt(s, k)), owner: P.token, data: [toBase64(data), 'base64'], executable: false, rentEpoch: 0, space: 165 };
    }
    const lamports = s.lamports.get(k);
    return lamports === undefined ? null : { lamports: Number(lamports), owner: P.system, data: ['', 'base64'], executable: false, rentEpoch: 0, space: 0 };
  };
  function decode(txBase64: unknown) {
    const bytes = fromBase64(txBase64, 2048), { signatures, message } = parseTransaction(bytes), parsed = parseMessageV0(message);
    return { bytes, signatures, message, parsed, instructions: decompileMessageV0(parsed, {}) };
  }
  function balances(s: Snapshot, keys: string[]) {
    return { lamports: keys.map(k => lamportsAt(s, k)), tokens: keys.flatMap((k, accountIndex) => { const t = s.tokens.get(k);
      return t ? [{ accountIndex, mint: t.mint, owner: t.owner, programId: P.token, uiTokenAmount: { amount: t.amount.toString(), decimals: solanaDevnetTokenByMint(t.mint)?.decimals ?? 0 } }] : []; }) };
  }
  function land(txBase64: string): string {
    const d = decode(txBase64), signature = base58Encode(d.signatures[0]!);
    if (state.transactions.has(signature)) return signature;
    if (!verifyEd25519(d.signatures[0]!, d.message, d.parsed.staticKeys[0]!)) throw Object.assign(new Error('Transaction signature verification failure'), { rpc: -32003 });
    const valid = issued.get(d.parsed.blockhash);
    if (valid === undefined || state.blockHeight > valid) throw Object.assign(new Error('Blockhash not found'), { rpc: -32002 });
    const keys = d.parsed.staticKeys, before = snapshot(), working = snapshot(), result = execute(working, d.instructions, keys[0]!);
    const final = result.err ? (() => { const s = snapshot(); s.lamports.set(keys[0]!, (s.lamports.get(keys[0]!) ?? 0n) - result.fee); return s; })() : working;
    const pre = balances(before, keys), post = balances(final, keys);
    state.lamports = final.lamports; state.tokens = final.tokens; state.lamportsOf = final.lamportsOf; state.slot += 1;
    state.transactions.set(signature, { signature, slot: state.slot, bytes: txBase64, err: result.err, fee: result.fee, keys, pre: pre.lamports, post: post.lamports,
      preTokens: pre.tokens, postTokens: post.tokens, logs: result.logs, finalizedAt: state.blockHeight + (options.confirmationDelay ?? 0) });
    return signature;
  }
  const value = (v: unknown) => ({ context: { slot: state.slot, apiVersion: 'mocked' }, value: v });
  async function rpc(method: string, params: readonly unknown[]): Promise<unknown> {
    switch (method) {
      case 'getGenesisHash': return options.cluster ?? profile.genesisHash;
      case 'getMultipleAccounts': return value((params[0] as string[]).map(k => accountValue(snapshot(), k)));
      case 'getLatestBlockhash': { const hash = blockhash(state.blockHeight); issued.set(hash, state.blockHeight + 150); return value({ blockhash: hash, lastValidBlockHeight: state.blockHeight + 150 }); }
      case 'getBlockHeight': return state.blockHeight;
      case 'simulateTransaction': {
        const d = decode(params[0]), s = snapshot(), result = execute(s, d.instructions, d.parsed.staticKeys[0]!);
        const addresses = ((params[1] as { accounts?: { addresses?: string[] } })?.accounts?.addresses) ?? [];
        // Accounts the transaction closed are reported empty with zero lamports.
        const closed = (k: string) => state.tokens.has(k) || state.lamportsOf.has(k) || d.instructions.some(i => i.programId === P.associatedToken && i.accounts[1]?.pubkey === k);
        return value({ err: result.err, logs: result.logs, unitsConsumed: result.units || 1, accounts: addresses.map(k => accountValue(s, k) ??
          (closed(k) ? { lamports: 0, owner: P.system, data: ['', 'base64'], executable: false, rentEpoch: 0, space: 0 } : null)) });
      }
      case 'sendTransaction': {
        state.sent.push(params[0] as string);
        if (options.send === 'DROPPED') return base58Encode(parseTransaction(fromBase64(params[0], 2048)).signatures[0]!);
        if (options.send === 'RPC_ERROR_DROPPED') throw Object.assign(new Error('Node is behind'), { rpc: -32005 });
        const signature = land(params[0] as string);
        if (options.send === 'RPC_ERROR_AFTER_LANDING') throw Object.assign(new Error('Request timed out'), { rpc: -32603 });
        return signature;
      }
      case 'getSignatureStatuses': return value((params[0] as string[]).map(sig => { const t = state.transactions.get(sig);
        return t ? { slot: t.slot, confirmations: null, err: t.err, confirmationStatus: state.blockHeight >= t.finalizedAt ? 'finalized' : 'confirmed' } : null; }));
      case 'getTransaction': { const t = state.transactions.get(params[0] as string);
        if (!t || state.blockHeight < t.finalizedAt) return null;
        return { slot: t.slot, blockTime: 1_790_870_000 + t.slot % 1000, version: 0, transaction: [t.bytes, 'base64'],
          meta: { err: t.err, fee: Number(t.fee), preBalances: t.pre.map(Number), postBalances: t.post.map(Number), preTokenBalances: t.preTokens, postTokenBalances: t.postTokens,
            loadedAddresses: { writable: [], readonly: [] }, innerInstructions: [{ index: 5, instructions: [{ programIdIndex: t.keys.indexOf(P.token), accounts: [], data: '' }] }],
            logMessages: t.logs, computeUnitsConsumed: 68_000 } }; }
      default: throw new Error('SOLANA_RPC_METHOD_DENIED');
    }
  }
  return { state, rpc, fund, ata, quoteFor, advance: (blocks: number) => { state.blockHeight += blocks; state.slot += blocks; } };
}
