// SPDX-License-Identifier: AGPL-3.0-only
import { JUPITER_SOLANA_MAINNET as profile, solanaTokenByMint, type SolanaToken } from '@defi-workflow-engine/action-registry';
import { readExactInputSwap, EXACT_INPUT_SWAP_ACTION, assertPublicWorkflow, type SemanticWorkflow,
  type ArtifactSet, type SimulationBundle, type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { associatedTokenAddress, findProgramAddress, compileMessageV0, decodeLookupTable, fromBase64,
  readU16, readU64, serializeMessageV0, serializeTransaction, sha256Hex, solanaAddress, toBase64,
  u32Bytes, type SolanaInstruction } from './solana.js';
import { assertMessageRoundTrip, assertSolanaSwapReview, verifySignedSolanaSwap, buildSolanaSwapArtifacts, estimateFee, readSolanaAccounts, readSolanaSwapBalances, requireSolanaSwapRuntime,
  rpcContextValue, setComputeUnitLimit, simulateSolanaMessage, solanaSwapArtifactHash, solanaSwapDeltas, solanaSwapHash, solanaTokenAmount, verifySolanaCluster,
  type SolanaBalances, type SolanaRouteStep, type SolanaRpc, type SolanaSwapQuote, type SolanaSwapSimulation } from './solana-swap.js';
export { JUPITER_SOLANA_MAINNET, SOLANA_MAINNET_TOKENS } from '@defi-workflow-engine/action-registry';
export type { SolanaToken, SolanaTokenSymbol } from '@defi-workflow-engine/action-registry';
// Shared Solana swap core, re-exported under its BUILD-014 import path.
export { assertMessageRoundTrip, estimateFee, readSolanaAccounts, setComputeUnitLimit, verifySolanaCluster } from './solana-swap.js';
export type { SolanaBalances, SolanaRpc } from './solana-swap.js';

export type JupiterHttp = (query: Record<string, string>) => Promise<unknown>;
export type JupiterIntent = { owner: string; input: SolanaToken; output: SolanaToken; amount: string; slippageBps: number };
export type JupiterRouteStep = SolanaRouteStep;
export type JupiterQuote = SolanaSwapQuote;
export type JupiterSwapArgs = { instruction: 'route-v2' | 'shared-accounts-route-v2'; programAuthorityId: number | null; inAmount: string; quotedOutAmount: string; slippageBps: number; platformFeeBps: number; positiveSlippageBps: number };
export type JupiterInspection = { programs: string[]; computeUnitPrice: string; ownerInputAccount: string; ownerOutputAccount: string;
  wrappedSolAccount: string | null; ensuredAccounts: string[]; swap: JupiterSwapArgs };
export type JupiterSimulation = SolanaSwapSimulation;
export type JupiterReview = { format: 'gryloo.jupiter-review.v1'; workflow: SemanticWorkflow; chain: string; cluster: 'mainnet-beta'; owner: string;
  input: { symbol: string; mint: string; decimals: number }; output: { symbol: string; mint: string; decimals: number };
  amount: string; slippageBps: number; quote: JupiterQuote; routeCommitment: string; inspection: JupiterInspection; lookupTables: Record<string, string[]>;
  blockhash: string; lastValidBlockHeight: number; computeUnitLimit: number; computeUnitPrice: string; estimatedFeeLamports: string;
  message: string; messageHash: string; unsignedTransaction: string; simulationResult: JupiterSimulation; expiresAt: string;
  artifactSet: ArtifactSet; simulation: SimulationBundle; policy: AuthorizationPolicy; manifest: StrategyManifest; plan: ExecutionPlan; commitment: string };

const P = profile.programs;
const LOOKUP_PROGRAM = 'AddressLookupTab1e1111111111111111111111111';
const fail = (code: string): never => { throw new Error(code); };
const uint = (value: unknown, code: string): string => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) < 1n << 64n ? value : fail(code);
const record = (value: unknown, code: string): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(code);
/** Historical names; the hash domains are the shared Solana swap ones. */
export const jupiterHash = solanaSwapHash;
export const jupiterArtifactHash = solanaSwapArtifactHash;

