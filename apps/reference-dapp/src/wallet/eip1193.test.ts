// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { buildModeAPair, encodeUnsignedPayload, decodeUnsignedPayload, encodeApprove, payloadIdentity, toHex } from '@defi-workflow-engine/reference-compiler';
import { decodePayloadView, walletRequestFor } from '../server/mode-a-service';
import {
  browserPayloadHash, connectWallet, decodeReviewedPayload, requestExactTransaction, requestFromBytes, verifyReviewedPayload,
  type Eip1193Provider, type ReviewedPayload,
} from './eip1193';

const OWNER = '0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b';
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const ROUTER = '0x2626664c2603336e57b271c5c0b26f421741e481';
function pair(tokenIn = WETH, tokenOut = USDC) {
  return buildModeAPair({ owner: OWNER, tokenIn, tokenOut, amountIn: 10n ** 18n, amountOutMinimum: 2_400_000_000n, fee: 500,
    deadline: 1_790_000_180n, nonce: 7n, approveGasLimit: 57_294n, swapGasLimit: 150_001n, maxFeePerGas: 1_796_246_614n });
}
function view(stepId: string, bytes: Uint8Array): ReviewedPayload {
  return { stepId, bytes: toHex(bytes), payloadHash: payloadIdentity(bytes).payloadHash,
    decoded: decodePayloadView(bytes), request: walletRequestFor(bytes, OWNER) };
}
function provider(replies: Record<string, unknown | Error>): Eip1193Provider & { calls: string[] } {
  const calls: string[] = [];
  return { calls, request: async ({ method }) => {
    calls.push(method);
    const reply = replies[method];
    if (reply instanceof Error) throw reply;
    if (reply === undefined) throw Object.assign(new Error('unsupported'), { code: 4200 });
    return reply;
  } };
}

describe('browser-side independent payload verification', () => {
  it('decodes both directions exactly like the server and recomputes the frozen payload hash', async () => {
    for (const [tokenIn, tokenOut] of [[WETH, USDC], [USDC, WETH]] as const) {
      const { approveBytes, swapBytes } = pair(tokenIn, tokenOut);
      for (const bytes of [approveBytes, swapBytes]) {
        expect(decodeReviewedPayload(toHex(bytes))).toEqual(decodePayloadView(bytes));
        expect(await browserPayloadHash(bytes)).toBe(payloadIdentity(bytes).payloadHash);
        expect(requestFromBytes(toHex(bytes), OWNER)).toEqual(walletRequestFor(bytes, OWNER));
      }
      const verified = await verifyReviewedPayload(view('step-swap', swapBytes), OWNER, { tokenIn, owner: OWNER });
      expect(verified.decoded.swap).toMatchObject({ tokenIn, tokenOut, recipient: OWNER, amountOutMinimum: '2400000000' });
    }
  });

  it('blocks a changed hash, byte, decoded field or request field before the wallet', async () => {
    const { approveBytes, swapBytes } = pair();
    const reviewed = view('step-swap', swapBytes);
    const expected = { tokenIn: WETH, owner: OWNER };
    await expect(verifyReviewedPayload({ ...reviewed, payloadHash: `0x${'00'.repeat(32)}` }, OWNER, expected)).rejects.toThrow(/^BROWSER_PAYLOAD_HASH_MISMATCH$/);
    await expect(verifyReviewedPayload({ ...reviewed, bytes: toHex(pair(WETH, USDC).approveBytes) }, OWNER, expected)).rejects.toThrow(/^BROWSER_PAYLOAD_HASH_MISMATCH$/);
    await expect(verifyReviewedPayload({ ...reviewed, decoded: { ...reviewed.decoded, gasLimit: '1' } }, OWNER, expected)).rejects.toThrow(/^BROWSER_DECODE_MISMATCH$/);
    await expect(verifyReviewedPayload({ ...reviewed, request: { ...reviewed.request, gas: '0x1' } }, OWNER, expected)).rejects.toThrow(/^BROWSER_DECODE_MISMATCH$/);
    // A consistent server response for an unknown spender or a foreign recipient is still refused.
    const spender = encodeUnsignedPayload({ ...decodeUnsignedPayload(approveBytes), data: encodeApprove(`0x${'de'.repeat(20)}`, 10n ** 18n) });
    await expect(verifyReviewedPayload(view('step-approve', spender), OWNER, expected)).rejects.toThrow(/^BROWSER_UNKNOWN_SPENDER$/);
    await expect(verifyReviewedPayload(reviewed, OWNER, { tokenIn: WETH, owner: `0x${'11'.repeat(20)}` })).rejects.toThrow(/^BROWSER_RECIPIENT_NOT_OWNER$/);
  });

  it('refuses noncanonical, wrong-chain, valued, access-listed and unknown-function payloads', () => {
    const { approveBytes } = pair();
    const payload = decodeUnsignedPayload(approveBytes);
    const hex = toHex(approveBytes);
    expect(() => decodeReviewedPayload(`0x01${hex.slice(4)}`)).toThrow(/^BROWSER_PAYLOAD_TYPE_INVALID$/);
    expect(() => decodeReviewedPayload(`${hex}00`)).toThrow(/^BROWSER_RLP_INVALID$/);
    expect(() => decodeReviewedPayload(hex.replace('827a69', '822105'))).toThrow(/^BROWSER_PAYLOAD_PROFILE_INVALID$/);
    const unknown = encodeUnsignedPayload({ ...payload, data: Uint8Array.of(0xa9, 0x05, 0x9c, 0xbb, ...new Uint8Array(64)) });
    expect(() => decodeReviewedPayload(toHex(unknown))).toThrow(/^BROWSER_UNKNOWN_FUNCTION$/);
    expect(() => decodeReviewedPayload('0x02zz')).toThrow(/^BROWSER_HEX_INVALID$/);
  });
});

