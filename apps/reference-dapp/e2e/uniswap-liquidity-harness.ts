// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MOCKED in-process Base Sepolia chain with a Uniswap v3 USDC/WETH 0.05% pool, Position Manager and two ERC-20s, for
 * the liquidity unit, PostgreSQL and loopback browser suites. No network. Read methods answer exactly the calls the
 * service makes; the only transaction path is `wallet.send` — the owner's browser wallet in a real deployment.
 * Every block keeps a state snapshot so historical reads (receipt block and parent) behave like an archive node.
 */
import { UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY as profile } from '@defi-workflow-engine/action-registry';
import { UNI_MOCK_CODE, UNI_MOCK_CODE_PINS } from '../src/server/uniswap-liquidity-mock.ts';
import { UNISWAP_SELECTORS as SEL, UNISWAP_TOPICS as TOPIC, decodeUniswapApprove, decodeUniswapMint, sqrtRatioAtTick, uniswapComposition } from '@defi-workflow-engine/reference-compiler';

export const UNI_OWNER = '0x5555555555555555555555555555555555555555';
const t0 = profile.token0.address, t1 = profile.token1.address, NPM = profile.positionManager, POOL = profile.pool;
const CODE = UNI_MOCK_CODE;
export { UNI_MOCK_CODE_PINS };

type Snapshot = { balances: Record<string, Record<string, bigint>>; allowances: Record<string, bigint>; native: Record<string, bigint>; nonces: Record<string, bigint>;
  owners: Record<string, string>; positions: Record<string, { liquidity: bigint; tickLower: number; tickUpper: number }>; sqrtPriceX96: bigint; tick: number };
type Inner = { readonly to: string; readonly input: string };
type MinedTx = { hash: string; from: string; to: string; input: string; nonce: bigint; block: number; status: 0 | 1; logs: unknown[]; gasUsed: bigint; inner?: Inner };
/** MetaMask Delegation Framework v1.3.0 on Base Sepolia, as observed in 0x8248b684…5ccc. */
export const UNI_DELEGATION_MANAGER = '0xdb9b1e94b5b69df7e401ddbede43491141047db3';
export const UNI_DELEGATOR_IMPL = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
export const UNI_RELAYER = '0xc066ac5d385419b1a8c43a0e146fa439837a8b8c';
const REDEEMED_TOPIC = '0x40dadaa36c6c2e3d7317e24757451ffb2d603d875f0ad5e92c5dd156573b1873';
/**
 * redeemDelegations([context], [mode 0], [encodeSingle(target, 0, data)]) — the exact single-redemption layout MetaMask
 * sends (verified byte-identical against the real Base Sepolia transaction in owner-submission.test.ts).
 */
export function encodeSingleRedemption(context: string, target: string, data: string): string {
  const word = (n: bigint) => n.toString(16).padStart(64, '0');
  const pad = (hex: string) => hex + '0'.repeat((64 - (hex.length % 64)) % 64);
  const bytesArray = (hex: string) => word(1n) + word(32n) + word(BigInt(hex.length / 2)) + pad(hex);
  const contexts = bytesArray(context.slice(2)), modeOffset = 96 + contexts.length / 2;
  return '0xcef6d209' + word(96n) + word(BigInt(modeOffset)) + word(BigInt(modeOffset + 64)) + contexts + word(1n) + word(0n) +
    bytesArray(target.slice(2) + word(0n) + data.slice(2));
}
const w = (n: bigint) => (n & ((1n << 256n) - 1n)).toString(16).padStart(64, '0');
const aw = (a: string) => a.slice(2).padStart(64, '0');
const hx = (n: number | bigint) => '0x' + n.toString(16);
const clone = (s: Snapshot): Snapshot => structuredClone(s);

