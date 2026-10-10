// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: a MOCKED loopback EVM chain for delegated-execution tests (unit, PostgreSQL and browser). Never a public network.
 *
 * It models exactly what the delegated path touches: ERC-20 balances/allowances of the public swap profile's USDC and WETH, a Uniswap-like
 * router and quoter at a fixed price, EIP-7702 designators of upgraded owner accounts, and the MetaMask Delegation Framework v1.3.0
 * `DelegationManager.redeemDelegations` — signature recovery over the EIP-712 digest, delegate/authority/disabled checks, and the
 * `erc7710` enforcer MODEL (not the bytecode) before and after the call — plus the owner's own `disableDelegation` self-call. A refused
 * redemption mines as a reverted transaction (status 0, no effect but the nonce), like the real manager. Evidence from it is MOCKED.
 */
import { erc7710 } from '@defi-workflow-engine/reference-compiler';
import { publicSwapProfile, type PublicSwapProfile } from '../../domain/public-testnet-swap.ts';

const D = erc7710, F = D.DELEGATION_FRAMEWORK_V1_3;
const TRANSFER = D.keccakHex('Transfer(address,address,uint256)'), APPROVAL = D.keccakHex('Approval(address,address,uint256)');
const BALANCE_OF = D.selectorOf('balanceOf(address)'), ALLOWANCE = D.selectorOf('allowance(address,address)'), DECIMALS = D.selectorOf('decimals()');
const QUOTE = '0xc6a5026a';
const word = (v: bigint) => '0x' + v.toString(16).padStart(64, '0');
const topic = (a: string) => '0x' + a.slice(2).padStart(64, '0');
const lower = (a: string) => a.toLowerCase();
type Receipt = { status: 0 | 1; logs: { address: string; topics: string[]; data: string }[]; blockNumber: number; from: string; to: string; reason: string | null };
type Tx = { hash: string; from: string; to: string; input: string; nonce: bigint; blockNumber: number };

