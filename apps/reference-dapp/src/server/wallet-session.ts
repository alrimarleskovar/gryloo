// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-JOURNEY-001: wallet sessions for permissionless runs.
 *
 * Any injected wallet proves control of its address once by signing an EIP-4361 ("Sign-In with Ethereum") message with
 * `personal_sign`. The server builds the message from a fresh nonce sealed in a short-lived HttpOnly challenge cookie,
 * recovers the signer (EIP-191, secp256k1) and, only if it is the claimed address, seals that address into an expiring
 * HttpOnly session cookie. The session principal decides which runs the browser may operate (`run-ownership.ts`).
 *
 * The session is authentication, not authorization: the message states that it authorizes no transaction and moves no
 * funds, the server never holds or derives a key, and every wallet request still needs the owner's Review, Manifest
 * acceptance, Execute click and transaction signature. Pure functions here; cookies are handled by the server action.
 */
import { createHmac, createPublicKey, hkdfSync, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { base58Decode } from '@defi-workflow-engine/reference-compiler';
import { checksumAddress, recoverPersonalSigner } from '@defi-workflow-engine/reference-reconciler';
import { isHostedDeployment } from './deployment.ts';

export { checksumAddress, recoverPersonalSigner };

export const WALLET_SESSION_COOKIE = 'flofi_wallet_session';
export const WALLET_CHALLENGE_COOKIE = 'flofi_wallet_challenge';
export const WALLET_SESSION_TTL_SECONDS = 8 * 3600;
export const WALLET_CHALLENGE_TTL_SECONDS = 300;
export const WALLET_SIGN_IN_STATEMENT = 'Sign in to Flofi to operate your own workflow runs. This signature authorizes no transaction and moves no funds.';
type Env = Readonly<Record<string, string | undefined>>;
type Challenge = { readonly n: string; readonly i: number; readonly e: number; readonly d: string; readonly u: string };
/** `d`: the host that issued the session (BUILD-CLOUD-PARITY-001); a session is only accepted there. */
type Session = { readonly a: string; readonly i: number; readonly e: number; readonly s: string; readonly d: string };
export type WalletSession = { readonly account: string; readonly expiresAt: string };

const ACCOUNT = /^0x[0-9a-f]{40}$/, DOMAIN = /^[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?$/;
const fail = (code: string): never => { throw new Error(code); };
const seconds = (now: Date) => Math.floor(now.getTime() / 1000);

let processKey: Buffer | null = null;
/**
 * The cookie MAC key: `FLOFI_SESSION_SECRET` (≥ 32 characters) when set, else derived from the server-only `API_AUTH_TOKEN` the
 * deployed BFF already holds (HKDF, separate label, so no new deployment secret), else — only on a local server — a random
 * per-process key (one local process; sessions end when it restarts). A forwarding BFF, and any hosted deployment
 * (BUILD-CLOUD-PARITY-001: serverless instances do not share memory, so a per-process key would reject every other
 * instance's sessions), fail closed without a configured key.
 */
export function walletSessionKey(env: Env): Buffer {
  const derive = (secret: string) => Buffer.from(hkdfSync('sha256', secret, 'flofi', 'flofi/wallet-session/v1', 32));
  const explicit = env.FLOFI_SESSION_SECRET;
  if (explicit !== undefined && explicit !== '') return explicit.length >= 32 ? derive(explicit) : fail('WALLET_SESSION_SECRET_INVALID');
  if (env.API_AUTH_TOKEN && env.API_AUTH_TOKEN.length >= 32) return derive(env.API_AUTH_TOKEN);
  if (env.API_BASE_URL || isHostedDeployment(env)) fail('WALLET_SESSION_NOT_CONFIGURED');
  return processKey ??= randomBytes(32);
}
function seal(kind: 'c1' | 's1' | 'n1', payload: Challenge | Session | SolanaSessionPayload, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${kind}.${body}.${createHmac('sha256', key).update(`${kind}.${body}`).digest('base64url')}`;
}
function unseal<T extends { e: number }>(kind: 'c1' | 's1' | 'n1', token: string | undefined, key: Buffer, now: Date): T | null {
  if (typeof token !== 'string' || token.length > 2_048) return null;
  const [prefix, body, mac, ...rest] = token.split('.');
  if (prefix !== kind || !body || !mac || rest.length) return null;
  const expected = createHmac('sha256', key).update(`${kind}.${body}`).digest(), supplied = Buffer.from(mac, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let value: T;
  try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T; } catch { return null; }
  return value && typeof value === 'object' && Number.isSafeInteger(value.e) && value.e > seconds(now) ? value : null;
}

/** The exact EIP-4361 message the wallet signs. Every field comes from the server (sealed challenge) or is re-checked. */
export function walletSignInMessage(input: { readonly domain: string; readonly uri: string; readonly address: string; readonly chainId: number;
  readonly nonce: string; readonly issuedAt: string; readonly expirationTime: string }): string {
  return `${input.domain} wants you to sign in with your Ethereum account:\n${checksumAddress(input.address)}\n\n${WALLET_SIGN_IN_STATEMENT}\n\n` +
    `URI: ${input.uri}\nVersion: 1\nChain ID: ${input.chainId}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expirationTime}`;
}
/** A fresh nonce bound to this origin; the sealed token goes into the HttpOnly challenge cookie. */
export function issueWalletChallenge(env: Env, input: { readonly domain: string; readonly uri: string; readonly now: Date }) {
  if (!DOMAIN.test(input.domain) || !/^https?:\/\/[^\s/?#]+$/.test(input.uri)) fail('WALLET_SIGN_IN_ORIGIN_INVALID');
  const issued = seconds(input.now), challenge: Challenge = { n: randomBytes(16).toString('hex'), i: issued, e: issued + WALLET_CHALLENGE_TTL_SECONDS,
    d: input.domain, u: input.uri };
  return { token: seal('c1', challenge, walletSessionKey(env)), nonce: challenge.n, issuedAt: new Date(issued * 1000).toISOString(),
    expirationTime: new Date(challenge.e * 1000).toISOString() };
}
/** The message for a challenge token (the client asks once per sign-in; the server rebuilds it at verification). */
export function challengeMessage(env: Env, input: { readonly challengeToken: string | undefined; readonly domain: string; readonly uri: string;
  readonly address: string; readonly chainId: number; readonly now: Date }): string {
  const challenge = unseal<Challenge>('c1', input.challengeToken, walletSessionKey(env), input.now) ?? fail('WALLET_SIGN_IN_CHALLENGE_INVALID');
  if (challenge.d !== input.domain || challenge.u !== input.uri) fail('WALLET_SIGN_IN_ORIGIN_MISMATCH');
  if (!ACCOUNT.test(input.address)) fail('WALLET_ADDRESS_INVALID');
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) fail('WALLET_CHAIN_INVALID');
  return walletSignInMessage({ domain: challenge.d, uri: challenge.u, address: input.address, chainId: input.chainId, nonce: challenge.n,
    issuedAt: new Date(challenge.i * 1000).toISOString(), expirationTime: new Date(challenge.e * 1000).toISOString() });
}
/** Verifies the wallet's signature over the challenge message and seals a session for the recovered address. */
export function verifyWalletSignIn(env: Env, input: { readonly challengeToken: string | undefined; readonly domain: string; readonly uri: string;
  readonly address: string; readonly chainId: number; readonly signature: string; readonly now: Date }): { readonly token: string; readonly session: WalletSession } {
  const message = challengeMessage(env, input);
  if (recoverPersonalSigner(message, input.signature) !== input.address) fail('WALLET_SIGNATURE_INVALID');
  const issued = seconds(input.now), session: Session = { a: input.address, i: issued, e: issued + WALLET_SESSION_TTL_SECONDS, s: randomBytes(12).toString('hex'),
    d: input.domain };
  return { token: seal('s1', session, walletSessionKey(env)), session: { account: session.a, expiresAt: new Date(session.e * 1000).toISOString() } };
}
/**
 * The session in a cookie value, or null when absent, tampered, expired, sealed with another key or issued for another host.
 * Deployments that share a key (Production and its Previews) therefore never accept each other's sessions.
 */
export function readWalletSession(env: Env, token: string | undefined, now: Date, domain: string): WalletSession | null {
  let key: Buffer;
  try { key = walletSessionKey(env); } catch { return null; }
  const session = unseal<Session>('s1', token, key, now);
  return session && ACCOUNT.test(session.a) && typeof session.d === 'string' && session.d === domain
    ? { account: session.a, expiresAt: new Date(session.e * 1000).toISOString() } : null;
}

/**
 * BUILD-MCP-002: Sign-In With Solana. The same challenge (sealed nonce bound to this origin, five minutes, single use from the
 * browser) and the same key family as the EIP-4361 session, but its own sealed kind (`n1`) and cookie, so an Ethereum session is
 * never read as a Solana one or the reverse. The wallet signs the exact SIWS text with Wallet Standard `solana:signMessage`; the
 * server verifies the Ed25519 signature against the claimed public key. The message names no cluster: control of a key is the
 * same on every Solana network, and the proof authorizes no transaction on any of them.
 */
export const SOLANA_SESSION_COOKIE = 'flofi_solana_session';
export const SOLANA_CHALLENGE_COOKIE = 'flofi_solana_challenge';
export const SOLANA_SIGN_IN_STATEMENT = 'Sign in to Flofi to prove you control this Solana wallet. This signature authorizes no transaction and moves no funds.';
type SolanaSessionPayload = { readonly a: string; readonly n: 'solana'; readonly i: number; readonly e: number; readonly s: string; readonly d: string };
export type SolanaWalletSession = { readonly namespace: 'solana'; readonly account: string; readonly expiresAt: string };
const SOLANA_ACCOUNT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
/** The 32-byte Ed25519 public key of a Solana address, or null. */
export function solanaPublicKey(address: unknown): Buffer | null {
  if (typeof address !== 'string' || !SOLANA_ACCOUNT.test(address)) return null;
  try { const bytes = base58Decode(address); return bytes.length === 32 ? Buffer.from(bytes) : null; } catch { return null; }
}
/** The exact SIWS message (EIP-4361 shape for Solana). Every field comes from the sealed challenge or is re-checked. */
export function solanaSignInMessage(input: { readonly domain: string; readonly uri: string; readonly address: string; readonly nonce: string;
  readonly issuedAt: string; readonly expirationTime: string }): string {
  return `${input.domain} wants you to sign in with your Solana account:\n${input.address}\n\n${SOLANA_SIGN_IN_STATEMENT}\n\n` +
    `URI: ${input.uri}\nVersion: 1\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt}\nExpiration Time: ${input.expirationTime}`;
}
export function solanaChallengeMessage(env: Env, input: { readonly challengeToken: string | undefined; readonly domain: string; readonly uri: string;
  readonly address: string; readonly now: Date }): string {
  const challenge = unseal<Challenge>('c1', input.challengeToken, walletSessionKey(env), input.now) ?? fail('WALLET_SIGN_IN_CHALLENGE_INVALID');
  if (challenge.d !== input.domain || challenge.u !== input.uri) fail('WALLET_SIGN_IN_ORIGIN_MISMATCH');
  if (!solanaPublicKey(input.address)) fail('WALLET_ADDRESS_INVALID');
  return solanaSignInMessage({ domain: challenge.d, uri: challenge.u, address: input.address, nonce: challenge.n,
    issuedAt: new Date(challenge.i * 1000).toISOString(), expirationTime: new Date(challenge.e * 1000).toISOString() });
}
/** Verifies the Ed25519 signature (base64, 64 bytes) over the challenge message and seals a Solana session for that key. */
export function verifySolanaSignIn(env: Env, input: { readonly challengeToken: string | undefined; readonly domain: string; readonly uri: string;
  readonly address: string; readonly signature: string; readonly now: Date }): { readonly token: string; readonly session: SolanaWalletSession } {
  const message = solanaChallengeMessage(env, input), key = solanaPublicKey(input.address)!;
  const signature = typeof input.signature === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(input.signature) ? Buffer.from(input.signature, 'base64') : null;
  let valid: boolean;
  try {
    valid = signature !== null && signature.length === 64 &&
      verify(null, Buffer.from(message, 'utf8'), createPublicKey({ key: Buffer.concat([ED25519_SPKI, key]), format: 'der', type: 'spki' }), signature);
  } catch { valid = false; }
  if (!valid) fail('WALLET_SIGNATURE_INVALID');
  const issued = seconds(input.now), session: SolanaSessionPayload = { a: input.address, n: 'solana', i: issued, e: issued + WALLET_SESSION_TTL_SECONDS,
    s: randomBytes(12).toString('hex'), d: input.domain };
  return { token: seal('n1', session, walletSessionKey(env)), session: { namespace: 'solana', account: session.a, expiresAt: new Date(session.e * 1000).toISOString() } };
}
/** The Solana session in a cookie value, or null (absent, tampered, expired, another key, another host, or an Ethereum session). */
export function readSolanaSession(env: Env, token: string | undefined, now: Date, domain: string): SolanaWalletSession | null {
  let key: Buffer;
  try { key = walletSessionKey(env); } catch { return null; }
  const session = unseal<SolanaSessionPayload>('n1', token, key, now);
  return session && session.n === 'solana' && solanaPublicKey(session.a) && session.d === domain
    ? { namespace: 'solana', account: session.a, expiresAt: new Date(session.e * 1000).toISOString() } : null;
}