/** Read the canonical swap and resolve it against the exact Jupiter Solana profile. */
export function jupiterIntent(workflow: SemanticWorkflow, owner: string): JupiterIntent & { nodeId: string } {
  assertPublicWorkflow(workflow);
  const nodes = workflow.nodes.filter(n => n.actionType === EXACT_INPUT_SWAP_ACTION && n.chainId.startsWith('solana:'));
  if (nodes.length !== 1 || workflow.nodes.some(n => n !== nodes[0] && !n.actionType.startsWith('mock-'))) fail('SOLANA_SWAP_ISOLATED_ONLY');
  const fields = readExactInputSwap(nodes[0]!);
  const input = solanaTokenByMint(fields.input.address), output = solanaTokenByMint(fields.output.address);
  if (fields.chain !== profile.chain) fail('SOLANA_CLUSTER_UNSUPPORTED');
  if (!input || !output || input === output || input.decimals !== fields.input.decimals || output.decimals !== fields.output.decimals) fail('SOLANA_MINT_UNSUPPORTED');
  if (fields.protocols.join() !== profile.protocol) fail('SOLANA_SWAP_PROVIDER_UNSUPPORTED');
  return { nodeId: nodes[0]!.nodeId, owner: solanaAddress(owner), input: input!, output: output!, amount: fields.amount, slippageBps: fields.slippageBps };
}
export function jupiterBuildQuery(intent: JupiterIntent): Record<string, string> {
  return { inputMint: intent.input.mint, outputMint: intent.output.mint, amount: intent.amount, taker: intent.owner,
    slippageBps: String(intent.slippageBps), wrapAndUnwrapSol: 'true', maxAccounts: '64' };
}

function instruction(value: unknown): SolanaInstruction {
  const ix = record(value, 'JUPITER_INSTRUCTION_INVALID');
  if (!Array.isArray(ix.accounts) || ix.accounts.length > 128) fail('JUPITER_INSTRUCTION_INVALID');
  return { programId: solanaAddress(ix.programId), data: fromBase64(ix.data, 4096),
    accounts: (ix.accounts as unknown[]).map(a => { const m = record(a, 'JUPITER_INSTRUCTION_INVALID');
      if (typeof m.isSigner !== 'boolean' || typeof m.isWritable !== 'boolean') fail('JUPITER_INSTRUCTION_INVALID');
      return { pubkey: solanaAddress(m.pubkey), isSigner: m.isSigner as boolean, isWritable: m.isWritable as boolean }; }) };
}
export type ParsedJupiterBuild = { quote: JupiterQuote; computeBudget: SolanaInstruction[]; setup: SolanaInstruction[]; swap: SolanaInstruction;
  cleanup: SolanaInstruction | null; lookupTableAddresses: string[] };

