// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-AUTOMATION-002: Passkeys and execution Credentials. A passkey is the owner's chain-neutral key for authorizing whole workflows. An
 * execution Credential is a proven wallet enrolled for delegated execution on one chain: the wallet signs ONE bounded grant (an ERC-7710
 * delegation for EVM, an SPL token delegation for Solana) to a session signer dedicated to that grant. Enrollment and revocation signatures
 * belong to the Credential lifecycle — never to a workflow or an execution.
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { credentialComplete, credentialPrepare, credentialReverify, credentialRevocationComplete, credentialRevoke, delegationEnabled, delegationOverview, passkeyOptions,
  passkeyRegister, passkeyRevoke } from '../app/delegation-action';
import type { DelegationOverviewView, GrantView, PasskeyView } from '../delegation/views';
import type { WorkflowOwner } from '../domain/saved-workflow';
import { useLocale } from '../i18n/locale';
import { createPasskey, passkeysSupported, sendRevocation, signDelegation, signSolanaWith } from './delegation-browser';
import { DELEGATION_ERROR_TEXT } from './delegated-automations';
import { useWalletAuthorityEpoch } from './wallet-authority-epoch';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { useJupiter } from '../state/jupiter-store';
import { WalletProof, useWalletProof } from './wallet-proof';

export type DelegationAccess = { readonly owner: WorkflowOwner | null; readonly proof: ReturnType<typeof useWalletProof> };
const ERROR_TEXT: Readonly<Record<string, string>> = { ...DELEGATION_ERROR_TEXT, EVM_ACCOUNT_NOT_UPGRADED: 'This account is not a MetaMask smart account yet. Switch it to a smart account in MetaMask, then verify again.',
  ENROLLMENT_SIGNER_MISMATCH: 'The signature came from another account.', ENROLLMENT_SIGNATURE_INVALID: 'The wallet signature is invalid.',
  SOLANA_DELEGATION_NOT_CONFIRMED: 'The delegation is not visible on-chain yet. Verify again in a moment.', WALLET_SESSION_REQUIRED: 'Prove ownership of this wallet first.',
  CREDENTIAL_SCOPE_INVALID: 'Check the tokens and amounts.', WALLET_ACCOUNT_MISMATCH: 'Switch your wallet to the account of this Credential, then try again.',
  SOLANA_WALLET_SESSION_REQUIRED: 'Connect the Solana wallet of this Credential (the one you proved), then try again.', CREDENTIAL_EXPIRY_INVALID: 'Choose an expiry in the future, at most one year away.' };
const STATE: Readonly<Record<string, string>> = { PENDING_SIGNATURE: 'Waiting for your wallet', ACTIVE: 'Active', REVOCATION_REQUESTED: 'Revocation requested', REVOKED: 'Revoked',
  EXPIRED: 'Expired', UNCERTAIN: 'Unverified', FAILED: 'Failed' };
const plusMonths = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const codeOf = (cause: unknown) => cause instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(cause.message) ? cause.message : 'WALLET_REQUEST_FAILED';

/** Whether this deployment serves delegated execution (null while unknown). */
function useEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => { void delegationEnabled().then(r => setEnabled(r.enabled)).catch(() => setEnabled(false)); }, []);
  return enabled;
}
function useOverview(owner: WorkflowOwner | null, proven: boolean) {
  const [overview, setOverview] = useState<DelegationOverviewView | null>(null), [code, setCode] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!owner || !proven) return;
    const r = await delegationOverview(owner).catch(() => ({ ok: false as const, code: 'DELEGATION_UNAVAILABLE' }));
    if (r.ok) { setOverview(r.value); setCode(null); } else { setOverview(null); setCode(r.code); }
  }, [owner, proven]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { overview, code, refresh };
}
function useRunner(refresh: () => Promise<void>) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState<string | null>(null);
  const run = useCallback(async (work: () => Promise<{ ok: boolean; code?: string }>, done?: string) => {
    if (busy) return false;
    setBusy(true); setNotice(''); setError(null);
    try { const r = await work(); if (!r.ok) { setError(r.code ?? 'DELEGATION_UNAVAILABLE'); return false; } if (done) setNotice(done); await refresh(); return true; }
    catch (cause) { setError(codeOf(cause)); return false; } finally { setBusy(false); }
  }, [busy, refresh]);
  const messages: ReactNode = <>{notice && <p className="workspace-notice" role="status">{t(notice)}</p>}
    {error && <p className="error-banner" role="alert">{ERROR_TEXT[error] ? t(ERROR_TEXT[error]) : t('FloFi could not complete this ({0}).', error)}</p>}</>;
  return { busy, run, messages };
}

