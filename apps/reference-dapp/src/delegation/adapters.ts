// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: delegated-authority adapters — one per mechanism, one interface. They prepare what the owner's wallet signs to
 * ENROLL a grant (once per Credential grant, never per workflow), verify that signature and the resulting on-chain state, re-verify a grant
 * read-only before it is used, and prepare/verify the owner's on-chain revocation. They never hold or derive an owner key and never sign
 * anything themselves; session-signer use is the executor's (`executor.ts`, `drivers.ts`).
 *
 *   EVM_ERC7710_METAMASK_V1_3  one EIP-712 Delegation (domain DelegationManager v1.3.0, chain-bound) signed with eth_signTypedData_v4 by a
 *                              MetaMask EIP-7702 smart account; the salt anchors the owner's authorization passkey; revocation is the
 *                              owner's self-call `disableDelegation(delegation)`
 *   SOLANA_SPL_DELEGATE_V1     one owner-signed transaction: a Memo anchoring the passkey + `ApproveChecked` to the session key for each
 *                              token account; revocation is an owner-signed `Revoke`
 */
import { createHash } from 'node:crypto';
import { erc7710, fromBase64, parseTransaction, splDelegation, toBase64, verifyEd25519, base58Encode } from '@defi-workflow-engine/reference-compiler';
import type { GrantScope } from './authority.ts';
import type { Mechanism } from './capabilities.ts';
import { domainDigest } from './canonical.ts';
import type { ChainTransport } from './chains.ts';
import type { GrantRecord } from './pg-store.ts';

const D = erc7710, F = D.DELEGATION_FRAMEWORK_V1_3, S = splDelegation;
const fail = (code: string): never => { throw new Error(code); };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
type Verified = { readonly ok: true; readonly payload: Readonly<Record<string, unknown>>; readonly commitment: string; readonly verification: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly code: string; readonly retryable?: boolean };
export type AuthorityState = { readonly state: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'UNCERTAIN'; readonly verification: Readonly<Record<string, unknown>> };
export type EnrollmentInput = { readonly grantId: string; readonly walletAddress: string; readonly chain: string; readonly scope: GrantScope; readonly sessionAddress: string;
  readonly anchor: string };
export interface AuthorityAdapter {
  readonly mechanism: Mechanism;
  readonly prepareEnrollment: (input: EnrollmentInput, transport: ChainTransport) => Promise<Readonly<Record<string, unknown>>>;
  readonly verifyEnrollment: (grant: GrantRecord, response: unknown, transport: ChainTransport) => Promise<Verified>;
  readonly reconcileAuthorityState: (grant: GrantRecord, transport: ChainTransport, now: Date) => Promise<AuthorityState>;
  readonly prepareRevocation: (grant: GrantRecord, transport: ChainTransport) => Promise<Readonly<Record<string, unknown>>>;
  readonly verifyRevocation: (grant: GrantRecord, response: unknown, transport: ChainTransport) => Promise<AuthorityState>;
}

/**
 * The anchor an enrollment commits to: the owner's authorization passkey (its public key, not just its id) for this exact grant. The executor
 * recomputes it from the passkey it is about to trust, so a swapped passkey row cannot inherit a wallet's signed grant.
 */
export function passkeyAnchor(input: { readonly owner: string; readonly grantId: string; readonly chain: string; readonly walletAddress: string;
  readonly passkeyId: string; readonly publicKeySpki: Uint8Array }): string {
  return domainDigest('flofi.credential-passkey-anchor.v1', { owner: input.owner, grantId: input.grantId, chain: input.chain, wallet: input.walletAddress,
    passkeyId: input.passkeyId, publicKey: '0x' + createHash('sha256').update(input.publicKeySpki).digest('hex') });
}

