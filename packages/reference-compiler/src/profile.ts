// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Controlled Base fork profile (BUILD-003D §3.2, §3.3; ADR-0004).
 *
 * This module is the single source for the fork's chain identities, the
 * exact anvil flags and the upstream request policy that the recording
 * proxy, the offline replay upstream and the G1 compatibility gate enforce.
 * It performs no I/O and is safe to import in the browser.
 */

/** EIP-155 chain ID served by the local fork; signatures are not valid on Base (8453). */
export const FORK_CHAIN_ID = 31337;
export const FORK_CHAIN_ID_HEX = '0x7a69';
/** The chain whose finalized state is reproduced. */
export const SOURCE_CHAIN_ID = 8453;
export const FORK_CHAIN_REF = 'eip155:31337';
export const SOURCE_CHAIN_REF = 'eip155:8453';
/** Lowest two clean dev-account indices, checked again at setup. */
export const FORK_OWNER_INDEX = 0;
export const FORK_SETUP_INDEX = 1;
export const FORK_EMPTY_LOCAL_BLOCKS = 20;

/**
 * Amendment 6: project-specific, public, test-only local dev accounts. They replace Anvil's globally known
 * default accounts, which all carry EIP-7702 code on Base. They are never funded or used outside the local
 * chain-31337 fork. Only public addresses and derivation metadata live here; the owner secret stays outside Git.
 */
export const FORK_ACCOUNT_DERIVATION_PATH = "m/44'/60'/31337'/0/";
export const FORK_DEV_ACCOUNTS = Object.freeze([
  '0x6b86363f41c70feae8fdd5476957cdadc9621704', '0x490850405076beb741fdc81cbd5bfd6d51573168',
  '0xd76788875502edb648e0032b4eb120e0610c1c68', '0x511a4267baac7ddad4da7032a82476b81fb32d36',
  '0x4f4506387734a9da0828070bc95aa43672c12083', '0x62b8ddc1663c7517ec645ab777c48f5748232a01',
  '0x3b6f9a972e4edc101afce6b50c36245d6eaf7ff2', '0xd6990854a6fde3766e5255e12aa3c7541c7a5e35',
  '0x81f25f79889ad7315b448bae04ecc5728c079784', '0x62d225656b8c4e21dd4c9d1801b2df2cf8b64066',
] as const);
/** Anvil's public default accounts: never acceptable as fork dev accounts (A6-1, A6-4). */
export const ANVIL_DEFAULT_ACCOUNTS = Object.freeze([
  '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266', '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc', '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
  '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65', '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc',
  '0x976ea74026e726554db657fa54763abd0c3a0aa9', '0x14dc79964da2c08b23698b3d3cc7ca32193d9955',
  '0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f', '0xa0ee7a142d267c1f36714e4a8f75612f20a79720',
] as const);

/** Pinned anvil identity (scripts/bootstrap-anvil.py verifies the archive and binary). */
export const ANVIL_PIN = Object.freeze({
  foundryVersion: 'v1.8.3',
  archiveSha256: '7ca48e6ca3cac1bce1403ca67e5bc1dc3bc1fd818199c9957c7165079c228568',
  binarySha256: '674a06c97a01350cd00241762bbfb01ebcafce9b6e8cbd6c8758ecea6ef4b968',
  binarySize: 50407016,
  version: 'anvil Version: 1.8.3\nCommit SHA: cae51ad458f6abb64852b7709eb784352429825d\n'
    + 'Build Timestamp: 2026-09-15T10:46:16.519267388Z (1789469176)\nBuild Profile: dist',
  clientVersion: 'anvil/v1.8.3',
});

/**
 * The exact anvil arguments of §3.2.1 as amended by A6-2. The caller supplies the fork URL, block number,
 * port. Secret input and its Anvil argument are confined to the e2e fork harness.
 */
export function forkAnvilArgs(options: { readonly port: number; readonly forkUrl: string; readonly forkBlockNumber: number; readonly timeoutMs: number }): readonly string[] {
  return Object.freeze([
    '--host', '127.0.0.1', '--port', String(options.port), '--chain-id', String(FORK_CHAIN_ID),
    '--fork-url', options.forkUrl, '--fork-block-number', String(options.forkBlockNumber),
    '--fork-chain-id', String(SOURCE_CHAIN_ID), '--no-storage-caching', '--no-fork-node-info',
    '--retries', '0', '--timeout', String(options.timeoutMs), '--accounts', '10', '--balance', '100',
  ]);
}

/**
 * Upstream request policy approved under D-5.
 *
 * `forward` methods may reach the recording provider (state reads only when
 * pinned to the fork block hash). Nothing else is allowed; the build stops
 * for an amendment if the pinned anvil needs another upstream method.
 */
