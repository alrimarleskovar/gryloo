// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: step drivers — how one workflow step is freshly simulated, scoped, signed by its grant's session signer, broadcast
 * and reconciled. The executor (`executor.ts`) is generic over them: adding an action type is a new call template + capability row + driver,
 * never an executor change.
 *
 *   EVM_UNISWAP_V3_ERC7710   Uniswap v3 exact-input swap on a public swap profile (Base Sepolia, Ethereum Sepolia): the same SwapRouter02
 *                            `exactInputSingle` and exact approval FloFi's public swap flow builds, each sent as ONE canonical
 *                            `redeemDelegations` by the session signer (the shape `verifyOwnerSubmission` already reconciles); fresh quote
 *                            from the pinned quoter; reconciliation from receipts and token Transfer events. Its provenance is its transport's.
 *   SOLANA_SPL_FIXTURE_SWAP  MOCKED harness only: a delegated SPL `TransferChecked` into the harness's fixture swap program, which pays SOL.
 *                            No Orca instruction exists in it; it proves the cross-domain authority path, not a Solana protocol integration.
 */
import { erc7710, fromBase64, splDelegation, toBase64, base58Encode, compileMessageV0, serializeMessageV0, serializeSignedTransaction, u64Bytes,
  type SolanaInstruction } from '@defi-workflow-engine/reference-compiler';
import type { DelegatedSignerProvider } from '@defi-workflow-engine/reference-executor';
import { publicSwapProfile } from '../domain/public-testnet-swap.ts';
import { delegationOf } from './adapters.ts';
import type { StepBinding } from './authority.ts';
import type { CapabilityMode } from './capabilities.ts';
import { domainDigest } from './canonical.ts';
import type { ChainTransport } from './chains.ts';
import { MOCKED_SWAP_PROGRAM, MOCKED_SWAP_VAULT } from './harness/solana-double.ts';
import type { GrantRecord } from './pg-store.ts';
import type { StepPlan } from './policy.ts';
import type { StepRequirement } from './steps.ts';

const D = erc7710, F = D.DELEGATION_FRAMEWORK_V1_3, S = splDelegation;
const fail = (code: string): never => { throw new Error(code); };
export type SignerUser = Pick<DelegatedSignerProvider, 'signEvmDigest' | 'signSolanaMessage'>;
export type StepContext = { readonly step: StepRequirement; readonly binding: StepBinding; readonly grant: GrantRecord; readonly transport: ChainTransport; readonly now: () => Date };
export type Reconciled = { readonly status: 'PENDING' | 'CONFIRMED' | 'REVERTED'; readonly spent: readonly { readonly asset: string; readonly amount: bigint }[];
  readonly received: readonly { readonly asset: string; readonly amount: bigint }[]; readonly evidence: Readonly<Record<string, unknown>> };
export type Signed = { readonly submission: Readonly<Record<string, unknown>>; readonly calls: number; readonly nextNonce: bigint | null };
export interface StepDriver {
  readonly id: 'EVM_UNISWAP_V3_ERC7710' | 'SOLANA_SPL_FIXTURE_SWAP';
  readonly supports: (ctx: Pick<StepContext, 'binding' | 'transport'>, mode: CapabilityMode) => boolean;
  /** Fresh, read-only: what the step would do now, and the exact calls to sign. */
  readonly simulate: (ctx: StepContext) => Promise<{ readonly plan: StepPlan; readonly prepared: Readonly<Record<string, unknown>> }>;
  /** The grant's own scope (the on-chain caveat model / token delegation) admits these exact calls — before anything is signed. */
  readonly authorize: (ctx: StepContext, prepared: Readonly<Record<string, unknown>>) => Promise<string | null>;
  readonly sign: (ctx: StepContext, prepared: Readonly<Record<string, unknown>>, signer: SignerUser) => Promise<Signed>;
  readonly broadcast: (ctx: StepContext, submission: Readonly<Record<string, unknown>>) => Promise<void>;
  readonly reconcile: (ctx: StepContext, submission: Readonly<Record<string, unknown>>, plan: Readonly<Record<string, unknown>>) => Promise<Reconciled>;
}
const word = (v: bigint) => v.toString(16).padStart(64, '0');
const addr = (a: string) => a.slice(2).padStart(64, '0');
const topicAddress = (t: unknown) => typeof t === 'string' && /^0x0{24}[0-9a-f]{40}$/i.test(t) ? ('0x' + t.slice(26)).toLowerCase() : null;
const TRANSFER = D.keccakHex('Transfer(address,address,uint256)');
const evmAsset = (chain: string, token: string) => `${chain}/erc20:${token}`;
type EvmCall = { readonly target: string; readonly data: string; readonly group: number; readonly method: string };
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x: unknown) => typeof x === 'bigint' ? x.toString() : x)) as Record<string, unknown>;