/** Quote validation: every economic field must equal the semantic intent; the minimum honours the slippage bound. */
export function parseJupiterBuild(value: unknown, intent: JupiterIntent, fetchedAt: string): ParsedJupiterBuild {
  const b = record(value, 'JUPITER_QUOTE_INVALID');
  if (b.inputMint !== intent.input.mint) fail('JUPITER_INPUT_MINT_MISMATCH');
  if (b.outputMint !== intent.output.mint) fail('JUPITER_OUTPUT_MINT_MISMATCH');
  if (uint(b.inAmount, 'JUPITER_QUOTE_INVALID') !== intent.amount) fail('JUPITER_INPUT_AMOUNT_MISMATCH');
  if (b.swapMode !== 'ExactIn') fail('JUPITER_SWAP_MODE_UNSUPPORTED');
  if (b.slippageBps !== intent.slippageBps) fail('JUPITER_SLIPPAGE_MISMATCH');
  const out = BigInt(uint(b.outAmount, 'JUPITER_QUOTE_INVALID')), min = BigInt(uint(b.otherAmountThreshold, 'JUPITER_QUOTE_INVALID'));
  if (out <= 0n || min <= 0n || min > out || min < out * BigInt(10_000 - intent.slippageBps) / 10_000n) fail('JUPITER_MINIMUM_OUTPUT_INVALID');
  if (typeof b.priceImpactPct !== 'string' || !/^-?(0|[1-9][0-9]*)(\.[0-9]{1,30})?$/.test(b.priceImpactPct)) fail('JUPITER_QUOTE_INVALID');
  if (!Array.isArray(b.routePlan) || b.routePlan.length < 1 || b.routePlan.length > 16) fail('JUPITER_ROUTE_INVALID');
  const routePlan = (b.routePlan as unknown[]).map(step => {
    const s = record(step, 'JUPITER_ROUTE_INVALID'), info = record(s.swapInfo, 'JUPITER_ROUTE_INVALID');
    if (typeof info.label !== 'string' || info.label.length > 64 || typeof s.bps !== 'number' || !Number.isInteger(s.bps) || s.bps < 1 || s.bps > 10_000) fail('JUPITER_ROUTE_INVALID');
    return { label: info.label as string, ammKey: solanaAddress(info.ammKey), inputMint: solanaAddress(info.inputMint), outputMint: solanaAddress(info.outputMint),
      inAmount: uint(info.inAmount, 'JUPITER_ROUTE_INVALID'), outAmount: uint(info.outAmount, 'JUPITER_ROUTE_INVALID'), bps: s.bps as number };
  });
  if (routePlan.filter(s => s.inputMint === intent.input.mint).reduce((sum, s) => sum + s.bps, 0) !== 10_000 ||
      !routePlan.some(s => s.outputMint === intent.output.mint)) fail('JUPITER_ROUTE_INVALID');
  if (!Array.isArray(b.computeBudgetInstructions) || !Array.isArray(b.setupInstructions) || !Array.isArray(b.otherInstructions)) fail('JUPITER_INSTRUCTION_INVALID');
  if ((b.otherInstructions as unknown[]).length) fail('JUPITER_UNEXPECTED_INSTRUCTION');
  if (b.tipInstruction !== null && b.tipInstruction !== undefined) fail('JUPITER_TIP_UNSUPPORTED');
  const tables = b.addressesByLookupTableAddress === null ? {} : record(b.addressesByLookupTableAddress, 'JUPITER_LOOKUP_TABLE_INVALID');
  if (Object.keys(tables).length > 4) fail('JUPITER_LOOKUP_TABLE_INVALID');
  return { quote: { inAmount: intent.amount, outAmount: out.toString(), otherAmountThreshold: min.toString(), priceImpactPct: b.priceImpactPct as string,
      slippageBps: intent.slippageBps, routePlan, fetchedAt },
    computeBudget: (b.computeBudgetInstructions as unknown[]).map(instruction), setup: (b.setupInstructions as unknown[]).map(instruction),
    swap: instruction(b.swapInstruction), cleanup: b.cleanupInstruction === null ? null : instruction(b.cleanupInstruction),
    lookupTableAddresses: Object.keys(tables).map(solanaAddress) };
}

