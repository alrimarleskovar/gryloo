// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001 MOCKED harness: an in-process Base and Arbitrum with USDC, Across SpokePools, the LI.FI Diamond and fee
 * forwarder, a scripted owner wallet, an Across relayer, and loopback LI.FI / Across API responses shaped like the real
 * recorded ones (so the real normalizers run). No network and no key; the only transaction path is `wallet.send` (the
 * owner's browser wallet in a real deployment) and the relayer's fill on Arbitrum.
 * BUILD-JOURNEY-001: `profile` selects the network (default Base → Arbitrum One; the testnet profile runs the identical
 * chains at Base Sepolia / Arbitrum Sepolia ids and addresses). `owner` may be any address, e.g. a random test wallet.
 */
import { createHash, randomBytes } from 'node:crypto';
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as MAINNET, type RouterProfile } from '@defi-workflow-engine/action-registry';
import { decodeAcrossDeposit, decodeLifiAcrossV4, decodeLifiFeeForward, decodeRouterApprove, encodeAcrossDeposit, encodeErc20ApprovalLog, encodeErc20TransferLog,
  encodeFilledRelayLog, encodeFundsDepositedLog, encodeLifiAcrossV4, encodeLifiFeeForward, lifiAcrossOutput, EIP1967_IMPLEMENTATION_SLOT, ROUTER_SELECTORS as SEL,
  type RouterLog } from '@defi-workflow-engine/reference-compiler';
import { createRouteProviders, type RouterHttp } from '../src/server/router-providers.ts';
import { ROUTER_MOCK_ACROSS_API, ROUTER_MOCK_CODE_PINS, ROUTER_MOCK_LIFI_API, ROUTER_TESTNET_MOCK, routerMockCode, routerMockCodePins } from '../src/server/router-mock.ts';
import { encodeSingleRedemption, UNI_DELEGATION_MANAGER, UNI_DELEGATOR_IMPL } from './uniswap-liquidity-harness.ts';

export { ROUTER_MOCK_CODE_PINS };
export const ROUTER_OWNER = '0x5555555555555555555555555555555555555555';
export const ROUTER_RECIPIENT = '0x6666666666666666666666666666666666666666';
export const ROUTER_RELAYER = '0x7777777777777777777777777777777777777777';
export const LIFI_FEE_RECIPIENT = '0xc06ebbefd94032b85424d51906e2a335efae264b';
const ZERO = '0x0000000000000000000000000000000000000000';
const REDEEMED_TOPIC = '0x40dadaa36c6c2e3d7317e24757451ffb2d603d875f0ad5e92c5dd156573b1873';
const w = (n: bigint) => n.toString(16).padStart(64, '0');
const aw = (a: string) => a.slice(2).padStart(64, '0');
const hx = (n: number | bigint) => '0x' + n.toString(16);
const blockHash = (chain: string, n: number) => '0x' + createHash('sha256').update(`${chain}:${n}`).digest('hex');
type Snapshot = { usdc: Record<string, bigint>; allowances: Record<string, bigint>; native: Record<string, bigint>; nonces: Record<string, bigint> };
type Mined = { hash: string; from: string; to: string; input: string; nonce: bigint; block: number; status: 0 | 1; logs: RouterLog[]; gasUsed: bigint; chain: 'base' | 'arbitrum' };
type Deposit = { depositId: bigint; sourceHash: string; depositor: string; recipient: string; inputAmount: bigint; outputAmount: bigint; fillDeadline: number;
  readyAt: number; filled: string | null; refunded: string | null };
export type FillMode = 'normal' | 'wrongRecipient' | 'belowMinimum' | 'duplicate';
export type RouterHarnessOptions = { owner?: string; usdc?: bigint; eth?: bigint; nonce?: bigint; simulateV1?: boolean; autoFillSeconds?: number | null;
  baseSafeLagBlocks?: number; arbitrumSafeLagBlocks?: number; startMs?: number;
  /** The owner's EOA is EIP-7702-delegated to the MetaMask delegator, so its wallet may relay requests (`wallet.sendRelayed`). */ delegatedOwner?: boolean;
  /** BUILD-JOURNEY-001: the router profile (network) these chains impersonate. */ profile?: RouterProfile;
  /** Further funded wallets on the source chain (other external users). */ wallets?: readonly string[] };