// ── EVM: Uniswap v3 through ERC-7710 redemptions ───────────────────────────────────────────────────────────────────────────────
async function balanceOf(t: ChainTransport, token: string, owner: string): Promise<bigint> {
  return BigInt(String(await t.rpc('eth_call', [{ to: token, data: D.selectorOf('balanceOf(address)') + addr(owner) }, 'latest'])).slice(0, 66));
}
/** The LogicalOrWrapper group index of each template, in `evmTemplates` order (approvals of distinct inputs, then swap pairs). */
function groupOf(grant: GrantRecord, kind: 'APPROVE' | 'SWAP', tokenIn: string, tokenOut?: string): number {
  const scope = grant.scope;
  if (scope.mechanism !== 'EVM_ERC7710_METAMASK_V1_3') return fail('DRIVER_MECHANISM_MISMATCH');
  const inputs = [...new Set(scope.pairs.map(p => p.tokenIn))];
  if (kind === 'APPROVE') { const i = inputs.indexOf(tokenIn); return i < 0 ? fail('GRANT_SCOPE_EXCEEDED') : i; }
  const j = scope.pairs.findIndex(p => p.tokenIn === tokenIn && p.tokenOut === tokenOut);
  return j < 0 ? fail('GRANT_SCOPE_EXCEEDED') : inputs.length + j;
}
export const evmSwapDriver: StepDriver = {
  id: 'EVM_UNISWAP_V3_ERC7710',
  supports: ({ binding }) => binding.need.kind === 'EVM_UNISWAP_V3_EXACT_INPUT_SINGLE' && publicSwapProfile(binding.chain) !== null,
  async simulate(ctx) {
    const need = ctx.binding.need;
    if (need.kind !== 'EVM_UNISWAP_V3_EXACT_INPUT_SINGLE') return fail('DRIVER_STEP_MISMATCH');
    const profile = publicSwapProfile(ctx.step.chain) ?? fail('DRIVER_PROFILE_MISSING'), t = ctx.transport, owner = ctx.binding.walletAddress, now = ctx.now().getTime();
    if (BigInt(String(await t.rpc('eth_chainId', []))) !== BigInt(profile.chainId)) fail('WRONG_PROVIDER_CHAIN');
    if (String(await t.rpc('eth_getCode', [owner, 'latest'])).toLowerCase() !== D.DELEGATOR_DESIGNATOR) fail('EVM_ACCOUNT_NOT_UPGRADED');
    if (await balanceOf(t, need.tokenIn, owner) < need.amountIn) fail('INSUFFICIENT_INPUT');
    const raw = String(await t.rpc('eth_call', [{ to: profile.quoter, data: '0xc6a5026a' + addr(need.tokenIn) + addr(need.tokenOut) + word(need.amountIn)
      + word(BigInt(profile.fee)) + word(0n) }, 'latest']));
    const expected = BigInt(raw.slice(0, 66)), slippage = BigInt(ctx.step.slippageBps ?? 0);
    if (expected <= 0n) fail('QUOTE_INVALID');
    const minimum = (expected * (10_000n - slippage) + 9_999n) / 10_000n;
    const swapData = D.EXACT_INPUT_SINGLE_METHOD + word(BigInt(need.tokenIn)) + word(BigInt(need.tokenOut)) + word(BigInt(profile.fee)) + addr(owner)
      + word(need.amountIn) + word(minimum) + word(0n);
    const calls: EvmCall[] = [
      { target: need.tokenIn, data: D.APPROVE_METHOD + addr(need.router) + word(need.amountIn), group: groupOf(ctx.grant, 'APPROVE', need.tokenIn), method: 'approve' },
      { target: need.router, data: swapData, group: groupOf(ctx.grant, 'SWAP', need.tokenIn, need.tokenOut), method: 'exactInputSingle' }];
    const [inBefore, outBefore] = await Promise.all([balanceOf(t, need.tokenIn, owner), balanceOf(t, need.tokenOut, owner)]);
    const plan: StepPlan = { stepIndex: ctx.step.index, chain: ctx.step.chain, actionType: 'asset.swap.exact-input', adapterId: 'uniswap.v3',
      targets: [need.tokenIn, need.router], spend: [{ asset: evmAsset(ctx.step.chain, need.tokenIn), amount: need.amountIn }],
      expectedReceive: [{ asset: evmAsset(ctx.step.chain, need.tokenOut), amount: expected }], minimumReceive: [{ asset: evmAsset(ctx.step.chain, need.tokenOut), amount: minimum }],
      recipient: `${ctx.step.chain}:${owner}`, slippageBps: Number(slippage), quotedAt: now, destinationChain: null, healthFactorAfter: null,
      provenance: t.provenance === 'MOCKED' ? 'MOCKED' : 'PUBLIC_READ_ONLY', simulationHash: domainDigest('flofi.delegated-step-simulation.v1', { calls, expected: expected.toString(), at: now }) };
    return { plan, prepared: json({ calls, before: { tokenIn: inBefore, tokenOut: outBefore }, minimum }) };
  },
  async authorize(ctx, prepared) {
    const delegation = delegationOf(ctx.grant.grantPayload?.delegation), hash = D.delegationHash(delegation);
    if (hash !== ctx.binding.grantCommitment || hash !== ctx.grant.commitment) return 'GRANT_COMMITMENT_MISMATCH';
    const calls = (prepared.calls ?? []) as EvmCall[];
    for (const [i, c] of calls.entries()) {
      const verdict = D.modelBeforeHooks(D.withGroupArgs(delegation, c.group), { redeemer: ctx.grant.sessionAddress, call: { target: c.target, value: 0n, data: c.data },
        blockTimestamp: BigInt(Math.floor(ctx.now().getTime() / 1000)), delegationHash: hash, callCount: BigInt(ctx.grant.callsUsed + i) });
      if (!verdict.ok) return 'GRANT_SCOPE_EXCEEDED';
    }
    return null;
  },
  async sign(ctx, prepared, signer) {
    const t = ctx.transport, profile = publicSwapProfile(ctx.step.chain)!, delegation = delegationOf(ctx.grant.grantPayload?.delegation);
    const chainNonce = BigInt(String(await t.rpc('eth_getTransactionCount', [ctx.grant.sessionAddress, 'pending'])));
    const base = ctx.grant.evmNextNonce !== null && ctx.grant.evmNextNonce > chainNonce ? ctx.grant.evmNextNonce : chainNonce;
    const priority = BigInt(String(await t.rpc('eth_maxPriorityFeePerGas', []))), gasPrice = BigInt(String(await t.rpc('eth_gasPrice', [])));
    const calls = (prepared.calls ?? []) as EvmCall[], txs = [];
    for (const [i, c] of calls.entries()) {
      const tx: erc7710.Eip1559 = { chainId: BigInt(profile.chainId), nonce: base + BigInt(i), maxPriorityFeePerGas: priority, maxFeePerGas: gasPrice * 2n + priority,
        gasLimit: 600_000n, to: F.delegationManager, value: 0n, data: D.redeemCalldata(delegation, c.group, { target: c.target, value: 0n, data: c.data }) };
      const sig = await signer.signEvmDigest(ctx.grant.sessionKeyRef, D.bytesOf(D.eip1559SigningHash(tx)));
      const signed = D.signedEip1559(tx, sig.yParity, sig.r, sig.s);
      if (D.decodeSignedEip1559(signed.raw).from !== ctx.grant.sessionAddress) fail('SIGNER_ADDRESS_MISMATCH');
      txs.push({ raw: signed.raw, hash: signed.hash, nonce: tx.nonce.toString(), target: c.target, method: c.method, group: c.group });
    }
    return { submission: { kind: 'EVM_REDEMPTIONS', chainId: profile.chainId, from: ctx.grant.sessionAddress, delegationHash: D.delegationHash(delegation), txs,
      hashes: txs.map(x => x.hash), before: prepared.before, minimum: prepared.minimum }, calls: txs.length, nextNonce: base + BigInt(txs.length) };
  },
  async broadcast(ctx, submission) {
    for (const tx of (submission.txs ?? []) as { raw: string; hash: string }[]) {
      try { await ctx.transport.rpc('eth_sendRawTransaction', [tx.raw]); }
      catch (cause) {
        // Already known (a re-broadcast) is fine; anything else is decided by reconciliation, never by a second, different transaction.
        if (await ctx.transport.rpc('eth_getTransactionByHash', [tx.hash]).catch(() => null)) continue;
        throw new Error(cause instanceof Error && /nonce/i.test(cause.message) ? 'SUBMISSION_NONCE_CONFLICT' : 'SUBMISSION_BROADCAST_FAILED');
      }
    }
  },
  async reconcile(ctx, submission, plan) {
    const t = ctx.transport, owner = ctx.binding.walletAddress, need = ctx.binding.need;
    if (need.kind !== 'EVM_UNISWAP_V3_EXACT_INPUT_SINGLE') return fail('DRIVER_STEP_MISMATCH');
    const txs = (submission.txs ?? []) as { hash: string; method: string }[], receipts = [];
    for (const tx of txs) {
      const r = await t.rpc('eth_getTransactionReceipt', [tx.hash]) as { status?: string; logs?: { address: string; topics: string[]; data: string }[]; blockNumber?: string } | null;
      if (!r) return { status: 'PENDING', spent: [], received: [], evidence: { pending: tx.hash } };
      receipts.push({ ...r, hash: tx.hash, method: tx.method });
    }
    const evidence = { txs: receipts.map(r => ({ hash: r.hash, method: r.method, status: r.status, block: r.blockNumber })), delegationHash: submission.delegationHash,
      redeemer: submission.from, provenance: t.provenance };
    if (receipts.some(r => r.status !== '0x1')) {
      // A reverted redemption moves nothing; balances say what (if anything) left the owner's account.
      const after = await balanceOf(t, need.tokenIn, owner), before = BigInt(String((submission.before as { tokenIn: string }).tokenIn));
      return { status: 'REVERTED', spent: before > after ? [{ asset: evmAsset(ctx.step.chain, need.tokenIn), amount: before - after }] : [], received: [], evidence };
    }
    const swap = receipts.at(-1)!;
    const redeemed = (swap.logs ?? []).filter(l => l.address.toLowerCase() === F.delegationManager && l.topics[0] === D.REDEEMED_DELEGATION_TOPIC);
    if (redeemed.length !== 1 || topicAddress(redeemed[0]!.topics[1]) !== owner || topicAddress(redeemed[0]!.topics[2]) !== String(submission.from)) fail('RECONCILIATION_MISMATCH');
    const transfers = (swap.logs ?? []).filter(l => l.topics[0] === TRANSFER);
    const outflow = transfers.find(l => l.address.toLowerCase() === need.tokenIn && topicAddress(l.topics[1]) === owner);
    const inflow = transfers.find(l => l.address.toLowerCase() === need.tokenOut && topicAddress(l.topics[2]) === owner);
    if (!outflow || !inflow) fail('RECONCILIATION_MISMATCH');
    const spent = BigInt(outflow!.data), received = BigInt(inflow!.data), minimum = BigInt(String(plan.minimum ?? submission.minimum));
    if (spent !== need.amountIn || received < minimum) fail('RECONCILIATION_MISMATCH');
    return { status: 'CONFIRMED', spent: [{ asset: evmAsset(ctx.step.chain, need.tokenIn), amount: spent }],
      received: [{ asset: evmAsset(ctx.step.chain, need.tokenOut), amount: received }], evidence };
  },
};