/** The Passkeys workspace: the placeholder of main until delegated execution is enabled and the owner proved a wallet. */
export function PasskeysPanel({ access, placeholder }: { access: DelegationAccess | undefined; placeholder: ReactNode }) {
  return access ? <PasskeysManager access={access} placeholder={placeholder}/> : <>{placeholder}</>;
}
function PasskeysManager({ access, placeholder }: { access: DelegationAccess; placeholder: ReactNode }) {
  const { t } = useLocale(), owner = access.owner, proven = Boolean(owner && access.proof.proven === owner.address);
  const { overview, code, refresh } = useOverview(owner, proven), { busy, run, messages } = useRunner(refresh);
  const [label, setLabel] = useState('This device');
  const enabled = useEnabled();
  // Without delegated execution on this deployment (or without a connected wallet) the workspace stays exactly as before.
  if (!enabled || !owner || code === 'DELEGATION_NOT_ENABLED') return <>{placeholder}</>;
  if (!proven) return <><header className="secondary-workspace-heading"><h1>{t('Passkeys')}</h1><p>{t('A passkey is how you authorize automatic workflows: once per workflow, on this device.')}</p></header>
    <div className="workspace-empty"><p>{t('Verify wallet ownership to manage passkeys.')}</p><WalletProof namespace={owner.namespace} proof={{ ...access.proof, proven: null }}/></div></>;
  async function add(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const options = await passkeyOptions(owner!);
      if (!options.ok) return options;
      try { return await passkeyRegister(owner!, await createPasskey(options.value, label.trim() || 'Passkey')); }
      catch (cause) { return { ok: false, code: codeOf(cause) }; }
    }, 'Passkey added.');
  }
  const passkeys: readonly PasskeyView[] = overview?.passkeys ?? [];
  return <section className="delegation-passkeys" aria-label={t('Passkeys')}>
    <header className="secondary-workspace-heading"><h1>{t('Passkeys')}</h1><p>{t('A passkey is how you authorize automatic workflows: once per workflow, with this device. It is never a wallet key and never moves funds by itself.')}</p></header>
    {messages}
    <form className="automation-inline-form" aria-label={t('Add a passkey')} onSubmit={event => void add(event)}>
      <label>{t('Name')}<input aria-label={t('Passkey name')} value={label} maxLength={40} onChange={e => setLabel(e.currentTarget.value)}/></label>
      <button type="submit" className="workspace-action primary-action" disabled={busy || !passkeysSupported()}>{t('Add a passkey')}</button>
    </form>
    {passkeys.length ? <ul className="delegation-passkey-list">{passkeys.map(p => <li key={p.passkeyId} aria-label={t('Passkey {0}', p.label)}>
      <strong>{p.label}</strong> · {t(p.revoked ? 'Revoked' : 'Active')} · {t('added {0}', new Date(p.createdAt).toLocaleDateString())}
      {!p.revoked && <button type="button" className="workspace-action" disabled={busy} onClick={() => void run(() => passkeyRevoke(owner, p.passkeyId), 'Passkey revoked.')}>{t('Revoke')}</button>}
    </li>)}</ul> : <div className="workspace-empty"><p>{t('No passkeys yet. Add one to get started.')}</p></div>}
  </section>;
}

