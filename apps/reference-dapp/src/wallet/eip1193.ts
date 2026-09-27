// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Browser side of Mode A on local chain 31337. This module independently decodes every reviewed
 * unsigned EIP-1559 payload, recomputes its frozen payload hash with WebCrypto, and derives the
 * EIP-1193 `eth_sendTransaction` request from those same bytes immediately before each request.
 * It never holds a key, never signs, never broadcasts, never switches chains and never retries.
 */
export const FORK_CHAIN_ID_HEX = '0x7a69';
const ROUTER = '0x2626664c2603336e57b271c5c0b26f421741e481';
const APPROVE = '0x095ea7b3';
const MULTICALL = '0x5ae401dc';
const EXACT_INPUT_SINGLE = '0x04e45aaf';

export type Eip1193Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  readonly isGrylooTestWallet?: boolean; readonly isMetaMask?: boolean };
export type BrowserDecoded = {
  readonly chainId: number; readonly nonce: string; readonly to: string; readonly value: string; readonly gasLimit: string;
  readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string; readonly functionSelector: string;
  readonly approve: { readonly spender: string; readonly amount: string } | null;
  readonly swap: { readonly tokenIn: string; readonly tokenOut: string; readonly fee: number; readonly recipient: string;
    readonly amountIn: string; readonly amountOutMinimum: string; readonly sqrtPriceLimitX96: string; readonly deadline: string } | null;
};
export type BrowserRequest = { readonly from: string; readonly to: string; readonly nonce: string; readonly gas: string;
  readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string; readonly value: '0x0'; readonly data: string;
  readonly chainId: typeof FORK_CHAIN_ID_HEX; readonly type: '0x2' };
export type ReviewedPayload = { readonly stepId: string; readonly bytes: string; readonly payloadHash: string;
  readonly decoded: BrowserDecoded; readonly request: BrowserRequest };
export type Verified = { readonly payloadHash: string; readonly decoded: BrowserDecoded; readonly request: BrowserRequest };

