// SPDX-License-Identifier: AGPL-3.0-only
import { JUPITER_SOLANA_MAINNET as profile, solanaTokenByMint, type SolanaToken } from '@defi-workflow-engine/action-registry';
import { readExactInputSwap, EXACT_INPUT_SWAP_ACTION, hashArtifactBytes, hashSupplyValue, type SemanticWorkflow,
  type ArtifactSet, type SimulationBundle, type AuthorizationPolicy, type StrategyManifest, type ExecutionPlan } from '@defi-workflow-engine/workflow-contracts';
import { associatedTokenAddress, base58Encode, findProgramAddress, compileMessageV0, decodeLookupTable, decodeTokenAccount, decompileMessageV0, fromBase64,
  parseMessageV0, parseTransaction, readU16, readU64, serializeMessageV0, serializeTransaction, sha256Hex, solanaAddress, toBase64,
  u32Bytes, verifyEd25519, type LookupTables, type SolanaInstruction } from './solana.js';
export { JUPITER_SOLANA_MAINNET, SOLANA_MAINNET_TOKENS } from '@defi-workflow-engine/action-registry';
export type { SolanaToken, SolanaTokenSymbol } from '@defi-workflow-engine/action-registry';

export type JupiterHttp = (query: Record<string, string>) => Promise<unknown>;
export type SolanaRpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
export type JupiterIntent = { owner: string; input: SolanaToken; output: SolanaToken; amount: string; slippageBps: number };
export type JupiterRouteStep = { label: string; ammKey: string; inputMint: string; outputMint: string; inAmount: string; outAmount: string; bps: number };
export type JupiterQuote = { inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct: string; slippageBps: number;
  routePlan: JupiterRouteStep[]; fetchedAt: string };
export type JupiterSwapArgs = { instruction: 'route-v2' | 'shared-accounts-route-v2'; programAuthorityId: number | null; inAmount: string; quotedOutAmount: string; slippageBps: number; platformFeeBps: number; positiveSlippageBps: number };
export type JupiterInspection = { programs: string[]; computeUnitPrice: string; ownerInputAccount: string; ownerOutputAccount: string;
  wrappedSolAccount: string | null; ensuredAccounts: string[]; swap: JupiterSwapArgs };
export type SolanaBalances = { slot: number; ownerLamports: string; input: string | null; output: string | null };
export type JupiterSimulation = { slot: number; unitsConsumed: number; logs: string[]; pre: SolanaBalances; post: SolanaBalances;
  inputSpent: string; outputReceived: string; accountCreationLamports: string; feeLamports: string };
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
export const jupiterHash = (value: unknown): string => hashSupplyValue(value);
export const jupiterArtifactHash = (kind: Parameters<typeof hashArtifactBytes>[0], value: unknown): string => hashArtifactBytes(kind, new TextEncoder().encode(JSON.stringify(value)));

