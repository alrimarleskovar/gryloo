// SPDX-License-Identifier: AGPL-3.0-only
'use server';
import { cookies } from 'next/headers';
import { challengeMessage, issueWalletChallenge, SOLANA_CHALLENGE_COOKIE, SOLANA_SESSION_COOKIE, solanaChallengeMessage, verifySolanaSignIn, verifyWalletSignIn,
  WALLET_CHALLENGE_COOKIE, WALLET_CHALLENGE_TTL_SECONDS, WALLET_SESSION_COOKIE, WALLET_SESSION_TTL_SECONDS, type SolanaWalletSession,
  type WalletSession } from '../server/wallet-session';
import { currentSolanaSession, currentWalletSession, requestOrigin } from '../server/session-principal';

/**
 * BUILD-JOURNEY-001: sign-in with the connected wallet (EIP-4361 over `personal_sign`). The challenge and the session live in
 * HttpOnly, SameSite=Strict cookies; the browser only relays the message to its own wallet and returns the signature.
 * The session binds runs to the wallet that created them. It authorizes no transaction: Flofi still never signs or sends.
 */
type Result<T> = { ok: true; value: T } | { ok: false; code: string };
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const failure = (cause: unknown): { ok: false; code: string } =>
  ({ ok: false, code: cause instanceof Error && CODE.test(cause.message) ? cause.message : 'WALLET_SIGN_IN_FAILED' });
const cookieOptions = (secure: boolean, maxAge: number) => ({ httpOnly: true, sameSite: 'strict' as const, secure, path: '/', maxAge });

export async function walletSignInChallenge(address: string, chainId: number): Promise<Result<{ message: string }>> {
  try {
    const account = typeof address === 'string' ? address.toLowerCase() : '', origin = await requestOrigin(), now = new Date();
    const challenge = issueWalletChallenge(process.env, { domain: origin.domain, uri: origin.uri, now });
    const message = challengeMessage(process.env, { challengeToken: challenge.token, domain: origin.domain, uri: origin.uri, address: account, chainId, now });
    (await cookies()).set(WALLET_CHALLENGE_COOKIE, challenge.token, cookieOptions(origin.secure, WALLET_CHALLENGE_TTL_SECONDS));
    return { ok: true, value: { message } };
  } catch (cause) { return failure(cause); }
}
export async function walletSignIn(address: string, chainId: number, signature: string): Promise<Result<WalletSession>> {
  try {
    const jar = await cookies(), origin = await requestOrigin(), challengeToken = jar.get(WALLET_CHALLENGE_COOKIE)?.value;
    // The challenge is single-use from the browser's side: it is removed whatever the outcome.
    jar.delete(WALLET_CHALLENGE_COOKIE);
    const { token, session } = verifyWalletSignIn(process.env, { challengeToken, domain: origin.domain, uri: origin.uri,
      address: typeof address === 'string' ? address.toLowerCase() : '', chainId, signature, now: new Date() });
    jar.set(WALLET_SESSION_COOKIE, token, cookieOptions(origin.secure, WALLET_SESSION_TTL_SECONDS));
    return { ok: true, value: session };
  } catch (cause) { return failure(cause); }
}
export async function walletSessionStatus(): Promise<WalletSession | null> {
  try { return await currentWalletSession(); } catch { return null; }
}
export async function walletSignOut(): Promise<void> {
  (await cookies()).delete(WALLET_SESSION_COOKIE);
}

/**
 * BUILD-MCP-002: Sign-In With Solana (Wallet Standard `solana:signMessage`). Same rules as the Ethereum sign-in: a single-use
 * HttpOnly challenge, the server rebuilds the message, verifies the Ed25519 signature and seals a session for exactly that key.
 */
export async function solanaSignInChallenge(address: string): Promise<Result<{ message: string }>> {
  try {
    const origin = await requestOrigin(), now = new Date(), account = typeof address === 'string' ? address : '';
    const challenge = issueWalletChallenge(process.env, { domain: origin.domain, uri: origin.uri, now });
    const message = solanaChallengeMessage(process.env, { challengeToken: challenge.token, domain: origin.domain, uri: origin.uri, address: account, now });
    (await cookies()).set(SOLANA_CHALLENGE_COOKIE, challenge.token, cookieOptions(origin.secure, WALLET_CHALLENGE_TTL_SECONDS));
    return { ok: true, value: { message } };
  } catch (cause) { return failure(cause); }
}
export async function solanaSignIn(address: string, signature: string): Promise<Result<SolanaWalletSession>> {
  try {
    const jar = await cookies(), origin = await requestOrigin(), challengeToken = jar.get(SOLANA_CHALLENGE_COOKIE)?.value;
    jar.delete(SOLANA_CHALLENGE_COOKIE);
    const { token, session } = verifySolanaSignIn(process.env, { challengeToken, domain: origin.domain, uri: origin.uri,
      address: typeof address === 'string' ? address : '', signature: typeof signature === 'string' ? signature : '', now: new Date() });
    jar.set(SOLANA_SESSION_COOKIE, token, cookieOptions(origin.secure, WALLET_SESSION_TTL_SECONDS));
    return { ok: true, value: session };
  } catch (cause) { return failure(cause); }
}
export async function solanaSessionStatus(): Promise<SolanaWalletSession | null> {
  try { return await currentSolanaSession(); } catch { return null; }
}
export async function solanaSignOut(): Promise<void> {
  (await cookies()).delete(SOLANA_SESSION_COOKIE);
}