export class EvmDoubleError extends Error {}
export type EvmDouble = ReturnType<typeof createEvmDouble>;
/** One MOCKED chain (the public swap profile of `chainId`). `clock` returns the block timestamp in seconds. */
export function createEvmDouble(chainId: number, clock: () => number = () => Math.floor(Date.now() / 1000)) {
  const profile: PublicSwapProfile = publicSwapProfile(chainId) ?? (() => { throw new EvmDoubleError('PROFILE_REQUIRED'); })();
  const balances = new Map<string, bigint>(), allowances = new Map<string, bigint>(), code = new Map<string, string>(), nonces = new Map<string, bigint>();
  const native = new Map<string, bigint>(), disabled = new Set<string>(), callCounts = new Map<string, bigint>();
  const receipts = new Map<string, Receipt>(), txs = new Map<string, Tx>();
  const pool = profile.pool;
  let block = 100, wethPerUsdc = 400_000_000_000_000n, dropNext = false, sends = 0;
  const key = (token: string, owner: string) => `${lower(token)}|${lower(owner)}`;
  const bal = (token: string, owner: string) => balances.get(key(token, owner)) ?? 0n;
  const setBal = (token: string, owner: string, v: bigint) => balances.set(key(token, owner), v);
  const allowanceKey = (token: string, owner: string, spender: string) => `${key(token, owner)}|${lower(spender)}`;
  const quote = (tokenIn: string, amountIn: bigint) => lower(tokenIn) === profile.usdc ? amountIn * wethPerUsdc / 1_000_000n : amountIn * 1_000_000n / wethPerUsdc;
  const fail = (reason: string): never => { throw new EvmDoubleError(reason); };

  /** Executes one call AS `account` (the owner's 7702 account), returning its logs. Throws (revert) on any failure. */
  function execute(account: string, call: erc7710.Call): Receipt['logs'] {
    if (call.value !== 0n) fail('VALUE_UNSUPPORTED');
    const method = call.data.slice(0, 10), target = lower(call.target);
    if (method === D.APPROVE_METHOD && [profile.usdc, profile.weth].includes(target)) {
      const [spender, amount] = D.abiDecode(['address', 'uint256'], D.bytesOf('0x' + call.data.slice(10))) as [string, bigint];
      allowances.set(allowanceKey(target, account, spender), amount);
      return [{ address: target, topics: [APPROVAL, topic(account), topic(spender)], data: word(amount) }];
    }
    if (method === D.EXACT_INPUT_SINGLE_METHOD && target === profile.router) {
      const [tokenIn, tokenOut, , recipient, amountIn, minOut] = D.abiDecode(['address', 'address', 'uint256', 'address', 'uint256', 'uint256', 'uint256'],
        D.bytesOf('0x' + call.data.slice(10))) as [string, string, bigint, string, bigint, bigint, bigint];
      const allowance = allowances.get(allowanceKey(tokenIn, account, profile.router)) ?? 0n;
      if (allowance < amountIn) fail('STF');
      if (bal(tokenIn, account) < amountIn) fail('STF');
      const out = quote(tokenIn, amountIn);
      if (out < minOut) fail('Too little received');
      allowances.set(allowanceKey(tokenIn, account, profile.router), allowance - amountIn);
      setBal(tokenIn, account, bal(tokenIn, account) - amountIn); setBal(tokenIn, pool, bal(tokenIn, pool) + amountIn);
      setBal(tokenOut, pool, bal(tokenOut, pool) - out); setBal(tokenOut, recipient, bal(tokenOut, recipient) + out);
      return [{ address: lower(tokenIn), topics: [TRANSFER, topic(account), topic(pool)], data: word(amountIn) },
        { address: lower(tokenOut), topics: [TRANSFER, topic(pool), topic(recipient)], data: word(out) }];
    }
    return fail('CALL_NOT_MODELED');
  }
  /** `DelegationManager.redeemDelegations` for single-call, depth-1 contexts (what FloFi's executor sends). */
  function redeem(sender: string, data: string): Receipt['logs'] {
    const r = D.decodeRedeemCalldata(data), logs: Receipt['logs'] = [];
    // Snapshot for atomicity: any failure reverts every effect of this transaction.
    const snapshot = { balances: new Map(balances), allowances: new Map(allowances), callCounts: new Map(callCounts) };
    try {
      r.contexts.forEach((context, i) => {
        const chain = D.decodePermissionContext(context);
        if (chain.length !== 1) fail('DEPTH_NOT_MODELED');
        const d = chain[0]!, hash = D.delegationHash(d);
        if (lower(d.delegate) !== lower(sender) && lower(d.delegate) !== '0x0000000000000000000000000000000000000a11') fail('InvalidDelegate');
        if (code.get(lower(d.delegator)) !== D.DELEGATOR_DESIGNATOR) fail('DELEGATOR_NOT_UPGRADED');
        let signer: string;
        try { signer = D.recoverDigestSigner(D.delegationDigest(chainId, d), d.signature); } catch { return fail('InvalidERC1271Signature'); }
        if (signer !== lower(d.delegator)) fail('InvalidERC1271Signature');
        if (disabled.has(hash)) fail('CannotUseADisabledDelegation');
        if (d.authority !== D.ROOT_AUTHORITY) fail('InvalidAuthority');
        if (r.modes[i] !== D.MODE_SINGLE_DEFAULT) fail('MODE_NOT_MODELED');
        const call = D.decodeSingleExecution(r.executions[i]!);
        const verdict = D.modelBeforeHooks(d, { redeemer: sender, call, blockTimestamp: BigInt(clock()), delegationHash: hash, callCount: callCounts.get(hash) ?? 0n });
        if (!verdict.ok) throw new EvmDoubleError(verdict.code);
        const before = verdict.balanceRules.map(rule => bal(rule.token, rule.recipient));
        if (verdict.countsCall) callCounts.set(hash, (callCounts.get(hash) ?? 0n) + 1n);
        logs.push(...execute(lower(d.delegator), call));
        verdict.balanceRules.forEach((rule, k) => { const after = D.modelAfterHook(rule, before[k]!, bal(rule.token, rule.recipient)); if (!after.ok) fail(after.code); });
        logs.push({ address: F.delegationManager, topics: [D.REDEEMED_DELEGATION_TOPIC, topic(lower(d.delegator)), topic(lower(sender))], data: '0x' });
      });
      return logs;
    } catch (cause) {
      balances.clear(); snapshot.balances.forEach((v, k) => balances.set(k, v));
      allowances.clear(); snapshot.allowances.forEach((v, k) => allowances.set(k, v));
      callCounts.clear(); snapshot.callCounts.forEach((v, k) => callCounts.set(k, v));
      throw cause;
    }
  }
  function mine(hash: string, from: string, to: string, input: string, nonce: bigint, run: () => Receipt['logs']): string {
    block += 1;
    let receipt: Receipt;
    try { receipt = { status: 1, logs: run(), blockNumber: block, from, to, reason: null }; }
    catch (cause) { receipt = { status: 0, logs: [], blockNumber: block, from, to, reason: cause instanceof Error ? cause.message : 'REVERT' }; }
    receipts.set(hash, receipt); txs.set(hash, { hash, from, to, input, nonce, blockNumber: block });
    return hash;
  }
  const blockOf = (n: number) => ({ number: '0x' + n.toString(16), hash: word(BigInt(n) + 0xb10c0000n), timestamp: '0x' + clock().toString(16), transactions: [...txs.values()]
    .filter(t => t.blockNumber === n).map(t => t.hash) });

  const rpc = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    const p = params as unknown[];
    switch (method) {
      case 'eth_chainId': return '0x' + chainId.toString(16);
      case 'eth_blockNumber': return '0x' + block.toString(16);
      case 'eth_gasPrice': return '0x3b9aca00';
      case 'eth_maxPriorityFeePerGas': return '0x5f5e100';
      case 'eth_estimateGas': return '0x61a80';
      case 'eth_getBlockByNumber': return blockOf(p[0] === 'latest' || p[0] === 'pending' ? block : Number(BigInt(String(p[0]))));
      case 'eth_getCode': return code.get(lower(String(p[0]))) ?? ([profile.usdc, profile.weth, profile.router, profile.quoter, F.delegationManager, ...Object.values(F.enforcers)]
        .includes(lower(String(p[0]))) ? '0x6080' : '0x');
      case 'eth_getBalance': return '0x' + (native.get(lower(String(p[0]))) ?? 0n).toString(16);
      case 'eth_getTransactionCount': return '0x' + (nonces.get(lower(String(p[0]))) ?? 0n).toString(16);
      case 'eth_getTransactionReceipt': {
        const r = receipts.get(String(p[0])), t = txs.get(String(p[0]));
        return r && t ? { transactionHash: t.hash, status: r.status ? '0x1' : '0x0', blockNumber: '0x' + r.blockNumber.toString(16), blockHash: blockOf(r.blockNumber).hash,
          from: r.from, to: r.to, gasUsed: '0x30d40', effectiveGasPrice: '0x3b9aca00', l1Fee: '0x0', logs: r.logs } : null;
      }
      case 'eth_getTransactionByHash': {
        const t = txs.get(String(p[0]));
        return t ? { hash: t.hash, from: t.from, to: t.to, input: t.input, nonce: '0x' + t.nonce.toString(16), value: '0x0', type: '0x2', chainId: '0x' + chainId.toString(16),
          blockNumber: '0x' + t.blockNumber.toString(16), blockHash: blockOf(t.blockNumber).hash } : null;
      }
      case 'eth_call': {
        const call = p[0] as { to: string; data: string }, to = lower(call.to), selector = call.data.slice(0, 10);
        if (to === F.delegationManager && selector === D.DISABLED_DELEGATIONS_SELECTOR) return word(disabled.has('0x' + call.data.slice(10)) ? 1n : 0n);
        if ([profile.usdc, profile.weth].includes(to) && selector === BALANCE_OF) return word(bal(to, '0x' + call.data.slice(34, 74)));
        if ([profile.usdc, profile.weth].includes(to) && selector === ALLOWANCE) return word(allowances.get(allowanceKey(to, '0x' + call.data.slice(34, 74), '0x' + call.data.slice(98, 138))) ?? 0n);
        if ([profile.usdc, profile.weth].includes(to) && selector === DECIMALS) return word(to === profile.usdc ? 6n : 18n);
        if (to === profile.quoter && selector === QUOTE) return word(quote('0x' + call.data.slice(34, 74), BigInt('0x' + call.data.slice(138, 202)))) + '0'.repeat(192);
        return fail('CALL_NOT_MODELED');
      }
      case 'eth_sendRawTransaction': {
        const signed = D.decodeSignedEip1559(String(p[0]));
        if (signed.tx.chainId !== BigInt(chainId)) fail('WRONG_CHAIN');
        if (txs.has(signed.hash)) return signed.hash; // a re-broadcast of the same bytes is idempotent
        const expected = nonces.get(signed.from) ?? 0n;
        if (signed.tx.nonce < expected) fail('nonce too low');
        if (signed.tx.nonce > expected) fail('nonce too high');
        if (dropNext) { dropNext = false; return signed.hash; } // accepted by the node, then lost: never mined
        sends += 1;
        nonces.set(signed.from, expected + 1n);
        native.set(signed.from, (native.get(signed.from) ?? 0n) - 200_000n * 1_000_000_000n);
        return mine(signed.hash, signed.from, lower(signed.tx.to), signed.tx.data, signed.tx.nonce, () => {
          if (lower(signed.tx.to) !== F.delegationManager || !signed.tx.data.startsWith(D.REDEEM_DELEGATIONS_SELECTOR)) fail('CALL_NOT_MODELED');
          return redeem(signed.from, signed.tx.data);
        });
      }
      default: return fail('METHOD_NOT_MODELED');
    }
  };
  /** Test and harness controls (never reachable through the product's RPC allowlist). */
  const control = {
    fund(owner: string, token: 'USDC' | 'WETH', amount: bigint) { setBal(token === 'USDC' ? profile.usdc : profile.weth, lower(owner), amount); },
    fundNative(account: string, wei: bigint) { native.set(lower(account), wei); },
    /** The owner's wallet upgraded its EOA to the MetaMask EIP-7702 stateless delegator (FloFi never does this). */
    upgrade(owner: string) { code.set(lower(owner), D.DELEGATOR_DESIGNATOR); },
    downgrade(owner: string) { code.delete(lower(owner)); },
    /** The owner's own `disableDelegation` self-call (sent by the owner's wallet). */
    ownerSend(from: string, to: string, data: string): string {
      const owner = lower(from), n = nonces.get(owner) ?? 0n;
      nonces.set(owner, n + 1n);
      const hash = D.keccakHex(`${owner}:${n}:${data}`);
      return mine(hash, owner, lower(to), data, n, () => {
        if (owner !== lower(to) || code.get(owner) !== D.DELEGATOR_DESIGNATOR) fail('NotEntryPointOrSelf');
        const d = D.decodeDisableDelegationCalldata(data);
        if (lower(d.delegator) !== owner) fail('InvalidDelegator');
        const hash2 = D.delegationHash(d);
        if (disabled.has(hash2)) fail('AlreadyDisabled');
        disabled.add(hash2);
        return [{ address: F.delegationManager, topics: [D.DISABLED_DELEGATION_TOPIC, hash2, topic(owner), topic(lower(d.delegate))], data: '0x' }];
      });
    },
    disableExternally(hash: string) { disabled.add(lower(hash)); },
    setPrice(wethPerUsdcUnits: bigint) { wethPerUsdc = wethPerUsdcUnits; },
    dropNextSubmission() { dropNext = true; },
    balance: (token: 'USDC' | 'WETH', owner: string) => bal(token === 'USDC' ? profile.usdc : profile.weth, lower(owner)),
    callCount: (hash: string) => callCounts.get(lower(hash)) ?? 0n,
    receipt: (hash: string) => receipts.get(hash) ?? null,
    sends: () => sends,
    profile,
  };
  setBal(profile.usdc, pool, 10n ** 15n); setBal(profile.weth, pool, 10n ** 24n);
  return { rpc, control };
}