function GrantCard({ g, owner, busy, run }: { g: GrantView; owner: WorkflowOwner; busy: boolean; run: (work: () => Promise<{ ok: boolean; code?: string }>, done?: string) => Promise<boolean> }) {
  const { t } = useLocale(), evm = useBuild009Wallet(), solana = useJupiter();
  async function finishRevocation() {
    await run(async () => {
      const payload = g.revocation as Record<string, unknown> | null;
      if (!payload) return { ok: false, code: 'CREDENTIAL_REVOCATION_NOT_REQUESTED' };
      if (g.walletNamespace === 'eip155') {
        // Only the grant's own wallet can disable its delegation; ask nothing of any other account.
        if (evm.account !== g.walletAddress) return { ok: false, code: 'WALLET_ACCOUNT_MISMATCH' };
        await sendRevocation({ from: String(payload.from), to: String(payload.to), data: String(payload.data), chainId: Number(payload.chainId) });
        // Once sent, completion only observes the chain (never a second transaction), whatever the wallet does next.
        return credentialRevocationComplete(owner, g.grantId, {});
      }
      return credentialRevocationComplete(owner, g.grantId, { signedTransaction: await signSolanaWith(g.walletAddress, String(payload.transaction), solana.session) });
    }, 'Revocation submitted by your wallet and checked on-chain.');
  }
  return <li className="automation-card delegation-grant" aria-label={t('Credential {0} on {1}', short(g.walletAddress), g.network)} data-state={g.state}>
    <header className="automation-card-head"><div><h3>{g.network} · {short(g.walletAddress)}</h3><p>{t(g.mechanism === 'EVM_ERC7710_METAMASK_V1_3' ? 'MetaMask delegation (ERC-7710)' : 'SPL token delegation')}</p></div>
      <span className="automation-badge" data-state={g.state}>{t(STATE[g.state] ?? g.state)}</span></header>
    <p>{g.scope.kind === 'EVM' ? t('Uniswap v3 swaps {0}; at most {1} calls ({2} used); recipient: this wallet only', g.scope.pairs.map(p => `${p.input} → ${p.output} ≤ ${p.perCallCap}`).join(', '),
      String(g.scope.maxCalls), String(g.callsUsed))
      : t('Spend up to {0} from this wallet’s token account; recipient and program are checked by FloFi, not on-chain', g.scope.tokens.map(x => `${x.amount} ${x.symbol}`).join(', '))}</p>
    <p className="muted">{t('Expires {0}', new Date(g.expiresAt).toLocaleDateString())}{g.verifiedAt ? ` · ${t('verified {0}', new Date(g.verifiedAt).toLocaleString())}` : ''}</p>
    <div className="automation-row-actions">
      {(g.state === 'ACTIVE' || g.state === 'UNCERTAIN') && <button type="button" className="workspace-action" disabled={busy} onClick={() => void run(() => credentialReverify(owner, g.grantId), 'Verified on-chain.')}>{t('Verify again')}</button>}
      {['ACTIVE', 'UNCERTAIN', 'EXPIRED'].includes(g.state) && <button type="button" className="workspace-action workspace-action-danger" disabled={busy} onClick={() => void run(() => credentialRevoke(owner, g.grantId),
        'FloFi stopped using this Credential. Now confirm the on-chain revocation in your wallet.')}>{t('Revoke credential')}</button>}
      {g.state === 'REVOCATION_REQUESTED' && <button type="button" className="workspace-action primary-action" disabled={busy} onClick={() => void finishRevocation()}>{t('Revoke on-chain with your wallet')}</button>}
    </div>
  </li>;
}

/** Credentials → "Automatic execution": the owner's execution Credentials and their enrollment. Nothing renders (and no wallet hook runs) without the
 * shell's wallet access, so the Credentials workspace of a deployment without delegated execution stays exactly as before. */