export function createUniswapLiquidityChain(options: { owner?: string; usdc?: bigint; weth?: bigint; eth?: bigint; tick?: number; nonce?: bigint; simulateV1?: boolean;
  /** The owner's EOA is already EIP-7702-delegated to the MetaMask delegator (code `0xef0100‖impl`). */ delegatedOwner?: boolean } = {}) {
  const owner = options.owner ?? UNI_OWNER;
  const tick = options.tick ?? 225_600;
  let head = 1_000;
  let timestamp = Math.floor(Date.now() / 1000);
  const state: Snapshot = { balances: { [t0]: { [owner]: options.usdc ?? 50_000_000n, [POOL]: 210_000_000n }, [t1]: { [owner]: options.weth ?? 10n ** 17n, [POOL]: 10n ** 18n } },
    allowances: {}, native: { [owner]: options.eth ?? 10n ** 17n }, nonces: { [owner]: options.nonce ?? 7n }, owners: {}, positions: {},
    sqrtPriceX96: sqrtRatioAtTick(tick) + 123_456_789n, tick };
  const history = new Map<number, Snapshot>([[head, clone(state)]]);
  const mined = new Map<string, MinedTx>(), blocks = new Map<number, string[]>();
  const pendingTxs: { hash: string; from: string; to: string; input: string; nonce: bigint; inner?: Inner }[] = [];
  let nextTokenId = 9_001n, hashSeq = 0;
  const gasPrice = 1_000_000n, baseFee = 500_000n;
  const counters = { simulate: 0, sends: 0 };
  const allowanceKey = (token: string, from: string, spender: string) => `${token}:${from}:${spender}`;
  const at = (blockTag: unknown): Snapshot => {
    if (blockTag === 'latest' || blockTag === 'pending' || blockTag === undefined) return state;
    const n = Number(BigInt(blockTag as string));
    if (n >= head) return state;
    for (let b = n; b >= 1_000; b--) { const s = history.get(b); if (s) return s; }
    throw new Error('MOCK_MISSING_TRIE_NODE');
  };
  /** One contract call against a snapshot; mutating calls change `s` (used for simulation and execution). */
  function execute(s: Snapshot, from: string, to: string, data: string, time: number): { ok: boolean; ret: string; logs: unknown[]; gas: bigint } {
    const sel = data.slice(0, 10), log = (address: string, topics: string[], body: string) => ({ address, topics, data: '0x' + body });
    if ((to === t0 || to === t1) && sel === SEL.approve) {
      const { spender, amount } = decodeUniswapApprove(data);
      s.allowances[allowanceKey(to, from, spender)] = amount;
      return { ok: true, ret: '0x' + w(1n), logs: [log(to, [TOPIC.approval, '0x' + aw(from), '0x' + aw(spender)], w(amount))], gas: 46_000n };
    }
    if (to === NPM && sel === SEL.mint) {
      const p = decodeUniswapMint(data);
      if (BigInt(time) > p.deadline || p.token0 !== t0 || p.token1 !== t1 || p.fee !== 500) return { ok: false, ret: '0x', logs: [], gas: 30_000n };
      let c;
      try { c = uniswapComposition(s.sqrtPriceX96, s.tick, p.tickLower, p.tickUpper, p.amount0Desired, p.amount1Desired); } catch { return { ok: false, ret: '0x', logs: [], gas: 30_000n }; }
      if (c.amount0 < p.amount0Min || c.amount1 < p.amount1Min) return { ok: false, ret: '0x', logs: [], gas: 60_000n };
      for (const [token, amount] of [[t0, c.amount0], [t1, c.amount1]] as const) {
        if (amount === 0n) continue;
        const key = allowanceKey(token, from, NPM);
        if ((s.allowances[key] ?? 0n) < amount || (s.balances[token]![from] ?? 0n) < amount) return { ok: false, ret: '0x', logs: [], gas: 80_000n };
      }
      const logs: unknown[] = [];
      for (const [token, amount] of [[t0, c.amount0], [t1, c.amount1]] as const) {
        if (amount === 0n) continue;
        s.allowances[allowanceKey(token, from, NPM)]! -= amount;
        s.balances[token]![from]! -= amount; s.balances[token]![POOL] = (s.balances[token]![POOL] ?? 0n) + amount;
      }
      const tokenId = nextTokenId++;
      s.owners[tokenId.toString()] = p.recipient;
      s.positions[tokenId.toString()] = { liquidity: c.liquidity, tickLower: p.tickLower, tickUpper: p.tickUpper };
      logs.push(log(POOL, [TOPIC.poolMint, '0x' + aw(NPM), '0x' + w(BigInt(p.tickLower)), '0x' + w(BigInt(p.tickUpper))], aw(NPM) + w(c.liquidity) + w(c.amount0) + w(c.amount1)));
      if (c.amount0 > 0n) logs.push(log(t0, [TOPIC.transfer, '0x' + aw(from), '0x' + aw(POOL)], w(c.amount0)));
      if (c.amount1 > 0n) logs.push(log(t1, [TOPIC.transfer, '0x' + aw(from), '0x' + aw(POOL)], w(c.amount1)));
      logs.push(log(NPM, [TOPIC.transfer, '0x' + w(0n), '0x' + aw(p.recipient), '0x' + w(tokenId)], ''));
      logs.push(log(NPM, [TOPIC.increaseLiquidity, '0x' + w(tokenId)], w(c.liquidity) + w(c.amount0) + w(c.amount1)));
      return { ok: true, ret: '0x' + w(tokenId) + w(c.liquidity) + w(c.amount0) + w(c.amount1), logs, gas: 480_000n };
    }
    return { ok: false, ret: '0x', logs: [], gas: 21_000n };
  }
  function read(s: Snapshot, to: string, data: string): string {
    const sel = data.slice(0, 10), arg = (i: number) => '0x' + data.slice(10 + i * 64 + 24, 10 + (i + 1) * 64);
    if (to === NPM && sel === SEL.factory) return '0x' + aw(profile.factory);
    if (to === NPM && sel === SEL.weth9) return '0x' + aw(t1);
    if (to === profile.factory && sel === SEL.getPool) return '0x' + aw(arg(0) === t0 && arg(1) === t1 ? POOL : '0x' + '0'.repeat(40));
    if (to === POOL && sel === SEL.token0) return '0x' + aw(t0);
    if (to === POOL && sel === SEL.token1) return '0x' + aw(t1);
    if (to === POOL && sel === SEL.fee) return '0x' + w(500n);
    if (to === POOL && sel === SEL.tickSpacing) return '0x' + w(10n);
    if (to === POOL && sel === SEL.liquidity) return '0x' + w(448_000_000_000n);
    if (to === POOL && sel === SEL.slot0) return '0x' + w(s.sqrtPriceX96) + w(BigInt(s.tick)) + w(1n) + w(1n) + w(1n) + w(0n) + w(1n);
    if ((to === t0 || to === t1) && sel === SEL.decimals) return '0x' + w(to === t0 ? 6n : 18n);
    if ((to === t0 || to === t1) && sel === SEL.balanceOf) return '0x' + w(s.balances[to]![arg(0)] ?? 0n);
    if ((to === t0 || to === t1) && sel === SEL.allowance) return '0x' + w(s.allowances[allowanceKey(to, arg(0), arg(1))] ?? 0n);
    if (to === NPM && sel === SEL.balanceOf) return '0x' + w(BigInt(Object.values(s.owners).filter(o => o === arg(0)).length));
    if (to === NPM && sel === SEL.ownerOf) { const id = BigInt('0x' + data.slice(10)).toString(); if (!s.owners[id]) throw new Error('MOCK_REVERT'); return '0x' + aw(s.owners[id]!); }
    if (to === NPM && sel === SEL.positions) {
      const p = s.positions[BigInt('0x' + data.slice(10)).toString()];
      if (!p) throw new Error('MOCK_REVERT');
      return '0x' + w(0n) + w(0n) + aw(t0) + aw(t1) + w(500n) + w(BigInt(p.tickLower)) + w(BigInt(p.tickUpper)) + w(p.liquidity) + w(0n) + w(0n) + w(0n) + w(0n);
    }
    if (to === profile.gasPriceOracle && sel === SEL.l1FeeUpperBound) return '0x' + w(3_000_000_000n);
    throw new Error('MOCK_UNEXPECTED_CALL_' + to + '_' + sel);
  }
  const blockOf = (n: number, full: boolean) => ({ number: hx(n), hash: '0x' + n.toString(16).padStart(64, 'b'), timestamp: hx(n === head ? timestamp : timestamp - (head - n) * 2),
    baseFeePerGas: hx(baseFee), transactions: full ? (blocks.get(n) ?? []).map(h => txView(mined.get(h)!)) : blocks.get(n) ?? [] });
  const txView = (tx: MinedTx | (typeof pendingTxs)[number]) => ({ hash: tx.hash, from: tx.from, to: tx.to, input: tx.input, nonce: hx(tx.nonce), value: '0x0',
    chainId: profile.chainHex, type: '0x2', blockNumber: 'block' in tx ? hx(tx.block) : null });
  function mine(txs: (typeof pendingTxs)[number][], options: { revert?: boolean } = {}) {
    head += 1; timestamp += 2;
    const hashes: string[] = [];
    for (const tx of txs) {
      // A delegated redemption executes the inner call as the owner; the relayer pays gas and consumes its own nonce.
      const result = options.revert ? { ok: false, ret: '0x', logs: [], gas: 50_000n } : tx.inner
        ? (() => { const r = execute(state, owner, tx.inner!.to, tx.inner!.input, timestamp);
          return r.ok ? { ...r, logs: [...r.logs, { address: UNI_DELEGATION_MANAGER, topics: [REDEEMED_TOPIC, '0x' + aw(owner), '0x' + aw(tx.from)], data: '0x' + w(32n) }] } : r; })()
        : execute(state, tx.from, tx.to, tx.input, timestamp);
      state.nonces[tx.from] = (state.nonces[tx.from] ?? 0n) + 1n;
      state.native[tx.from] = (state.native[tx.from] ?? 0n) - result.gas * gasPrice;
      const logs = result.ok ? result.logs.map((l, i) => ({ ...(l as object), logIndex: hx(i) })) : [];
      mined.set(tx.hash, { ...tx, block: head, status: result.ok ? 1 : 0, logs, gasUsed: result.gas });
      hashes.push(tx.hash);
    }
    blocks.set(head, hashes);
    history.set(head, clone(state));
  }
  const rpc = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    if (['eth_sendTransaction', 'eth_sendRawTransaction', 'sendTransaction'].includes(method)) throw new Error('MOCK_SEND_FORBIDDEN_USE_WALLET');
    switch (method) {
      case 'eth_chainId': return profile.chainHex;
      case 'eth_blockNumber': return hx(head);
      case 'eth_getBlockByNumber': { const n = params[0] === 'latest' ? head : Number(BigInt(params[0] as string)); return n > head ? null : blockOf(n, params[1] === true); }
      case 'eth_getCode': {
        const s = (params[0] as string).toLowerCase();
        if (s === UNI_DELEGATION_MANAGER) return '0x60076007';
        if (s === owner && options.delegatedOwner) return '0xef0100' + UNI_DELEGATOR_IMPL.slice(2);
        return CODE[s] ?? '0x';
      }
      case 'eth_getBalance': return hx(at(params[1]).native[(params[0] as string).toLowerCase()] ?? 0n);
      case 'eth_getTransactionCount': {
        const who = (params[0] as string).toLowerCase(), base = at(params[1]).nonces[who] ?? 0n;
        return hx(params[1] === 'pending' ? base + BigInt(pendingTxs.filter(p => p.from === who).length) : base);
      }
      case 'eth_maxPriorityFeePerGas': return hx(gasPrice - baseFee);
      case 'eth_call': { const r = params[0] as { to: string; data: string }; return read(at(params[1]), r.to.toLowerCase(), r.data.toLowerCase()); }
      case 'eth_simulateV1': {
        if (options.simulateV1 === false) throw new Error('MOCK_METHOD_NOT_FOUND');
        counters.simulate += 1;
        const spec = params[0] as { blockStateCalls: { calls: { from: string; to: string; data: string }[] }[] };
        const s = clone(at(params[1]));
        return [{ number: hx(head + 1), calls: spec.blockStateCalls[0]!.calls.map(c => {
          const r = execute(s, c.from.toLowerCase(), c.to.toLowerCase(), c.data.toLowerCase(), timestamp + 2);
          return { status: r.ok ? '0x1' : '0x0', returnData: r.ret, gasUsed: hx(r.gas), logs: r.logs };
        }) }];
      }
      case 'eth_getTransactionReceipt': {
        const tx = mined.get(params[0] as string);
        return tx ? { transactionHash: tx.hash, status: hx(tx.status), blockNumber: hx(tx.block), blockHash: blockOf(tx.block, false).hash, from: tx.from, to: tx.to,
          gasUsed: hx(tx.gasUsed), effectiveGasPrice: hx(gasPrice), l1Fee: hx(1_000_000_000n), logs: tx.logs } : null;
      }
      case 'eth_getTransactionByHash': { const tx = mined.get(params[0] as string) ?? pendingTxs.find(p => p.hash === params[0]); return tx ? txView(tx) : null; }
    }
    throw new Error('MOCK_UNEXPECTED_RPC_' + method);
  };
  const newHash = () => '0x' + (++hashSeq).toString(16).padStart(64, 'e');
  /** The owner's browser wallet: the ONLY place a transaction is sent. */
  const wallet = {
    send(tx: { from: string; to: string; data: string; chainId: string }, mode: { hold?: boolean; revert?: boolean } = {}): string {
      if (tx.from !== owner || tx.chainId !== profile.chainHex) throw new Error('MOCK_WRONG_SIGNER');
      counters.sends += 1;
      const queued = { hash: newHash(), from: owner, to: tx.to.toLowerCase(), input: tx.data.toLowerCase(), nonce: (state.nonces[owner] ?? 0n) + BigInt(pendingTxs.length) };
      if (mode.hold) { pendingTxs.push(queued); return queued.hash; }
      mine([queued], mode); return queued.hash;
    },
    /** The same wallet request fulfilled by MetaMask as a relayed type-2, depth-1 redemption (owner nonce unchanged). */
    sendDelegated(tx: { from: string; to: string; data: string; chainId: string }, mode: { hold?: boolean } = {}): string {
      if (tx.from !== owner || tx.chainId !== profile.chainHex || !options.delegatedOwner) throw new Error('MOCK_WRONG_SIGNER');
      counters.sends += 1;
      const inner = { to: tx.to.toLowerCase(), input: tx.data.toLowerCase() };
      const queued = { hash: newHash(), from: UNI_RELAYER, to: UNI_DELEGATION_MANAGER, input: encodeSingleRedemption('0x' + 'ab'.repeat(96), inner.to, inner.input),
        nonce: (state.nonces[UNI_RELAYER] ?? 0n) + BigInt(pendingTxs.filter(p => p.from === UNI_RELAYER).length), inner };
      if (mode.hold) { pendingTxs.push(queued); return queued.hash; }
      mine([queued]); return queued.hash;
    },
    /** Mine every held transaction (optionally replacing one by a same-call speed-up or a cancellation). */
    release(change?: { kind: 'SPEED_UP' | 'CANCEL'; hash: string }): string | null {
      let replacement: string | null = null;
      const txs = pendingTxs.splice(0).map(p => {
        if (change?.hash !== p.hash) return p;
        replacement = newHash();
        return change.kind === 'SPEED_UP' ? { ...p, hash: replacement } : { ...p, hash: replacement, to: owner, input: '0x' };
      });
      mine(txs); return replacement;
    },
  };
  return { rpc, wallet, owner, counters, mined,
    /** Wall clock aligned with the chain head (the service rejects stale or future heads). */
    clock: () => new Date(timestamp * 1000 + 1_000),
    /** Another market participant moves the pool price (a swap): `ticks` up or down. */
    movePrice(ticks: number) { state.tick += ticks; state.sqrtPriceX96 = sqrtRatioAtTick(state.tick) + 1n; head += 1; timestamp += 2; history.set(head, clone(state)); },
    advance(seconds: number) { const blocksAhead = Math.max(1, Math.floor(seconds / 2)); head += blocksAhead; timestamp += seconds; history.set(head, clone(state)); },
    /** The owner approves outside Flofi. */
    externalAllowance(token: 'token0' | 'token1', amount: bigint) { state.allowances[allowanceKey(token === 'token0' ? t0 : t1, owner, NPM)] = amount; history.set(head, clone(state)); },
    get snapshot() { return state; } };
}
export type UniswapLiquidityChain = ReturnType<typeof createUniswapLiquidityChain>;