// ── EVM: ERC-7710 / MetaMask Delegation Framework v1.3.0 ───────────────────────────────────────────────────────────────────────
const chainIdOf = (chain: string) => { const m = /^eip155:([1-9][0-9]{0,18})$/.exec(chain); return m ? Number(m[1]) : fail('DELEGATION_CHAIN_INVALID'); };
const seconds = (iso: string) => BigInt(Math.floor(Date.parse(iso) / 1000));
export function evmTemplates(scope: Extract<GrantScope, { mechanism: 'EVM_ERC7710_METAMASK_V1_3' }>): erc7710.CallTemplate[] {
  const approvals = [...new Set(scope.pairs.map(p => p.tokenIn))].map(token => ({ kind: 'ERC20_APPROVE' as const, token, spender: scope.router }));
  const swaps = scope.pairs.map(p => ({ kind: 'UNISWAP_V3_EXACT_INPUT_SINGLE' as const, router: scope.router, tokenIn: p.tokenIn, tokenOut: p.tokenOut, perCallInputCap: BigInt(p.perCallInputCap) }));
  return [...approvals, ...swaps];
}
type SerialDelegation = Omit<erc7710.Delegation, 'salt'> & { readonly salt: string };
export const serializeDelegation = (d: erc7710.Delegation | Omit<erc7710.Delegation, 'signature'>): SerialDelegation | Omit<SerialDelegation, 'signature'> => ({ ...d, salt: d.salt.toString() });
export function delegationOf(value: unknown): erc7710.Delegation {
  if (!isObject(value) || typeof value.salt !== 'string' || !/^[0-9]{1,78}$/.test(value.salt) || typeof value.signature !== 'string' || !Array.isArray(value.caveats))
    fail('DELEGATION_PAYLOAD_INVALID');
  const v = value as unknown as SerialDelegation;
  return { delegate: D.evmAddress(v.delegate), delegator: D.evmAddress(v.delegator), authority: v.authority, salt: BigInt(v.salt), signature: v.signature,
    caveats: v.caveats.map(c => ({ enforcer: D.evmAddress(c.enforcer), terms: c.terms, args: c.args })) };
}
const call = async (t: ChainTransport, to: string, data: string) => String(await t.rpc('eth_call', [{ to, data }, 'latest']));
const codeAt = async (t: ChainTransport, address: string) => String(await t.rpc('eth_getCode', [address, 'latest'])).toLowerCase();
async function disabledOnChain(t: ChainTransport, hash: string): Promise<boolean> {
  const raw = await call(t, F.delegationManager, D.disabledDelegationsCalldata(hash));
  return BigInt(raw.slice(0, 66)) === 1n;
}

