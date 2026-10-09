// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test-only software authenticator (never imported by product code): a P-256 key in this process's memory that produces WebAuthn
 * registration and assertion responses exactly as an authenticator with attestation `none` would, so the real verifier runs.
 */
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { b64url } from './webauthn.ts';

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest();
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
function coseKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const x = Buffer.from(jwk.x, 'base64url'), y = Buffer.from(jwk.y, 'base64url');
  // {1: 2, 3: -7, -1: 1, -2: x, -3: y}
  return Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), x, Buffer.from([0x22, 0x58, 0x20]), y]);
}
export function createTestAuthenticator(options: { flags?: number; credentialId?: Buffer } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const credentialId = options.credentialId ?? Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255));
  let counter = 0;
  const flags = options.flags ?? 0x45; // UP | UV | AT
  return {
    credentialId: b64url(credentialId),
    register(challenge: Uint8Array, origin: string, rpId: string, override: { type?: string; flags?: number } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: override.type ?? 'webauthn.create', challenge: b64url(challenge), origin, crossOrigin: false }));
      const idLength = Buffer.from([credentialId.length >> 8, credentialId.length & 255]);
      const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([override.flags ?? flags]), u32(0), Buffer.alloc(16), idLength, credentialId, coseKey(publicKey)]);
      return { credentialId: b64url(credentialId), clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authenticatorData), publicKeyAlgorithm: -7 };
    },
    assert(challenge: Uint8Array, origin: string, rpId: string, override: { type?: string; flags?: number; counter?: number } = {}) {
      counter = override.counter ?? counter + 1;
      const clientDataJSON = Buffer.from(JSON.stringify({ type: override.type ?? 'webauthn.get', challenge: b64url(challenge), origin, crossOrigin: false }));
      const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([override.flags ?? 0x05]), u32(counter)]);
      const signature = sign('sha256', Buffer.concat([authenticatorData, sha256(clientDataJSON)]), { key: privateKey, dsaEncoding: 'der' });
      return { credentialId: b64url(credentialId), clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authenticatorData), signature: b64url(signature) };
    },
  };
}