function fail(code: string): never { throw new Error(code); }
export function hexToBytes(value: string): Uint8Array {
  if (!/^0x(?:[0-9a-f]{2})*$/.test(value)) fail('BROWSER_HEX_INVALID');
  const out = new Uint8Array((value.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(2 + 2 * i, 4 + 2 * i), 16);
  return out;
}
export function bytesToHex(bytes: Uint8Array): string { return `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`; }
type Rlp = Uint8Array | Rlp[];
function rlpItem(input: Uint8Array, offset: number): { item: Rlp; next: number } {
  const prefix = input[offset] ?? fail('BROWSER_RLP_INVALID');
  const length = (start: number, size: number) => {
    if (size < 1 || size > 4 || start + size > input.length || input[start] === 0) fail('BROWSER_RLP_INVALID');
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + input[start + i]!;
    return value;
  };
  if (prefix < 0x80) return { item: input.subarray(offset, offset + 1), next: offset + 1 };
  if (prefix <= 0xb7) {
    const size = prefix - 0x80, end = offset + 1 + size;
    if (end > input.length || (size === 1 && input[offset + 1]! < 0x80)) fail('BROWSER_RLP_INVALID');
    return { item: input.subarray(offset + 1, end), next: end };
  }
  if (prefix <= 0xbf) {
    const sizeOfSize = prefix - 0xb7, size = length(offset + 1, sizeOfSize), start = offset + 1 + sizeOfSize;
    if (size < 56 || start + size > input.length) fail('BROWSER_RLP_INVALID');
    return { item: input.subarray(start, start + size), next: start + size };
  }
  let start: number, end: number;
  if (prefix <= 0xf7) { start = offset + 1; end = start + prefix - 0xc0; }
  else { const sizeOfSize = prefix - 0xf7, size = length(offset + 1, sizeOfSize); if (size < 56) fail('BROWSER_RLP_INVALID'); start = offset + 1 + sizeOfSize; end = start + size; }
  if (end > input.length) fail('BROWSER_RLP_INVALID');
  const items: Rlp[] = [];
  for (let at = start; at < end;) { const { item, next } = rlpItem(input, at); items.push(item); at = next; }
  return { item: items, next: end };
}
const bytesOf = (item: Rlp | undefined): Uint8Array => item instanceof Uint8Array ? item : fail('BROWSER_RLP_INVALID');
const listOf = (item: Rlp | undefined): Rlp[] => Array.isArray(item) ? item : fail('BROWSER_RLP_INVALID');
function integer(item: Rlp | undefined): bigint {
  const bytes = bytesOf(item);
  if (bytes.length > 32 || (bytes.length > 0 && bytes[0] === 0)) fail('BROWSER_RLP_INTEGER_INVALID');
  return bytes.length ? BigInt(bytesToHex(bytes)) : 0n;
}
function word(data: Uint8Array, index: number): bigint {
  const slice = data.subarray(index, index + 32);
  if (slice.length !== 32) fail('BROWSER_ABI_INVALID');
  return BigInt(bytesToHex(slice));
}
function address(data: Uint8Array, index: number): string {
  const value = word(data, index);
  if (value >> 160n) fail('BROWSER_ABI_INVALID');
  return `0x${value.toString(16).padStart(40, '0')}`;
}

/** Independent decoder of the frozen Mode A payload profile; any other shape is refused. */
export function decodeReviewedPayload(bytesHex: string): BrowserDecoded {
  const bytes = hexToBytes(bytesHex);
  if (bytes[0] !== 2) fail('BROWSER_PAYLOAD_TYPE_INVALID');
  const { item, next } = rlpItem(bytes, 1);
  if (next !== bytes.length) fail('BROWSER_RLP_INVALID');
  const fields = listOf(item);
  if (fields.length !== 9 || integer(fields[0]) !== 31337n || integer(fields[6]) !== 0n || listOf(fields[8]).length !== 0) fail('BROWSER_PAYLOAD_PROFILE_INVALID');
  const to = bytesOf(fields[5]);
  const data = bytesOf(fields[7]);
  if (to.length !== 20 || data.length < 4) fail('BROWSER_PAYLOAD_PROFILE_INVALID');
  const selector = bytesToHex(data.subarray(0, 4));
  let approve: BrowserDecoded['approve'] = null;
  let swap: BrowserDecoded['swap'] = null;
  if (selector === APPROVE) {
    if (data.length !== 68) fail('BROWSER_ABI_INVALID');
    approve = { spender: address(data, 4), amount: word(data, 36).toString() };
  } else if (selector === MULTICALL) {
    // multicall(uint256 deadline, bytes[] data) holding exactly one exactInputSingle call.
    if (data.length !== 4 + 32 * 5 + 4 + 32 * 7 + 28 || word(data, 36) !== 0x40n || word(data, 68) !== 1n || word(data, 100) !== 0x20n
      || word(data, 132) !== 228n || bytesToHex(data.subarray(164, 168)) !== EXACT_INPUT_SINGLE
      || data.subarray(392).some(byte => byte !== 0)) fail('BROWSER_ABI_INVALID');
    const fee = word(data, 232);
    if (fee > 16_777_215n) fail('BROWSER_ABI_INVALID');
    swap = { tokenIn: address(data, 168), tokenOut: address(data, 200), fee: Number(fee), recipient: address(data, 264),
      amountIn: word(data, 296).toString(), amountOutMinimum: word(data, 328).toString(), sqrtPriceLimitX96: word(data, 360).toString(),
      deadline: word(data, 4).toString() };
  } else fail('BROWSER_UNKNOWN_FUNCTION');
  return { chainId: 31337, nonce: integer(fields[1]).toString(), to: bytesToHex(to), value: '0',
    gasLimit: integer(fields[4]).toString(), maxFeePerGas: integer(fields[3]).toString(),
    maxPriorityFeePerGas: integer(fields[2]).toString(), functionSelector: selector, approve, swap };
}

/** Browser-side WebCrypto implementation of the frozen `payload` hash framing. */
export async function browserPayloadHash(bytes: Uint8Array): Promise<string> {
  const domain = new TextEncoder().encode('defi-workflow-engine/payload');
  const preimage = new Uint8Array(20 + domain.length + bytes.length);
  preimage.set(new TextEncoder().encode('DWE-HASH'), 0);
  preimage[9] = 1;
  const view = new DataView(preimage.buffer);
  view.setUint16(10, domain.length, false);
  preimage.set(domain, 12);
  view.setBigUint64(12 + domain.length, BigInt(bytes.length), false);
  preimage.set(bytes, 20 + domain.length);
  return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', preimage)));
}
export function requestFromBytes(bytesHex: string, owner: string): BrowserRequest {
  const decoded = decodeReviewedPayload(bytesHex);
  const bytes = hexToBytes(bytesHex);
  const { item } = rlpItem(bytes, 1);
  const data = bytesToHex(bytesOf(listOf(item)[7]));
  const quantity = (value: string) => `0x${BigInt(value).toString(16)}`;
  return { from: owner, to: decoded.to, nonce: quantity(decoded.nonce), gas: quantity(decoded.gasLimit),
    maxFeePerGas: quantity(decoded.maxFeePerGas), maxPriorityFeePerGas: quantity(decoded.maxPriorityFeePerGas), value: '0x0',
    data, chainId: FORK_CHAIN_ID_HEX, type: '0x2' };
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

/**
 * The server's decoded view and request must equal the browser's independent derivation, and the
 * recomputed payload hash must equal the reviewed hash. Any difference blocks before the wallet.
 */
export async function verifyReviewedPayload(view: ReviewedPayload, owner: string, expected: { readonly tokenIn: string; readonly owner: string }): Promise<Verified> {
  const decoded = decodeReviewedPayload(view.bytes);
  const payloadHash = await browserPayloadHash(hexToBytes(view.bytes));
  const request = requestFromBytes(view.bytes, owner);
  if (payloadHash !== view.payloadHash) fail('BROWSER_PAYLOAD_HASH_MISMATCH');
  if (canonical(decoded) !== canonical(view.decoded) || canonical(request) !== canonical(view.request)) fail('BROWSER_DECODE_MISMATCH');
  if (decoded.approve && (decoded.to !== expected.tokenIn || decoded.approve.spender !== ROUTER)) fail('BROWSER_UNKNOWN_SPENDER');
  if (decoded.swap && (decoded.to !== ROUTER || decoded.swap.recipient !== expected.owner)) fail('BROWSER_RECIPIENT_NOT_OWNER');
  return { payloadHash, decoded, request };
}

export type WalletConnection = { readonly account: string; readonly chainId: typeof FORK_CHAIN_ID_HEX; readonly label: string };
export function injectedProvider(): Eip1193Provider | null {
  const candidate = (globalThis as { ethereum?: unknown }).ethereum;
  return candidate && typeof (candidate as Eip1193Provider).request === 'function' ? candidate as Eip1193Provider : null;
}
export function walletLabel(provider: Eip1193Provider): string {
  if (provider.isGrylooTestWallet) return 'Automated test adapter · Anvil-unlocked local test account';
  if (provider.isMetaMask) return 'Injected EIP-1193 wallet (MetaMask-compatible)';
  return 'Injected EIP-1193 wallet';
}
/** Chain 31337 and the single reviewed local account only; the wallet is never asked to switch chains. */
export async function connectWallet(provider: Eip1193Provider, owner: string): Promise<WalletConnection> {
  const chainId = await provider.request({ method: 'eth_chainId' });
  if (chainId !== FORK_CHAIN_ID_HEX) fail('WALLET_WRONG_CHAIN');
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || accounts.length < 1 || typeof accounts[0] !== 'string') fail('WALLET_ACCOUNT_UNAVAILABLE');
  if (accounts[0].toLowerCase() !== owner) fail('WALLET_WRONG_ACCOUNT');
  return { account: owner, chainId: FORK_CHAIN_ID_HEX, label: walletLabel(provider) };
}
/** One exact request; a rejection or any failure after the request is reported, never retried. */
export async function requestExactTransaction(provider: Eip1193Provider, request: BrowserRequest): Promise<
  { readonly kind: 'HASH'; readonly transactionHash: string } | { readonly kind: 'REJECTED' } | { readonly kind: 'UNKNOWN' }> {
  const chainId = await provider.request({ method: 'eth_chainId' }).catch(() => null);
  if (chainId !== FORK_CHAIN_ID_HEX) fail('WALLET_WRONG_CHAIN');
  try {
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ ...request }] });
    return typeof hash === 'string' && /^0x[0-9a-f]{64}$/.test(hash) ? { kind: 'HASH', transactionHash: hash } : { kind: 'UNKNOWN' };
  } catch (error) {
    return (error as { code?: unknown })?.code === 4001 ? { kind: 'REJECTED' } : { kind: 'UNKNOWN' };
  }
}