export function createRouterHarness(options: RouterHarnessOptions = {}) {
  const profile = options.profile ?? MAINNET, SRC = profile.source, DST = profile.destination, MOCK_CODE = routerMockCode(profile);
  const owner = (options.owner ?? ROUTER_OWNER).toLowerCase();
  let offset = 0;
  const origin = options.startMs ?? Date.now();
  const started = Date.now();
  const nowMs = () => origin + (Date.now() - started) + offset;
  const clock = () => new Date(nowMs());
  const BASE_GENESIS = 52_000_000, ARB_GENESIS = 510_000_000;
  const baseHead = () => BASE_GENESIS + Math.floor((nowMs() - origin) / 2000);
  const arbHead = () => ARB_GENESIS + Math.floor((nowMs() - origin) / 250);
  const baseTime = (n: number) => Math.floor((origin + (n - BASE_GENESIS) * 2000) / 1000);
  const arbTime = (n: number) => Math.floor((origin + (n - ARB_GENESIS) * 250) / 1000);
  const advance = (seconds: number) => { offset += seconds * 1000; processFills(); };
  const others = (options.wallets ?? []).map(w => w.toLowerCase());
  const state: Snapshot = { usdc: { [owner]: options.usdc ?? 50_000_000n, [SRC.spokePool]: 900_000_000n, ...Object.fromEntries(others.map(w => [w, 50_000_000n])) },
    allowances: {}, native: { [owner]: options.eth ?? 10n ** 16n, [ROUTER_RELAYER]: 10n ** 18n, ...Object.fromEntries(others.map(w => [w, 10n ** 16n])) },
    nonces: { [owner]: options.nonce ?? 3n, ...Object.fromEntries(others.map(w => [w, 0n])) } };
  const arbUsdc: Record<string, bigint> = { [ROUTER_RELAYER]: 10_000_000_000n };
  const history: [number, Snapshot][] = [[0, structuredClone(state)]];
  const arbHistory: [number, Record<string, bigint>][] = [[0, { ...arbUsdc }]];
  const mined = new Map<string, Mined>(), pending: { hash: string; from: string; to: string; input: string; nonce: bigint }[] = [];
  const deposits: Deposit[] = [];
  let nextDepositId = 6_291_456n;
  const counters = { sends: 0, simulate: 0, fills: 0, quotes: { lifi: 0, across: 0 }, status: { lifi: 0, across: 0 } };
  const controls = {
    lifi: 'ok' as 'ok' | 'down' | 'stargate' | 'noFeeStep', across: 'ok' as 'ok' | 'down', feeBump: 0n, hint: 'normal' as 'normal' | 'down' | 'lying',
    autoFillSeconds: options.autoFillSeconds === undefined ? 5 : options.autoFillSeconds, fillMode: 'normal' as FillMode, receiptLost: false,
    baseSafeLag: options.baseSafeLagBlocks ?? 5, arbitrumSafeLag: options.arbitrumSafeLagBlocks ?? 40,
  };
  const allowanceKey = (token: string, from: string, spender: string) => `${token}:${from}:${spender}`;
  const snapshotAt = (tag: unknown): Snapshot => {
    if (tag === undefined || tag === 'latest' || tag === 'pending') return state;
    const n = Number(BigInt(tag as string));
    return [...history].reverse().find(([b]) => b <= n)?.[1] ?? history[0]![1];
  };
  const arbAt = (tag: unknown): Record<string, bigint> => {
    if (tag === undefined || tag === 'latest') return arbUsdc;
    const n = Number(BigInt(tag as string));
    return [...arbHistory].reverse().find(([b]) => b <= n)?.[1] ?? arbHistory[0]![1];
  };
  const record = () => history.push([baseHead(), structuredClone(state)]);
  const transfer = (s: Snapshot, from: string, to: string, amount: bigint, logs: RouterLog[]) => {
    if ((s.usdc[from] ?? 0n) < amount) throw new Error('MOCK_INSUFFICIENT_BALANCE');
    s.usdc[from] = (s.usdc[from] ?? 0n) - amount; s.usdc[to] = (s.usdc[to] ?? 0n) + amount;
    logs.push(encodeErc20TransferLog(SRC.usdc, from, to, amount));
  };
  const pull = (s: Snapshot, owner_: string, spender: string, amount: bigint, logs: RouterLog[]) => {
    const key = allowanceKey(SRC.usdc, owner_, spender);
    if ((s.allowances[key] ?? 0n) < amount) throw new Error('MOCK_ALLOWANCE');
    s.allowances[key] = (s.allowances[key] ?? 0n) - amount;
    transfer(s, owner_, spender, amount, logs);
  };
  /** One Base call against a snapshot; mutates it (used for simulation and execution). */
  function execute(s: Snapshot, from: string, to: string, data: string, time: number, assignDeposit: boolean): { ok: boolean; logs: RouterLog[]; gas: bigint; deposit?: Omit<Deposit, 'sourceHash' | 'readyAt' | 'filled' | 'refunded'> } {
    const logs: RouterLog[] = [];
    try {
      if (to === SRC.usdc && data.startsWith(SEL.approve)) {
        const { spender, amount } = decodeRouterApprove(data);
        s.allowances[allowanceKey(SRC.usdc, from, spender)] = amount;
        logs.push(encodeErc20ApprovalLog(SRC.usdc, from, spender, amount));
        return { ok: true, logs, gas: 46_000n };
      }
      const emitDeposit = (depositor: string, recipient: string, inputAmount: bigint, outputAmount: bigint, quoteTimestamp: number, fillDeadline: number,
        exclusivityParameter: number, exclusiveRelayer: string) => {
        if (time - quoteTimestamp > 3600 || quoteTimestamp > time || fillDeadline > time + 21_600 || fillDeadline < time) throw new Error('MOCK_DEPOSIT_TIME');
        const depositId = assignDeposit ? nextDepositId++ : nextDepositId;
        logs.push(encodeFundsDepositedLog({ spokePool: SRC.spokePool, destinationChainId: BigInt(DST.chainId), depositId, depositor, inputToken: SRC.usdc, outputToken: DST.usdc,
          inputAmount, outputAmount, quoteTimestamp, fillDeadline, exclusivityDeadline: exclusivityParameter ? time + exclusivityParameter : 0, recipient,
          exclusiveRelayer: '0x' + aw(exclusiveRelayer), message: '0x' }));
        return { depositId, depositor, recipient, inputAmount, outputAmount, fillDeadline };
      };
      if (to === SRC.spokePool && data.startsWith(SEL.acrossDeposit)) {
        const c = decodeAcrossDeposit(data);
        pull(s, from, SRC.spokePool, c.inputAmount, logs);
        const deposit = emitDeposit(c.depositor, c.recipient, c.inputAmount, c.outputAmount, c.quoteTimestamp, c.fillDeadline, c.exclusivityParameter, c.exclusiveRelayer);
        return { ok: true, logs, gas: 120_000n, deposit };
      }
      if (to === SRC.lifiDiamond && (data.startsWith(SEL.lifiSwapAndStartAcrossV4) || data.startsWith(SEL.lifiStartAcrossV4))) {
        const c = decodeLifiAcrossV4(data);
        let amount = c.bridgeData.minAmount;
        if (c.kind === 'SWAP_AND_START') {
          const swap = c.swaps[0]!;
          pull(s, from, SRC.lifiDiamond, swap.fromAmount, logs);
          for (const fee of decodeLifiFeeForward(swap.callData).fees) transfer(s, SRC.lifiDiamond, fee.recipient, fee.amount, logs);
          amount = swap.fromAmount - decodeLifiFeeForward(swap.callData).fees.reduce((sum, f) => sum + f.amount, 0n);
        } else pull(s, from, SRC.lifiDiamond, amount, logs);
        transfer(s, SRC.lifiDiamond, SRC.spokePool, amount, logs);
        const output = c.kind === 'SWAP_AND_START' ? lifiAcrossOutput(amount, c.across.outputAmountMultiplier) : c.across.outputAmount;
        const deposit = emitDeposit(c.across.refundAddress, c.across.receiverAddress, amount, output, c.across.quoteTimestamp, c.across.fillDeadline, c.across.exclusivityParameter,
          c.across.exclusiveRelayer);
        return { ok: true, logs, gas: 260_000n, deposit };
      }
      return { ok: false, logs: [], gas: 30_000n };
    } catch { return { ok: false, logs: [], gas: 30_000n }; }
  }
  function mineBase(from: string, to: string, input: string, nonce: bigint, consumeNonce = true, hash = '0x' + randomBytes(32).toString('hex'),
    inner: { from: string; to: string; input: string } | null = null): Mined {
    advance(2);
    const block = baseHead();
    const scratch = structuredClone(state);
    const result = inner ? execute(scratch, inner.from, inner.to, inner.input, baseTime(block), true) : execute(scratch, from, to, input, baseTime(block), true);
    if (inner && result.ok) result.logs.push({ address: UNI_DELEGATION_MANAGER, topics: [REDEEMED_TOPIC, '0x' + aw(inner.from), '0x' + aw(from)], data: '0x' + w(32n) });
    if (result.ok) Object.assign(state, scratch);
    if (consumeNonce) state.nonces[from] = nonce + 1n;
    const tx: Mined = { hash, from, to, input, nonce, block, status: result.ok ? 1 : 0, logs: result.ok ? result.logs : [], gasUsed: result.gas, chain: 'base' };
    mined.set(hash, tx); record();
    if (result.deposit) deposits.push({ ...result.deposit, sourceHash: hash, readyAt: nowMs() + (controls.autoFillSeconds ?? 0) * 1000, filled: null, refunded: null });
    return tx;
  }
  const wallet = {
    /** The owner's wallet sends the exact request (`hold` keeps it unmined). */
    send(tx: { from: string; to: string; data: string; value: string; chainId: string }, mode: { hold?: boolean } = {}): string {
      const from = String(tx.from).toLowerCase();
      if (tx.chainId !== SRC.chainHex || tx.value !== '0x0' || (from !== owner && !others.includes(from))) throw new Error('MOCK_WALLET_REQUEST_INVALID');
      counters.sends++;
      const nonce = state.nonces[from] ?? 0n;
      if (mode.hold) { const hash = '0x' + randomBytes(32).toString('hex'); pending.push({ hash, from, to: tx.to, input: tx.data, nonce }); return hash; }
      return mineBase(from, tx.to, tx.data, nonce).hash;
    },
    /** MetaMask delegated redemption: a relayer sends it; the owner's nonce does not change. */
    sendRelayed(tx: { from: string; to: string; data: string; chainId: string }): string {
      if (!options.delegatedOwner || tx.from !== owner || tx.chainId !== SRC.chainHex) throw new Error('MOCK_WRONG_SIGNER');
      counters.sends++;
      const nonce = state.nonces[ROUTER_RELAYER] ?? 0n;
      return mineBase(ROUTER_RELAYER, UNI_DELEGATION_MANAGER, encodeSingleRedemption('0x' + 'ab'.repeat(96), tx.to, tx.data), nonce, true, undefined,
        { from: owner, to: tx.to, input: tx.data }).hash;
    },
    /** Mines held transactions (the wallet's request reached the network later). */
    mine(): string[] { return pending.splice(0).map(p => mineBase(p.from, p.to, p.input, p.nonce, true, p.hash).hash); },
    /** A different transaction consumes the owner's nonce (e.g. a wallet cancellation). */
    cancel(): string { pending.splice(0); return mineBase(owner, owner, '0x', state.nonces[owner] ?? 0n).hash; },
  };
  function fill(deposit: Deposit, mode: FillMode = controls.fillMode): string {
    const block = arbHead(), hash = '0x' + randomBytes(32).toString('hex');
    const recipient = mode === 'wrongRecipient' ? '0x8888888888888888888888888888888888888888' : deposit.recipient;
    const amount = mode === 'belowMinimum' ? deposit.outputAmount - 1n : deposit.outputAmount;
    const event = { spokePool: DST.spokePool, originChainId: BigInt(SRC.chainId), depositId: deposit.depositId, relayer: '0x' + aw(ROUTER_RELAYER), inputToken: SRC.usdc,
      outputToken: DST.usdc, inputAmount: deposit.inputAmount, outputAmount: deposit.outputAmount, repaymentChainId: BigInt(SRC.chainId), fillDeadline: deposit.fillDeadline,
      exclusivityDeadline: 0, exclusiveRelayer: '0x' + '0'.repeat(64), depositor: deposit.depositor, recipient: deposit.recipient, messageHash: '0x' + '0'.repeat(64),
      updatedRecipient: recipient, updatedMessageHash: '0x' + '0'.repeat(64), updatedOutputAmount: amount, fillType: 0 };
    const logs = [encodeFilledRelayLog(event), encodeErc20TransferLog(DST.usdc, ROUTER_RELAYER, recipient, amount)];
    if (mode === 'duplicate') logs.push(encodeFilledRelayLog(event));
    arbUsdc[ROUTER_RELAYER] = (arbUsdc[ROUTER_RELAYER] ?? 0n) - amount; arbUsdc[recipient] = (arbUsdc[recipient] ?? 0n) + amount;
    arbHistory.push([block, { ...arbUsdc }]);
    mined.set(hash, { hash, from: ROUTER_RELAYER, to: DST.spokePool, input: '0x', nonce: 0n, block, status: 1, logs, gasUsed: 150_000n, chain: 'arbitrum' });
    deposit.filled = hash; counters.fills++;
    return hash;
  }
  function processFills() {
    if (controls.autoFillSeconds === null) return;
    for (const d of deposits) if (!d.filled && !d.refunded && d.readyAt <= nowMs() && arbTime(arbHead()) <= d.fillDeadline) fill(d);
  }
  const relayer = {
    fill(depositIndex = deposits.length - 1, mode?: FillMode) { return fill(deposits[depositIndex]!, mode); },
    /** Across settlement refunds an expired deposit to the refund address on Base. */
    refund(depositIndex = deposits.length - 1): string {
      const d = deposits[depositIndex]!;
      const tx = mineBase(ROUTER_RELAYER, SRC.spokePool, '0x0123', 0n, false);
      transfer(state, SRC.spokePool, d.depositor, d.inputAmount, tx.logs); tx.status = 1; record();
      d.refunded = tx.hash; return tx.hash;
    },
    deposits,
  };

  const receipt = (m: Mined) => ({ transactionHash: m.hash, status: hx(m.status), blockNumber: hx(m.block), blockHash: blockHash(m.chain, m.block), from: m.from, to: m.to,
    gasUsed: hx(m.gasUsed), effectiveGasPrice: hx(1_000_000n), l1Fee: hx(10_000n), logs: m.logs.map((l, i) => ({ ...l, logIndex: hx(i), transactionHash: m.hash, blockNumber: hx(m.block) })) });
  const txObject = (m: Mined) => ({ hash: m.hash, from: m.from, to: m.to, input: m.input, value: '0x0', nonce: hx(m.nonce), chainId: hx(m.chain === 'base' ? SRC.chainId : DST.chainId),
    type: '0x2', blockHash: blockHash(m.chain, m.block), blockNumber: hx(m.block) });
  const block = (chain: 'base' | 'arbitrum', n: number, full: boolean) => {
    const txs = [...mined.values()].filter(m => m.chain === chain && m.block === n);
    return { number: hx(n), hash: blockHash(chain, n), timestamp: hx(chain === 'base' ? baseTime(n) : arbTime(n)), baseFeePerGas: hx(5_000_000n),
      transactions: full ? txs.map(txObject) : txs.map(m => m.hash) };
  };
  const tagNumber = (chain: 'base' | 'arbitrum', tag: unknown) => {
    const head = chain === 'base' ? baseHead() : arbHead();
    if (tag === 'latest' || tag === 'pending') return head;
    if (tag === 'safe' || tag === 'finalized') return head - (chain === 'base' ? controls.baseSafeLag : controls.arbitrumSafeLag);
    return Number(BigInt(tag as string));
  };
  const code = (target: string, chain: 'base' | 'arbitrum') => {
    if (chain === 'base' && target === UNI_DELEGATION_MANAGER) return '0x60306030';
    if (chain === 'base' && target === owner && options.delegatedOwner) return '0xef0100' + UNI_DELEGATOR_IMPL.slice(2);
    return MOCK_CODE[(chain === 'arbitrum' ? 'dst:' : '') + target] ?? '0x';
  };
  const logsIn = (chain: 'base' | 'arbitrum', f: { address: string; fromBlock: string; toBlock: string; topics: (string | null)[] }, head: number) => {
    const from = Number(BigInt(f.fromBlock)), to = Number(BigInt(f.toBlock));
    if (to - from + 1 > 2_000) throw new Error('MOCK_LOG_RANGE_TOO_LARGE');
    return [...mined.values()].filter(m => m.chain === chain && m.block >= from && m.block <= to && m.block <= head)
      .flatMap(m => m.logs.filter(l => l.address === f.address && f.topics.every((t, i) => t === null || l.topics[i] === t))
        .map((l, i) => ({ ...l, transactionHash: m.hash, blockNumber: hx(m.block), logIndex: hx(i) })));
  };
  async function baseRpc(method: string, params: readonly unknown[]): Promise<unknown> {
    const p = params as unknown[];
    switch (method) {
      case 'eth_chainId': return hx(SRC.chainId);
      case 'eth_blockNumber': return hx(baseHead());
      case 'eth_getBlockByNumber': { const n = tagNumber('base', p[0]); return n > baseHead() ? null : block('base', n, p[1] === true); }
      case 'eth_getCode': return code(String(p[0]).toLowerCase(), 'base');
      case 'eth_getStorageAt': return String(p[1]) === EIP1967_IMPLEMENTATION_SLOT && String(p[0]) === SRC.spokePool ? '0x' + aw('0xf23c6c04a2b88e8651fe99bbdccbb5c9d306e6b0') : '0x0';
      case 'eth_getBalance': return hx(snapshotAt(p[1]).native[String(p[0]).toLowerCase()] ?? 0n);
      case 'eth_getTransactionCount': {
        const who = String(p[0]).toLowerCase();
        if (p[1] === 'pending') return hx((state.nonces[who] ?? 0n) + BigInt(pending.filter(x => x.from === who).length));
        return hx(snapshotAt(p[1]).nonces[who] ?? 0n);
      }
      case 'eth_maxPriorityFeePerGas': return hx(1_000_000n);
      case 'eth_call': {
        const { to, data } = p[0] as { to: string; data: string }, s = snapshotAt(p[1]);
        if (to === SRC.usdc && data.startsWith(SEL.balanceOf)) return '0x' + w(s.usdc['0x' + data.slice(34, 74)] ?? 0n);
        if (to === SRC.usdc && data.startsWith(SEL.allowance)) return '0x' + w(s.allowances[allowanceKey(SRC.usdc, '0x' + data.slice(34, 74), '0x' + data.slice(98, 138))] ?? 0n);
        if (to === SRC.usdc && data === SEL.decimals) return '0x' + w(6n);
        if (to === SRC.spokePool && data === SEL.chainId) return '0x' + w(BigInt(SRC.chainId));
        if (to === SRC.spokePool && data === SEL.pausedDeposits) return '0x' + w(0n);
        if (to === SRC.spokePool && data === SEL.depositQuoteTimeBuffer) return '0x' + w(3600n);
        if (to === SRC.spokePool && data === SEL.fillDeadlineBuffer) return '0x' + w(21_600n);
        if (to === '0x420000000000000000000000000000000000000f') return '0x' + w(50_000n);
        throw new Error('MOCK_CALL_UNSUPPORTED');
      }
      case 'eth_simulateV1': {
        if (options.simulateV1 === false) throw new Error('MOCK_METHOD_NOT_FOUND');
        counters.simulate++;
        const request = p[0] as { blockStateCalls: { calls: { from: string; to: string; data: string }[] }[] };
        const at = tagNumber('base', p[1]), s = structuredClone(snapshotAt(hx(at)));
        return [{ calls: request.blockStateCalls[0]!.calls.map(c => { const r = execute(s, c.from.toLowerCase(), c.to.toLowerCase(), c.data, baseTime(baseHead()), false);
          return { status: r.ok ? '0x1' : '0x0', gasUsed: hx(r.gas), returnData: '0x', logs: r.logs }; }) }];
      }
      case 'eth_getLogs': return logsIn('base', p[0] as Parameters<typeof logsIn>[1], baseHead());
      case 'eth_getTransactionReceipt': { const m = mined.get(String(p[0])); return m?.chain === 'base' && m.block <= baseHead() && !controls.receiptLost ? receipt(m) : null; }
      case 'eth_getTransactionByHash': { const m = mined.get(String(p[0])); return m?.chain === 'base' ? txObject(m) : null; }
      default: throw new Error('MOCK_METHOD_UNSUPPORTED:' + method);
    }
  }
  async function arbitrumRpc(method: string, params: readonly unknown[]): Promise<unknown> {
    processFills();
    const p = params as unknown[];
    switch (method) {
      case 'eth_chainId': return hx(DST.chainId);
      case 'eth_blockNumber': return hx(arbHead());
      case 'eth_getBlockByNumber': { const n = tagNumber('arbitrum', p[0]); return n > arbHead() ? null : block('arbitrum', n, p[1] === true); }
      case 'eth_getCode': return code(String(p[0]).toLowerCase(), 'arbitrum');
      case 'eth_getStorageAt': return '0x' + aw('0xcfcda84333431bcc9155f2368b8362f0d1dff8c9');
      case 'eth_call': {
        const { to, data } = p[0] as { to: string; data: string };
        if (to === DST.usdc && data.startsWith(SEL.balanceOf)) return '0x' + w(arbAt(p[1])['0x' + data.slice(34, 74)] ?? 0n);
        if (to === DST.spokePool && data === SEL.chainId) return '0x' + w(BigInt(DST.chainId));
        if (to === DST.spokePool && data === SEL.pausedFills) return '0x' + w(0n);
        throw new Error('MOCK_CALL_UNSUPPORTED');
      }
      case 'eth_getLogs': return logsIn('arbitrum', p[0] as Parameters<typeof logsIn>[1], arbHead());
      case 'eth_getTransactionReceipt': { const m = mined.get(String(p[0])); return m?.chain === 'arbitrum' && m.block <= arbHead() ? receipt(m) : null; }
      case 'eth_getTransactionByHash': { const m = mined.get(String(p[0])); return m?.chain === 'arbitrum' ? txObject(m) : null; }
      default: throw new Error('MOCK_METHOD_UNSUPPORTED:' + method);
    }
  }

  // --- loopback provider APIs, shaped like the recorded real responses ------------------------------------------------
  const usdcToken = (chainId: number, address: string) => ({ address, chainId, symbol: 'USDC', decimals: 6, name: 'USD Coin', coinKey: 'USDC' });
  function lifiQuote(q: URLSearchParams): unknown {
    if (controls.lifi === 'down') throw new Error('ROUTER_PROVIDER_HTTP_503');
    counters.quotes.lifi++;
    const amount = BigInt(q.get('fromAmount')!), from = q.get('fromAddress')!.toLowerCase(), to = q.get('toAddress')!.toLowerCase();
    const time = baseTime(baseHead()), fee = amount * 25n / 10_000n, minAmount = amount - fee;
    const relayerCapital = 997n + controls.feeBump, quotedGas = 7_776n;
    const multiplier = (minAmount - relayerCapital - quotedGas) * 10n ** 18n / minAmount, output = lifiAcrossOutput(minAmount, multiplier);
    // Like LI.FI's lines, the relayer fees absorb the multiplier's rounding so that they sum exactly to minAmount − output.
    const relayerGas = minAmount - output - relayerCapital, bridgeFee = relayerCapital + relayerGas;
    const tool = controls.lifi === 'stargate' ? 'stargateV2' : 'across', noFee = controls.lifi === 'noFeeStep';
    const across = { receiverAddress: to, refundAddress: from, sendingAssetId: SRC.usdc, receivingAssetId: DST.usdc, outputAmount: noFee ? amount - bridgeFee : output,
      outputAmountMultiplier: noFee ? 0n : multiplier, exclusiveRelayer: ZERO, quoteTimestamp: time, fillDeadline: time + 7_200, exclusivityParameter: 0, message: '0x' };
    const transactionId = '0x' + randomBytes(32).toString('hex');
    const bridgeData = { transactionId, bridge: tool, integrator: 'flofi', referrer: ZERO, sendingAssetId: SRC.usdc, receiver: to, minAmount: noFee ? amount : minAmount,
      destinationChainId: BigInt(DST.chainId), hasSourceSwaps: !noFee, hasDestinationCall: false };
    const data = noFee ? encodeLifiAcrossV4({ kind: 'START', bridgeData, swaps: [], across })
      : encodeLifiAcrossV4({ kind: 'SWAP_AND_START', bridgeData, across, swaps: [{ callTo: SRC.lifiFeeForwarder, approveTo: SRC.lifiFeeForwarder, sendingAssetId: SRC.usdc,
        receivingAssetId: SRC.usdc, fromAmount: amount, callData: encodeLifiFeeForward(SRC.usdc, [{ recipient: LIFI_FEE_RECIPIENT, amount: fee }]), requiresDeposit: true }] });
    const out = (noFee ? amount - bridgeFee : output).toString();
    const feeLine = (name: string, value: bigint) => ({ name, description: name, token: usdcToken(SRC.chainId, SRC.usdc), amount: value.toString(), amountUSD: '0', included: true });
    return { type: 'lifi', id: randomBytes(8).toString('hex') + ':0', tool, toolDetails: { key: tool, name: tool },
      action: { fromChainId: SRC.chainId, toChainId: DST.chainId, fromToken: usdcToken(SRC.chainId, SRC.usdc), toToken: usdcToken(DST.chainId, DST.usdc),
        fromAmount: amount.toString(), slippage: Number(q.get('slippage')), fromAddress: from, toAddress: to },
      estimate: { tool, fromAmount: amount.toString(), toAmount: out, toAmountMin: out, approvalAddress: SRC.lifiDiamond, executionDuration: 2,
        feeCosts: [...noFee ? [] : [feeLine('LIFI Fixed Fee', fee)], feeLine('Relayer fee', relayerCapital), feeLine('Relayer gas fee', relayerGas)],
        gasCosts: [{ type: 'SEND', amount: '1248222000000', token: { address: ZERO, chainId: SRC.chainId, symbol: 'ETH', decimals: 18 } }] },
      includedSteps: [...noFee ? [] : [{ type: 'protocol', tool: 'feeCollection' }], { type: 'cross', tool }], integrator: 'flofi',
      transactionRequest: { value: '0x0', to: SRC.lifiDiamond, data, from, chainId: SRC.chainId, gasPrice: '0x5b8d80', gasLimit: '0xa3af0' }, transactionId };
  }
  function acrossQuote(q: URLSearchParams): unknown {
    if (controls.across === 'down') throw new Error('ROUTER_PROVIDER_HTTP_503');
    counters.quotes.across++;
    const amount = BigInt(q.get('amount')!), depositor = q.get('depositor')!.toLowerCase(), recipient = q.get('recipient')!.toLowerCase();
    const time = baseTime(baseHead()), capital = 1_000n + controls.feeBump, gas = 7_777n, output = amount - capital - gas;
    const data = encodeAcrossDeposit({ depositor, recipient, inputToken: SRC.usdc, outputToken: DST.usdc, inputAmount: amount, outputAmount: output,
      destinationChainId: BigInt(DST.chainId), exclusiveRelayer: ZERO, quoteTimestamp: time, fillDeadline: time + 7_200, exclusivityParameter: 0, message: '0x', trailer: '0x73c0de' });
    const t = (chainId: number, address: string) => ({ decimals: 6, symbol: 'USDC', address, name: 'USD Coin', chainId });
    const amt = (value: bigint) => ({ amount: value.toString(), token: t(SRC.chainId, SRC.usdc) });
    return { crossSwapType: 'bridgeableToBridgeable', amountType: 'exactInput',
      checks: { allowance: { token: SRC.usdc, spender: SRC.spokePool, actual: '0', expected: amount.toString() }, balance: { token: SRC.usdc, actual: '0', expected: amount.toString() } },
      approvalTxns: [{ chainId: SRC.chainId, to: SRC.usdc, data: SEL.approve + aw(SRC.spokePool) + 'f'.repeat(64) }],
      steps: { bridge: { inputAmount: amount.toString(), outputAmount: output.toString(), tokenIn: t(SRC.chainId, SRC.usdc), tokenOut: t(DST.chainId, DST.usdc),
        fees: { ...amt(capital + gas), details: { type: 'across', relayerCapital: amt(capital), destinationGas: amt(gas), lp: amt(0n) } }, provider: 'across' } },
      inputToken: t(SRC.chainId, SRC.usdc), outputToken: t(DST.chainId, DST.usdc), refundToken: t(SRC.chainId, SRC.usdc),
      fees: { total: amt(capital + gas) }, inputAmount: amount.toString(), maxInputAmount: amount.toString(), expectedOutputAmount: output.toString(),
      minOutputAmount: output.toString(), expectedFillTime: 2, swapTx: { ecosystem: 'evm', simulationSuccess: false, chainId: SRC.chainId, to: SRC.spokePool, data, gas: '0' },
      quoteExpiryTimestamp: time + 3_400, id: 'mock-' + randomBytes(6).toString('hex') };
  }
  function statusFor(sourceHash: string): Deposit | undefined { return deposits.find(d => d.sourceHash === sourceHash); }
  const http: RouterHttp = async url => {
    const u = new URL(url), q = u.searchParams;
    if (u.pathname.endsWith('/lifi/v1/quote')) return lifiQuote(q);
    if (u.pathname.endsWith('/across/api/swap/approval')) return acrossQuote(q);
    if (controls.hint === 'down') throw new Error('ROUTER_PROVIDER_HTTP_503');
    processFills();
    const lie = '0x' + 'ab'.repeat(32);
    if (u.pathname.endsWith('/across/api/deposit/status')) {
      counters.status.across++;
      const d = statusFor(q.get('depositTxnRef')!);
      if (!d) return { status: 'pending' };
      if (controls.hint === 'lying') return { status: 'filled', depositTxnRef: d.sourceHash, fillTxnRef: lie, originChainId: SRC.chainId, destinationChainId: DST.chainId };
      if (d.refunded) return { status: 'refunded', depositTxnRef: d.sourceHash, depositRefundTxnRef: d.refunded, originChainId: SRC.chainId, destinationChainId: DST.chainId };
      if (d.filled) return { status: 'filled', depositTxnRef: d.sourceHash, fillTxnRef: d.filled, originChainId: SRC.chainId, destinationChainId: DST.chainId };
      return { status: arbTime(arbHead()) > d.fillDeadline ? 'expired' : 'pending', depositTxnRef: d.sourceHash };
    }
    if (u.pathname.endsWith('/lifi/v1/status')) {
      counters.status.lifi++;
      const d = statusFor(q.get('txHash')!);
      if (!d) return { status: 'NOT_FOUND' };
      return d.filled ? { status: 'DONE', substatus: 'COMPLETED', sending: { txHash: d.sourceHash, chainId: SRC.chainId }, receiving: { txHash: d.filled, chainId: DST.chainId } }
        : { status: 'PENDING', substatus: 'WAIT_DESTINATION_TRANSACTION', sending: { txHash: d.sourceHash, chainId: SRC.chainId } };
    }
    throw new Error('ROUTER_PROVIDER_HTTP_404');
  };
  const providers = profile === MAINNET ? createRouteProviders({ http, lifiApi: ROUTER_MOCK_LIFI_API, acrossApi: ROUTER_MOCK_ACROSS_API })
    : createRouteProviders({ http, profile, lifiApi: ROUTER_TESTNET_MOCK.lifiApi, acrossApi: ROUTER_TESTNET_MOCK.acrossApi });
  return { owner, profile, codePins: routerMockCodePins(profile), clock, advance, wallet, relayer, controls, counters, providers, http, baseRpc, arbitrumRpc, state, arbUsdc,
    mined, baseHead, arbHead, nowMs };
}
export type RouterHarness = ReturnType<typeof createRouterHarness>;
