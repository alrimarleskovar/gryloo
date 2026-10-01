// SPDX-License-Identifier: AGPL-3.0-only
import { ORCA_WHIRLPOOLS_DEVNET as profile, solanaDevnetTokenByMint, type SolanaDevnetToken } from '@defi-workflow-engine/action-registry';
export { ORCA_WHIRLPOOLS_DEVNET, SOLANA_DEVNET_TOKENS } from '@defi-workflow-engine/action-registry';
export type { SolanaDevnetToken, SolanaDevnetTokenSymbol } from '@defi-workflow-engine/action-registry';
import { readExactInputSwap, EXACT_INPUT_SWAP_ACTION, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { associatedTokenAddress, base58Encode, compileMessageV0, decompileMessageV0, findProgramAddress, fromBase64, parseMessageV0, publicKeyBytes, readU64, serializeMessageV0, serializeTransaction,
  sha256Hex, solanaAddress, toBase64, u32Bytes, u64Bytes, type SolanaInstruction } from './solana.js';
import { assertMessageRoundTrip, assertSolanaSwapReview, buildSolanaSwapArtifacts, estimateFee, readSolanaAccounts, readSolanaSwapBalances, requireSolanaSwapRuntime,
  rpcContextValue, setComputeUnitLimit, simulateSolanaMessage, solanaSwapDeltas, solanaSwapHash, solanaTokenAmount, verifySignedSolanaSwap, verifySolanaCluster,
  type SolanaBalances, type SolanaRpc, type SolanaSwapQuote, type SolanaSwapReviewCore, type SolanaSwapSimulation } from './solana-swap.js';

/**
 * Orca Whirlpools `swap_v2` on Solana Devnet with valueless test tokens: the Devnet runtime of the canonical swap.
 * Gryloo reads and verifies the official Devnet pool, builds every instruction itself, compiles the exact v0
 * message and quotes by read-only simulation of that pool state. There is no third-party transaction to trust.
 * Instruction layout: orca-so/whirlpools programs/whirlpool/src/instructions/v2/swap.rs.
 */
export type OrcaIntent = { owner: string; input: SolanaDevnetToken; output: SolanaDevnetToken; amount: string; slippageBps: number };
export type OrcaPool = { address: string; whirlpoolsConfig: string; tickSpacing: number; feeRate: number; protocolFeeRate: number; liquidity: string;
  sqrtPrice: string; tickCurrentIndex: number; tokenMintA: string; tokenVaultA: string; tokenMintB: string; tokenVaultB: string; slot: number };
export type OrcaSwapArgs = { instruction: 'swap-v2'; pool: string; aToB: boolean; amount: string; otherAmountThreshold: string; sqrtPriceLimit: string;
  amountSpecifiedIsInput: boolean; tickArrays: string[]; oracle: string };
export type OrcaInspection = { programs: string[]; computeUnitPrice: string; ownerInputAccount: string; ownerOutputAccount: string; wrappedSolAccount: string;
  ensuredAccounts: string[]; swap: OrcaSwapArgs; tickArraysInitialized: boolean[] };
export type OrcaTradedEvent = { whirlpool: string; aToB: boolean; preSqrtPrice: string; postSqrtPrice: string; inputAmount: string; outputAmount: string;
  inputTransferFee: string; outputTransferFee: string; lpFee: string; protocolFee: string };
export type OrcaDevnetReview = Omit<SolanaSwapReviewCore, 'inspection'> & { format: 'gryloo.orca-devnet-review.v1'; cluster: 'devnet';
  provider: 'Orca Whirlpools'; inspection: OrcaInspection; pool: OrcaPool; simulatedTrade: OrcaTradedEvent };

const P = profile.programs, POOL = profile.pool;
const TOKEN_ACCOUNT_RENT = 2_039_280n, TICK_ARRAY_SIZE = 88, MIN_TICK = -443_636, MAX_TICK = 443_636;
const WHIRLPOOL_DISCRIMINATOR = '3f95d10ce1806309'; // sha256("account:Whirlpool")[0..8], equal to the Devnet pool account
const fail = (code: string): never => { throw new Error(code); };
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const utf8 = (text: string) => new TextEncoder().encode(text);
const u128 = (data: Uint8Array, at: number): bigint => readU64(data, at) + (readU64(data, at + 8) << 64n);
const ata = (owner: string, mint: string) => associatedTokenAddress(owner, mint, P.token, P.associatedToken);

/** Read the canonical swap and resolve it against the exact Orca Devnet profile. */
export function orcaDevnetIntent(workflow: SemanticWorkflow, owner: string): OrcaIntent & { nodeId: string } {
  const nodes = workflow.nodes.filter(n => n.actionType === EXACT_INPUT_SWAP_ACTION && n.chainId.startsWith('solana:'));
  if (nodes.length !== 1 || workflow.nodes.some(n => n !== nodes[0] && !n.actionType.startsWith('mock-'))) fail('SOLANA_SWAP_ISOLATED_ONLY');
  const fields = readExactInputSwap(nodes[0]!);
  if (fields.chain !== profile.chain) fail('SOLANA_CLUSTER_UNSUPPORTED');
  const input = solanaDevnetTokenByMint(fields.input.address), output = solanaDevnetTokenByMint(fields.output.address);
  if (!input || !output || input === output || input.decimals !== fields.input.decimals || output.decimals !== fields.output.decimals) fail('SOLANA_MINT_UNSUPPORTED');
  if (fields.protocols.join() !== profile.protocol) fail('SOLANA_SWAP_PROVIDER_UNSUPPORTED');
  if (fields.slippageBps < 1 || fields.slippageBps > profile.maximumSlippageBps) fail('SOLANA_SLIPPAGE_OUT_OF_RANGE');
  if (BigInt(fields.amount) > BigInt(input!.maximumAmount)) fail('AMOUNT_OUT_OF_RANGE');
  return { nodeId: nodes[0]!.nodeId, owner: solanaAddress(owner), input: input!, output: output!, amount: fields.amount, slippageBps: fields.slippageBps };
}

/** Whirlpool account layout (programs/whirlpool/src/state/whirlpool.rs). */
export function decodeWhirlpool(address: string, data: Uint8Array, slot: number): OrcaPool {
  if (data.length < 261 || hex(data.slice(0, 8)) !== WHIRLPOOL_DISCRIMINATOR) fail('ORCA_POOL_INVALID');
  const key = (at: number) => base58Encode(data.slice(at, at + 32));
  const view = new DataView(data.buffer, data.byteOffset);
  return { address, whirlpoolsConfig: key(8), tickSpacing: view.getUint16(41, true), feeRate: view.getUint16(45, true), protocolFeeRate: view.getUint16(47, true),
    liquidity: u128(data, 49).toString(), sqrtPrice: u128(data, 65).toString(), tickCurrentIndex: view.getInt32(81, true),
    tokenMintA: key(101), tokenVaultA: key(133), tokenMintB: key(181), tokenVaultB: key(213), slot };
}
/** The pool must be the documented Devnet test pool under the documented Devnet config, with live liquidity. */
export async function readOrcaPool(rpc: SolanaRpc): Promise<OrcaPool> {
  const { slot, accounts } = await readSolanaAccounts(rpc, [POOL.address]);
  const account = accounts[0];
  if (!account || account.owner !== P.whirlpool) fail('ORCA_POOL_MISMATCH');
  const pool = decodeWhirlpool(POOL.address, account!.data, slot);
  if (pool.whirlpoolsConfig !== profile.whirlpoolsConfig || pool.tokenMintA !== POOL.tokenMintA || pool.tokenMintB !== POOL.tokenMintB ||
      pool.tokenVaultA !== POOL.tokenVaultA || pool.tokenVaultB !== POOL.tokenVaultB || pool.tickSpacing !== POOL.tickSpacing) fail('ORCA_POOL_MISMATCH');
  if (BigInt(pool.liquidity) === 0n || BigInt(pool.sqrtPrice) === 0n) fail('ORCA_POOL_NO_LIQUIDITY');
  return pool;
}
const floorDiv = (a: number, b: number) => Math.floor(a / b);
/** The program's own sequence (util/sparse_swap.rs get_start_tick_indexes): three arrays in the swap direction. */
export function orcaTickArrayStarts(tickCurrentIndex: number, tickSpacing: number, aToB: boolean): number[] {
  const span = TICK_ARRAY_SIZE * tickSpacing, base = floorDiv(tickCurrentIndex, span) * span;
  const offsets = aToB ? [0, -1, -2] : tickCurrentIndex + tickSpacing >= base + span ? [1, 2, 3] : [0, 1, 2];
  const starts = offsets.map(o => base + o * span).filter(start => start >= floorDiv(MIN_TICK, span) * span && start <= MAX_TICK);
  if (starts.length !== 3) fail('ORCA_TICK_ARRAYS_UNAVAILABLE');
  return starts;
}
export const orcaTickArrayAddress = (pool: string, start: number) => findProgramAddress([utf8('tick_array'), publicKeyBytes(pool), utf8(String(start))], P.whirlpool);
export const orcaOracleAddress = (pool: string) => findProgramAddress([utf8('oracle'), publicKeyBytes(pool)], P.whirlpool);

/** swap_v2(amount u64, other_amount_threshold u64, sqrt_price_limit u128, amount_specified_is_input bool, a_to_b bool, remaining_accounts_info Option<_>). */
export function encodeOrcaSwapV2(args: Pick<OrcaSwapArgs, 'amount' | 'otherAmountThreshold' | 'aToB'>): Uint8Array {
  return Uint8Array.from([...Buffer.from(profile.swapV2Discriminator, 'hex'), ...u64Bytes(BigInt(args.amount)), ...u64Bytes(BigInt(args.otherAmountThreshold)),
    ...new Array<number>(16).fill(0), 1, args.aToB ? 1 : 0, 0]);
}
export function decodeOrcaSwapV2(data: Uint8Array): Pick<OrcaSwapArgs, 'amount' | 'otherAmountThreshold' | 'sqrtPriceLimit' | 'amountSpecifiedIsInput' | 'aToB'> {
  if (data.length !== 43 || hex(data.slice(0, 8)) !== profile.swapV2Discriminator || data[40]! > 1 || data[41]! > 1 || data[42] !== 0) fail('ORCA_SWAP_INSTRUCTION_UNSUPPORTED');
  return { amount: readU64(data, 8).toString(), otherAmountThreshold: readU64(data, 16).toString(), sqrtPriceLimit: u128(data, 24).toString(),
    amountSpecifiedIsInput: data[40] === 1, aToB: data[41] === 1 };
}
/** Anchor `Traded` event emitted by every Whirlpool swap ("Program data: <base64>"). */
export function parseOrcaTradedEvents(logs: readonly string[]): OrcaTradedEvent[] {
  return logs.flatMap(line => {
    const match = /^Program data: ([A-Za-z0-9+/]+={0,2})$/.exec(line);
    if (!match) return [];
    const data = Uint8Array.from(Buffer.from(match[1]!, 'base64'));
    if (data.length !== 121 || hex(data.slice(0, 8)) !== profile.tradedEventDiscriminator || data[40]! > 1) return [];
    return [{ whirlpool: base58Encode(data.slice(8, 40)), aToB: data[40] === 1, preSqrtPrice: u128(data, 41).toString(), postSqrtPrice: u128(data, 57).toString(),
      inputAmount: readU64(data, 73).toString(), outputAmount: readU64(data, 81).toString(), inputTransferFee: readU64(data, 89).toString(),
      outputTransferFee: readU64(data, 97).toString(), lpFee: readU64(data, 105).toString(), protocolFee: readU64(data, 113).toString() }];
  });
}
function createAta(owner: string, account: string, mint: string): SolanaInstruction {
  return { programId: P.associatedToken, data: Uint8Array.of(1), accounts: [{ pubkey: owner, isSigner: true, isWritable: true }, { pubkey: account, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: P.system, isSigner: false, isWritable: false },
    { pubkey: P.token, isSigner: false, isWritable: false }] };
}
/**
 * Every instruction is Gryloo-built and owner-bound: the owner's own token accounts, exactly the reviewed SOL wrap,
 * one swap_v2 against the verified pool and the wrapped-SOL account closed back to the owner. No other signer.
 */
export function orcaSwapInstructions(intent: OrcaIntent, pool: OrcaPool, threshold: string, units: number): { instructions: SolanaInstruction[]; inspection: OrcaInspection } {
  const { owner, input, output } = intent;
  const aToB = input.mint === pool.tokenMintA;
  if (aToB ? output.mint !== pool.tokenMintB : input.mint !== pool.tokenMintB || output.mint !== pool.tokenMintA) fail('ORCA_POOL_MISMATCH');
  const inputAccount = ata(owner, input.mint), outputAccount = ata(owner, output.mint);
  const wrapped = input.native ? inputAccount : output.native ? outputAccount : fail('ORCA_POOL_MISMATCH');
  const ownerA = aToB ? inputAccount : outputAccount, ownerB = aToB ? outputAccount : inputAccount;
  const tickArrays = orcaTickArrayStarts(pool.tickCurrentIndex, pool.tickSpacing, aToB).map(start => orcaTickArrayAddress(pool.address, start));
  const oracle = orcaOracleAddress(pool.address);
  const swap: OrcaSwapArgs = { instruction: 'swap-v2', pool: pool.address, aToB, amount: intent.amount, otherAmountThreshold: threshold, sqrtPriceLimit: '0',
    amountSpecifiedIsInput: true, tickArrays, oracle };
  const m = (pubkey: string, isWritable: boolean, isSigner = false) => ({ pubkey, isSigner, isWritable });
  const swapIx: SolanaInstruction = { programId: P.whirlpool, data: encodeOrcaSwapV2(swap), accounts: [m(P.token, false), m(P.token, false), m(P.memo, false), m(owner, false, true),
    m(pool.address, true), m(pool.tokenMintA, false), m(pool.tokenMintB, false), m(ownerA, true), m(pool.tokenVaultA, true), m(ownerB, true), m(pool.tokenVaultB, true),
    ...tickArrays.map(t => m(t, true)), m(oracle, true)] };
  const ensured = [wrapped, ...output.native ? [] : [outputAccount]];
  const instructions: SolanaInstruction[] = [setComputeUnitLimit(units), createAta(owner, wrapped, profile.pool.tokenMintA),
    ...input.native ? [{ programId: P.system, data: Uint8Array.from([...u32Bytes(2), ...u64Bytes(BigInt(intent.amount))]), accounts: [m(owner, true, true), m(wrapped, true)] },
      { programId: P.token, data: Uint8Array.of(17), accounts: [m(wrapped, true)] }] : [],
    ...output.native ? [] : [createAta(owner, outputAccount, output.mint)],
    swapIx,
    { programId: P.token, data: Uint8Array.of(9), accounts: [m(wrapped, true), m(owner, true), m(owner, false, true)] }];
  if (instructions.some(ix => ix.accounts.some(a => a.isSigner && a.pubkey !== owner))) fail('DEVNET_SWAP_UNEXPECTED_SIGNER');
  return { instructions, inspection: { programs: [...new Set(instructions.map(ix => ix.programId))], computeUnitPrice: '0', ownerInputAccount: inputAccount,
    ownerOutputAccount: outputAccount, wrappedSolAccount: wrapped, ensuredAccounts: ensured, swap, tickArraysInitialized: [] } };
}
/** Exact-amount spot-relative price impact in percent (fee included), from the pre-swap sqrt price. */
function priceImpactPct(amount: bigint, out: bigint, sqrtPrice: bigint, aToB: boolean): string {
  const square = sqrtPrice * sqrtPrice, ideal = aToB ? amount * square >> 128n : (amount << 128n) / square;
  if (ideal <= 0n) return '0';
  const scaled = (ideal - out) * 100_000_000n / ideal, sign = scaled < 0n ? '-' : '', abs = scaled < 0n ? -scaled : scaled;
  return `${sign}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, '0')}`;
}

/** Read-only: verified pool, Gryloo-built v0 message, quote by RPC simulation, review artifacts. Never signs or sends. */
export async function simulateOrcaDevnetSwap(workflow: SemanticWorkflow, ownerInput: string, rpc: SolanaRpc, now = Date.now()): Promise<OrcaDevnetReview> {
  const intent = orcaDevnetIntent(workflow, ownerInput), runtime = requireSolanaSwapRuntime(profile.chain);
  await verifySolanaCluster(rpc, profile.genesisHash);
  const fetchedAt = new Date(now).toISOString();
  const pool = await readOrcaPool(rpc);
  const draft = orcaSwapInstructions(intent, pool, '1', profile.maximumComputeUnits);
  const { accounts: arrays } = await readSolanaAccounts(rpc, draft.inspection.swap.tickArrays);
  // Uninitialized tick arrays are allowed by the program's sparse sequence; anything else must be owned by Whirlpools.
  if (arrays.some(a => a && a.owner !== P.whirlpool)) fail('ORCA_TICK_ARRAY_INVALID');
  const pre = await readSolanaSwapBalances(rpc, intent, draft.inspection);
  if ((intent.input.native ? pre.input : pre.output) !== null) fail('DEVNET_SWAP_WRAPPED_SOL_ACCOUNT_PRESENT');
  if (!intent.input.native && BigInt(pre.input ?? '0') < BigInt(intent.amount)) fail(`DEVNET_SWAP_INSUFFICIENT_${intent.input.symbol.toUpperCase()}`);
  // SOL needed: any native input, the temporary wrapped-SOL deposit (refunded in the same transaction), a new devUSDC account deposit and the base fee.
  const required = (intent.input.native ? BigInt(intent.amount) : 0n) + TOKEN_ACCOUNT_RENT + (!intent.output.native && pre.output === null ? TOKEN_ACCOUNT_RENT : 0n) + BigInt(profile.baseFeeLamports);
  if (BigInt(pre.ownerLamports) < required) fail('DEVNET_SWAP_INSUFFICIENT_SOL');
  const latest = rpcContextValue(await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]));
  const blockhash = solanaAddress(latest.blockhash), lastValidBlockHeight = latest.lastValidBlockHeight;
  if (!Number.isSafeInteger(lastValidBlockHeight)) fail('SOLANA_RPC_INVALID');
  const addresses = [intent.owner, draft.inspection.ownerInputAccount, draft.inspection.ownerOutputAccount];
  const build = (threshold: string, units: number) => {
    const built = orcaSwapInstructions(intent, pool, threshold, units);
    return { ...built, bytes: serializeMessageV0(compileMessageV0(intent.owner, built.instructions, blockhash, {})) };
  };
  const trade = (logs: readonly string[]) => {
    const events = parseOrcaTradedEvents(logs);
    const event = events.length === 1 ? events[0]! : fail('ORCA_TRADE_EVENT_MISSING');
    if (event.whirlpool !== pool.address || event.aToB !== draft.inspection.swap.aToB || event.inputAmount !== intent.amount) fail('ORCA_TRADE_EVENT_MISMATCH');
    return event;
  };
  // Quote: the pool's own swap of the exact input against current Devnet state.
  const probe = await simulateSolanaMessage(rpc, build('1', profile.maximumComputeUnits).bytes, addresses, 'DEVNET_SWAP');
  const quoted = BigInt(trade(probe.allLogs).outputAmount);
  const minimum = quoted * BigInt(10_000 - intent.slippageBps) / 10_000n;
  if (minimum <= 0n) fail('DEVNET_SWAP_AMOUNT_TOO_SMALL');
  const units = Math.min(profile.maximumComputeUnits, Math.ceil(probe.unitsConsumed * 1.2) + 10_000);
  const final = build(minimum.toString(), units);
  assertMessageRoundTrip(final.bytes, final.instructions, intent.owner, {}, 'DEVNET_SWAP');
  const simulated = await simulateSolanaMessage(rpc, final.bytes, addresses, 'DEVNET_SWAP');
  const simulatedTrade = trade(simulated.allLogs);
  const fee = BigInt(estimateFee(units, '0', profile.baseFeeLamports));
  const [ownerAfter, inAfter, outAfter] = simulated.accounts;
  const post: SolanaBalances = { slot: pre.slot, ownerLamports: ownerAfter?.lamports.toString() ?? '0',
    input: solanaTokenAmount(inAfter!, intent.owner, intent.input.mint), output: solanaTokenAmount(outAfter!, intent.owner, intent.output.mint) };
  // A new owner devUSDC account keeps a refundable rent deposit; the temporary wrapped-SOL account is closed in the same transaction.
  const created = !intent.output.native && pre.output === null ? outAfter?.lamports ?? 0n : 0n;
  const deltas = solanaSwapDeltas(intent, pre, post, fee, created, 'DEVNET_SWAP');
  const tolerance = (native: boolean) => native ? fee : 0n;
  if (deltas.inputSpent < BigInt(intent.amount) - tolerance(intent.input.native) || deltas.inputSpent > BigInt(intent.amount) + tolerance(intent.input.native)) fail('DEVNET_SWAP_SIMULATED_INPUT_MISMATCH');
  if (BigInt(simulatedTrade.outputAmount) < minimum || deltas.outputReceived + tolerance(intent.output.native) < minimum) fail('DEVNET_SWAP_SIMULATED_OUTPUT_BELOW_MINIMUM');
  const quote: SolanaSwapQuote = { inAmount: intent.amount, outAmount: quoted.toString(), otherAmountThreshold: minimum.toString(),
    priceImpactPct: priceImpactPct(BigInt(intent.amount), quoted, BigInt(pool.sqrtPrice), final.inspection.swap.aToB), slippageBps: intent.slippageBps,
    routePlan: [{ label: 'Orca Whirlpool', ammKey: pool.address, inputMint: intent.input.mint, outputMint: intent.output.mint, inAmount: intent.amount, outAmount: quoted.toString(), bps: 10_000 }],
    fetchedAt };
  const inspection: OrcaInspection = { ...final.inspection, tickArraysInitialized: arrays.map(Boolean) };
  const simulationResult: SolanaSwapSimulation = { slot: pre.slot, unitsConsumed: simulated.unitsConsumed, logs: simulated.logs, pre, post,
    inputSpent: deltas.inputSpent.toString(), outputReceived: deltas.outputReceived.toString(), accountCreationLamports: created.toString(), feeLamports: fee.toString() };
  const expiresAt = new Date(now + profile.reviewTtlSeconds * 1000).toISOString();
  const swapIx = final.instructions.find(ix => ix.programId === P.whirlpool)!;
  const routeCommitment = solanaSwapHash({ pool, swap: inspection.swap, swapData: toBase64(swapIx.data), swapAccounts: swapIx.accounts });
  const message = toBase64(final.bytes), messageHash = sha256Hex(final.bytes);
  const artifacts = buildSolanaSwapArtifacts({ runtime, workflow, nodeId: intent.nodeId, intent, quote, quoteArtifact: { quote, routeCommitment, messageHash, pool, simulatedTrade },
    messageHash, contract: { address: P.whirlpool, version: 'orca-whirlpools-devnet' }, functionId: 'swap-v2', maximumNetworkCostLamports: fee + created,
    lastValidBlockHeight: lastValidBlockHeight as number, expiresAt, reviewTtlSeconds: profile.reviewTtlSeconds });
  const review: Omit<OrcaDevnetReview, 'commitment'> = { format: 'gryloo.orca-devnet-review.v1', provider: 'Orca Whirlpools', workflow, chain: profile.chain, cluster: 'devnet',
    owner: intent.owner, input: { symbol: intent.input.symbol, mint: intent.input.mint, decimals: intent.input.decimals },
    output: { symbol: intent.output.symbol, mint: intent.output.mint, decimals: intent.output.decimals }, amount: intent.amount, slippageBps: intent.slippageBps,
    quote, routeCommitment, inspection, pool, simulatedTrade, lookupTables: {}, blockhash, lastValidBlockHeight: lastValidBlockHeight as number, computeUnitLimit: units,
    computeUnitPrice: '0', estimatedFeeLamports: fee.toString(), message, messageHash, unsignedTransaction: toBase64(serializeTransaction(null, final.bytes)),
    simulationResult, expiresAt, ...artifacts };
  return { ...review, commitment: solanaSwapHash(review) };
}
export function assertOrcaDevnetReview(review: OrcaDevnetReview, workflow: SemanticWorkflow, owner: string, blockHeight: number, now = Date.now()): void {
  if (review.format !== 'gryloo.orca-devnet-review.v1' || review.chain !== profile.chain) fail('DEVNET_SWAP_AUTHORIZATION_INVALID');
  assertSolanaSwapReview(review, workflow, owner, blockHeight, now, orcaDevnetIntent, 'DEVNET_SWAP');
  // Defense in depth: the reviewed bytes must still decode to exactly one owner-signed swap_v2 of the reviewed amount and minimum on the verified pool.
  const swaps = decompileMessageV0(parseMessageV0(fromBase64(review.message)), {}).filter(ix => ix.programId === P.whirlpool);
  const args = swaps.length === 1 ? decodeOrcaSwapV2(swaps[0]!.data) : fail('DEVNET_SWAP_TRANSACTION_CHANGED');
  if (args.amount !== review.amount || args.otherAmountThreshold !== review.quote.otherAmountThreshold || !args.amountSpecifiedIsInput || args.sqrtPriceLimit !== '0' ||
      swaps[0]!.accounts[3]?.pubkey !== review.owner || swaps[0]!.accounts[4]?.pubkey !== POOL.address) fail('DEVNET_SWAP_TRANSACTION_CHANGED');
}
export function verifySignedOrcaDevnetTransaction(review: OrcaDevnetReview, signedBase64: unknown): { signature: string; transaction: string } {
  return verifySignedSolanaSwap(review, signedBase64, 'DEVNET_SWAP');
}
