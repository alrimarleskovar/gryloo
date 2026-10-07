// SPDX-License-Identifier: AGPL-3.0-only
import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTestWallet } from '../../../../packages/reference-reconciler/test/test-wallet.ts';
import { challengeMessage, checksumAddress, issueWalletChallenge, readWalletSession, recoverPersonalSigner, verifyWalletSignIn, walletSessionKey,
  WALLET_SIGN_IN_STATEMENT } from './wallet-session.ts';

/** BUILD-JOURNEY-001: sign-in with an arbitrary wallet; the server recovers the signer and binds only that address. */
const env = { FLOFI_SESSION_SECRET: randomBytes(32).toString('hex') };
const origin = { domain: 'flofi.example', uri: 'https://flofi.example' };
const t0 = new Date('2026-10-04T12:00:00.000Z'), later = (s: number) => new Date(t0.getTime() + s * 1000);
function signIn(wallet = createTestWallet(), options: { env?: Record<string, string | undefined>; signer?: ReturnType<typeof createTestWallet>; chainId?: number; at?: Date } = {}) {
  const e = options.env ?? env, chainId = options.chainId ?? 84532;
  const challenge = issueWalletChallenge(e, { ...origin, now: t0 });
  const message = challengeMessage(e, { challengeToken: challenge.token, ...origin, address: wallet.address, chainId, now: t0 });
  const signature = (options.signer ?? wallet).signMessage(message);
  return { wallet, challenge, message, attempt: () => verifyWalletSignIn(e, { challengeToken: challenge.token, ...origin, address: wallet.address, chainId, signature,
    now: options.at ?? later(10) }) };
}

describe('BUILD-JOURNEY-001 wallet session', () => {
  it('any fresh wallet signs one EIP-4361 message and gets a session bound to exactly its address', () => {
    for (let i = 0; i < 3; i++) {
      const { wallet, message, attempt } = signIn();
      expect(message).toContain(`flofi.example wants you to sign in with your Ethereum account:\n${checksumAddress(wallet.address)}`);
      expect(message).toContain(WALLET_SIGN_IN_STATEMENT);
      expect(message).toMatch(/\nURI: https:\/\/flofi\.example\nVersion: 1\nChain ID: 84532\nNonce: [0-9a-f]{32}\nIssued At: 2026-10-04T12:00:00\.000Z\nExpiration Time: 2026-10-04T12:05:00\.000Z$/);
      const { token, session } = attempt();
      expect(session.account).toBe(wallet.address);
      expect(readWalletSession(env, token, later(60), origin.domain)).toEqual(session);
      expect(readWalletSession(env, token, later(10 + 8 * 3600), origin.domain)).toBeNull();
      expect(readWalletSession(env, token, later(9 + 8 * 3600), origin.domain)).not.toBeNull();
    }
  });
  it('recovers personal_sign signers (v 27/28 and 0/1) and the EIP-55 checksum', () => {
    const wallet = createTestWallet(), signature = wallet.signMessage('hello');
    expect(recoverPersonalSigner('hello', signature)).toBe(wallet.address);
    const v = parseInt(signature.slice(130), 16);
    expect(recoverPersonalSigner('hello', signature.slice(0, 130) + (v - 27).toString(16).padStart(2, '0'))).toBe(wallet.address);
    expect(recoverPersonalSigner('hello!', signature)).not.toBe(wallet.address);
    expect(() => recoverPersonalSigner('hello', '0x1234')).toThrow('WALLET_SIGNATURE_INVALID');
    expect(checksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
  });
  it('refuses another signer, a tampered or expired challenge, another origin and another key', () => {
    const victim = createTestWallet(), attacker = createTestWallet();
    expect(() => signIn(victim, { signer: attacker }).attempt()).toThrow('WALLET_SIGNATURE_INVALID');
    expect(() => signIn(victim, { at: later(301) }).attempt()).toThrow('WALLET_SIGN_IN_CHALLENGE_INVALID');
    const { challenge, message } = signIn(victim), signature = victim.signMessage(message);
    expect(() => verifyWalletSignIn(env, { challengeToken: challenge.token, domain: 'evil.example', uri: 'https://evil.example', address: victim.address, chainId: 84532,
      signature, now: later(5) })).toThrow('WALLET_SIGN_IN_ORIGIN_MISMATCH');
    expect(() => verifyWalletSignIn(env, { challengeToken: challenge.token.slice(0, -2) + 'AA', ...origin, address: victim.address, chainId: 84532, signature,
      now: later(5) })).toThrow('WALLET_SIGN_IN_CHALLENGE_INVALID');
    // The signature covers the chain id: a different one rebuilds a different message.
    expect(() => verifyWalletSignIn(env, { challengeToken: challenge.token, ...origin, address: victim.address, chainId: 1, signature, now: later(5) }))
      .toThrow('WALLET_SIGNATURE_INVALID');
    const other = { FLOFI_SESSION_SECRET: randomBytes(32).toString('hex') };
    expect(() => verifyWalletSignIn(other, { challengeToken: challenge.token, ...origin, address: victim.address, chainId: 84532, signature, now: later(5) }))
      .toThrow('WALLET_SIGN_IN_CHALLENGE_INVALID');
    const { token } = signIn(victim).attempt();
    expect(readWalletSession(other, token, later(20), origin.domain)).toBeNull();
    const [kind, body, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), a: attacker.address })).toString('base64url');
    expect(readWalletSession(env, `${kind}.${forged}.${mac}`, later(20), origin.domain)).toBeNull();
    // A challenge token is never accepted as a session and vice versa.
    expect(readWalletSession(env, challenge.token, later(20), origin.domain)).toBeNull();
  });
  it('derives the key from the deployed API token, needs no new secret, and fails closed for a forwarding BFF without one', () => {
    const token = randomBytes(24).toString('hex');
    expect(walletSessionKey({ API_AUTH_TOKEN: token }).equals(walletSessionKey({ API_AUTH_TOKEN: token }))).toBe(true);
    expect(walletSessionKey({ API_AUTH_TOKEN: token }).equals(Buffer.from(token))).toBe(false);
    expect(() => walletSessionKey({ API_BASE_URL: 'https://api.example' })).toThrow('WALLET_SESSION_NOT_CONFIGURED');
    expect(() => walletSessionKey({ FLOFI_SESSION_SECRET: 'short' })).toThrow('WALLET_SESSION_SECRET_INVALID');
    expect(readWalletSession({ API_BASE_URL: 'https://api.example' }, 's1.x.y', t0, origin.domain)).toBeNull();
    const { token: session } = signIn(createTestWallet(), { env: { API_AUTH_TOKEN: token } }).attempt();
    expect(readWalletSession({ API_AUTH_TOKEN: token }, session, later(30), origin.domain)).not.toBeNull();
  });
});

