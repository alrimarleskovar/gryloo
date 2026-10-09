// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { createTestAuthenticator } from './passkey.test-harness.ts';
import { rpIdOf, verifyAssertion, verifyRegistration } from './webauthn.ts';

const ORIGIN = 'http://localhost:3108', RP = 'localhost';
const challenge = Uint8Array.from({ length: 32 }, (_, i) => i), digest = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);

describe('passkey registration (ES256, attestation none, user verification required)', () => {
  it('verifies an authenticator registration and rebuilds the key from the attested COSE key', () => {
    const a = createTestAuthenticator(), r = verifyRegistration(a.register(challenge, ORIGIN, RP), { challenge, origin: ORIGIN, rpId: RP });
    expect(r.credentialId).toBe(a.credentialId);
    expect(r.publicKeySpki).toHaveLength(91);
    expect(r.signCount).toBe(0);
  });
  it.each([
    ['another challenge', (a: ReturnType<typeof createTestAuthenticator>) => a.register(digest, ORIGIN, RP), 'PASSKEY_CHALLENGE_MISMATCH'],
    ['another origin', (a: ReturnType<typeof createTestAuthenticator>) => a.register(challenge, 'https://evil.example', RP), 'PASSKEY_ORIGIN_MISMATCH'],
    ['another relying party', (a: ReturnType<typeof createTestAuthenticator>) => a.register(challenge, ORIGIN, 'evil.example'), 'PASSKEY_RP_MISMATCH'],
    ['an assertion presented as a registration', (a: ReturnType<typeof createTestAuthenticator>) => a.register(challenge, ORIGIN, RP, { type: 'webauthn.get' }), 'PASSKEY_CLIENT_DATA_TYPE'],
    ['no user verification', (a: ReturnType<typeof createTestAuthenticator>) => a.register(challenge, ORIGIN, RP, { flags: 0x41 }), 'PASSKEY_USER_VERIFICATION_REQUIRED'],
    ['another credential id', (a: ReturnType<typeof createTestAuthenticator>) => ({ ...a.register(challenge, ORIGIN, RP), credentialId: 'A'.repeat(43) }), 'PASSKEY_CREDENTIAL_MISMATCH'],
    ['another algorithm', (a: ReturnType<typeof createTestAuthenticator>) => ({ ...a.register(challenge, ORIGIN, RP), publicKeyAlgorithm: -257 }), 'PASSKEY_ALGORITHM_UNSUPPORTED'],
  ])('refuses %s', (_n, make, code) => {
    expect(() => verifyRegistration(make(createTestAuthenticator()), { challenge, origin: ORIGIN, rpId: RP })).toThrow(code);
  });
});

describe('passkey assertion over an authorization digest', () => {
  const a = createTestAuthenticator(), reg = verifyRegistration(a.register(challenge, ORIGIN, RP), { challenge, origin: ORIGIN, rpId: RP });
  const expected = (signCount = 0) => ({ challenge: digest, origin: ORIGIN, rpId: RP, credentialId: reg.credentialId, publicKeySpki: reg.publicKeySpki, signCount });
  it('verifies the exact digest and returns the grown counter', () => {
    expect(verifyAssertion(a.assert(digest, ORIGIN, RP, { counter: 5 }), expected(4))).toEqual({ signCount: 5 });
  });
  it.each([
    ['a different digest', () => a.assert(challenge, ORIGIN, RP, { counter: 9 }), 0, 'PASSKEY_CHALLENGE_MISMATCH'],
    ['another origin', () => a.assert(digest, 'http://127.0.0.1:3108', RP, { counter: 9 }), 0, 'PASSKEY_ORIGIN_MISMATCH'],
    ['no user verification', () => a.assert(digest, ORIGIN, RP, { counter: 9, flags: 0x01 }), 0, 'PASSKEY_USER_VERIFICATION_REQUIRED'],
    ['a replayed counter', () => a.assert(digest, ORIGIN, RP, { counter: 5 }), 5, 'PASSKEY_COUNTER_REPLAY'],
    ['a registration response', () => ({ ...a.register(digest, ORIGIN, RP, { type: 'webauthn.get' }), signature: 'AA' }), 0, 'PASSKEY_AUTHENTICATOR_DATA_INVALID'],
    ['a forged signature', () => ({ ...a.assert(digest, ORIGIN, RP, { counter: 9 }), signature: createTestAuthenticator().assert(digest, ORIGIN, RP).signature }), 0, 'PASSKEY_SIGNATURE_INVALID'],
  ])('refuses %s', (_n, make, stored, code) => { expect(() => verifyAssertion(make() as never, expected(stored))).toThrow(code); });
  it('refuses another passkey', () => {
    const other = createTestAuthenticator({ credentialId: Buffer.alloc(32, 9) });
    expect(() => verifyAssertion(other.assert(digest, ORIGIN, RP), expected())).toThrow('PASSKEY_CREDENTIAL_MISMATCH');
  });
  it('derives the relying party from the origin host', () => {
    expect(rpIdOf('http://localhost:3108')).toBe('localhost');
    expect(rpIdOf('https://app.flofi.xyz')).toBe('app.flofi.xyz');
    expect(() => rpIdOf('https://app.flofi.xyz/path')).toThrow('PASSKEY_ORIGIN_INVALID');
  });
});
