// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: session signers of delegated grants, behind one provider interface. The owner's key is never here: a session key
 * is a separate key, one per grant, whose on-chain authority is only what the owner's grant gives it (an ERC-7710 delegation's caveats, an
 * SPL token delegation's amount). Callers receive an opaque reference, the public address and signatures — never key material.
 *
 *   local-disposable  keys in mode-0600 files under an absolute directory below /tmp, created exclusively, deleted on destroy. For local
 *                     and public-testnet operation only; the application refuses it on hosted deployments. NOT production custody.
 *   memory            keys in this process's memory (unit tests and loopback harnesses only).
 *
 * A production provider (non-exportable keys in a KMS/HSM, per-grant isolation, audited use) does not exist in this repository; the
 * application reports production delegated signing as unavailable rather than using either provider in its place.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { base58Encode } from '@defi-workflow-engine/reference-compiler';

export type SignerNamespace = 'eip155' | 'solana';
export type EvmSignature = { readonly yParity: 0 | 1; readonly r: bigint; readonly s: bigint };
export interface DelegatedSignerProvider {
  readonly id: 'local-disposable' | 'memory';
  /** Whether this provider is acceptable custody for real funds. Neither implementation here is. */
  readonly production: false;
  readonly create: (namespace: SignerNamespace) => Promise<{ readonly ref: string; readonly address: string }>;
  readonly address: (ref: string) => Promise<string>;
  readonly signEvmDigest: (ref: string, digest: Uint8Array) => Promise<EvmSignature>;
  readonly signSolanaMessage: (ref: string, message: Uint8Array) => Promise<Uint8Array>;
  readonly destroy: (ref: string) => Promise<void>;
}
type Key = { readonly namespace: SignerNamespace; readonly secret: Uint8Array };
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const fail = (code: string): never => { throw new Error(code); };
function addressOf(key: Key): string {
  return key.namespace === 'eip155' ? '0x' + hex(keccak_256(secp256k1.getPublicKey(key.secret, false).subarray(1)).subarray(12))
    : base58Encode(ed25519.getPublicKey(key.secret));
}
function newKey(namespace: SignerNamespace): Key {
  return { namespace, secret: namespace === 'eip155' ? secp256k1.utils.randomSecretKey() : ed25519.utils.randomSecretKey() };
}
function signEvm(key: Key, digest: Uint8Array): EvmSignature {
  if (key.namespace !== 'eip155' || digest.length !== 32) fail('SIGNER_REQUEST_INVALID');
  const sig = secp256k1.sign(digest, key.secret, { prehash: false, format: 'recovered' });
  return { yParity: sig[0]! as 0 | 1, r: BigInt('0x' + hex(sig.subarray(1, 33))), s: BigInt('0x' + hex(sig.subarray(33, 65))) };
}
function signSolana(key: Key, message: Uint8Array): Uint8Array {
  if (key.namespace !== 'solana' || !message.length || message.length > 1232) fail('SIGNER_REQUEST_INVALID');
  return ed25519.sign(message, key.secret);
}
const REF = /^(local-disposable|memory):[a-f0-9]{32}$/;
const refOf = (id: DelegatedSignerProvider['id']) => `${id}:${randomBytes(16).toString('hex')}`;

export function memorySignerProvider(): DelegatedSignerProvider {
  const keys = new Map<string, Key>();
  const get = (ref: string) => keys.get(ref) ?? fail('SIGNER_KEY_NOT_FOUND');
  return {
    id: 'memory', production: false,
    async create(namespace) { const ref = refOf('memory'), key = newKey(namespace); keys.set(ref, key); return { ref, address: addressOf(key) }; },
    async address(ref) { return addressOf(get(ref)); },
    async signEvmDigest(ref, digest) { return signEvm(get(ref), digest); },
    async signSolanaMessage(ref, message) { return signSolana(get(ref), message); },
    async destroy(ref) { keys.delete(ref); },
  };
}

/** Disposable file keys: `directory` must be an absolute path below /tmp (never a repository or home path). */
export function localDisposableSignerProvider(directory: string): DelegatedSignerProvider {
  const root = normalize(directory);
  if (!isAbsolute(root) || !root.startsWith('/tmp/') || root.includes('..')) fail('SIGNER_DIRECTORY_INVALID');
  const path = (ref: string) => REF.test(ref) && ref.startsWith('local-disposable:') ? join(root, ref.slice('local-disposable:'.length) + '.key') : fail('SIGNER_REF_INVALID');
  async function load(ref: string): Promise<Key> {
    let raw: string;
    try { raw = await readFile(path(ref), 'utf8'); } catch { return fail('SIGNER_KEY_NOT_FOUND'); }
    const parsed = JSON.parse(raw) as { namespace?: unknown; secret?: unknown };
    if ((parsed.namespace !== 'eip155' && parsed.namespace !== 'solana') || typeof parsed.secret !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.secret)) fail('SIGNER_KEY_CORRUPT');
    return { namespace: parsed.namespace as SignerNamespace, secret: Uint8Array.from(Buffer.from(parsed.secret as string, 'hex')) };
  }
  return {
    id: 'local-disposable', production: false,
    async create(namespace) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const ref = refOf('local-disposable'), key = newKey(namespace);
      await writeFile(path(ref), JSON.stringify({ namespace, secret: hex(key.secret) }), { mode: 0o600, flag: 'wx' });
      return { ref, address: addressOf(key) };
    },
    async address(ref) { return addressOf(await load(ref)); },
    async signEvmDigest(ref, digest) { return signEvm(await load(ref), digest); },
    async signSolanaMessage(ref, message) { return signSolana(await load(ref), message); },
    async destroy(ref) { await rm(path(ref), { force: true }); },
  };
}
