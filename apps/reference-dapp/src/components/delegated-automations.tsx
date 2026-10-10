// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-AUTOMATION-002: "Automatic within limits" in the Automations workspace. The owner composes the workflow (1–4 steps, EVM and Solana
 * mixed), FloFi resolves the authority graph over every step (which of the owner's Credentials covers it, which is missing and why), the owner
 * sets per-asset limits and an expiry, reviews the Universal Workflow Authorization in plain language and signs it ONCE with a passkey. From then
 * on occurrences execute with no new owner signature while every limit holds; the owner sees authorization status, budget used / reserved /
 * remaining, executions with the Credential and grant of every step, and a prominent Revoke.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { authorizationReauthorize, authorizationReview, authorizationRevoke, authorizationSign, delegatedAutomationCreate, delegatedAutomationPreview, delegationOverview,
  executionResume } from '../app/delegation-action';
import type { AuthorizationView, DelegationOverviewView, ExecutionView, ManifestView, PreviewView, ReviewView } from '../delegation/views';
import type { WorkflowOwner } from '../domain/saved-workflow';
import { useLocale } from '../i18n/locale';
import { assertPasskey, passkeysSupported } from './delegation-browser';

type Run = (work: () => Promise<{ ok: boolean; code?: string }>, done?: string) => Promise<boolean>;
export const DELEGATION_ERROR_TEXT: Readonly<Record<string, string>> = {
  DELEGATION_NOT_ENABLED: 'Automatic execution is not enabled on this deployment.', DELEGATED_SIGNER_UNAVAILABLE: 'Automatic execution needs a secure signing service this deployment does not have yet.',
  DELEGATED_AUTHORITY_UNAVAILABLE: 'A step of this workflow has no enrolled Credential that can execute it automatically.', PASSKEY_REQUIRED: 'Register a passkey first.',
  PASSKEY_CANCELLED: 'The passkey request was cancelled. Nothing was authorized.', PASSKEY_UNSUPPORTED: 'This browser cannot use passkeys.',
  PASSKEY_FRESH_SIGN_IN_REQUIRED: 'Sign in with your wallet again (within the last 15 minutes) to register a passkey.', CREDENTIALS_USE_DIFFERENT_PASSKEYS: 'The Credentials of this workflow are bound to different passkeys. Re-enroll them with one passkey.',
  MANIFEST_LIMIT_BELOW_WORKFLOW: 'A per-execution limit is below what one execution spends.', MANIFEST_BUDGET_BELOW_EXECUTION: 'A budget is below what one execution spends.',
  MANIFEST_BUDGET_REQUIRED: 'Every spent asset needs a cumulative budget.', MANIFEST_ASSET_LIMIT_REQUIRED: 'Set a limit for every asset the workflow spends.',
  MANIFEST_SLIPPAGE_BELOW_WORKFLOW: 'The slippage cap is below the slippage of a step.', DELEGATION_EXPIRY_INVALID: 'Choose an expiry in the future, at most one year away.',
  DELEGATION_INPUT_INVALID: 'Check the fields and try again.', AUTHORIZATION_SIGNATURE_INVALID: 'The passkey signature could not be verified.',
  AUTHORIZATION_NOT_PENDING: 'This authorization changed. Review it again.', AUTHORIZATION_CHALLENGE_INVALID: 'This review expired. Review it again.',
  PASSKEY_COUNTER_REPLAY: 'This passkey response was already used.', DELEGATED_AUTHORIZATION_REQUIRED: 'Sign the authorization before this automation can run.',
  DELEGATED_REAUTHORIZATION_REQUIRED: 'Re-authorize this automation to change its workflow.',
};
const REASON_TEXT: Readonly<Record<string, string>> = {
  DELEGATED_AUTHORITY_UNAVAILABLE: 'no enrolled Credential for this network', CREDENTIAL_SCOPE_AMOUNT: 'the Credential\'s per-call cap is too low',
  CREDENTIAL_SCOPE_ASSET: 'the Credential does not cover this token pair', CREDENTIAL_SCOPE_TARGET: 'the Credential does not cover this protocol',
  CREDENTIAL_EXPIRED: 'the Credential expired', CREDENTIAL_REVOKED: 'the Credential was revoked', CREDENTIAL_UNCERTAIN: 'the Credential could not be verified on-chain',
  CREDENTIAL_NOT_ENROLLED: 'the Credential\'s wallet signature is still pending', CREDENTIAL_CALLS_EXHAUSTED: 'the Credential has no calls left',
  SOLANA_DELEGATED_BUILDER_NOT_IMPLEMENTED: 'automatic Solana swaps are not available on this deployment', NATIVE_SOL_NOT_DELEGABLE: 'native SOL cannot be delegated',
  DELEGATION_TEMPLATE_NOT_IMPLEMENTED: 'this action cannot run automatically yet', DELEGATED_TARGET_SCOPE_UNAVAILABLE: 'this route cannot be limited on-chain',
  MAINNET_DELEGATION_DISABLED: 'real-funds networks are disabled for automatic execution', BRIDGE_ROUTE_UNAVAILABLE: 'no bridge route exists',
};
const STATE_TEXT: Readonly<Record<string, string>> = { PENDING_SIGNATURE: 'Waiting for your signature', ACTIVE: 'Active', REVOKED: 'Revoked', EXPIRED: 'Expired',
  QUEUED: 'Queued', AUTHORITY_VERIFIED: 'Authority verified', RESERVED: 'Budget reserved', RUNNING: 'Executing', SETTLED: 'Settled', BLOCKED: 'Blocked — nothing was executed',
  UNCERTAIN: 'Outcome being confirmed', HALTED: 'Halted — needs your attention', FAILED: 'Failed — reconciled', RECONCILED: 'Reconciled', PENDING: 'Pending',
  SIMULATED: 'Simulated', POLICY_VERIFIED: 'Within limits', SUBMISSION_PREPARED: 'Prepared', SUBMITTED: 'Submitted', REVERTED: 'Reverted' };
const PERIOD: Readonly<Record<string, string>> = { DAY: 'day', WEEK: 'week', MONTH: 'month' };
const short = (a: string) => a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

export function useDelegation(owner: WorkflowOwner | null, proven: boolean) {
  const [overview, setOverview] = useState<DelegationOverviewView | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!owner || !proven) return;
    const result = await delegationOverview(owner).catch(() => ({ ok: false as const, code: 'DELEGATION_UNAVAILABLE' }));
    if (result.ok) { setOverview(result.value); setCode(null); } else { setOverview(null); setCode(result.code); }
  }, [owner, proven]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { overview, code, refresh };
}