export const evmAdapter: AuthorityAdapter = {
  mechanism: 'EVM_ERC7710_METAMASK_V1_3',
  async prepareEnrollment(input) {
    const scope = input.scope;
    if (scope.mechanism !== 'EVM_ERC7710_METAMASK_V1_3' || scope.chain !== input.chain) return fail('CREDENTIAL_SCOPE_INVALID');
    const chainId = chainIdOf(input.chain);
    // Strictly-after/strictly-before bounds (TimestampEnforcer): usable from validFrom to expiresAt.
    const delegation = D.compileGrant({ chainId, owner: input.walletAddress, session: input.sessionAddress, validAfter: seconds(scope.validFrom) - 1n,
      validBefore: seconds(scope.expiresAt), maxCalls: BigInt(scope.maxCalls), templates: evmTemplates(scope), salt: BigInt(input.anchor) });
    return { kind: 'EVM_EIP712_DELEGATION', chainId, typedData: D.delegationTypedData(chainId, delegation), delegation: serializeDelegation(delegation),
      digest: D.delegationDigest(chainId, delegation), delegationHash: D.delegationHash(delegation),
      requires: { account: 'METAMASK_EIP7702_SMART_ACCOUNT', implementation: F.eip7702StatelessDeleGator, delegationManager: F.delegationManager, frameworkVersion: F.version } };
  },
  async verifyEnrollment(grant, response, t) {
    if (!isObject(response) || typeof response.signature !== 'string') return { ok: false, code: 'ENROLLMENT_RESPONSE_INVALID' };
    const unsigned = delegationOf({ ...grant.enrollment.delegation as object, signature: '0x' });
    const chainId = chainIdOf(grant.chain), digest = D.delegationDigest(chainId, unsigned);
    let signer: string;
    try { signer = D.recoverDigestSigner(digest, response.signature); } catch { return { ok: false, code: 'ENROLLMENT_SIGNATURE_INVALID' }; }
    if (signer !== grant.walletAddress) return { ok: false, code: 'ENROLLMENT_SIGNER_MISMATCH' };
    if (BigInt(String(await t.rpc('eth_chainId', []))) !== BigInt(chainId)) return { ok: false, code: 'DELEGATION_WRONG_CHAIN', retryable: true };
    if (await codeAt(t, grant.walletAddress) !== D.DELEGATOR_DESIGNATOR) return { ok: false, code: 'EVM_ACCOUNT_NOT_UPGRADED', retryable: true };
    const used = [F.delegationManager, ...new Set(unsigned.caveats.flatMap(c => c.enforcer === F.enforcers.logicalOrWrapper
      ? [c.enforcer, ...D.decodeLogicalOrTerms(c.terms).flat().map(x => x.enforcer)] : [c.enforcer]))];
    for (const address of used) if (['0x', '0x0'].includes(await codeAt(t, address))) return { ok: false, code: 'DELEGATION_FRAMEWORK_NOT_DEPLOYED' };
    const hash = D.delegationHash(unsigned);
    if (await disabledOnChain(t, hash)) return { ok: false, code: 'DELEGATION_DISABLED' };
    return { ok: true, commitment: hash, payload: { delegation: serializeDelegation({ ...unsigned, signature: response.signature.toLowerCase() }), delegationHash: hash, chainId },
      verification: { checks: ['OWNER_SIGNATURE', 'EIP7702_DESIGNATOR', 'FRAMEWORK_CODE', 'NOT_DISABLED'], provenance: t.provenance } };
  },
  async reconcileAuthorityState(grant, t, now) {
    if (now.getTime() >= grant.expiresAt.getTime()) return { state: 'EXPIRED', verification: { reason: 'EXPIRED', at: now.toISOString() } };
    const hash = grant.commitment ?? fail('CREDENTIAL_NOT_ENROLLED');
    try {
      if (await disabledOnChain(t, hash)) return { state: 'REVOKED', verification: { reason: 'DISABLED_ON_CHAIN', at: now.toISOString(), provenance: t.provenance } };
      if (await codeAt(t, grant.walletAddress) !== D.DELEGATOR_DESIGNATOR) return { state: 'UNCERTAIN', verification: { reason: 'EVM_ACCOUNT_DELEGATOR_CHANGED', at: now.toISOString() } };
    } catch { return { state: 'UNCERTAIN', verification: { reason: 'CHAIN_READ_FAILED', at: now.toISOString() } }; }
    return { state: 'ACTIVE', verification: { reason: 'VERIFIED', at: now.toISOString(), provenance: t.provenance } };
  },
  async prepareRevocation(grant) {
    const delegation = delegationOf((grant.grantPayload ?? fail('CREDENTIAL_NOT_ENROLLED')).delegation);
    return { kind: 'EVM_OWNER_SELF_CALL', chainId: chainIdOf(grant.chain), from: grant.walletAddress, to: grant.walletAddress, value: '0x0',
      data: D.disableDelegationCalldata(delegation), delegationHash: grant.commitment };
  },
  async verifyRevocation(grant, _response, t) {
    try {
      return await disabledOnChain(t, grant.commitment ?? fail('CREDENTIAL_NOT_ENROLLED'))
        ? { state: 'REVOKED', verification: { reason: 'DISABLED_ON_CHAIN', provenance: t.provenance } }
        : { state: 'UNCERTAIN', verification: { reason: 'NOT_YET_DISABLED' } };
    } catch { return { state: 'UNCERTAIN', verification: { reason: 'CHAIN_READ_FAILED' } }; }
  },
};