/** route_v2 / shared_accounts_route_v2: [id: u8 (shared only)] in_amount u64, quoted_out_amount u64, slippage_bps u16, platform_fee_bps u16, positive_slippage_bps u16, route_plan. */
export function decodeJupiterSwap(data: Uint8Array): JupiterSwapArgs {
  const discriminator = Buffer.from(data.slice(0, 8)).toString('hex');
  const shared = discriminator === profile.sharedAccountsRouteV2Discriminator;
  if (!shared && discriminator !== profile.routeV2Discriminator) fail('JUPITER_SWAP_INSTRUCTION_UNSUPPORTED');
  const at = shared ? 9 : 8;
  if (data.length < at + 26) fail('JUPITER_SWAP_INSTRUCTION_UNSUPPORTED');
  return { instruction: shared ? 'shared-accounts-route-v2' : 'route-v2', programAuthorityId: shared ? data[8]! : null,
    inAmount: readU64(data, at).toString(), quotedOutAmount: readU64(data, at + 8).toString(), slippageBps: readU16(data, at + 16),
    platformFeeBps: readU16(data, at + 18), positiveSlippageBps: readU16(data, at + 20) };
}
const ata = (owner: string, mint: string) => associatedTokenAddress(owner, mint, P.token, P.associatedToken);
const meta = (ix: SolanaInstruction, i: number) => ix.accounts[i] ?? fail('JUPITER_INSTRUCTION_ACCOUNTS_INVALID');

