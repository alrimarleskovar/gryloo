// SPDX-License-Identifier: AGPL-3.0-only
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { JUPITER_SOLANA_MAINNET as profile, SOLANA_MAINNET_TOKENS, solanaTokenByMint } from '@defi-workflow-engine/action-registry';
import { associatedTokenAddress, serializeSignedTransaction, base58Encode, decompileMessageV0, findProgramAddress, fromBase64, parseMessageV0, parseTransaction, publicKeyBytes,
  readU64, serializeTransaction, toBase64, u32Bytes, u64Bytes, verifyEd25519, type SolanaInstruction } from './solana.js';
import { decodeJupiterSwap } from './jupiter.js';

/**
 * MOCKED deterministic Solana mainnet-beta + Jupiter /build loopback for tests and the offline browser harness.
 * It interprets the exact compiled message. Nothing here is public evidence.
 */
const P = profile.programs, LOOKUP = 'AddressLookupTab1e1111111111111111111111111', RENT = 2_039_280n;
const PRICE: Record<string, bigint> = { SOL: 117_600_000n, USDC: 1_000_000n, USDT: 1_000_000n }; // micro-USD per whole token
const key = (label: string) => base58Encode(sha256(new TextEncoder().encode('gryloo-mock:' + label)));
export type MockedTokenAccount = { mint: string; owner: string; amount: bigint };
export type MockedTransaction = { signature: string; slot: number; bytes: string; err: unknown; fee: bigint; keys: string[]; loaded: { writable: string[]; readonly: string[] };
  pre: bigint[]; post: bigint[]; preTokens: unknown[]; postTokens: unknown[]; inner: unknown[]; finalizedAt: number };
export type MockedJupiterOptions = { actualOutput?: (quoted: bigint) => bigint; failSwap?: boolean; extraInputDebit?: bigint;
  send?: 'OK' | 'RPC_ERROR_AFTER_LANDING' | 'RPC_ERROR_DROPPED' | 'DROPPED'; confirmationDelay?: number; cluster?: string; tamperBuild?: (build: Record<string, unknown>) => void };
