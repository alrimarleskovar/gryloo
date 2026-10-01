// SPDX-License-Identifier: AGPL-3.0-only
import { sha256 } from '@noble/hashes/sha2.js';
import { ORCA_WHIRLPOOLS_DEVNET as profile, solanaDevnetTokenByMint } from '@defi-workflow-engine/action-registry';
import { associatedTokenAddress, base58Encode, decompileMessageV0, fromBase64, parseMessageV0, parseTransaction, publicKeyBytes, readU64, toBase64,
  u64Bytes, verifyEd25519, type SolanaInstruction } from './solana.js';
import { decodeOrcaSwapV2, orcaOracleAddress, orcaTickArrayAddress, orcaTickArrayStarts } from './orca-whirlpool.js';
import { ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY as lp } from '@defi-workflow-engine/action-registry';
import { decodeOrcaModifyLiquidity, decodeOrcaOpenPosition, orcaLiquidityAmounts, orcaSqrtPriceAtTick, orcaTickArrayStart, orcaLiquidityTickArray } from './orca-liquidity.js';

/**
 * MOCKED deterministic Solana Devnet + Orca Whirlpool loopback for tests and the offline browser harness.
 * It interprets the exact compiled message at a fixed synthetic price. Nothing here is public or Devnet evidence.
 */
const P = profile.programs, POOL = profile.pool, RENT = 2_039_280n, WSOL = POOL.tokenMintA;
const SQRT_PRICE = 2_758_300_908_685_096_775n, TICK = -38_008, FEE_PPM = 2_000n;
const orcaSqrtAt = (tick: number) => orcaSqrtPriceAtTick(tick);
/** Synthetic rate: 22.3 devUSDC per Devnet SOL before the 0.2% pool fee. */
const MICRO_USDC_PER_SOL = 22_300_000n;
export type MockedOrcaOptions = { actualOutput?: (quoted: bigint) => bigint; failSwap?: boolean; extraInputDebit?: bigint; extraOwnerDebit?: bigint;
  send?: 'OK' | 'RPC_ERROR_AFTER_LANDING' | 'RPC_ERROR_DROPPED' | 'DROPPED'; confirmationDelay?: number; cluster?: string; poolConfig?: string; noTradeEvent?: boolean;
  /** BUILD-015 liquidity: synthetic trading fees credited to a position when it is next modified or collected. */
  accrueFees?: { a: string; b: string }; failLiquidity?: boolean; poolRewardMint?: string; poolFeeRate?: number; extraVaultOutflowB?: bigint;
  /** Shift the pool price between simulation and execution (price movement), in ticks. */
  priceShiftTicks?: number };
type Position = { mint: string; liquidity: bigint; lower: number; upper: number; feeOwedA: bigint; feeOwedB: bigint };
type Token = { mint: string; owner: string; amount: bigint };
type Snapshot = { lamports: Map<string, bigint>; tokens: Map<string, Token>; lamportsOf: Map<string, bigint>; positions: Map<string, Position>; tokens2022: Map<string, Token>;
  mints: Set<string>; accrued: Set<string> };
const POSITION_RENT = 2_885_440n, MINT_RENT = 1_676_400n, POSITION_TOKEN_RENT = 1_513_840n;
type Landed = { signature: string; slot: number; bytes: string; err: unknown; fee: bigint; keys: string[]; pre: bigint[]; post: bigint[];
  preTokens: unknown[]; postTokens: unknown[]; logs: string[]; finalizedAt: number };