export function ExecutionCredentials({ access }: { access: DelegationAccess | undefined }) {
  return access ? <ExecutionCredentialsPanel access={access}/> : null;
}
function ExecutionCredentialsPanel({ access }: { access: DelegationAccess }) {
  const { t } = useLocale(), owner = access.owner, proven = Boolean(owner && access.proof.proven === owner.address);
  const { overview, code, refresh } = useOverview(owner, proven), { busy, run, messages } = useRunner(refresh);
  const solanaProof = useWalletProof(owner ? 'solana' : null);
  const [network, setNetwork] = useState<'base-sepolia' | 'ethereum-sepolia' | 'solana-devnet'>('base-sepolia'), [cap, setCap] = useState('100'), [calls, setCalls] = useState('40');
  const [amount, setAmount] = useState('20'), [expires, setExpires] = useState(plusMonths(3));
  // PR #76: a wallet signature obtained under one wallet authority epoch is submitted only under that same epoch.
  const epoch = useWalletAuthorityEpoch(), shared = useJupiter().session;
  const [pending, setPending] = useState<{ grantId: string; signature: string; epoch: string } | null>(null);
  const pendingValid = pending !== null && pending.epoch === epoch.epoch;
  const enabled = useEnabled();
  if (!enabled || !owner || code === 'DELEGATION_NOT_ENABLED') return null;
  const passkey = overview?.passkeys.find(p => !p.revoked);
  async function enroll(event: FormEvent) {
    event.preventDefault();
    if (!passkey) return;
    const solana = network === 'solana-devnet';
    const walletAddress = solana ? solanaProof.proven : owner!.namespace === 'eip155' ? owner!.address : null;
    await run(async () => {
      if (!walletAddress) return { ok: false, code: 'WALLET_SESSION_REQUIRED' };
      const started = epoch.read();
      const input = solana ? { mechanism: 'SOLANA_SPL_DELEGATE_V1', walletAddress, network, tokens: [{ symbol: 'devUSDC', amount }], expiresAt: `${expires}T23:59:00Z`,
        passkeyId: passkey.passkeyId, label: 'Solana wallet' }
        : { mechanism: 'EVM_ERC7710_METAMASK_V1_3', walletAddress, network, pairs: [{ input: 'USDC', output: 'WETH', perCallCap: cap }], maxCalls: Number(calls),
          expiresAt: `${expires}T23:59:00Z`, passkeyId: passkey.passkeyId, label: 'EVM wallet' };
      const prepared = await credentialPrepare(owner!, input);
      if (!prepared.ok) return prepared;
      const enrollment = prepared.value.enrollment as Record<string, unknown>;
      if (solana) {
        const signedTransaction = await signSolanaWith(walletAddress, String(enrollment.transaction), shared);
        if (epoch.read() !== started) return { ok: false, code: 'WALLET_AUTHORITY_CHANGED' };
        return credentialComplete(owner!, prepared.value.grantId, { signedTransaction });
      }
      const signature = await signDelegation(walletAddress, enrollment.typedData);
      if (epoch.read() !== started) return { ok: false, code: 'WALLET_AUTHORITY_CHANGED' };
      const done = await credentialComplete(owner!, prepared.value.grantId, { signature });
      if (!done.ok && done.code === 'EVM_ACCOUNT_NOT_UPGRADED') setPending({ grantId: prepared.value.grantId, signature, epoch: started });
      return done;
    }, 'Credential enrolled: this wallet can now serve automatic workflows within its limits.');
  }
  return <section className="workspace-section delegation-credentials" aria-labelledby="credentials-execution">
    <div className="workspace-section-heading"><div><h2 id="credentials-execution">{t('Automatic execution')}</h2>
      <span className="workspace-count">{overview?.credentials.reduce((n, c) => n + c.grants.filter(g => g.state === 'ACTIVE').length, 0) ?? 0}</span></div></div>
    <p className="muted">{t('Enroll a wallet once to let FloFi execute workflows you authorize, inside the limits it signs here. Each enrollment is one wallet signature per network; workflows never ask the wallet again.')}</p>
    {messages}
    {!proven ? <div className="workspace-empty"><p>{t('Verify wallet ownership to manage automatic execution.')}</p><WalletProof namespace={owner.namespace} proof={{ ...access.proof, proven: null }}/></div> : <>
      {overview?.availability.enrollment && <p className="muted">{t(ERROR_TEXT[overview.availability.enrollment] ?? overview.availability.enrollment)}</p>}
      {!passkey && <p className="error-banner" role="note">{t('Register a passkey first (Passkeys). Every Credential is bound to the passkey that will authorize your workflows.')}</p>}
      <ul className="automation-list">{(overview?.credentials ?? []).flatMap(c => c.grants).map(g => <GrantCard key={g.grantId} g={g} owner={owner} busy={busy} run={run}/>)}</ul>
      {pending && pendingValid && <div className="approval-actions"><button type="button" className="workspace-action" disabled={busy}
        onClick={() => void run(async () => { const r = await credentialComplete(owner, pending.grantId, { signature: pending.signature }); if (r.ok) setPending(null); return r; }, 'Credential enrolled.')}>{t('Verify again')}</button></div>}
      <form className="automation-form" aria-label={t('Enroll a wallet for automatic execution')} onSubmit={event => void enroll(event)}>
        <label className="automation-field"><span>{t('Network')}</span><select aria-label={t('Credential network')} value={network} onChange={e => setNetwork(e.currentTarget.value as typeof network)}>
          <option value="base-sepolia">Base Sepolia</option><option value="ethereum-sepolia">Ethereum Sepolia</option><option value="solana-devnet">Solana Devnet</option></select></label>
        {network === 'solana-devnet' ? <>
          {!solanaProof.proven && <WalletProof namespace="solana" proof={solanaProof}/>}
          <label className="automation-field"><span>{t('Delegated devUSDC (total)')}</span><input inputMode="decimal" aria-label={t('Delegated devUSDC')} value={amount} onChange={e => setAmount(e.currentTarget.value.trim())}/></label>
        </> : <>
          <label className="automation-field"><span>{t('USDC per call (max)')}</span><input inputMode="decimal" aria-label={t('USDC per call')} value={cap} onChange={e => setCap(e.currentTarget.value.trim())}/></label>
          <label className="automation-field"><span>{t('Number of calls')}</span><input inputMode="numeric" aria-label={t('Number of calls')} value={calls} onChange={e => setCalls(e.currentTarget.value.trim())}/></label>
        </>}
        <label className="automation-field"><span>{t('Expires on')}</span><input type="date" aria-label={t('Credential expires on')} value={expires} onChange={e => setExpires(e.currentTarget.value)}/></label>
        <button type="submit" className="workspace-action primary-action" disabled={busy || !passkey}>{t('Enroll with my wallet')}</button>
      </form>
    </>}
  </section>;
}