describe('strict injected wallet boundary', () => {
  it('accepts only chain 31337 and the single reviewed account, and never asks the wallet to switch', async () => {
    const good = provider({ eth_chainId: '0x7a69', eth_requestAccounts: [OWNER.toUpperCase().replace('0X', '0x')] });
    await expect(connectWallet(good, OWNER)).resolves.toMatchObject({ account: OWNER, chainId: '0x7a69' });
    for (const [replies, code] of [
      [{ eth_chainId: '0x2105', eth_requestAccounts: [OWNER] }, /^WALLET_WRONG_CHAIN$/],
      [{ eth_chainId: '0x1', eth_requestAccounts: [OWNER] }, /^WALLET_WRONG_CHAIN$/],
      [{ eth_chainId: '0x7a69', eth_requestAccounts: [`0x${'22'.repeat(20)}`] }, /^WALLET_WRONG_ACCOUNT$/],
      [{ eth_chainId: '0x7a69', eth_requestAccounts: [] }, /^WALLET_ACCOUNT_UNAVAILABLE$/],
    ] as const) {
      const wallet = provider(replies);
      await expect(connectWallet(wallet, OWNER)).rejects.toThrow(code);
      expect(wallet.calls).not.toContain('wallet_switchEthereumChain');
      expect(wallet.calls).not.toContain('eth_sendTransaction');
    }
  });

  it('classifies wallet results without ever retrying', async () => {
    const request = walletRequestFor(pair().approveBytes, OWNER);
    const hash = `0x${'ab'.repeat(32)}`;
    const cases = [
      [{ eth_chainId: '0x7a69', eth_sendTransaction: hash }, { kind: 'HASH', transactionHash: hash }],
      [{ eth_chainId: '0x7a69', eth_sendTransaction: Object.assign(new Error('rejected'), { code: 4001 }) }, { kind: 'REJECTED' }],
      [{ eth_chainId: '0x7a69', eth_sendTransaction: Object.assign(new Error('internal'), { code: -32603 }) }, { kind: 'UNKNOWN' }],
      [{ eth_chainId: '0x7a69', eth_sendTransaction: '0x1234' }, { kind: 'UNKNOWN' }],
    ] as const;
    for (const [replies, outcome] of cases) {
      const wallet = provider(replies);
      expect(await requestExactTransaction(wallet, request)).toEqual(outcome);
      expect(wallet.calls.filter(method => method === 'eth_sendTransaction')).toHaveLength(1);
    }
    const moved = provider({ eth_chainId: '0x2105', eth_sendTransaction: hash });
    await expect(requestExactTransaction(moved, request)).rejects.toThrow(/^WALLET_WRONG_CHAIN$/);
    expect(moved.calls).not.toContain('eth_sendTransaction');
    expect(request.to).toBe(WETH);
    expect(requestFromBytes(toHex(pair().swapBytes), OWNER).to).toBe(ROUTER);
  });
});