/** Do not blindly sign: every top-level instruction must match an allowlisted, owner-bound shape. */
export function inspectJupiterInstructions(parsed: ParsedJupiterBuild, intent: JupiterIntent): JupiterInspection {
  const { owner, input, output } = intent;
  const inputAccount = ata(owner, input.mint), outputAccount = ata(owner, output.mint);
  const wrapped = input.native ? inputAccount : output.native ? outputAccount : null;
  let computeUnitPrice = '0';
  if (parsed.computeBudget.length > 1) fail('JUPITER_UNEXPECTED_INSTRUCTION');
  for (const ix of parsed.computeBudget) {
    if (ix.programId !== P.computeBudget || ix.accounts.length || ix.data.length !== 9 || ix.data[0] !== 3) fail('JUPITER_UNEXPECTED_INSTRUCTION');
    computeUnitPrice = readU64(ix.data, 1).toString();
  }
  if (BigInt(computeUnitPrice) > 50_000_000n) fail('JUPITER_PRIORITY_FEE_TOO_HIGH');
  const created: string[] = [];
  let wrappedLamports = 0n, synced = false;
  for (const ix of parsed.setup) {
    if (ix.programId === P.associatedToken) {
      const [payer, account, wallet, mint, system, token] = [0, 1, 2, 3, 4, 5].map(i => meta(ix, i));
      if (ix.data.length !== 1 || ix.data[0] !== 1 || ix.accounts.length !== 6 || payer!.pubkey !== owner || !payer!.isSigner ||
          wallet!.pubkey !== owner || system!.pubkey !== P.system || token!.pubkey !== P.token ||
          ![input.mint, output.mint].includes(mint!.pubkey) || account!.pubkey !== ata(owner, mint!.pubkey)) fail('JUPITER_SETUP_UNEXPECTED');
      created.push(account!.pubkey);
    } else if (ix.programId === P.system) {
      // Wrap exactly the reviewed SOL input from the owner into the owner's own wrapped-SOL account.
      if (!input.native || ix.data.length !== 12 || Buffer.from(ix.data.slice(0, 4)).toString('hex') !== Buffer.from(u32Bytes(2)).toString('hex') ||
          ix.accounts.length !== 2 || meta(ix, 0).pubkey !== owner || meta(ix, 1).pubkey !== wrapped || wrappedLamports) fail('JUPITER_SETUP_UNEXPECTED');
      wrappedLamports = readU64(ix.data, 4);
    } else if (ix.programId === P.token) {
      if (!input.native || ix.data.length !== 1 || ix.data[0] !== 17 || ix.accounts.length !== 1 || meta(ix, 0).pubkey !== wrapped || synced) fail('JUPITER_SETUP_UNEXPECTED');
      synced = true;
    } else fail('JUPITER_SETUP_UNEXPECTED');
  }
  if (input.native && (wrappedLamports !== BigInt(intent.amount) || !synced)) fail('JUPITER_WRAP_AMOUNT_MISMATCH');
  const swap = parsed.swap;
  if (swap.programId !== P.jupiter) fail('JUPITER_PROGRAM_MISMATCH');
  const args = decodeJupiterSwap(swap.data);
  if (args.inAmount !== intent.amount) fail('JUPITER_INPUT_AMOUNT_MISMATCH');
  if (args.quotedOutAmount !== parsed.quote.outAmount || args.slippageBps !== intent.slippageBps) fail('JUPITER_MINIMUM_OUTPUT_INVALID');
  if (args.platformFeeBps !== 0 || args.positiveSlippageBps !== 0) fail('JUPITER_FEE_UNEXPECTED');
  // Leading accounts are fixed by the instruction; output must land in the owner's own token account.
  const authority = args.programAuthorityId === null ? null : findProgramAddress([new TextEncoder().encode('authority'), Uint8Array.of(args.programAuthorityId)], P.jupiter);
  const fixed = authority === null
    ? [owner, inputAccount, outputAccount, input.mint, output.mint, P.token, P.token, P.jupiter, P.jupiterEventAuthority, P.jupiter]
    : [authority, owner, inputAccount, ata(authority, input.mint), ata(authority, output.mint), outputAccount, input.mint, output.mint, P.token, P.token, P.jupiterEventAuthority, P.jupiter];
  const ownerAt = authority === null ? 0 : 1, inputMintAt = authority === null ? 3 : 6;
  fixed.forEach((key, i) => { if (meta(swap, i).pubkey !== key) fail(i === ownerAt ? 'JUPITER_OWNER_MISMATCH' : i === inputMintAt ? 'JUPITER_INPUT_MINT_MISMATCH' :
    i === inputMintAt + 1 ? 'JUPITER_OUTPUT_MINT_MISMATCH' : 'JUPITER_RECIPIENT_UNEXPECTED'); });
  if (!meta(swap, ownerAt).isSigner) fail('JUPITER_OWNER_MISMATCH');
  if (parsed.cleanup) {
    const c = parsed.cleanup;
    if (!wrapped || c.programId !== P.token || c.data.length !== 1 || c.data[0] !== 9 || c.accounts.length !== 3 || meta(c, 0).pubkey !== wrapped ||
        meta(c, 1).pubkey !== owner || meta(c, 2).pubkey !== owner) fail('JUPITER_CLEANUP_UNEXPECTED');
  } else if (wrapped) fail('JUPITER_CLEANUP_MISSING');
  const all = [...parsed.computeBudget, ...parsed.setup, swap, ...parsed.cleanup ? [parsed.cleanup] : []];
  if (all.some(ix => ix.accounts.some(a => a.isSigner && a.pubkey !== owner))) fail('JUPITER_UNEXPECTED_SIGNER');
  return { programs: [...new Set(all.map(ix => ix.programId))], computeUnitPrice, ownerInputAccount: inputAccount, ownerOutputAccount: outputAccount,
    wrappedSolAccount: wrapped, ensuredAccounts: created, swap: args };
}