function Limits({ m }: { m: ManifestView }) {
  const { t } = useLocale();
  const date = (iso: string) => { try { return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)); } catch { return iso; } };
  const inputs = m.assets.filter(a => a.role === 'INPUT');
  return <ul className="delegation-limits">
    {inputs.map(a => <li key={`${a.asset}-x`}>{t('{0} {1} per execution', a.maxPerExecution ?? '0', a.symbol)}</li>)}
    {inputs.flatMap(a => a.budgets.map(b => <li key={`${a.asset}-${b.period}`}>{t('{0} {1} per {2}', b.amount, a.symbol, t(PERIOD[b.period] ?? b.period))}</li>))}
    {m.maxExecutionsPerPeriod && <li>{t('{0} executions per {1}', String(m.maxExecutionsPerPeriod.count), t(PERIOD[m.maxExecutionsPerPeriod.period] ?? ''))}</li>}
    {m.cooldownSeconds > 0 && <li>{t('Cooldown {0} min', String(Math.round(m.cooldownSeconds / 60)))}</li>}
    <li>{t('{0}% slippage', String(m.maxSlippageBps / 100))}</li>
    <li>{t('expires {0}', date(m.expiresAt))}</li>
  </ul>;
}

/** The human-readable Universal Workflow Authorization Review, then the owner's ONE passkey signature. */
export function AuthorizationReview({ review, owner, busy, run, onDone }: { review: ReviewView; owner: WorkflowOwner; busy: boolean; run: Run; onDone: () => void }) {
  const { t } = useLocale(), m = review.manifest;
  const onChain = Object.entries(m.enforcement).filter(([, where]) => where.some(w => w.startsWith('SMART_ACCOUNT'))).map(([rule]) => rule);
  const application = Object.entries(m.enforcement).filter(([, where]) => where.includes('APPLICATION_GATEWAY')).map(([rule]) => rule);
  async function sign() {
    const ok = await run(async () => {
      let assertion: Awaited<ReturnType<typeof assertPasskey>>;
      try { assertion = await assertPasskey(review); } catch (cause) { return { ok: false, code: cause instanceof Error && /^[A-Z_]+$/.test(cause.message) ? cause.message : 'PASSKEY_CANCELLED' }; }
      return authorizationSign(owner, review.authorizationId, review.revision, assertion);
    }, 'Authorized. FloFi may now execute this automation within your limits without asking you again.');
    if (ok) onDone();
  }
  return <section className="automation-card delegation-review" aria-label={t('Authorization review')}>
    <h3>{t('Automatic execution allowed')}</h3>
    <ul className="delegation-steps">{m.steps.map(s => <li key={s.stepIndex}><strong>{s.label}</strong> · {t('wallet {0}', short(s.walletAddress))}</li>)}</ul>
    <p><strong>{t('Maximum:')}</strong></p>
    <Limits m={m}/>
    <p className="delegation-promise">{t('FloFi may execute without asking you again while all these limits remain valid.')}</p>
    {review.widening.length > 0 && <p className="error-banner" role="note">{t('This revision changes: {0}', review.widening.join(', '))}</p>}
    <details><summary>{t('What is enforced where')}</summary>
      <p>{t('By your wallets\' on-chain delegation (FloFi cannot exceed it even if compromised):')}</p><ul>{onChain.map(r => <li key={r}>{t(r)}</li>)}</ul>
      <p>{t('By FloFi before every execution:')}</p><ul>{application.map(r => <li key={r}>{t(r)}</li>)}</ul></details>
    <p>{t('Wallet setup: {0} Credential(s) already enrolled — no new wallet signature is needed. You sign this authorization once, with your passkey.', String(m.setupSignatures))}</p>
    <p className="muted">{t('Revoke it at any time with “Revoke authorization”: FloFi stops at once.')}</p>
    <div className="approval-actions"><button type="button" className="primary" disabled={busy || !passkeysSupported()} onClick={() => void sign()}>{t('Authorize with passkey')}</button></div>
  </section>;
}