// ── Solana: SPL Token delegation ───────────────────────────────────────────────────────────────────────────────────────────────
async function tokenAccount(t: ChainTransport, address: string): Promise<splDelegation.TokenAccountState | null> {
  const info = await t.rpc('getAccountInfo', [address, { encoding: 'base64' }]) as { value?: { data?: unknown; owner?: unknown } | null } | null;
  const value = info?.value;
  if (!value) return null;
  if (value.owner !== S.TOKEN_PROGRAM || !Array.isArray(value.data) || typeof value.data[0] !== 'string') fail('SOLANA_ACCOUNT_INVALID');
  return S.decodeTokenAccountState(fromBase64((value.data as string[])[0], 4096));
}
async function blockhash(t: ChainTransport): Promise<string> {
  const r = await t.rpc('getLatestBlockhash', [{ commitment: 'finalized' }]) as { value?: { blockhash?: unknown } } | null;
  return typeof r?.value?.blockhash === 'string' ? r.value.blockhash : fail('SOLANA_BLOCKHASH_UNAVAILABLE');
}
/** Verifies the owner's signature over exactly `message`, broadcasts the owner-signed transaction, and returns its signature. */
async function ownerBroadcast(t: ChainTransport, owner: string, message: Uint8Array, signedBase64: unknown): Promise<{ readonly signature: string; readonly wire: string }> {
  const wire = fromBase64(signedBase64, 1_232 * 2), parsed = parseTransaction(wire);
  if (Buffer.compare(Buffer.from(parsed.message), Buffer.from(message)) !== 0) fail('ENROLLMENT_MESSAGE_MISMATCH');
  if (parsed.signatures.length !== 1 || !verifyEd25519(parsed.signatures[0]!, message, owner)) fail('ENROLLMENT_SIGNATURE_INVALID');
  const signature = base58Encode(parsed.signatures[0]!);
  await t.rpc('sendTransaction', [toBase64(wire), { encoding: 'base64', skipPreflight: false }]);
  return { signature, wire: toBase64(wire) };
}