export function jupiterInstructions(parsed: ParsedJupiterBuild, units: number): SolanaInstruction[] {
  return [setComputeUnitLimit(units), ...parsed.computeBudget, ...parsed.setup, parsed.swap, ...parsed.cleanup ? [parsed.cleanup] : []];
}
export async function readJupiterBalances(rpc: SolanaRpc, intent: JupiterIntent, inspection: Pick<JupiterInspection, 'ownerInputAccount' | 'ownerOutputAccount'>): Promise<SolanaBalances> {
  return readSolanaSwapBalances(rpc, intent, inspection);
}
/** Lookup-table contents come from the chain, never from Jupiter's response. */
export async function verifyLookupTables(rpc: SolanaRpc, addresses: string[]): Promise<Record<string, string[]>> {
  if (!addresses.length) return {};
  const { accounts } = await readSolanaAccounts(rpc, addresses);
  return Object.fromEntries(addresses.map((address, i) => {
    const a = accounts[i];
    if (!a || a.owner !== LOOKUP_PROGRAM) fail('JUPITER_LOOKUP_TABLE_UNVERIFIED');
    const table = decodeLookupTable(a!.data);
    if (!table.active) fail('JUPITER_LOOKUP_TABLE_INACTIVE');
    return [address, table.addresses];
  }));
}
export const jupiterDeltas = (intent: JupiterIntent, pre: SolanaBalances, post: SolanaBalances, fee: bigint, created: bigint) => solanaSwapDeltas(intent, pre, post, fee, created, 'JUPITER');
async function simulateMessage(rpc: SolanaRpc, message: Uint8Array, intent: JupiterIntent, inspection: JupiterInspection) {
  const { unitsConsumed, logs, accounts } = await simulateSolanaMessage(rpc, message, [intent.owner, inspection.ownerInputAccount, inspection.ownerOutputAccount], 'JUPITER');
  const [owner, inAccount, outAccount] = accounts;
  return { unitsConsumed, logs, owner: owner!, inAccount: inAccount!, outAccount: outAccount! };
}