describe('BUILD-CLOUD-PARITY-001 wallet session on hosted deployments', () => {
  it('a session is accepted only by the host that issued it, even when deployments share the key', () => {
    const { token, session } = signIn().attempt();
    expect(readWalletSession(env, token, later(30), origin.domain)).toEqual(session);
    expect(readWalletSession(env, token, later(30), 'flofi-git-feature-team.vercel.app')).toBeNull();
    expect(readWalletSession(env, token, later(30), 'flofi.example:3000')).toBeNull();
    // A pre-binding token (no issuing host) is refused: those sessions simply sign in again.
    const key = walletSessionKey(env), body = Buffer.from(JSON.stringify({ a: createTestWallet().address, i: 0, e: 4_102_444_800, s: 'x' })).toString('base64url');
    const legacy = `s1.${body}.${createHmac('sha256', key).update(`s1.${body}`).digest('base64url')}`;
    expect(readWalletSession(env, legacy, later(30), origin.domain)).toBeNull();
  });
  it('a hosted deployment never invents a per-process key (serverless instances do not share memory)', () => {
    for (const hosted of [{ VERCEL: '1' }, { RAILWAY_PROJECT_ID: 'p' }, { FLOFI_DEPLOYMENT: 'hosted' }, { VERCEL: '1', DATABASE_URL: 'postgres://db/x' }])
      expect(() => walletSessionKey(hosted)).toThrow('WALLET_SESSION_NOT_CONFIGURED');
    const secret = randomBytes(32).toString('hex');
    // Every instance of one deployment derives the same key from the configured secret.
    expect(walletSessionKey({ VERCEL: '1', FLOFI_SESSION_SECRET: secret }).equals(walletSessionKey({ VERCEL: '1', FLOFI_SESSION_SECRET: secret }))).toBe(true);
    // Local development keeps its single-process key.
    expect(walletSessionKey({}).equals(walletSessionKey({}))).toBe(true);
  });
});