export function createMockedSolanaJupiter(options: MockedJupiterOptions = {}) {
  const state = { slot: 300_000_000, blockHeight: 280_000_000, lamports: new Map<string, bigint>(), tokens: new Map<string, MockedTokenAccount>(),
    lamportsOf: new Map<string, bigint>(), transactions: new Map<string, MockedTransaction>(), sent: [] as string[], builds: 0 };
  const tableAddress = key('lookup-table'), pool = key('pool'), vaultA = key('vault-a'), vaultB = key('vault-b');
  const table = [P.token, P.system, pool, vaultA, vaultB, key('oracle'), P.jupiterEventAuthority];
  const ata = (owner: string, mint: string) => associatedTokenAddress(owner, mint, P.token, P.associatedToken);
  const blockhash = (height: number) => base58Encode(sha256(new TextEncoder().encode('blockhash:' + height)));
  const issued = new Map<string, number>();
  function fund(owner: string, lamports: bigint, tokens: Partial<Record<'USDC' | 'USDT', bigint>> = {}) {
    state.lamports.set(owner, lamports);
    for (const [symbol, amount] of Object.entries(tokens)) {
      const token = SOLANA_MAINNET_TOKENS[symbol as 'USDC' | 'USDT'];
      state.tokens.set(ata(owner, token.mint), { mint: token.mint, owner, amount: amount as bigint }); state.lamportsOf.set(ata(owner, token.mint), RENT);
    }
  }
  const ix = (programId: string, accounts: [string, boolean, boolean][], data: number[]) => ({ programId, data: toBase64(Uint8Array.from(data)),
    accounts: accounts.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })) });
  function build(query: Record<string, string>): unknown {
    state.builds++;
    const input = solanaTokenByMint(query.inputMint ?? ''), output = solanaTokenByMint(query.outputMint ?? ''), owner = query.taker ?? '';
    if (!input || !output) return { error: 'No routes found' };
    const amount = BigInt(query.amount ?? '0'), slippage = Number(query.slippageBps ?? '50');
    const out = amount * PRICE[input.symbol]! * 10n ** BigInt(output.decimals) / (PRICE[output.symbol]! * 10n ** BigInt(input.decimals));
    const min = out * BigInt(10_000 - slippage) / 10_000n;
    const inAccount = ata(owner, input.mint), outAccount = ata(owner, output.mint);
    const setup = [ix(P.associatedToken, [[owner, true, true], [outAccount, false, true], [owner, false, false], [output.mint, false, false], [P.system, false, false], [P.token, false, false]], [1])];
    if (input.native) setup.unshift(ix(P.associatedToken, [[owner, true, true], [inAccount, false, true], [owner, false, false], [input.mint, false, false], [P.system, false, false], [P.token, false, false]], [1]),
      ix(P.system, [[owner, true, true], [inAccount, false, true]], [...u32Bytes(2), ...u64Bytes(amount)]), ix(P.token, [[inAccount, false, true]], [17]));
    const data = [...Buffer.from(profile.routeV2Discriminator, 'hex'), ...u64Bytes(amount), ...u64Bytes(out), slippage & 255, slippage >> 8, 0, 0, 0, 0, 1, 0, 0, 0, 7, 16, 39, 0, 1];
    const swap = ix(P.jupiter, [[owner, true, false], [inAccount, false, true], [outAccount, false, true], [input.mint, false, false], [output.mint, false, false],
      [P.token, false, false], [P.token, false, false], [P.jupiter, false, false], [P.jupiterEventAuthority, false, false], [P.jupiter, false, false],
      [pool, false, true], [vaultA, false, true], [vaultB, false, true], [key('oracle'), false, false]], data);
    const wrapped = input.native ? inAccount : output.native ? outAccount : null;
    const response: Record<string, unknown> = { inputMint: input.mint, outputMint: output.mint, inAmount: amount.toString(), outAmount: out.toString(),
      otherAmountThreshold: min.toString(), swapMode: 'ExactIn', slippageBps: slippage, priceImpactPct: '0',
      routePlan: [{ percent: 100, bps: 10_000, swapInfo: { ammKey: pool, label: 'MockedAMM', inputMint: input.mint, outputMint: output.mint, inAmount: amount.toString(), outAmount: out.toString() } }],
      computeBudgetInstructions: [ix(P.computeBudget, [], [3, ...u64Bytes(1_000n)])], setupInstructions: setup, swapInstruction: swap,
      cleanupInstruction: wrapped ? ix(P.token, [[wrapped, false, true], [owner, false, true], [owner, true, false]], [9]) : null,
      otherInstructions: [], tipInstruction: null, addressesByLookupTableAddress: { [tableAddress]: table },
      blockhashWithMetadata: { blockhash: [...publicKeyBytes(blockhash(state.blockHeight))], lastValidBlockHeight: state.blockHeight + 150 } };
    options.tamperBuild?.(response);
    return response;
  }
  type Snapshot = { lamports: Map<string, bigint>; tokens: Map<string, MockedTokenAccount>; lamportsOf: Map<string, bigint> };
  const snapshot = (): Snapshot => ({ lamports: new Map(state.lamports), tokens: new Map([...state.tokens].map(([k, v]) => [k, { ...v }])), lamportsOf: new Map(state.lamportsOf) });
  const lamportsAt = (s: Snapshot, k: string) => s.lamports.get(k) ?? s.lamportsOf.get(k) ?? 0n;
  /** Execute instructions against a snapshot; returns an error object instead of throwing on program failure. */
  function execute(s: Snapshot, instructions: SolanaInstruction[], payer: string): { err: unknown; fee: bigint; units: number } {
    let limit = 200_000, price = 0n;
    for (const i of instructions) if (i.programId === P.computeBudget) { if (i.data[0] === 2) limit = new DataView(i.data.buffer, i.data.byteOffset).getUint32(1, true); if (i.data[0] === 3) price = readU64(i.data, 1); }
    const fee = 5000n + (BigInt(limit) * price + 999_999n) / 1_000_000n;
    if ((s.lamports.get(payer) ?? 0n) < fee) return { err: 'InsufficientFundsForFee', fee, units: 0 };
    s.lamports.set(payer, s.lamports.get(payer)! - fee);
    const debit = (k: string, n: bigint) => { const v = s.lamports.get(k) ?? 0n; if (v < n) throw new Error('insufficient lamports'); s.lamports.set(k, v - n); };
    try {
      instructions.forEach((i, index) => {
        const a = (n: number) => i.accounts[n]!.pubkey;
        if (i.programId === P.computeBudget) return;
        if (i.programId === P.associatedToken) { if (!s.tokens.has(a(1))) { debit(a(0), RENT); s.tokens.set(a(1), { mint: a(3), owner: a(2), amount: 0n }); s.lamportsOf.set(a(1), RENT); } return; }
        if (i.programId === P.system) { const n = readU64(i.data, 4); debit(a(0), n); s.lamportsOf.set(a(1), (s.lamportsOf.get(a(1)) ?? 0n) + n); s.tokens.get(a(1))!.amount += n; return; }
        if (i.programId === P.token && i.data[0] === 17) return;
        if (i.programId === P.token && i.data[0] === 9) { const lam = s.lamportsOf.get(a(0)) ?? 0n; s.tokens.delete(a(0)); s.lamportsOf.delete(a(0)); s.lamports.set(a(1), (s.lamports.get(a(1)) ?? 0n) + lam); return; }
        if (i.programId === P.jupiter) {
          const args = decodeJupiterSwap(i.data), source = s.tokens.get(a(1)), target = s.tokens.get(a(2));
          const min = BigInt(args.quotedOutAmount) * BigInt(10_000 - args.slippageBps) / 10_000n;
          const actual = options.actualOutput ? options.actualOutput(BigInt(args.quotedOutAmount)) : BigInt(args.quotedOutAmount);
          if (options.failSwap || actual < min) throw Object.assign(new Error('slippage'), { custom: { InstructionError: [index, { Custom: 6001 }] } });
          if (!source || !target || source.amount < BigInt(args.inAmount)) throw Object.assign(new Error('funds'), { custom: { InstructionError: [index, { Custom: 1 }] } });
          source.amount -= BigInt(args.inAmount) + (options.extraInputDebit ?? 0n); target.amount += actual;
          if (target.mint === 'So11111111111111111111111111111111111111112') s.lamportsOf.set(a(2), (s.lamportsOf.get(a(2)) ?? 0n) + actual);
          if (source.mint === 'So11111111111111111111111111111111111111112') s.lamportsOf.set(a(1), (s.lamportsOf.get(a(1)) ?? 0n) - BigInt(args.inAmount));
          return;
        }
        throw Object.assign(new Error('program'), { custom: { InstructionError: [index, 'UnsupportedProgramId'] } });
      });
    } catch (cause) { return { err: (cause as { custom?: unknown }).custom ?? 'ProgramFailed', fee, units: 90_000 }; }
    return { err: null, fee, units: 120_000 };
  }
  const tables = () => ({ [tableAddress]: table });
  const accountValue = (s: Snapshot, k: string) => {
    if (k === tableAddress) {
      const data = new Uint8Array(56 + 32 * table.length); new DataView(data.buffer).setUint32(0, 1, true); new DataView(data.buffer).setBigUint64(4, 0xffffffffffffffffn, true);
      table.forEach((address, i) => data.set(publicKeyBytes(address), 56 + 32 * i));
      return { lamports: 1_000_000, owner: LOOKUP, data: [toBase64(data), 'base64'], executable: false, rentEpoch: 0, space: data.length };
    }
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
    return { bytes, signatures, message, parsed, instructions: decompileMessageV0(parsed, tables()) };
  }
  function balances(s: Snapshot, keys: string[]) {
    return { lamports: keys.map(k => lamportsAt(s, k)), tokens: keys.flatMap((k, accountIndex) => { const t = s.tokens.get(k);
      return t ? [{ accountIndex, mint: t.mint, owner: t.owner, programId: P.token, uiTokenAmount: { amount: t.amount.toString(), decimals: solanaTokenByMint(t.mint)?.decimals ?? 0 } }] : []; }) };
  }
  function land(txBase64: string): string {
    const d = decode(txBase64), signature = base58Encode(d.signatures[0]!);
    if (state.transactions.has(signature)) return signature;
    if (!verifyEd25519(d.signatures[0]!, d.message, d.parsed.staticKeys[0]!)) throw Object.assign(new Error('Transaction signature verification failure'), { rpc: -32003 });
    const valid = issued.get(d.parsed.blockhash);
    if (valid === undefined || state.blockHeight > valid) throw Object.assign(new Error('Blockhash not found'), { rpc: -32002 });
    const keys = [...d.parsed.staticKeys, ...d.parsed.lookups.flatMap(l => l.writable.map(i => table[i]!)), ...d.parsed.lookups.flatMap(l => l.readonly.map(i => table[i]!))];
    const before = snapshot(), working = snapshot(), result = execute(working, d.instructions, keys[0]!);
    const final = result.err ? (() => { const s = snapshot(); s.lamports.set(keys[0]!, (s.lamports.get(keys[0]!) ?? 0n) - result.fee); return s; })() : working;
    const pre = balances(before, keys), post = balances(final, keys);
    state.lamports = final.lamports; state.tokens = final.tokens; state.lamportsOf = final.lamportsOf;
    state.slot += 1;
    state.transactions.set(signature, { signature, slot: state.slot, bytes: txBase64, err: result.err, fee: result.fee, keys,
      loaded: { writable: keys.slice(d.parsed.staticKeys.length, d.parsed.staticKeys.length + d.parsed.lookups.reduce((n, l) => n + l.writable.length, 0)),
        readonly: keys.slice(d.parsed.staticKeys.length + d.parsed.lookups.reduce((n, l) => n + l.writable.length, 0)) },
      pre: pre.lamports, post: post.lamports, preTokens: pre.tokens, postTokens: post.tokens,
      inner: [{ index: 3, instructions: [{ programIdIndex: keys.indexOf(P.token), accounts: [], data: '' }] }], finalizedAt: state.blockHeight + (options.confirmationDelay ?? 0) });
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
        return value({ err: result.err, logs: ['Program log: MOCKED simulation'], unitsConsumed: result.units || 1, accounts: addresses.map(k => accountValue(s, k)) });
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
            loadedAddresses: t.loaded, innerInstructions: t.inner, logMessages: ['Program log: MOCKED'], computeUnitsConsumed: 120_000 } }; }
      default: throw new Error('SOLANA_RPC_METHOD_DENIED');
    }
  }
  return { state, rpc, http: async (query: Record<string, string>) => build(query), fund, advance: (blocks: number) => { state.blockHeight += blocks; state.slot += blocks; },
    tableAddress, ata, eventAuthority: findProgramAddress([new TextEncoder().encode('__event_authority')], P.jupiter) };
}
/** MOCKED wallet signing with an in-memory disposable key. Never used by product code paths. */
export function createMockedSolanaWallet(secretKey: Uint8Array = ed25519.utils.randomSecretKey()) {
  const owner = base58Encode(ed25519.getPublicKey(secretKey));
  return { owner, sign(unsignedBase64: string): string {
    const { signatures, message } = parseTransaction(fromBase64(unsignedBase64, 2048));
    const signature = ed25519.sign(message, secretKey);
    // Like a Wallet Standard wallet: the owner fills its own (first) slot and preserves any other signer slots.
    return toBase64(signatures.length === 1 ? serializeTransaction(signature, message) : serializeSignedTransaction([signature, ...signatures.slice(1)], message));
  },
  /** BUILD-MCP-002: Wallet Standard `solana:signMessage` (Sign-In With Solana): an Ed25519 signature over the exact bytes, never a transaction. */
  signMessage(message: Uint8Array): Uint8Array { return ed25519.sign(message, secretKey); } };
}