/** Read-only: Jupiter /build, chain-verified tables, exact v0 message, RPC simulation, review artifacts. Never sends. */
export async function simulateJupiterSwap(workflow: SemanticWorkflow, ownerInput: string, http: JupiterHttp, rpc: SolanaRpc, now = Date.now()): Promise<JupiterReview> {
  const intent = jupiterIntent(workflow, ownerInput);
  await verifySolanaCluster(rpc, profile.genesisHash);
  const fetchedAt = new Date(now).toISOString();
  const parsed = parseJupiterBuild(await http(jupiterBuildQuery(intent)), intent, fetchedAt);
  const inspection = inspectJupiterInstructions(parsed, intent);
  const tables = await verifyLookupTables(rpc, parsed.lookupTableAddresses);
  const pre = await readJupiterBalances(rpc, intent, inspection);
  if (inspection.wrappedSolAccount && (intent.input.native ? pre.input : pre.output) !== null) fail('JUPITER_WRAPPED_SOL_ACCOUNT_PRESENT');
  if (!intent.input.native && BigInt(pre.input ?? '0') < BigInt(intent.amount)) fail(`JUPITER_INSUFFICIENT_${intent.input.symbol}`);
  const latest = rpcContextValue(await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]));
  const blockhash = solanaAddress(latest.blockhash), lastValidBlockHeight = latest.lastValidBlockHeight;
  if (!Number.isSafeInteger(lastValidBlockHeight)) fail('SOLANA_RPC_INVALID');
  const compile = (units: number) => serializeMessageV0(compileMessageV0(intent.owner, jupiterInstructions(parsed, units), blockhash, tables));
  const probe = await simulateMessage(rpc, compile(profile.maximumComputeUnits), intent, inspection);
  const units = Math.min(profile.maximumComputeUnits, Math.ceil(probe.unitsConsumed * 1.2) + 10_000);
  const messageBytes = compile(units);
  assertMessageRoundTrip(messageBytes, jupiterInstructions(parsed, units), intent.owner, tables);
  const final = await simulateMessage(rpc, messageBytes, intent, inspection);
  const fee = BigInt(estimateFee(units, inspection.computeUnitPrice, profile.baseFeeLamports));
  const post: SolanaBalances = { slot: pre.slot, ownerLamports: final.owner?.lamports.toString() ?? '0',
    input: solanaTokenAmount(final.inAccount, intent.owner, intent.input.mint), output: solanaTokenAmount(final.outAccount, intent.owner, intent.output.mint) };
  // A new owner output token account keeps a refundable rent deposit; the temporary wrapped-SOL account is closed.
  const created = !intent.output.native && pre.output === null ? final.outAccount?.lamports ?? 0n : 0n;
  if (BigInt(pre.ownerLamports) < fee + created + (intent.input.native ? BigInt(intent.amount) : 0n)) fail('JUPITER_INSUFFICIENT_SOL');
  const deltas = jupiterDeltas(intent, pre, post, fee, created);
  // Native legs tolerate whether the simulator debited the fee; token legs must be exact.
  const tolerance = (native: boolean) => native ? fee : 0n;
  if (deltas.inputSpent < BigInt(intent.amount) - tolerance(intent.input.native) || deltas.inputSpent > BigInt(intent.amount) + tolerance(intent.input.native)) fail('JUPITER_SIMULATED_INPUT_MISMATCH');
  if (deltas.outputReceived + tolerance(intent.output.native) < BigInt(parsed.quote.otherAmountThreshold)) fail('JUPITER_SIMULATED_OUTPUT_BELOW_MINIMUM');
  const simulationResult: JupiterSimulation = { slot: pre.slot, unitsConsumed: final.unitsConsumed, logs: final.logs, pre, post,
    inputSpent: deltas.inputSpent.toString(), outputReceived: deltas.outputReceived.toString(), accountCreationLamports: created.toString(), feeLamports: fee.toString() };
  const expiresAt = new Date(now + profile.reviewTtlSeconds * 1000).toISOString();
  const routeCommitment = jupiterHash({ routePlan: parsed.quote.routePlan, swapData: toBase64(parsed.swap.data), swapAccounts: parsed.swap.accounts });
  const message = toBase64(messageBytes), messageHash = sha256Hex(messageBytes);
  const { artifactSet, simulation, policy, manifest, plan } = buildSolanaSwapArtifacts({ runtime: requireSolanaSwapRuntime(profile.chain), workflow,
    nodeId: intent.nodeId, intent, quote: parsed.quote, quoteArtifact: { quote: parsed.quote, routeCommitment, messageHash, tables },
    messageHash, contract: { address: P.jupiter, version: 'jupiter-v6' }, functionId: 'route-v2', maximumNetworkCostLamports: fee + created,
    lastValidBlockHeight: lastValidBlockHeight as number, expiresAt, reviewTtlSeconds: profile.reviewTtlSeconds });
  const review: Omit<JupiterReview, 'commitment'> = { format: 'gryloo.jupiter-review.v1', workflow, chain: profile.chain, cluster: 'mainnet-beta', owner: intent.owner,
    input: { symbol: intent.input.symbol, mint: intent.input.mint, decimals: intent.input.decimals },
    output: { symbol: intent.output.symbol, mint: intent.output.mint, decimals: intent.output.decimals },
    amount: intent.amount, slippageBps: intent.slippageBps, quote: parsed.quote, routeCommitment, inspection, lookupTables: tables, blockhash,
    lastValidBlockHeight: lastValidBlockHeight as number, computeUnitLimit: units, computeUnitPrice: inspection.computeUnitPrice,
    estimatedFeeLamports: fee.toString(), message, messageHash, unsignedTransaction: toBase64(serializeTransaction(null, messageBytes)),
    simulationResult, expiresAt, artifactSet, simulation, policy, manifest, plan };
  return { ...review, commitment: jupiterHash(review) };
}

/** Review/Execute guard: commitment, semantic revision, owner, freshness and blockhash validity. */
export function assertJupiterReview(review: JupiterReview, workflow: SemanticWorkflow, owner: string, blockHeight: number, now = Date.now()): void {
  assertSolanaSwapReview(review, workflow, owner, blockHeight, now, jupiterIntent, 'JUPITER');
}

/** The wallet must return exactly the reviewed message with a valid owner signature. Any modification fails closed. */
export function verifySignedJupiterTransaction(review: JupiterReview, signedBase64: unknown): { signature: string; transaction: string } {
  return verifySignedSolanaSwap(review, signedBase64, 'JUPITER');
}
