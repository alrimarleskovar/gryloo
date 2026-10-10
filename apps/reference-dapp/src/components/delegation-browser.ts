// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-AUTOMATION-002: the browser half of delegated authority — the owner's own devices produce every signature, FloFi only relays them:
 *
 *   passkeys       `navigator.credentials.create/get` (WebAuthn, ES256, user verification required). The authorization challenge is the
 *                  digest of the Universal Workflow Authorization envelope, so the passkey signs that authorization itself.
 *   EVM wallet     `eth_signTypedData_v4` of the Credential's EIP-712 Delegation (enrollment, once per grant) and the owner's own
 *                  `disableDelegation` self-call (revocation). Never anything per workflow or per execution.
 *   Solana wallet  `solana:signTransaction` of the Credential's delegation (or revocation) transaction.
 *
 * Nothing here holds a key or stores a credential (no localStorage, no cookies written).
 */
import { chosenEvmProvider, injected, type EvmProvider } from '../wallet/evm-discovery';
import { connectSolanaWallet, signWithSolanaWallet, solanaWalletChoices, type SolanaWalletChain } from '../wallet/solana-wallet';
import type { PasskeyOptionsView, ReviewView } from '../delegation/views';

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(Array.from(view, b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0));
const fail = (code: string): never => { throw new Error(code); };

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials;
}
/** Registers a passkey for the options FloFi issued (single-use challenge). Returns what FloFi verifies. */
export async function createPasskey(options: PasskeyOptionsView, label: string) {
  if (!passkeysSupported()) fail('PASSKEY_UNSUPPORTED');
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: fromB64url(options.challenge), rp: { id: options.rpId, name: options.rpName },
    user: { id: fromB64url(options.userId), name: options.userName, displayName: options.userName },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: options.timeoutMs, attestation: 'none',
    authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
    excludeCredentials: options.excludeCredentials.map(id => ({ type: 'public-key' as const, id: fromB64url(id) })),
  } }) as PublicKeyCredential | null;
  if (!credential) return fail('PASSKEY_CANCELLED');
  const response = credential.response as AuthenticatorAttestationResponse;
  return { challenge: options.challenge, credentialId: b64url(credential.rawId), clientDataJSON: b64url(response.clientDataJSON),
    authenticatorData: b64url(response.getAuthenticatorData()), publicKeyAlgorithm: response.getPublicKeyAlgorithm(), label };
}
/** The owner's ONE workflow signature: a passkey assertion over the authorization digest. */
export async function assertPasskey(review: ReviewView) {
  if (!passkeysSupported()) fail('PASSKEY_UNSUPPORTED');
  const credential = await navigator.credentials.get({ publicKey: { challenge: fromB64url(review.challenge), rpId: review.passkey.rpId, timeout: 300_000,
    userVerification: 'required', allowCredentials: [{ type: 'public-key', id: fromB64url(review.passkey.credentialId) }] } }) as PublicKeyCredential | null;
  if (!credential) return fail('PASSKEY_CANCELLED');
  const response = credential.response as AuthenticatorAssertionResponse;
  return { credentialId: b64url(credential.rawId), clientDataJSON: b64url(response.clientDataJSON), authenticatorData: b64url(response.authenticatorData),
    signature: b64url(response.signature) };
}

const evmProvider = (): EvmProvider => chosenEvmProvider() ?? injected() ?? fail('EVM_WALLET_NOT_FOUND');
/** Credential enrollment: the EVM wallet signs the Delegation's EIP-712 typed data (once per grant). */
export async function signDelegation(address: string, typedData: unknown): Promise<string> {
  const signature = await evmProvider().request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typedData)] });
  return typeof signature === 'string' ? signature : fail('WALLET_SIGNATURE_INVALID');
}
/** Credential revocation: the owner's own self-call `disableDelegation(delegation)`, sent by the owner's wallet. */
export async function sendRevocation(payload: { from: string; to: string; data: string; chainId: number }): Promise<string> {
  const hash = await evmProvider().request({ method: 'eth_sendTransaction', params: [{ from: payload.from, to: payload.to, data: payload.data, value: '0x0',
    chainId: '0x' + payload.chainId.toString(16) }] });
  return typeof hash === 'string' ? hash : fail('WALLET_RESPONSE_INVALID');
}
/** Solana enrollment / revocation: the owner's Solana wallet signs the prepared transaction (FloFi broadcasts the owner-signed bytes). */
export async function signSolanaWith(address: string, unsignedTransaction: string, chain: SolanaWalletChain = 'solana:devnet'): Promise<string> {
  for (const choice of solanaWalletChoices(chain)) {
    const session = await connectSolanaWallet(choice.key, chain, 'DELEGATION').catch(() => null);
    if (session?.account.address === address) return signWithSolanaWallet(session, unsignedTransaction, 'DELEGATION');
  }
  return fail('SOLANA_WALLET_NOT_FOUND');
}