export const solanaAdapter: AuthorityAdapter = {
  mechanism: 'SOLANA_SPL_DELEGATE_V1',
  async prepareEnrollment(input, t) {
    const scope = input.scope;
    if (scope.mechanism !== 'SOLANA_SPL_DELEGATE_V1' || scope.chain !== input.chain || !scope.accounts.length) return fail('CREDENTIAL_SCOPE_INVALID');
    const memo = `flofi:grant:v1:${input.anchor.slice(2)}`;
    const ixs = [S.memo(memo, input.walletAddress), ...scope.accounts.map(a => S.approveChecked({ source: a.tokenAccount, mint: a.mint, delegate: input.sessionAddress,
      owner: input.walletAddress, amount: BigInt(a.amount), decimals: a.decimals }))];
    const message = S.ownerMessage(input.walletAddress, ixs, await blockhash(t));
    return { kind: 'SOLANA_DELEGATION_TRANSACTION', message: toBase64(message), transaction: toBase64(Uint8Array.from([1, ...new Uint8Array(64), ...message])), memo,
      delegate: input.sessionAddress, accounts: scope.accounts.map(a => ({ tokenAccount: a.tokenAccount, mint: a.mint, amount: a.amount })) };
  },
  async verifyEnrollment(grant, response, t) {
    const scope = grant.scope;
    if (scope.mechanism !== 'SOLANA_SPL_DELEGATE_V1' || !isObject(response)) return { ok: false, code: 'ENROLLMENT_RESPONSE_INVALID' };
    let sent: { signature: string; wire: string };
    try { sent = await ownerBroadcast(t, grant.walletAddress, fromBase64(grant.enrollment.message, 1_232 * 2), response.signedTransaction); }
    catch (cause) { return { ok: false, code: cause instanceof Error && /^[A-Z_]{3,80}$/.test(cause.message) ? cause.message : 'ENROLLMENT_BROADCAST_FAILED', retryable: true }; }
    for (const a of scope.accounts) {
      const state = await tokenAccount(t, a.tokenAccount);
      if (!state || !S.delegationActive(state, { owner: grant.walletAddress, mint: a.mint, delegate: grant.sessionAddress, amount: BigInt(a.amount) }))
        return { ok: false, code: 'SOLANA_DELEGATION_NOT_CONFIRMED', retryable: true };
    }
    const messageHash = '0x' + createHash('sha256').update(fromBase64(grant.enrollment.message, 1_232 * 2)).digest('hex');
    return { ok: true, commitment: domainDigest('flofi.solana-delegation-commitment.v1', { signature: sent.signature, messageHash }),
      payload: { signedTransaction: sent.wire, signature: sent.signature, messageHash }, verification: { checks: ['OWNER_SIGNATURE', 'DELEGATE_READBACK'], provenance: t.provenance } };
  },
  async reconcileAuthorityState(grant, t, now) {
    if (now.getTime() >= grant.expiresAt.getTime()) return { state: 'EXPIRED', verification: { reason: 'EXPIRED', at: now.toISOString() } };
    const scope = grant.scope;
    if (scope.mechanism !== 'SOLANA_SPL_DELEGATE_V1') return { state: 'UNCERTAIN', verification: { reason: 'SCOPE_INVALID' } };
    try {
      const remaining: Record<string, string> = {};
      for (const a of scope.accounts) {
        const state = await tokenAccount(t, a.tokenAccount);
        if (!state || state.owner !== grant.walletAddress || state.mint !== a.mint) return { state: 'UNCERTAIN', verification: { reason: 'TOKEN_ACCOUNT_CHANGED', at: now.toISOString() } };
        // A cleared delegate is either the owner's revoke or an exhausted amount: either way FloFi must not rely on it.
        if (state.delegate !== grant.sessionAddress) return { state: 'UNCERTAIN', verification: { reason: 'SOLANA_DELEGATION_CLEARED', at: now.toISOString() } };
        remaining[a.mint] = state.delegatedAmount.toString();
      }
      return { state: 'ACTIVE', verification: { reason: 'VERIFIED', remaining, at: now.toISOString(), provenance: t.provenance } };
    } catch { return { state: 'UNCERTAIN', verification: { reason: 'CHAIN_READ_FAILED', at: now.toISOString() } }; }
  },
  async prepareRevocation(grant, t) {
    const scope = grant.scope;
    if (scope.mechanism !== 'SOLANA_SPL_DELEGATE_V1') return fail('CREDENTIAL_SCOPE_INVALID');
    const ixs = [S.memo(`flofi:revoke:v1:${grant.grantId}`, grant.walletAddress), ...scope.accounts.map(a => S.revoke({ source: a.tokenAccount, owner: grant.walletAddress }))];
    const message = S.ownerMessage(grant.walletAddress, ixs, await blockhash(t));
    return { kind: 'SOLANA_REVOCATION_TRANSACTION', message: toBase64(message), transaction: toBase64(Uint8Array.from([1, ...new Uint8Array(64), ...message])) };
  },
  async verifyRevocation(grant, response, t) {
    const scope = grant.scope;
    if (scope.mechanism !== 'SOLANA_SPL_DELEGATE_V1' || !isObject(response) || !isObject(grant.revocation)) return { state: 'UNCERTAIN', verification: { reason: 'RESPONSE_INVALID' } };
    try { await ownerBroadcast(t, grant.walletAddress, fromBase64(grant.revocation.message, 1_232 * 2), response.signedTransaction); }
    catch { return { state: 'UNCERTAIN', verification: { reason: 'REVOCATION_BROADCAST_FAILED' } }; }
    for (const a of scope.accounts) {
      const state = await tokenAccount(t, a.tokenAccount).catch(() => null);
      if (!state || state.delegate === grant.sessionAddress) return { state: 'UNCERTAIN', verification: { reason: 'DELEGATE_STILL_SET' } };
    }
    return { state: 'REVOKED', verification: { reason: 'DELEGATE_CLEARED', provenance: t.provenance } };
  },
};
export const ADAPTERS: Readonly<Record<Mechanism, AuthorityAdapter>> = Object.freeze({ EVM_ERC7710_METAMASK_V1_3: evmAdapter, SOLANA_SPL_DELEGATE_V1: solanaAdapter });
