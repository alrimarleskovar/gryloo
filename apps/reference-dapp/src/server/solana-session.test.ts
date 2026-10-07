// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: Sign-In With Solana. Disposable Ed25519 keys generated in memory for each test (never written anywhere): the
 * server verifies the exact SIWS message against the claimed public key and seals a session only for that key. Ethereum and
 * Solana sessions are never interchangeable.
 */
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base58Encode } from '@defi-workflow-engine/reference-compiler';
import { issueWalletChallenge, readSolanaSession, readWalletSession, SOLANA_SIGN_IN_STATEMENT, solanaChallengeMessage, solanaPublicKey,
  verifySolanaSignIn } from './wallet-session.ts';

const env = { FLOFI_SESSION_SECRET: randomBytes(32).toString('hex') };
const origin = { domain: 'flofi.example', uri: 'https://flofi.example' };
const t0 = new Date('2026-10-06T12:00:00.000Z'), later = (s: number) => new Date(t0.getTime() + s * 1000);
function keypair(): { address: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
  return { address: base58Encode(new Uint8Array(raw)), privateKey };
}
function attempt(options: { signer?: ReturnType<typeof keypair>; at?: Date; mutate?: (message: string) => string; claimed?: string; domain?: string } = {}) {
  const wallet = keypair(), signer = options.signer ?? wallet, address = options.claimed ?? wallet.address;
  const challenge = issueWalletChallenge(env, { ...origin, now: t0 });
  const message = solanaChallengeMessage(env, { challengeToken: challenge.token, ...origin, address: wallet.address, now: t0 });
  const signature = sign(null, Buffer.from((options.mutate ?? (m => m))(message), 'utf8'), signer.privateKey).toString('base64');
  return { wallet, message, signature, run: () => verifySolanaSignIn(env, { challengeToken: challenge.token, ...origin, ...options.domain ? { domain: options.domain } : {},
    address, signature, now: options.at ?? later(10) }) };
}

describe('BUILD-MCP-002 Sign-In With Solana', () => {
  it('a fresh Solana key signs one SIWS message and gets a session bound to exactly that key', () => {
    const { wallet, message, run } = attempt();
    expect(message).toBe(`flofi.example wants you to sign in with your Solana account:\n${wallet.address}\n\n${SOLANA_SIGN_IN_STATEMENT}\n\n` +
      'URI: https://flofi.example\nVersion: 1\n' + message.split('\nVersion: 1\n')[1]);
    expect(message).toMatch(/\nNonce: [0-9a-f]{32}\nIssued At: 2026-10-06T12:00:00\.000Z\nExpiration Time: 2026-10-06T12:05:00\.000Z$/);
    expect(message).not.toMatch(/Chain ID|mainnet|devnet/);
    expect(message).toContain('authorizes no transaction and moves no funds');
    const { token, session } = run();
    expect(session).toEqual({ namespace: 'solana', account: wallet.address, expiresAt: '2026-10-06T20:00:10.000Z' });
    expect(readSolanaSession(env, token, later(60), origin.domain)).toEqual(session);
  });
  it('refuses a signature by another key, over another message, or claiming another address', () => {
    expect(() => attempt({ signer: keypair() }).run()).toThrow('WALLET_SIGNATURE_INVALID');
    expect(() => attempt({ mutate: m => m.replace('Version: 1', 'Version: 2') }).run()).toThrow('WALLET_SIGNATURE_INVALID');
    expect(() => attempt({ claimed: keypair().address }).run()).toThrow('WALLET_SIGNATURE_INVALID');
    expect(() => attempt({ claimed: '0x' + '1'.repeat(40) }).run()).toThrow('WALLET_ADDRESS_INVALID');
  });
  it('refuses malformed signatures without throwing anything else', () => {
    const { wallet } = attempt(), challenge = issueWalletChallenge(env, { ...origin, now: t0 });
    for (const signature of ['', 'abc', Buffer.alloc(63).toString('base64'), Buffer.alloc(65).toString('base64'), Buffer.alloc(64).toString('hex'), Buffer.alloc(64).toString('base64')])
      expect(() => verifySolanaSignIn(env, { challengeToken: challenge.token, ...origin, address: wallet.address, signature, now: later(1) })).toThrow('WALLET_SIGNATURE_INVALID');
  });
  it('honours the challenge expiry and the origin it was issued for', () => {
    expect(() => attempt({ at: later(301) }).run()).toThrow('WALLET_SIGN_IN_CHALLENGE_INVALID');
    expect(() => attempt({ domain: 'evil.example' }).run()).toThrow('WALLET_SIGN_IN_ORIGIN_MISMATCH');
  });
  it('never reads a Solana session as an Ethereum one or the reverse, nor on another host or after expiry', () => {
    const { token } = attempt().run();
    expect(readWalletSession(env, token, later(60), origin.domain)).toBeNull();
    expect(readSolanaSession(env, token, later(60), 'other.example')).toBeNull();
    expect(readSolanaSession(env, token, later(8 * 3600 + 11), origin.domain)).toBeNull();
    expect(readSolanaSession({ FLOFI_SESSION_SECRET: randomBytes(32).toString('hex') }, token, later(60), origin.domain)).toBeNull();
    expect(readSolanaSession(env, token.replace(/\.[^.]+$/, '.AAAA'), later(60), origin.domain)).toBeNull();
  });
  it('accepts only base58 addresses of exactly 32 bytes', () => {
    expect(solanaPublicKey('So11111111111111111111111111111111111111112')?.length).toBe(32);
    for (const value of ['0OIl' + '1'.repeat(40), '1'.repeat(31), '2'.repeat(45), '', 42, null]) expect(solanaPublicKey(value)).toBeNull();
  });
});