// ── Solana (MOCKED harness only): delegated SPL debit into the fixture swap program ─────────────────────────────────────────────
/** The harness's fixed price, lamports per whole input token unit (the double uses the same). */
export const MOCKED_SOLANA_LAMPORTS_PER_UNIT = 2_000_000n;
async function tokenAmount(t: ChainTransport, account: string): Promise<{ amount: bigint; delegate: string | null; delegatedAmount: bigint }> {
  const info = await t.rpc('getAccountInfo', [account, { encoding: 'base64' }]) as { value?: { data?: [string, string] } | null } | null;
  const data = info?.value?.data?.[0] ?? fail('SOLANA_ACCOUNT_MISSING');
  const s = S.decodeTokenAccountState(fromBase64(data, 4096));
  return { amount: s.amount, delegate: s.delegate, delegatedAmount: s.delegatedAmount };
}
const lamportsOf = async (t: ChainTransport, account: string) => BigInt((await t.rpc('getBalance', [account]) as { value: number }).value);
export const solanaFixtureDriver: StepDriver = {
  id: 'SOLANA_SPL_FIXTURE_SWAP',
  supports: ({ binding, transport }, mode) => mode === 'MOCKED_HARNESS' && transport.provenance === 'MOCKED' && binding.need.kind === 'SOLANA_SPL_SPEND'
    && binding.need.programs.includes(MOCKED_SWAP_PROGRAM),
  async simulate(ctx) {
    const need = ctx.binding.need, scope = ctx.grant.scope;
    if (need.kind !== 'SOLANA_SPL_SPEND' || scope.mechanism !== 'SOLANA_SPL_DELEGATE_V1') return fail('DRIVER_STEP_MISMATCH');
    const account = scope.accounts.find(a => a.mint === need.mint) ?? fail('GRANT_SCOPE_EXCEEDED'), owner = ctx.binding.walletAddress, t = ctx.transport;
    const state = await tokenAmount(t, account.tokenAccount);
    if (state.amount < need.amount) fail('INSUFFICIENT_INPUT');
    if (state.delegate !== ctx.grant.sessionAddress || state.delegatedAmount < need.amount) fail('GRANT_SCOPE_EXCEEDED');
    const expected = need.amount * MOCKED_SOLANA_LAMPORTS_PER_UNIT / 10n ** BigInt(need.decimals), slippage = BigInt(ctx.step.slippageBps ?? 0);
    const minimum = (expected * (10_000n - slippage) + 9_999n) / 10_000n, now = ctx.now().getTime();
    const output = ctx.step.outputs[0] ?? fail('DRIVER_STEP_MISMATCH'), outKey = `${ctx.step.chain}/token:${output.address}`;
    const plan: StepPlan = { stepIndex: ctx.step.index, chain: ctx.step.chain, actionType: 'asset.swap.exact-input', adapterId: ctx.step.adapterId ?? 'unknown',
      targets: [need.mint, S.TOKEN_PROGRAM, MOCKED_SWAP_PROGRAM], spend: [{ asset: `${ctx.step.chain}/token:${need.mint}`, amount: need.amount }],
      expectedReceive: [{ asset: outKey, amount: expected }], minimumReceive: [{ asset: outKey, amount: minimum }], recipient: `${ctx.step.chain}:${owner}`,
      slippageBps: Number(slippage), quotedAt: now, destinationChain: null, healthFactorAfter: null, provenance: 'MOCKED',
      simulationHash: domainDigest('flofi.delegated-step-simulation.v1', { mint: need.mint, amount: need.amount.toString(), expected: expected.toString(), at: now }) };
    return { plan, prepared: json({ tokenAccount: account.tokenAccount, minimum, before: { token: state.amount, lamports: await lamportsOf(t, owner) } }) };
  },
  async authorize(ctx, prepared) {
    const need = ctx.binding.need;
    if (need.kind !== 'SOLANA_SPL_SPEND') return 'DRIVER_STEP_MISMATCH';
    const state = await tokenAmount(ctx.transport, String(prepared.tokenAccount));
    return state.delegate === ctx.grant.sessionAddress && state.delegatedAmount >= need.amount ? null : 'GRANT_SCOPE_EXCEEDED';
  },
  async sign(ctx, prepared, signer) {
    const need = ctx.binding.need;
    if (need.kind !== 'SOLANA_SPL_SPEND') return fail('DRIVER_STEP_MISMATCH');
    const r = await ctx.transport.rpc('getLatestBlockhash', [{ commitment: 'finalized' }]) as { value: { blockhash: string } };
    const swap: SolanaInstruction = { programId: MOCKED_SWAP_PROGRAM, data: Uint8Array.from([1, ...u64Bytes(need.amount), ...u64Bytes(BigInt(String(prepared.minimum)))]),
      accounts: [{ pubkey: need.mint, isSigner: false, isWritable: false }, { pubkey: ctx.binding.walletAddress, isSigner: false, isWritable: true }] };
    const ixs = [S.transferChecked({ source: String(prepared.tokenAccount), mint: need.mint, destination: MOCKED_SWAP_VAULT, authority: ctx.grant.sessionAddress,
      amount: need.amount, decimals: need.decimals }), swap];
    const message = serializeMessageV0(compileMessageV0(ctx.grant.sessionAddress, ixs, r.value.blockhash, {}));
    const signature = await signer.signSolanaMessage(ctx.grant.sessionKeyRef, message);
    const wire = serializeSignedTransaction([signature], message);
    return { submission: { kind: 'SOLANA_TRANSACTION', wire: toBase64(wire), signature: base58Encode(signature), hashes: [base58Encode(signature)], before: prepared.before,
      minimum: prepared.minimum, tokenAccount: prepared.tokenAccount }, calls: 1, nextNonce: null };
  },
  async broadcast(ctx, submission) {
    await ctx.transport.rpc('sendTransaction', [String(submission.wire), { encoding: 'base64' }]);
  },
  async reconcile(ctx, submission) {
    const need = ctx.binding.need;
    if (need.kind !== 'SOLANA_SPL_SPEND') return fail('DRIVER_STEP_MISMATCH');
    const statuses = await ctx.transport.rpc('getSignatureStatuses', [[String(submission.signature)]]) as { value: ({ err: unknown } | null)[] };
    const status = statuses.value[0];
    const evidence = { signature: submission.signature, redeemer: ctx.grant.sessionAddress, provenance: ctx.transport.provenance, program: 'MOCKED_SWAP_PROGRAM' };
    if (!status) return { status: 'PENDING', spent: [], received: [], evidence };
    const before = submission.before as { token: string; lamports: string };
    const token = await tokenAmount(ctx.transport, String(submission.tokenAccount)), lamports = await lamportsOf(ctx.transport, ctx.binding.walletAddress);
    const spent = BigInt(before.token) - token.amount, received = lamports - BigInt(before.lamports);
    const output = ctx.step.outputs[0]!, inKey = `${ctx.step.chain}/token:${need.mint}`, outKey = `${ctx.step.chain}/token:${output.address}`;
    if (status.err) return { status: 'REVERTED', spent: spent > 0n ? [{ asset: inKey, amount: spent }] : [], received: [], evidence: { ...evidence, err: String(JSON.stringify(status.err)).slice(0, 120) } };
    if (spent !== need.amount || received < BigInt(String(submission.minimum))) fail('RECONCILIATION_MISMATCH');
    return { status: 'CONFIRMED', spent: [{ asset: inKey, amount: spent }], received: [{ asset: outKey, amount: received }], evidence };
  },
};
export const DRIVERS: readonly StepDriver[] = Object.freeze([evmSwapDriver, solanaFixtureDriver]);
export function driverFor(ctx: Pick<StepContext, 'binding' | 'transport'>, mode: CapabilityMode): StepDriver | null {
  return DRIVERS.find(d => d.supports(ctx, mode)) ?? null;
}
