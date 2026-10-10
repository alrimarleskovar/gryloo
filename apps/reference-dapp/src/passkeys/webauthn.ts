// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: minimal WebAuthn (passkey) verification for FloFi's chain-neutral authorizations — ES256 only, attestation `none`,
 * user verification REQUIRED. Pure functions over `node:crypto`; no dependency, no key custody (a passkey's private key never leaves the
 * owner's authenticator).
 *
 *   registration  clientDataJSON (type webauthn.create, the single-use challenge, this deployment's origin) + authenticatorData (rpIdHash,
 *                 UP+UV+AT flags, the attested credential id and its COSE EC2 P-256 key). The stored public key is rebuilt from the COSE
 *                 key the authenticator attested, never taken from a client-supplied field.
 *   assertion     clientDataJSON (type webauthn.get, challenge = the exact digest being authorized) + authenticatorData (rpIdHash, UP+UV,
 *                 a signature counter that must grow when either side is non-zero) + an ES256 signature over
 *                 authenticatorData ‖ SHA-256(clientDataJSON).
 */
import { createHash, createPublicKey, verify } from 'node:crypto';

export const ES256 = -7;
const fail = (code: string): never => { throw new Error(code); };
export const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');
export function fromB64url(value: unknown, max = 4096): Uint8Array {
  if (typeof value !== 'string' || !value.length || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) fail('PASSKEY_ENCODING_INVALID');
  const bytes = Uint8Array.from(Buffer.from(value as string, 'base64url'));
  if (b64url(bytes) !== value) fail('PASSKEY_ENCODING_INVALID');
  return bytes;
}
const sha256 = (bytes: Uint8Array | string) => Uint8Array.from(createHash('sha256').update(bytes).digest());
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── Minimal CBOR (definite lengths; enough for a COSE key) ────────────────────────────────────────────────────────────────────
type Cbor = number | bigint | Uint8Array | string | Cbor[] | Map<Cbor, Cbor>;
function cbor(bytes: Uint8Array, at: number, depth = 0): { value: Cbor; end: number } {
  if (depth > 8 || at >= bytes.length) fail('PASSKEY_CBOR_INVALID');
  const head = bytes[at]!, major = head >> 5, info = head & 31;
  let length: number, next = at + 1;
  if (info < 24) length = info;
  else if (info === 24) { const b = bytes[next]; if (b === undefined) return fail('PASSKEY_CBOR_INVALID'); length = b; next += 1; }
  else if (info === 25) { if (next + 2 > bytes.length) fail('PASSKEY_CBOR_INVALID'); length = (bytes[next]! << 8) | bytes[next + 1]!; next += 2; }
  else if (info === 26) { if (next + 4 > bytes.length) fail('PASSKEY_CBOR_INVALID'); length = new DataView(bytes.buffer, bytes.byteOffset + next, 4).getUint32(0); next += 4; }
  else return fail('PASSKEY_CBOR_INVALID');
  if (major === 0) return { value: length, end: next };
  if (major === 1) return { value: -1 - length, end: next };
  if (major === 2 || major === 3) {
    if (next + length > bytes.length) fail('PASSKEY_CBOR_INVALID');
    const slice = bytes.slice(next, next + length);
    return { value: major === 2 ? slice : new TextDecoder('utf-8', { fatal: true }).decode(slice), end: next + length };
  }
  if (major === 4) { const items: Cbor[] = []; for (let i = 0; i < length; i++) { const r = cbor(bytes, next, depth + 1); items.push(r.value); next = r.end; } return { value: items, end: next }; }
  if (major === 5) {
    const map = new Map<Cbor, Cbor>();
    for (let i = 0; i < length; i++) { const k = cbor(bytes, next, depth + 1), v = cbor(bytes, k.end, depth + 1); if (map.has(k.value)) fail('PASSKEY_CBOR_INVALID'); map.set(k.value, v.value); next = v.end; }
    return { value: map, end: next };
  }
  return fail('PASSKEY_CBOR_INVALID');
}
const SPKI_P256_PREFIX = Uint8Array.from(Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'));
/** A COSE EC2 P-256 ES256 key → SPKI DER (validated by node:crypto as a point on the curve). */
export function coseEs256ToSpki(cose: Map<Cbor, Cbor>): Uint8Array {
  const x = cose.get(-2), y = cose.get(-3);
  if (cose.get(1) !== 2 || cose.get(3) !== ES256 || cose.get(-1) !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32)
    fail('PASSKEY_ALGORITHM_UNSUPPORTED');
  const spki = Uint8Array.from([...SPKI_P256_PREFIX, 4, ...x as Uint8Array, ...y as Uint8Array]);
  try { createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' }); } catch { fail('PASSKEY_PUBLIC_KEY_INVALID'); }
  return spki;
}

// ── Authenticator data ────────────────────────────────────────────────────────────────────────────────────────────────────
export type AuthenticatorData = { readonly rpIdHash: Uint8Array; readonly userPresent: boolean; readonly userVerified: boolean; readonly backupEligible: boolean;
  readonly backedUp: boolean; readonly signCount: number; readonly attested: { readonly aaguid: Uint8Array; readonly credentialId: Uint8Array; readonly publicKeySpki: Uint8Array } | null };
export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData {
  if (bytes.length < 37 || bytes.length > 1024) fail('PASSKEY_AUTHENTICATOR_DATA_INVALID');
  const flags = bytes[32]!, signCount = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0);
  let attested: AuthenticatorData['attested'] = null, end = 37;
  if (flags & 0x40) {
    if (bytes.length < 55) fail('PASSKEY_AUTHENTICATOR_DATA_INVALID');
    const aaguid = bytes.slice(37, 53), idLength = (bytes[53]! << 8) | bytes[54]!;
    if (idLength < 16 || idLength > 1023 || 55 + idLength > bytes.length) fail('PASSKEY_AUTHENTICATOR_DATA_INVALID');
    const credentialId = bytes.slice(55, 55 + idLength), key = cbor(bytes, 55 + idLength);
    if (!(key.value instanceof Map)) fail('PASSKEY_AUTHENTICATOR_DATA_INVALID');
    attested = { aaguid, credentialId, publicKeySpki: coseEs256ToSpki(key.value as Map<Cbor, Cbor>) };
    end = key.end;
  }
  if (flags & 0x80) end = cbor(bytes, end).end; // extensions
  if (end !== bytes.length) fail('PASSKEY_AUTHENTICATOR_DATA_INVALID');
  return { rpIdHash: bytes.slice(0, 32), userPresent: !!(flags & 0x01), userVerified: !!(flags & 0x04), backupEligible: !!(flags & 0x08), backedUp: !!(flags & 0x10),
    signCount, attested };
}
type ClientData = { readonly type: string; readonly challenge: string; readonly origin: string; readonly crossOrigin?: boolean };
function clientDataOf(bytes: Uint8Array, type: 'webauthn.create' | 'webauthn.get', challenge: Uint8Array, origin: string): void {
  let data: ClientData;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as ClientData; } catch { return fail('PASSKEY_CLIENT_DATA_INVALID'); }
  if (!data || data.type !== type) fail('PASSKEY_CLIENT_DATA_TYPE');
  if (typeof data.challenge !== 'string' || data.challenge !== b64url(challenge)) fail('PASSKEY_CHALLENGE_MISMATCH');
  if (data.origin !== origin) fail('PASSKEY_ORIGIN_MISMATCH');
  if (data.crossOrigin === true) fail('PASSKEY_CROSS_ORIGIN');
}
const checkRp = (auth: AuthenticatorData, rpId: string) => {
  if (!equal(auth.rpIdHash, sha256(rpId))) fail('PASSKEY_RP_MISMATCH');
  if (!auth.userPresent) fail('PASSKEY_USER_PRESENCE_REQUIRED');
  if (!auth.userVerified) fail('PASSKEY_USER_VERIFICATION_REQUIRED');
};

export type RegistrationInput = { readonly credentialId: string; readonly clientDataJSON: string; readonly authenticatorData: string; readonly publicKeyAlgorithm: number };
export type VerifiedRegistration = { readonly credentialId: string; readonly publicKeySpki: Uint8Array; readonly signCount: number; readonly backedUp: boolean };
export function verifyRegistration(input: RegistrationInput, expected: { readonly challenge: Uint8Array; readonly origin: string; readonly rpId: string }): VerifiedRegistration {
  if (input.publicKeyAlgorithm !== ES256) fail('PASSKEY_ALGORITHM_UNSUPPORTED');
  clientDataOf(fromB64url(input.clientDataJSON), 'webauthn.create', expected.challenge, expected.origin);
  const auth = parseAuthenticatorData(fromB64url(input.authenticatorData));
  checkRp(auth, expected.rpId);
  if (!auth.attested) fail('PASSKEY_ATTESTED_DATA_REQUIRED');
  if (!equal(auth.attested!.credentialId, fromB64url(input.credentialId, 1400))) fail('PASSKEY_CREDENTIAL_MISMATCH');
  return { credentialId: input.credentialId, publicKeySpki: auth.attested!.publicKeySpki, signCount: auth.signCount, backedUp: auth.backedUp };
}

export type AssertionInput = { readonly credentialId: string; readonly clientDataJSON: string; readonly authenticatorData: string; readonly signature: string };
/** Verifies that the registered passkey signed `challenge` (FloFi passes the exact digest being authorized). Returns the new counter. */
export function verifyAssertion(input: AssertionInput, expected: { readonly challenge: Uint8Array; readonly origin: string; readonly rpId: string;
  readonly credentialId: string; readonly publicKeySpki: Uint8Array; readonly signCount: number }): { readonly signCount: number } {
  if (input.credentialId !== expected.credentialId) fail('PASSKEY_CREDENTIAL_MISMATCH');
  const clientData = fromB64url(input.clientDataJSON), authBytes = fromB64url(input.authenticatorData);
  clientDataOf(clientData, 'webauthn.get', expected.challenge, expected.origin);
  const auth = parseAuthenticatorData(authBytes);
  checkRp(auth, expected.rpId);
  if (auth.attested) fail('PASSKEY_AUTHENTICATOR_DATA_INVALID');
  // A counter that does not grow (when either side uses one) means a cloned or replayed authenticator response.
  if ((auth.signCount !== 0 || expected.signCount !== 0) && auth.signCount <= expected.signCount) fail('PASSKEY_COUNTER_REPLAY');
  const signed = Buffer.concat([authBytes, sha256(clientData)]);
  const ok = (() => {
    try { return verify('sha256', signed, { key: Buffer.from(expected.publicKeySpki), format: 'der', type: 'spki', dsaEncoding: 'der' }, Buffer.from(fromB64url(input.signature, 200))); }
    catch { return false; }
  })();
  if (!ok) fail('PASSKEY_SIGNATURE_INVALID');
  return { signCount: auth.signCount };
}
/** The relying-party id of a deployment origin: its host name (no port). */
export function rpIdOf(origin: string): string {
  const url = new URL(origin);
  if (url.origin !== origin || !/^https?:$/.test(url.protocol)) fail('PASSKEY_ORIGIN_INVALID');
  return url.hostname;
}