type StepDraft = { asset: 'ETH' | 'SOL'; side: 'BUY' | 'SELL'; network: string; amount: string };
const NETWORKS: readonly { asset: 'ETH' | 'SOL'; network: string; label: string }[] = [{ asset: 'ETH', network: 'base-sepolia', label: 'Base Sepolia' },
  { asset: 'ETH', network: 'ethereum-sepolia', label: 'Ethereum Sepolia' }, { asset: 'SOL', network: 'solana-devnet', label: 'Solana Devnet' }];
const plusMonths = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };

export function DelegatedCreate({ owner, busy, run, onReview }: { owner: WorkflowOwner; busy: boolean; run: Run; onReview: (review: ReviewView) => void }) {
  const { t } = useLocale();
  const zone = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } }, []);
  const [name, setName] = useState(''), [frequency, setFrequency] = useState<'DAILY' | 'WEEKLY'>('WEEKLY'), [weekday, setWeekday] = useState('1'), [time, setTime] = useState('09:00');
  const [timezone, setTimezone] = useState(zone), [expires, setExpires] = useState(plusMonths(3)), [slippage, setSlippage] = useState('50'), [count, setCount] = useState('4');
  const [steps, setSteps] = useState<StepDraft[]>([{ asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '' }]);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [limits, setLimits] = useState<Record<string, { max: string; weekly: string }>>({});
  const input = () => ({ version: 1, name: name.trim() || 'Automatic workflow', trigger: { kind: 'SCHEDULE', schedule: { frequency, weekday: frequency === 'WEEKLY' ? Number(weekday) : null, time, timezone } },
    steps: steps.map(s => ({ ...s, slippageBps: Number(slippage) })),
    limits: { assets: Object.entries(limits).map(([asset, l]) => ({ asset, maxPerExecution: l.max, budgets: [{ period: 'WEEK', amount: l.weekly }] })),
      maxExecutionsPerPeriod: count ? { count: Number(count), period: 'WEEK' } : null, cooldownMinutes: 0, maxSlippageBps: Number(slippage) },
    expiresAt: `${expires}T23:59:00Z` });
  async function check(event?: FormEvent) {
    event?.preventDefault();
    await run(async () => {
      const result = await delegatedAutomationPreview(owner, input());
      if (result.ok) {
        setPreview(result.value);
        const next: Record<string, { max: string; weekly: string }> = {};
        for (const s of result.value.steps) for (const i of s.inputs) {
          const prior = limits[i.asset], sum = String(Number(next[i.asset]?.max ?? 0) + Number(i.amount));
          next[i.asset] = prior ?? { max: sum, weekly: String(Number(sum) * Math.max(1, Number(count) || 1)) };
        }
        setLimits(next);
      }
      return result;
    });
  }
  async function create() {
    await run(async () => {
      const created = await delegatedAutomationCreate(owner, input());
      if (!created.ok) return created;
      const review = await authorizationReview(owner, created.value.authorizationId);
      if (review.ok) onReview(review.value);
      return review;
    }, 'Created. Review the authorization and sign it with your passkey.');
  }
  const assets = preview ? [...new Map(preview.steps.flatMap(s => s.inputs).map(i => [i.asset, i])).values()] : [];
  const field = (label: string, control: ReactNode) => <label className="automation-field"><span>{t(label)}</span>{control}</label>;
  return <form className="automation-form delegation-form" aria-label={t('Create an automatic workflow')} onSubmit={event => void check(event)}>
    <p className="muted">{t('Execution: Automatic within limits — FloFi executes each occurrence without asking you again, inside the limits you sign once.')}</p>
    {field('Name', <input aria-label={t('Name')} value={name} maxLength={80} onChange={e => setName(e.currentTarget.value)}/>)}
    <div className="automation-pair">
      {field('Frequency', <select aria-label={t('Frequency')} value={frequency} onChange={e => setFrequency(e.currentTarget.value as 'DAILY' | 'WEEKLY')}>
        <option value="WEEKLY">{t('Weekly')}</option><option value="DAILY">{t('Daily')}</option></select>)}
      {frequency === 'WEEKLY' && field('Day', <select aria-label={t('Day')} value={weekday} onChange={e => setWeekday(e.currentTarget.value)}>
        {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d, i) => <option key={d} value={String(i + 1)}>{t(d)}</option>)}</select>)}
      {field('Time', <input type="time" aria-label={t('Time')} value={time} onChange={e => setTime(e.currentTarget.value)} required/>)}
      {field('Time zone', <input aria-label={t('Time zone')} value={timezone} onChange={e => setTimezone(e.currentTarget.value.trim())} required/>)}
    </div>
    <fieldset className="delegation-steps-editor"><legend>{t('Workflow steps')}</legend>
      {steps.map((s, i) => <div key={i} className="automation-pair" role="group" aria-label={t('Step {0}', String(i + 1))}>
        <select aria-label={t('Step {0} network', String(i + 1))} value={`${s.asset}|${s.network}`} onChange={e => {
          const [asset, network] = e.currentTarget.value.split('|') as ['ETH' | 'SOL', string];
          setSteps(steps.map((x, j) => j === i ? { ...x, asset, network } : x)); setPreview(null); }}>
          {NETWORKS.map(n => <option key={n.network} value={`${n.asset}|${n.network}`}>{n.asset} · {t(n.label)}</option>)}</select>
        <select aria-label={t('Step {0} side', String(i + 1))} value={s.side} onChange={e => { setSteps(steps.map((x, j) => j === i ? { ...x, side: e.currentTarget.value as 'BUY' | 'SELL' } : x)); setPreview(null); }}>
          <option value="BUY">{t('Buy')}</option><option value="SELL">{t('Sell')}</option></select>
        <input inputMode="decimal" aria-label={t('Step {0} amount', String(i + 1))} placeholder={t('Amount spent')} value={s.amount}
          onChange={e => { setSteps(steps.map((x, j) => j === i ? { ...x, amount: e.currentTarget.value.trim() } : x)); setPreview(null); }} required/>
        {steps.length > 1 && <button type="button" className="workspace-action" onClick={() => { setSteps(steps.filter((_, j) => j !== i)); setPreview(null); }}>{t('Remove')}</button>}
      </div>)}
      {steps.length < 4 && <button type="button" className="workspace-action" onClick={() => { setSteps([...steps, { asset: 'SOL', side: 'BUY', network: 'solana-devnet', amount: '' }]); setPreview(null); }}>{t('Add a step')}</button>}
    </fieldset>
    <div className="automation-pair">
      {field('Executions per week', <input inputMode="numeric" aria-label={t('Executions per week')} value={count} onChange={e => setCount(e.currentTarget.value.trim())}/>)}
      {field('Max slippage (bps)', <input inputMode="numeric" aria-label={t('Max slippage (bps)')} value={slippage} onChange={e => setSlippage(e.currentTarget.value.trim())} required/>)}
      {field('Expires on', <input type="date" aria-label={t('Expires on')} value={expires} onChange={e => setExpires(e.currentTarget.value)} required/>)}
    </div>
    <div className="approval-actions"><button type="submit" className="workspace-action" disabled={busy}>{t('Check credentials and limits')}</button></div>
    {preview && <section className="delegation-preview" aria-label={t('Authority check')}>
      <ul className="delegation-steps">{preview.steps.map(s => <li key={s.index} data-ok={s.binding ? 'true' : 'false'}>
        <strong>{s.label}</strong> — {s.binding ? t('covered by your Credential for wallet {0}', short(s.binding.walletAddress))
          : t('not covered: {0}', t(REASON_TEXT[s.failure ?? ''] ?? s.failure ?? ''))}</li>)}</ul>
      {preview.requiredEnrollments.length > 0 && <p className="error-banner" role="alert">{t('Enroll the missing Credentials in Credentials, then check again. Nothing was created.')}</p>}
      {assets.length > 0 && <fieldset><legend>{t('Limits per asset')}</legend>{assets.map(a => <div key={a.asset} className="automation-pair">
        {field(t('Max {0} per execution', a.symbol), <input inputMode="decimal" aria-label={t('Max {0} per execution', a.symbol)} value={limits[a.asset]?.max ?? ''}
          onChange={e => setLimits({ ...limits, [a.asset]: { max: e.currentTarget.value.trim(), weekly: limits[a.asset]?.weekly ?? '' } })}/>)}
        {field(t('{0} budget per week', a.symbol), <input inputMode="decimal" aria-label={t('{0} budget per week', a.symbol)} value={limits[a.asset]?.weekly ?? ''}
          onChange={e => setLimits({ ...limits, [a.asset]: { max: limits[a.asset]?.max ?? '', weekly: e.currentTarget.value.trim() } })}/>)}</div>)}</fieldset>}
      {preview.requiredEnrollments.length === 0 && <div className="approval-actions"><button type="button" className="primary" disabled={busy} onClick={() => void create()}>{t('Create and review authorization')}</button></div>}
    </section>}
  </form>;
}