/** Read the canonical swap and resolve it against the exact Jupiter Solana profile. */
export function jupiterIntent(workflow: SemanticWorkflow, owner: string): JupiterIntent & { nodeId: string } {
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

export function setComputeUnitLimit(units: number): SolanaInstruction {
  return { programId: P.computeBudget, accounts: [], data: Uint8Array.from([2, ...u32Bytes(units)]) };
}
export function jupiterInstructions(parsed: ParsedJupiterBuild, units: number): SolanaInstruction[] {
  return [setComputeUnitLimit(units), ...parsed.computeBudget, ...parsed.setup, parsed.swap, ...parsed.cleanup ? [parsed.cleanup] : []];
}
const rpcValue = (value: unknown) => record(record(value, 'SOLANA_RPC_INVALID').value, 'SOLANA_RPC_INVALID');
type RawAccount = { lamports: bigint; owner: string; data: Uint8Array } | null;
function account(value: unknown): RawAccount {
  if (value === null) return null;
  const a = record(value, 'SOLANA_RPC_INVALID');
  if (!Array.isArray(a.data) || a.data[1] !== 'base64' || typeof a.lamports !== 'number' || !Number.isSafeInteger(a.lamports)) fail('SOLANA_RPC_INVALID');
  return { lamports: BigInt(a.lamports as number), owner: solanaAddress(a.owner), data: fromBase64((a.data as unknown[])[0], 1_000_000) };
}
export async function readSolanaAccounts(rpc: SolanaRpc, keys: string[]): Promise<{ slot: number; accounts: RawAccount[] }> {
  const result = record(await rpc('getMultipleAccounts', [keys, { encoding: 'base64', commitment: 'confirmed' }]), 'SOLANA_RPC_INVALID');
  const context = record(result.context, 'SOLANA_RPC_INVALID');
  if (!Array.isArray(result.value) || result.value.length !== keys.length || !Number.isSafeInteger(context.slot)) fail('SOLANA_RPC_INVALID');
  return { slot: context.slot as number, accounts: (result.value as unknown[]).map(account) };
}
function tokenAmount(a: RawAccount, owner: string, mint: string): string | null {
  if (!a) return null;
  const t = decodeTokenAccount(a.data);
  if (a.owner !== P.token || t.owner !== owner || t.mint !== mint) fail('SOLANA_TOKEN_ACCOUNT_MISMATCH');
  return t.amount.toString();
}
export async function verifySolanaCluster(rpc: SolanaRpc): Promise<void> {
  if (await rpc('getGenesisHash', []) !== profile.genesisHash) fail('SOLANA_WRONG_CLUSTER');
}
export async function readJupiterBalances(rpc: SolanaRpc, intent: JupiterIntent, inspection: Pick<JupiterInspection, 'ownerInputAccount' | 'ownerOutputAccount'>): Promise<SolanaBalances> {
  const { slot, accounts } = await readSolanaAccounts(rpc, [intent.owner, inspection.ownerInputAccount, inspection.ownerOutputAccount]);
  return { slot, ownerLamports: (accounts[0]?.lamports ?? 0n).toString(),
    input: tokenAmount(accounts[1]!, intent.owner, intent.input.mint), output: tokenAmount(accounts[2]!, intent.owner, intent.output.mint) };
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
export function estimateFee(units: number, computeUnitPrice: string): string {
  return (BigInt(profile.baseFeeLamports) + (BigInt(units) * BigInt(computeUnitPrice) + 999_999n) / 1_000_000n).toString();
}
/** Economic deltas for the owner. Native SOL is measured on owner lamports with fees and new-account deposits separated. */
export function jupiterDeltas(intent: JupiterIntent, pre: SolanaBalances, post: SolanaBalances, fee: bigint, created: bigint): { inputSpent: bigint; outputReceived: bigint } {
  const lamports = BigInt(post.ownerLamports) - BigInt(pre.ownerLamports) + fee + created;
  const spent = intent.input.native ? -lamports : BigInt(pre.input ?? fail('JUPITER_INPUT_ACCOUNT_MISSING')) - BigInt(post.input ?? '0');
  const received = intent.output.native ? lamports : BigInt(post.output ?? '0') - BigInt(pre.output ?? '0');
  return { inputSpent: spent, outputReceived: received };
}
/** The compiled bytes must resolve to exactly the inspected instructions under runtime account rules. */
export function assertMessageRoundTrip(messageBytes: Uint8Array, instructions: SolanaInstruction[], owner: string, tables: LookupTables): void {
  const writable = new Set([owner, ...instructions.flatMap(i => i.accounts.filter(a => a.isWritable).map(a => a.pubkey))]);
  const normalize = (list: SolanaInstruction[]) => JSON.stringify(list.map(i => ({ programId: i.programId, data: toBase64(i.data),
    accounts: i.accounts.map(a => [a.pubkey, a.pubkey === owner, writable.has(a.pubkey)]) })));
  const decoded = decompileMessageV0(parseMessageV0(messageBytes), tables).map(i => ({ ...i, accounts: i.accounts.map(a => ({ ...a,
    isSigner: a.isSigner, isWritable: a.isWritable })) }));
  if (decoded.some(i => i.accounts.some(a => a.isSigner !== (a.pubkey === owner) || a.isWritable !== writable.has(a.pubkey))) ||
      normalize(decoded) !== normalize(instructions)) fail('JUPITER_MESSAGE_ROUND_TRIP_MISMATCH');
}
async function simulateMessage(rpc: SolanaRpc, message: Uint8Array, intent: JupiterIntent, inspection: JupiterInspection) {
  const tx = toBase64(serializeTransaction(null, message));
  const value = rpcValue(await rpc('simulateTransaction', [tx, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false, commitment: 'confirmed',
    accounts: { encoding: 'base64', addresses: [intent.owner, inspection.ownerInputAccount, inspection.ownerOutputAccount] } }]));
  const logs = Array.isArray(value.logs) ? (value.logs as unknown[]).filter((l): l is string => typeof l === 'string').slice(-40).map(l => l.slice(0, 300)) : [];
  if (value.err !== null) throw new Error('JUPITER_SIMULATION_FAILED', { cause: { err: value.err, logs } });
  if (!Number.isSafeInteger(value.unitsConsumed) || (value.unitsConsumed as number) <= 0 || !Array.isArray(value.accounts) || value.accounts.length !== 3) fail('JUPITER_SIMULATION_INVALID');
  const [owner, inAccount, outAccount] = (value.accounts as unknown[]).map(account);
  return { unitsConsumed: value.unitsConsumed as number, logs, owner: owner!, inAccount: inAccount!, outAccount: outAccount! };
}

/** Read-only: Jupiter /build, chain-verified tables, exact v0 message, RPC simulation, review artifacts. Never sends. */
export async function simulateJupiterSwap(workflow: SemanticWorkflow, ownerInput: string, http: JupiterHttp, rpc: SolanaRpc, now = Date.now()): Promise<JupiterReview> {
  const semanticHash = jupiterArtifactHash('semantic-workflow', workflow);
  const intent = jupiterIntent(workflow, ownerInput);
  await verifySolanaCluster(rpc);
  const fetchedAt = new Date(now).toISOString();
  const parsed = parseJupiterBuild(await http(jupiterBuildQuery(intent)), intent, fetchedAt);
  const inspection = inspectJupiterInstructions(parsed, intent);
  const tables = await verifyLookupTables(rpc, parsed.lookupTableAddresses);
  const pre = await readJupiterBalances(rpc, intent, inspection);
  if (inspection.wrappedSolAccount && (intent.input.native ? pre.input : pre.output) !== null) fail('JUPITER_WRAPPED_SOL_ACCOUNT_PRESENT');
  if (!intent.input.native && BigInt(pre.input ?? '0') < BigInt(intent.amount)) fail(`JUPITER_INSUFFICIENT_${intent.input.symbol}`);
  const latest = rpcValue(await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]));
  const blockhash = solanaAddress(latest.blockhash), lastValidBlockHeight = latest.lastValidBlockHeight;
  if (!Number.isSafeInteger(lastValidBlockHeight)) fail('SOLANA_RPC_INVALID');
  const compile = (units: number) => serializeMessageV0(compileMessageV0(intent.owner, jupiterInstructions(parsed, units), blockhash, tables));
  const probe = await simulateMessage(rpc, compile(profile.maximumComputeUnits), intent, inspection);
  const units = Math.min(profile.maximumComputeUnits, Math.ceil(probe.unitsConsumed * 1.2) + 10_000);
  const messageBytes = compile(units);
  assertMessageRoundTrip(messageBytes, jupiterInstructions(parsed, units), intent.owner, tables);
  const final = await simulateMessage(rpc, messageBytes, intent, inspection);
  const fee = BigInt(estimateFee(units, inspection.computeUnitPrice));
  const post: SolanaBalances = { slot: pre.slot, ownerLamports: final.owner?.lamports.toString() ?? '0',
    input: tokenAmount(final.inAccount, intent.owner, intent.input.mint), output: tokenAmount(final.outAccount, intent.owner, intent.output.mint) };
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
  const inputAsset = { chainId: profile.chain, address: intent.input.mint, decimals: intent.input.decimals };
  const outputAsset = { chainId: profile.chain, address: intent.output.mint, decimals: intent.output.decimals };
  const artifactSet: ArtifactSet = { schemaVersion: '1.0.0', artifactSetId: 'jupiter-artifacts', semanticWorkflowHash: semanticHash,
    artifacts: [{ artifactId: 'jupiter-quote', nodeId: intent.nodeId, artifactHash: jupiterHash({ quote: parsed.quote, routeCommitment, messageHash, tables }) }] };
  const artifactHash = jupiterArtifactHash('artifact-set', artifactSet);
  const simulation: SimulationBundle = { schemaVersion: '1.0.0', simulationId: 'jupiter-simulation', semanticWorkflowRevision: workflow.revision,
    semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash, adapters: [{ id: profile.adapterId, version: '1.0.0' }],
    contracts: [{ chainId: profile.chain, address: P.jupiter, version: 'jupiter-v6' }],
    outputs: [{ nodeId: intent.nodeId, outputId: 'amount-out', expected: { asset: outputAsset, amount: parsed.quote.outAmount },
      minimum: { asset: outputAsset, amount: parsed.quote.otherAmountThreshold }, adverse: { asset: outputAsset, amount: parsed.quote.otherAmountThreshold } }],
    propagatedOutputs: [], failurePaths: [], uncertainty: [], unsupportedAssumptions: [],
    freshness: { observedAt: fetchedAt, expiresAt, maximumAgeSeconds: profile.reviewTtlSeconds } };
  const simulationHash = jupiterArtifactHash('simulation-bundle', simulation), owner = { chainId: profile.chain, address: intent.owner };
  const spendLimits = [{ asset: inputAsset, maximumAmount: intent.amount, maximumPerStepAmount: intent.amount, maximumCumulativeAmount: intent.amount }];
  const gasBudgets = [{ asset: { chainId: profile.chain, nativeId: 'SOL', decimals: 9 }, maximumAmount: (fee + created).toString() }];
  const recovery = { failurePolicy: 'ABORT' as const, residualAssetRecipient: owner, maximumAttemptsPerStep: 1, requiresHumanReview: true as const };
  const providers = { kind: 'FIXED' as const, providerId: profile.adapterId };
  const policy: AuthorizationPolicy = { schemaVersion: '1.0.0', policyId: 'jupiter-policy', semanticWorkflowHash: semanticHash, artifactSetHash: artifactHash, simulationHash,
    requiredAuthorizationClass: 'MODE_A', allowlists: { owners: [owner], accounts: [owner], recipients: [owner], chains: [profile.chain],
      adapters: [{ id: profile.adapterId, version: '1.0.0' }], protocols: [profile.protocol],
      contracts: [{ chainId: profile.chain, address: P.jupiter, version: 'jupiter-v6' }],
      functions: [{ chainId: profile.chain, contract: P.jupiter, functionId: 'route-v2' }] },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits, maximumSlippageBps: intent.slippageBps, gasBudgets, feeBudgets: [], oracleRules: [], accountRiskRules: [], checkpointRules: [], providers,
    nonce: String(lastValidBlockHeight), deadline: expiresAt, revocationEpoch: workflow.revision, recovery, enforcement: 'NOT_ENFORCED' };
  const policyHash = jupiterArtifactHash('authorization-policy', policy);
  const manifest: StrategyManifest = { schemaVersion: '1.0.0', manifestId: 'jupiter-manifest', semanticWorkflowRevision: workflow.revision, semanticWorkflowHash: semanticHash,
    artifactSetHash: artifactHash, simulationHash, policyHash, authorizationMode: 'MODE_A', owner, executor: null, expiresAt, nonce: String(lastValidBlockHeight),
    revocationEpoch: workflow.revision, spendLimits, maximumSlippageBps: intent.slippageBps, gasBudgets, feeBudgets: [], providers, recovery, enforcement: 'NOT_ENFORCED' };
  const manifestHash = jupiterArtifactHash('strategy-manifest', manifest);
  const plan: ExecutionPlan = { schemaVersion: '1.0.0', executionPlanId: 'jupiter-plan', semanticWorkflowHash: semanticHash, manifestHash,
    segments: [{ segmentId: 'jupiter-segment', chainId: profile.chain, dependencies: [], steps: [{ stepId: 'jupiter-swap', nodeId: intent.nodeId,
      chainId: profile.chain, adapter: { id: profile.adapterId, version: '1.0.0' }, dependencies: [], requiredAuthorizationClass: 'MODE_A',
      executionKind: 'DIRECT_TRANSACTION', payloadHash: messageHash }] }], checkpointIds: [], enforcement: 'NOT_ENFORCED' };
  jupiterArtifactHash('execution-plan', plan);
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
  const { commitment, ...content } = review;
  if (jupiterHash(content) !== commitment) fail('JUPITER_AUTHORIZATION_INVALID');
  if (jupiterArtifactHash('semantic-workflow', workflow) !== review.manifest.semanticWorkflowHash) fail('JUPITER_SEMANTIC_REVISION_CHANGED');
  if (owner !== review.owner) fail('JUPITER_WRONG_OWNER');
  if (now >= Date.parse(review.expiresAt) || now < Date.parse(review.quote.fetchedAt)) fail('JUPITER_QUOTE_STALE');
  if (!Number.isSafeInteger(blockHeight) || blockHeight >= review.lastValidBlockHeight - 20) fail('JUPITER_QUOTE_STALE');
  const intent = jupiterIntent(workflow, owner);
  if (intent.amount !== review.amount || intent.input.mint !== review.input.mint || intent.output.mint !== review.output.mint ||
      intent.slippageBps !== review.slippageBps) fail('JUPITER_SEMANTIC_REVISION_CHANGED');
  const step = review.plan.segments[0]?.steps[0];
  if (sha256Hex(fromBase64(review.message)) !== review.messageHash || step?.executionKind !== 'DIRECT_TRANSACTION' || step.payloadHash !== review.messageHash ||
      toBase64(serializeTransaction(null, fromBase64(review.message))) !== review.unsignedTransaction) fail('JUPITER_TRANSACTION_CHANGED');
}

/** The wallet must return exactly the reviewed message with a valid owner signature. Any modification fails closed. */
export function verifySignedJupiterTransaction(review: JupiterReview, signedBase64: unknown): { signature: string; transaction: string } {
  const bytes = fromBase64(signedBase64, 2048);
  const { signatures, message } = parseTransaction(bytes);
  if (signatures.length !== 1 || toBase64(message) !== review.message) fail('JUPITER_TRANSACTION_CHANGED');
  if (!verifyEd25519(signatures[0]!, message, review.owner)) fail('JUPITER_SIGNATURE_INVALID');
  return { signature: base58Encode(signatures[0]!), transaction: toBase64(bytes) };
}