export function encodeMockedWhirlpool(config: string = profile.whirlpoolsConfig, options: { rewardMint?: string | undefined; feeRate?: number | undefined } = {}): Uint8Array {
  const data = new Uint8Array(653), view = new DataView(data.buffer);
  data.set(Buffer.from('3f95d10ce1806309', 'hex'), 0); data.set(publicKeyBytes(config), 8); data[40] = 255;
  view.setUint16(41, POOL.tickSpacing, true); view.setUint16(45, options.feeRate ?? Number(FEE_PPM), true); view.setUint16(47, 300, true);
  if (options.rewardMint) data.set(publicKeyBytes(options.rewardMint), 269);
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
    positions: new Map<string, Position>(), tokens2022: new Map<string, Token>(), mints: new Set<string>(), accrued: new Set<string>(),
    transactions: new Map<string, Landed>(), sent: [] as string[] };
  const ata = (owner: string, mint: string) => associatedTokenAddress(owner, mint, P.token, P.associatedToken);
  const blockhash = (height: number) => base58Encode(sha256(new TextEncoder().encode('devnet-blockhash:' + height)));
  const issued = new Map<string, number>();
  state.tokens.set(POOL.tokenVaultA, { mint: POOL.tokenMintA, owner: POOL.address, amount: 357_303_449_041n });
  state.tokens.set(POOL.tokenVaultB, { mint: POOL.tokenMintB, owner: POOL.address, amount: 7_142_157_709n });
  const tickArrays = new Set([true, false].flatMap(aToB => orcaTickArrayStarts(TICK, POOL.tickSpacing, aToB).map(start => orcaTickArrayAddress(POOL.address, start))));
  // Initialized liquidity tick arrays: three on each side of the current price.
  const span = lp.tickArraySize * POOL.tickSpacing;
  for (let i = -3; i <= 3; i++) tickArrays.add(orcaLiquidityTickArray(POOL.address, orcaTickArrayStart(TICK) + i * span));
  const poolTick = () => TICK + (options.priceShiftTicks ?? 0);
  const poolSqrt = () => options.priceShiftTicks ? orcaSqrtAt(poolTick()) : SQRT_PRICE;
  function fund(owner: string, lamports: bigint, devUsdc = 0n) {
    state.lamports.set(owner, lamports);
    if (devUsdc > 0n) { state.tokens.set(ata(owner, POOL.tokenMintB), { mint: POOL.tokenMintB, owner, amount: devUsdc }); state.lamportsOf.set(ata(owner, POOL.tokenMintB), RENT); }
  }
  const snapshot = (): Snapshot => ({ lamports: new Map(state.lamports), tokens: new Map([...state.tokens].map(([k, v]) => [k, { ...v }])), lamportsOf: new Map(state.lamportsOf),
    positions: new Map([...state.positions].map(([k, v]) => [k, { ...v }])), tokens2022: new Map([...state.tokens2022].map(([k, v]) => [k, { ...v }])), mints: new Set(state.mints),
    accrued: new Set(state.accrued) });
  const lamportsAt = (s: Snapshot, k: string) => s.lamports.get(k) ?? s.lamportsOf.get(k) ?? 0n;
  const quoteFor = (aToB: boolean, amount: bigint) => (aToB ? amount * MICRO_USDC_PER_SOL / 1_000_000_000n : amount * 1_000_000_000n / MICRO_USDC_PER_SOL) * (1_000_000n - FEE_PPM) / 1_000_000n;
  const hexOf = (data: Uint8Array) => Buffer.from(data.slice(0, 8)).toString('hex');
  const eventLog = (discriminator: string, position: string, p: Position, extra?: { liquidity: bigint; a: bigint; b: bigint }) => {
    const data = new Uint8Array(extra ? 128 : 80), view = new DataView(data.buffer);
    data.set(Buffer.from(discriminator, 'hex'), 0); data.set(publicKeyBytes(POOL.address), 8); data.set(publicKeyBytes(position), 40);
    view.setInt32(72, p.lower, true); view.setInt32(76, p.upper, true);
    if (extra) { data.set(u64Bytes(extra.liquidity & ((1n << 64n) - 1n)), 80); data.set(u64Bytes(extra.liquidity >> 64n), 88); data.set(u64Bytes(extra.a), 96); data.set(u64Bytes(extra.b), 104); }
    return 'Program data: ' + toBase64(data);
  };
  /** MOCKED Whirlpools position instructions at the synthetic pool price, with the program's own integer rounding. */
  function liquidity(s: Snapshot, i: SolanaInstruction, index: number, logs: string[], debit: (k: string, n: bigint) => void, fault: (code: unknown) => never) {
    const a = (n: number) => i.accounts[n]!.pubkey, d = hexOf(i.data), I = lp.instructions;
    if (options.failLiquidity) fault({ Custom: 6001 });
    const move = (from: string, to: string, amount: bigint) => {
      const source = s.tokens.get(from), target = s.tokens.get(to);
      if (!source || !target || source.amount < amount) fault({ Custom: 1 });
      source!.amount -= amount; target!.amount += amount;
      if (source!.mint === WSOL && from !== POOL.tokenVaultA) s.lamportsOf.set(from, (s.lamportsOf.get(from) ?? 0n) - amount);
      if (target!.mint === WSOL && to !== POOL.tokenVaultA) s.lamportsOf.set(to, (s.lamportsOf.get(to) ?? 0n) + amount);
    };
    const accrue = (key: string, p: Position) => { if (options.accrueFees && p.liquidity > 0n && !s.accrued.has(key)) { s.accrued.add(key); p.feeOwedA += BigInt(options.accrueFees.a); p.feeOwedB += BigInt(options.accrueFees.b); } };
    const authority = (owner: string, positionToken: string, mint: string) => { const t = s.tokens2022.get(positionToken); if (!t || t.owner !== owner || t.mint !== mint || t.amount !== 1n) fault({ Custom: 6017 }); };
    if (d === I.openPositionWithTokenExtensions) {
      const args = decodeOrcaOpenPosition(i.data);
      if (a(5) !== POOL.address || s.positions.has(a(2)) || s.mints.has(a(3)) || args.tickLower % POOL.tickSpacing || args.tickUpper % POOL.tickSpacing || args.tickLower >= args.tickUpper) fault({ Custom: 6008 });
      debit(a(0), POSITION_RENT + MINT_RENT + POSITION_TOKEN_RENT);
      const p: Position = { mint: a(3), liquidity: 0n, lower: args.tickLower, upper: args.tickUpper, feeOwedA: 0n, feeOwedB: 0n };
      s.positions.set(a(2), p); s.lamportsOf.set(a(2), POSITION_RENT); s.mints.add(a(3)); s.lamportsOf.set(a(3), MINT_RENT);
      s.tokens2022.set(a(4), { mint: a(3), owner: a(1), amount: 1n }); s.lamportsOf.set(a(4), POSITION_TOKEN_RENT);
      logs.push('Program log: Instruction: OpenPositionWithTokenExtensions', eventLog(lp.events.positionOpened, a(2), p), `Program ${lp.programs.token2022} invoke [2]`);
      return;
    }
    if (d === I.increaseLiquidityV2 || d === I.decreaseLiquidityV2) {
      const args = decodeOrcaModifyLiquidity(i.data), p = s.positions.get(a(5));
      if (a(0) !== POOL.address || a(11) !== POOL.tokenVaultA || a(12) !== POOL.tokenVaultB || !p || ![a(13), a(14)].every(t => tickArrays.has(t))) fault({ Custom: 6023 });
      authority(a(4), a(6), p!.mint);
      const delta = BigInt(args.liquidity), increase = args.kind === 'increase';
      if (delta === 0n || !increase && delta > p!.liquidity) fault({ Custom: 6003 });
      accrue(a(5), p!);
      const amounts = orcaLiquidityAmounts({ tickCurrentIndex: poolTick(), sqrtPrice: poolSqrt() }, p!.lower, p!.upper, delta, increase);
      if (increase && (amounts.amount0 > BigInt(args.tokenA) || amounts.amount1 > BigInt(args.tokenB))) fault({ Custom: 6017 });
      if (!increase && (amounts.amount0 < BigInt(args.tokenA) || amounts.amount1 < BigInt(args.tokenB))) fault({ Custom: 6018 });
      if (increase) { move(a(9), POOL.tokenVaultA, amounts.amount0); move(a(10), POOL.tokenVaultB, amounts.amount1); p!.liquidity += delta; }
      else { move(POOL.tokenVaultA, a(9), amounts.amount0); move(POOL.tokenVaultB, a(10), amounts.amount1); p!.liquidity -= delta; }
      logs.push(`Program log: Instruction: ${increase ? 'IncreaseLiquidityV2' : 'DecreaseLiquidityV2'}`, `Program ${P.token} invoke [2]`,
        eventLog(increase ? lp.events.liquidityIncreased : lp.events.liquidityDecreased, a(5), p!, { liquidity: delta, a: amounts.amount0, b: amounts.amount1 }));
      return;
    }
    if (d === I.collectFeesV2) {
      const p = s.positions.get(a(2));
      if (a(0) !== POOL.address || !p) fault({ Custom: 6023 });
      authority(a(1), a(3), p!.mint); accrue(a(2), p!);
      move(POOL.tokenVaultA, a(6), p!.feeOwedA); move(POOL.tokenVaultB, a(8), p!.feeOwedB + (options.extraVaultOutflowB ?? 0n));
      p!.feeOwedA = 0n; p!.feeOwedB = 0n;
      logs.push('Program log: Instruction: CollectFeesV2');
      return;
    }
    if (d === I.closePositionWithTokenExtensions) {
      const p = s.positions.get(a(2));
      if (!p || p.mint !== a(3)) fault({ Custom: 6023 });
      authority(a(0), a(4), p!.mint);
      if (p!.liquidity !== 0n || p!.feeOwedA !== 0n || p!.feeOwedB !== 0n) fault({ Custom: 6009 });
      const refund = (s.lamportsOf.get(a(2)) ?? 0n) + (s.lamportsOf.get(a(3)) ?? 0n) + (s.lamportsOf.get(a(4)) ?? 0n);
      s.positions.delete(a(2)); s.mints.delete(a(3)); s.tokens2022.delete(a(4)); [a(2), a(3), a(4)].forEach(k => s.lamportsOf.delete(k));
      s.lamports.set(a(1), (s.lamports.get(a(1)) ?? 0n) + refund);
      logs.push('Program log: Instruction: ClosePositionWithTokenExtensions', `Program ${lp.programs.token2022} invoke [2]`);
      return;
    }
    fault('InvalidInstructionData');
  }
  /** Execute against a snapshot; returns an error object instead of throwing on program failure. */
  function execute(s: Snapshot, instructions: SolanaInstruction[], payer: string, signers = 1): { err: unknown; fee: bigint; units: number; logs: string[] } {
    const fee = 5000n * BigInt(signers), logs: string[] = [];
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
        if (i.programId === P.whirlpool && Buffer.from(i.data.slice(0, 8)).toString('hex') !== profile.swapV2Discriminator) { liquidity(s, i, index, logs, debit, fault); return; }
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
    if (k === POOL.address) { const data = encodeMockedWhirlpool(options.poolConfig, { rewardMint: options.poolRewardMint, feeRate: options.poolFeeRate });
      if (options.priceShiftTicks) { const view = new DataView(data.buffer), sqrt = poolSqrt(); view.setBigUint64(65, sqrt & ((1n << 64n) - 1n), true); view.setBigUint64(73, sqrt >> 64n, true); view.setInt32(81, poolTick(), true); }
      return { lamports: 5_000_000, owner: P.whirlpool, data: [toBase64(data), 'base64'], executable: false, rentEpoch: 0, space: data.length }; }
    const position = s.positions.get(k);
    if (position) {
      const data = new Uint8Array(216), view = new DataView(data.buffer);
      data.set(Buffer.from(lp.positionDiscriminator, 'hex'), 0); data.set(publicKeyBytes(POOL.address), 8); data.set(publicKeyBytes(position.mint), 40);
      view.setBigUint64(72, position.liquidity & ((1n << 64n) - 1n), true); view.setBigUint64(80, position.liquidity >> 64n, true);
      view.setInt32(88, position.lower, true); view.setInt32(92, position.upper, true); view.setBigUint64(112, position.feeOwedA, true); view.setBigUint64(136, position.feeOwedB, true);
      return { lamports: Number(s.lamportsOf.get(k) ?? 0n), owner: P.whirlpool, data: [toBase64(data), 'base64'], executable: false, rentEpoch: 0, space: 216 };
    }
    if (s.mints.has(k)) return { lamports: Number(s.lamportsOf.get(k) ?? 0n), owner: lp.programs.token2022, data: [toBase64(new Uint8Array(234)), 'base64'], executable: false, rentEpoch: 0, space: 234 };
    const t22 = s.tokens2022.get(k);
    if (t22) {
      const data = new Uint8Array(170); data.set(publicKeyBytes(t22.mint), 0); data.set(publicKeyBytes(t22.owner), 32); new DataView(data.buffer).setBigUint64(64, t22.amount, true); data[108] = 1; data[165] = 2;
      return { lamports: Number(s.lamportsOf.get(k) ?? 0n), owner: lp.programs.token2022, data: [toBase64(data), 'base64'], executable: false, rentEpoch: 0, space: 170 };
    }
    if (tickArrays.has(k)) { const data = new Uint8Array(16); data.set(Buffer.from(lp.tickArrayDiscriminator, 'hex'), 0);
      return { lamports: 70_000_000, owner: P.whirlpool, data: [toBase64(data), 'base64'], executable: false, rentEpoch: 0, space: 16 }; }
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
    return { lamports: keys.map(k => lamportsAt(s, k)), tokens: keys.flatMap((k, accountIndex): { accountIndex: number; mint: string; owner: string; programId: string; uiTokenAmount: { amount: string; decimals: number } }[] => { const t = s.tokens.get(k), t22 = s.tokens2022.get(k);
      return t ? [{ accountIndex, mint: t.mint, owner: t.owner, programId: P.token, uiTokenAmount: { amount: t.amount.toString(), decimals: solanaDevnetTokenByMint(t.mint)?.decimals ?? 0 } }]
        : t22 ? [{ accountIndex, mint: t22.mint, owner: t22.owner, programId: lp.programs.token2022, uiTokenAmount: { amount: t22.amount.toString(), decimals: 0 } }] : []; }) };
  }
  function land(txBase64: string): string {
    const d = decode(txBase64), signature = base58Encode(d.signatures[0]!);
    if (state.transactions.has(signature)) return signature;
    if (d.signatures.length !== d.parsed.header[0] || d.signatures.some((sig, i) => !verifyEd25519(sig, d.message, d.parsed.staticKeys[i]!)))
      throw Object.assign(new Error('Transaction signature verification failure'), { rpc: -32003 });
    const valid = issued.get(d.parsed.blockhash);
    if (valid === undefined || state.blockHeight > valid) throw Object.assign(new Error('Blockhash not found'), { rpc: -32002 });
    const keys = d.parsed.staticKeys, before = snapshot(), working = snapshot(), result = execute(working, d.instructions, keys[0]!, d.signatures.length);
    const final = result.err ? (() => { const s = snapshot(); s.lamports.set(keys[0]!, (s.lamports.get(keys[0]!) ?? 0n) - result.fee); return s; })() : working;
    const pre = balances(before, keys), post = balances(final, keys);
    state.lamports = final.lamports; state.tokens = final.tokens; state.lamportsOf = final.lamportsOf; state.positions = final.positions; state.tokens2022 = final.tokens2022;
    state.mints = final.mints; state.accrued = final.accrued; state.slot += 1;
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
        const d = decode(params[0]), s = snapshot(), result = execute(s, d.instructions, d.parsed.staticKeys[0]!, d.parsed.header[0]);
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