export const FORK_UPSTREAM_POLICY = Object.freeze({
  forward: Object.freeze(['eth_chainId', 'eth_getBlockByNumber', 'eth_getBalance', 'eth_getTransactionCount', 'eth_getCode', 'eth_getStorageAt'] as const),
  hashPinnedStateReads: Object.freeze(['eth_getBalance', 'eth_getTransactionCount', 'eth_getCode', 'eth_getStorageAt'] as const),
  localMethodNotFound: Object.freeze(['eth_gasPrice', 'eth_getAccountInfo'] as const),
  localMissing: Object.freeze(['eth_getBlockByHash', 'eth_getTransactionByHash', 'eth_getTransactionReceipt'] as const),
});

/**
 * Zero-argument methods that pinned Anvil v1.8.3 sends upstream with the
 * JSON-RPC `params` member omitted (G5 incident, 2026-09-24). JSON-RPC 2.0
 * treats an omitted member as no parameters, so the omission is read as `[]`
 * for these methods only. Every other method must send a positional array.
 */
export const FORK_UPSTREAM_PARAMS_OMITTED = Object.freeze(['eth_gasPrice'] as const);

type RpcValue = null | boolean | number | string | RpcValue[] | { [key: string]: RpcValue };
export type ForkUpstreamCall = { readonly method: string; readonly params: readonly RpcValue[] };

/**
 * The single wire normalization shared by the recording proxy, the replay
 * upstream and G1: the request exactly as Anvil sent it becomes `{ method,
 * params }`, or `null` for a batch, a non-string method or a parameter form
 * other than a positional array or an approved omission.
 */
export function forkUpstreamCall(request: unknown): ForkUpstreamCall | null {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return null;
  const call = request as { method?: unknown; params?: unknown };
  if (typeof call.method !== 'string') return null;
  if (Array.isArray(call.params)) return { method: call.method, params: call.params as RpcValue[] };
  if (!('params' in call) && (FORK_UPSTREAM_PARAMS_OMITTED as readonly string[]).includes(call.method)) return { method: call.method, params: [] };
  return null;
}

export type ForkProxyRoute =
  | { readonly kind: 'forward'; readonly method: string; readonly params: readonly RpcValue[] }
  | { readonly kind: 'local-error'; readonly code: -32601; readonly message: 'method not found' }
  | { readonly kind: 'local-null' }
  | { readonly kind: 'local-source-block' }
  | { readonly kind: 'stop'; readonly reason: string };

/**
 * D-5 Amendment 3: classify Anvil's request before any provider access.
 * The caller must stop its session on `stop`, and may answer a source-block
 * lookup only with its already verified, pinned N/H block response.
 */
export function routeForkUpstreamRequest(
  request: unknown,
  sourceBlockNumber: number,
  sourceBlockHash: string,
): ForkProxyRoute {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return { kind: 'stop', reason: 'batch or invalid request' };
  const call = forkUpstreamCall(request);
  if (call === null) return { kind: 'stop', reason: 'invalid method or params' };
  const method = call.method;
  const params = call.params;
  const hash = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
  const address = (value: unknown) => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value);
  const blockNumber = `0x${sourceBlockNumber.toString(16)}`;
  if (method === 'eth_gasPrice' && params.length === 0) return { kind: 'local-error', code: -32601, message: 'method not found' };
  if (method === 'eth_getAccountInfo' && params.length === 2 && address(params[0]) && params[1] === sourceBlockHash) {
    return { kind: 'local-error', code: -32601, message: 'method not found' };
  }
  if (method === 'eth_getBlockByHash' && params.length === 2 && hash(params[0]) && params[1] === true) {
    return params[0] === sourceBlockHash ? { kind: 'local-source-block' } : { kind: 'local-null' };
  }
  if ((method === 'eth_getTransactionByHash' || method === 'eth_getTransactionReceipt') && params.length === 1 && hash(params[0])) {
    return { kind: 'local-null' };
  }
  if (method === 'eth_chainId' && params.length === 0) return { kind: 'forward', method, params };
  if (method === 'eth_getBlockByNumber' && params.length === 2 && params[0] === blockNumber && typeof params[1] === 'boolean') {
    return { kind: 'forward', method, params };
  }
  if ((FORK_UPSTREAM_POLICY.hashPinnedStateReads as readonly string[]).includes(method)) {
    const expectedLength = method === 'eth_getStorageAt' ? 3 : 2;
    if (params.length === expectedLength && address(params[0]) && params.at(-1) === sourceBlockHash
      && (method !== 'eth_getStorageAt' || (typeof params[1] === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(params[1])))) {
      return { kind: 'forward', method, params: [...params.slice(0, -1), { blockHash: sourceBlockHash, requireCanonical: true }] };
    }
  }
  return { kind: 'stop', reason: `unapproved ${method} parameters or method` };
}

/** Validate cached source-block data before a local H lookup is answered. */
export function verifiedSourceBlockReply(value: unknown, sourceBlockNumber: number, sourceBlockHash: string): RpcValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SOURCE_BLOCK_UNVERIFIED');
  const block = value as { number?: unknown; hash?: unknown };
  if (block.number !== `0x${sourceBlockNumber.toString(16)}` || block.hash !== sourceBlockHash) {
    throw new Error('SOURCE_BLOCK_UNVERIFIED');
  }
  return value as RpcValue;
}