function ExecutionRow({ e, owner, busy, run }: { e: ExecutionView; owner: WorkflowOwner; busy: boolean; run: Run }) {
  const { t } = useLocale();
  return <li className="delegation-execution" data-state={e.state}>
    <span>{new Date(e.createdAt).toLocaleString()} · <strong>{t(STATE_TEXT[e.state] ?? e.state)}</strong>{e.code && e.state !== 'SETTLED' ? ` (${e.code})` : ''}
      {e.evidenceLevel ? ` · ${t('evidence {0}', e.evidenceLevel)}` : ''}</span>
    <ul>{e.steps.map(s => <li key={s.step}>{t('Step {0}', String(s.step + 1))} · {s.network} · {t(STATE_TEXT[s.state] ?? s.state)} · {t('Credential {0}, grant {1}', short(s.credentialId), short(s.grantId))}
      {s.spent.map(x => ` · −${x.amount} ${x.symbol}`).join('')}{s.received.map(x => ` · +${x.amount} ${x.symbol}`).join('')}
      {s.submissions.length > 0 && <> · <code title={s.submissions.join(' ')}>{short(s.submissions.at(-1)!)}</code></>}</li>)}</ul>
    {e.state === 'HALTED' && <button type="button" className="workspace-action" disabled={busy} onClick={() => void run(() => executionResume(owner, e.executionId), 'Resumed. FloFi re-checks every limit before continuing.')}>{t('Resume')}</button>}
  </li>;
}

/** Status of every delegated authorization of the owner: state, budget, executions, Revoke. */
export function DelegatedAuthorizations({ overview, owner, busy, run, onReview }: { overview: DelegationOverviewView; owner: WorkflowOwner; busy: boolean; run: Run;
  onReview: (review: ReviewView) => void }) {
  const { t } = useLocale();
  if (!overview.authorizations.length) return <div className="workspace-empty"><p>{t('No automatic workflows yet.')}</p></div>;
  const executionsOf = (a: AuthorizationView) => overview.executions.filter(e => e.authorizationId === a.authorizationId);
  return <div className="automation-list">{overview.authorizations.map(a => <article key={a.authorizationId} className="automation-card delegation-card" aria-label={t('Automatic workflow {0}', a.ruleName)}>
    <header className="automation-card-head"><div><h3>{a.ruleName}</h3><p>{t('Execution: Automatic within limits')} · {a.manifest.networks.join(' + ')}</p></div>
      <span className="automation-badge" data-state={a.state}>{t(STATE_TEXT[a.state] ?? a.state)}</span></header>
    <ul className="delegation-steps">{a.manifest.steps.map(s => <li key={s.stepIndex}>{s.label} · {t('wallet {0}', short(s.walletAddress))}</li>)}</ul>
    <Limits m={a.manifest}/>
    <table className="delegation-budget"><caption>{t('Budget')}</caption><thead><tr><th>{t('Asset')}</th><th>{t('Period')}</th><th>{t('Limit')}</th><th>{t('Spent')}</th><th>{t('Reserved')}</th><th>{t('Remaining')}</th></tr></thead>
      <tbody>{a.budget.flatMap(b => b.periods.map(p => <tr key={`${b.asset}-${p.period}`}><td>{b.symbol}</td><td>{t(PERIOD[p.period] ?? p.period)}</td><td>{p.limit}</td><td>{p.spent}</td>
        <td>{p.reserved}</td><td>{p.remaining}</td></tr>))}</tbody></table>
    <p className="muted">{t('{0} executions', String(a.executions))}{a.signedAt ? ` · ${t('signed {0}', new Date(a.signedAt).toLocaleString())}` : ''}{a.revokedAt ? ` · ${t('revoked {0}', new Date(a.revokedAt).toLocaleString())}` : ''}</p>
    <div className="automation-row-actions">
      {a.state === 'PENDING_SIGNATURE' && <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => {
        const r = await authorizationReview(owner, a.authorizationId); if (r.ok) onReview(r.value); return r; })}>{t('Review and sign')}</button>}
      {(a.state === 'ACTIVE' || a.state === 'PENDING_SIGNATURE') && <button type="button" className="danger" disabled={busy}
        onClick={() => void run(() => authorizationRevoke(owner, a.authorizationId), 'Authorization revoked. FloFi will not execute this workflow again.')}>{t('Revoke authorization')}</button>}
      {a.state === 'ACTIVE' && <button type="button" className="workspace-action" disabled={busy} onClick={() => void run(async () => {
        const r = await authorizationReauthorize(owner, a.authorizationId); if (r.ok) onReview(r.value); return r; })}>{t('Re-authorize')}</button>}
    </div>
    {executionsOf(a).length > 0 && <details open><summary>{t('History')}</summary><ul className="delegation-executions">{executionsOf(a).map(e => <ExecutionRow key={e.executionId} e={e} owner={owner} busy={busy} run={run}/>)}</ul></details>}
  </article>)}</div>;
}
