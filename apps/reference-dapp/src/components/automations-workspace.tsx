// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-AUTOMATION-001: the Automations workspace — automated evaluation, owner-confirmed execution. The owner creates scheduled DCAs,
 * price triggers and daily market rounds, sees what FloFi is waiting on them for, and opens each proposal into FloFi's existing flow
 * (/approve → fresh simulation → Strategy Manifest Review → own wallet signature). Nothing here signs, submits or approves: every
 * server action re-verifies the owner's wallet session, and the only way forward from a proposal is the shared approval flow.
 */
import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { automationHistory, automationOverview, automationsAvailability, changeAutomationState, createAutomation, createTelegramLinkCode, dismissAutomationOccurrence,
  openAutomationOccurrence, prepareWatchProposal, rebindAutomation, unlinkTelegram } from '../app/automation-action';
import { listWorkflows } from '../app/workflow-action';
import type { CapabilityView, HistoryEntryView, LinkCodeView, ObservationView, OccurrenceView, OverviewView, RouteCapability, RuleHistoryView, RuleView } from '../automations/views';
import type { Command } from '../domain/commands';
import type { OwnerWorkflow, WorkflowOwner } from '../domain/saved-workflow';
import { useLocale } from '../i18n/locale';
import { WalletProof, type useWalletProof } from './wallet-proof';
import type { ReviewView } from '../delegation/views';
import { AuthorizationReview, DelegatedAuthorizations, DelegatedCreate, DELEGATION_ERROR_TEXT, useDelegation } from './delegated-automations';

export type AutomationNavigation = { readonly owner: WorkflowOwner | null; readonly proof: ReturnType<typeof useWalletProof>; readonly onPropose: (command: Command) => void };
type Kind = RuleView['kind'];
type Asset = 'ETH' | 'BTC' | 'SOL';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const STATE_LABEL: Readonly<Record<string, string>> = { ACTIVE: 'Active', PAUSED: 'Paused', EXPIRED: 'Expired', ARCHIVED: 'Archived' };
const KIND_LABEL: Readonly<Record<Kind, string>> = { SCHEDULED_DCA: 'Scheduled DCA', PRICE_TRIGGER: 'Price trigger', DAILY_WATCH: 'Daily watch' };
const OCCURRENCE_LABEL: Readonly<Record<string, string>> = { PENDING_OWNER: 'Awaiting you', APPROVAL_CREATED: 'Opened for review', COMPLETED: 'Loaded into your workflow',
  DISMISSED: 'Dismissed', EXPIRED: 'Expired' };
const OUTCOME_LABEL: Readonly<Record<string, string>> = {
  AUTOMATION_CREATED: 'Automation created', AUTOMATION_PAUSED: 'Paused', AUTOMATION_RESUMED: 'Resumed', AUTOMATION_ARCHIVED: 'Archived', AUTOMATION_EXPIRED: 'Automation expired',
  AUTOMATION_REBOUND: 'Rebound to the current workflow', TRIGGERED: 'Triggered — proposal created', WATCH_REPORTED: 'Market round reported',
  ARMED: 'Evaluated — condition not met (watching)', CONDITION_NOT_MET: 'Evaluated — condition not met', CONDITION_ALREADY_MET: 'Condition already met — waiting for a new crossing',
  CONDITION_STILL_MET: 'Condition still met — no new proposal', REARMED: 'Condition cleared — watching again', COOLDOWN: 'Crossing during the cooldown — no proposal',
  LIMIT_BLOCKED: 'Blocked by a limit — no proposal', MISSED: 'Missed while FloFi was unavailable', WORKFLOW_CHANGED: 'Saved workflow changed — rebind required',
  STRATEGY_STALE: 'No longer reproducible — rebind required', APPROVAL_REQUESTED: 'Opened for review', APPROVAL_APPLIED: 'Loaded into your workflow',
  OWNER_DISMISSED: 'Dismissed', OWNER_PREPARED_BUY: 'You started your own buy in Build', OWNER_PREPARED_SELL: 'You started your own sell in Build', DUPLICATE_TRIGGER: 'Duplicate trigger ignored',
  PRICE_STALE: 'Price observation too old — ignored', PRICE_SOURCE_OFF: 'No price source on this deployment', PRICE_SOURCE_TIMEOUT: 'Price source timed out — ignored',
  PRICE_SOURCE_UNREACHABLE: 'Price source unreachable — ignored', PRICE_SOURCE_ERROR: 'Price source error — ignored', PRICE_FEED_MISMATCH: 'Price feed failed verification — ignored',
  OCCURRENCE_EXPIRED: 'Expired', AUTOMATION_REBOUND_WITHDRAWN: 'Withdrawn by a rebind' };
const ERROR_TEXT: Readonly<Record<string, string>> = {
  WALLET_SESSION_REQUIRED: 'Verify wallet ownership to use automations.', AUTOMATIONS_NOT_ENABLED: 'Automations are not enabled on this deployment.',
  AUTOMATION_STORE_UNAVAILABLE: 'Automations are unavailable on this deployment right now.', AUTOMATION_SCHEMA_NOT_INSTALLED: 'Automations are unavailable on this deployment right now.',
  AUTOMATION_VERSION_CONFLICT: 'This automation changed in another session. Refresh and try again.', AUTOMATION_RULE_LIMIT: 'You have reached the maximum number of automations.',
  BTC_EXECUTION_ROUTE_UNAVAILABLE: 'FloFi has no BTC swap route yet. You can watch BTC and get alerts, but FloFi cannot prepare a BTC purchase.',
  OWNER_EXECUTION_NOT_IMPLEMENTED: 'FloFi cannot execute this action with your wallet yet.', MAINNET_HANDOFF_DISABLED_BY_POLICY: 'Real-funds automations are disabled on this deployment.',
  FLOW_NOT_ENABLED_IN_DEPLOYMENT: 'This action is not enabled on this deployment.', PUBLIC_RECORDING_OFF: 'This action is not enabled on this deployment.',
  LIMIT_AMOUNT_PER_EXECUTION: 'The amount is above your maximum per execution.', LIMIT_SLIPPAGE: 'The slippage is above your maximum slippage.',
  LIMIT_PERIOD_AMOUNT: 'This would exceed your maximum amount for the period.', LIMIT_PERIOD_COUNT: 'This would exceed your maximum number of proposals for the period.',
  PRICE_ASSET_NOT_OBSERVABLE: 'FloFi cannot observe this asset’s price on this deployment.', AUTOMATION_INPUT_INVALID: 'Check the fields and try again.',
  AUTOMATION_SCHEDULE_INVALID: 'Check the schedule and the time zone.', AUTOMATION_CONDITION_INVALID: 'Check the price condition.', AUTOMATION_AMOUNT_INVALID: 'Enter an amount above zero.',
  AUTOMATION_EXPIRY_INVALID: 'The expiry must be in the future (at most two years).', AUTOMATION_NAME_INVALID: 'Use 1–80 characters for the name.',
  AUTOMATION_WORKFLOW_NOT_REPRESENTABLE: 'Only a saved workflow with exactly one Base Sepolia or Ethereum Sepolia swap can be automated.',
  AUTOMATION_WORKFLOW_CHANGED: 'The saved workflow changed. Rebind the automation before reviewing.', AUTOMATION_PAUSED: 'Resume the automation first.',
  AUTOMATION_OCCURRENCE_EXPIRED: 'This proposal has expired.', AUTOMATION_OCCURRENCE_DISMISSED: 'This proposal was dismissed.', STRATEGY_STALE: 'This proposal is no longer reproducible.',
  AUTOMATION_OCCURRENCE_COMPLETED: 'You already added this proposal to your workflow.', AUTOMATION_OCCURRENCE_CHANGED: 'This proposal changed. Refresh and try again.',
  AUTOMATION_ACTION_ASSET_MISMATCH: 'The action must trade the asset the condition watches.', HANDOFF_RATE_LIMITED: 'Too many reviews opened recently. Try again later.',
  HANDOFF_PENDING_LIMIT: 'Too many open reviews for this automation. Finish or dismiss one first.', AUTOMATION_LINK_RATE_LIMITED: 'Too many codes requested. Try again later.',
  AUTOMATION_CHAT_NOTIFICATIONS_UNAVAILABLE: 'Telegram notifications are not available on this deployment.',
  AUTOMATION_WALLET_NAMESPACE_MISMATCH: 'This network needs a wallet of another kind than the one you proved. Only your own wallet can approve its proposals.' };

const usd = (value: string) => { const [whole, fraction = ''] = value.split('.'); return `$${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction.slice(0, 2).padEnd(2, '0')}` : ''}`; };
function changeOf(o: ObservationView): string | null {
  if (!('priceUsd' in o) || !o.previousPriceUsd) return null;
  const a = Number(o.priceUsd), b = Number(o.previousPriceUsd);
  if (!(a > 0 && b > 0)) return null;
  const pct = (a - b) / b * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
let zoneList: readonly string[] | null = null;
const zones = () => zoneList ??= (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; } })();

function When({ iso, zone }: { iso: string | null; zone: string }) {
  const { language } = useLocale();
  if (!iso) return <>—</>;
  let text: string;
  try { text = new Intl.DateTimeFormat(language === 'PT' ? 'pt-PT' : 'en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
  catch { text = iso; }
  return <time dateTime={iso}>{text}</time>;
}
function Observation({ o }: { o: ObservationView }) {
  const { t } = useLocale();
  if (!('priceUsd' in o)) return <span className="automation-observation">{o.asset} · {t('not observed')} ({o.code})</span>;
  const change = changeOf(o);
  return <span className="automation-observation"><strong>{o.asset}</strong> {usd(o.priceUsd)}{change && <> · {t('{0} since the last round', change)}</>} · {o.source === 'CHAINLINK' ? 'Chainlink' : t('fixture')}{o.evidence === 'MOCKED' ? ' · MOCKED' : ''}</span>;
}

function useAutomationText() {
  const { t } = useLocale();
  return useMemo(() => ({
    schedule: (r: Pick<RuleView, 'schedule' | 'timezone'>) => !r.schedule ? '' : r.schedule.frequency === 'DAILY' ? t('Every day at {0} ({1})', r.schedule.time, r.timezone)
      : t('Every {0} at {1} ({2})', t(WEEKDAYS[(r.schedule.weekday ?? 1) - 1]!), r.schedule.time, r.timezone),
    condition: (c: NonNullable<RuleView['condition']>) => c.type === 'PRICE_BELOW' ? t('If {0} falls below {1}', c.asset, usd(c.threshold!))
      : c.type === 'PRICE_ABOVE' ? t('If {0} rises above {1}', c.asset, usd(c.threshold!))
        : c.type === 'PERCENT_DROP' ? t('If {0} falls {1}% from {2} (at or below {3})', c.asset, c.percent!, usd(c.reference!), usd(c.effectiveThreshold))
          : t('If {0} rises {1}% from {2} (at or above {3})', c.asset, c.percent!, usd(c.reference!), usd(c.effectiveThreshold)),
    action: (a: RuleView['action']) => a ? t('Prepare {0} {1} → {2} on {3}', a.amount, a.inputAsset, a.outputAsset, t(a.networkLabel)) : t('Notify me only'),
    limits: (l: RuleView['limits']) => [
      l.maxAmountPerExecution ? t('Max {0} per execution', l.maxAmountPerExecution) : null,
      l.maxAmountPerPeriod ? t('Max {0} per {1}', l.maxAmountPerPeriod.amount, t(l.maxAmountPerPeriod.period.toLowerCase())) : null,
      l.maxOccurrencesPerPeriod ? t('At most {0} proposals per {1}', String(l.maxOccurrencesPerPeriod.count), t(l.maxOccurrencesPerPeriod.period.toLowerCase())) : null,
      l.cooldownMinutes ? t('Cooldown {0} min', String(l.cooldownMinutes)) : null,
      l.maxSlippageBps !== null ? t('Max slippage {0} bps', String(l.maxSlippageBps)) : null,
    ].filter((v): v is string => Boolean(v)),
    error: (code: string) => ERROR_TEXT[code] ? t(ERROR_TEXT[code]) : DELEGATION_ERROR_TEXT[code] ? t(DELEGATION_ERROR_TEXT[code]) : t('FloFi could not complete this ({0}).', code),
  }), [t]);
}

// ── Pending decisions ────────────────────────────────────────────────────────────────────────────────────────────────────────
function PendingCard({ o, rule, highlighted, capabilities, busy, run, onPropose, owner }: { o: OccurrenceView; rule: RuleView | undefined; highlighted: boolean;
  capabilities: CapabilityView; busy: boolean; run: (work: () => Promise<{ ok: boolean; code?: string }>, done?: string) => Promise<boolean>; onPropose: (command: Command) => void;
  owner: WorkflowOwner }) {
  const { t } = useLocale(), text = useAutomationText();
  const [trade, setTrade] = useState<{ asset: Asset; side: 'BUY' | 'SELL'; network: string; amount: string } | null>(null);
  const zone = rule?.timezone ?? 'UTC';
  async function review() {
    await run(async () => {
      const opened = await openAutomationOccurrence(owner, o.occurrenceId);
      if (opened.ok) window.location.assign(opened.value.approvalUrl);
      return opened;
    });
  }
  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (!trade) return;
    await run(async () => {
      const prepared = await prepareWatchProposal(owner, o.occurrenceId, { ...trade, slippageBps: 50 });
      if (prepared.ok) onPropose(prepared.value.command);
      return prepared;
    }, 'Your own trade is in Build. Apply it, simulate and review before signing.');
  }
  const routes = (asset: string) => capabilities.routes.filter(r => r.asset === asset && r.executable);
  return <article className="automation-card automation-pending" id={`occurrence-${o.occurrenceId}`} data-highlighted={highlighted ? 'true' : undefined}
    aria-label={t('Proposal from {0}', o.ruleName)}>
    <header className="automation-card-head"><div><h3>{o.ruleName}</h3><p>{t(o.kind === 'WATCH' ? 'Daily watch' : o.kind === 'PRICE' ? 'Price trigger' : 'Scheduled DCA')} · {t(OCCURRENCE_LABEL[o.state] ?? o.state)}</p></div>
      <span className="automation-badge" data-state={o.state}>{t(OCCURRENCE_LABEL[o.state] ?? o.state)}</span></header>
    {o.kind === 'SCHEDULE' && <p>{t('Scheduled for')} <When iso={o.dueAt} zone={zone}/></p>}
    {o.observations.length > 0 && o.kind === 'PRICE' && rule?.condition && <p>{text.condition(rule.condition)} — {t('met')}: <Observation o={o.observations[0]!}/></p>}
    {o.kind === 'WATCH' ? <ul className="automation-watch">{o.observations.map(obs => <li key={obs.asset}><Observation o={obs}/>
      {'priceUsd' in obs && routes(obs.asset).length > 0 ? <span className="automation-row-actions">
        <button type="button" className="workspace-action" disabled={busy} onClick={() => setTrade({ asset: obs.asset as Asset, side: 'BUY', network: routes(obs.asset)[0]!.network, amount: '' })}>{t('Buy')}</button>
        <button type="button" className="workspace-action" disabled={busy} onClick={() => setTrade({ asset: obs.asset as Asset, side: 'SELL', network: routes(obs.asset)[0]!.network, amount: '' })}>{t('Sell')}</button></span>
        : 'priceUsd' in obs ? <span className="muted">{t(obs.asset === 'BTC' ? 'No BTC swap route in FloFi yet' : 'Not executable on this deployment')}</span> : null}</li>)}</ul>
      : <p className="automation-action-line"><strong>{text.action(o.action)}</strong>{o.action?.fundsClass === 'REAL_FUNDS' && <> · {t('REAL FUNDS')}</>}</p>}
    {trade && <form className="automation-inline-form" aria-label={`${t(trade.side === 'BUY' ? 'Buy' : 'Sell')} ${trade.asset}`} onSubmit={event => void prepare(event)}>
      <label>{t('Network')}<select aria-label={t('Network')} value={trade.network} onChange={e => setTrade({ ...trade, network: e.currentTarget.value })}>
        {routes(trade.asset).map(r => <option key={r.network} value={r.network}>{t(r.networkLabel)}</option>)}</select></label>
      <label>{t('Amount ({0})', trade.side === 'BUY' ? routes(trade.asset).find(r => r.network === trade.network)?.quote ?? '' : routes(trade.asset).find(r => r.network === trade.network)?.base ?? '')}
        <input inputMode="decimal" aria-label={t('Amount')} value={trade.amount} onChange={e => setTrade({ ...trade, amount: e.currentTarget.value.trim() })} required/></label>
      <div className="automation-row-actions"><button type="submit" className="workspace-action" disabled={busy}>{t('Prepare in Build')}</button>
        <button type="button" className="workspace-action" onClick={() => setTrade(null)}>{t('Cancel')}</button></div>
      <p className="muted">{t('This is your own new trade, not part of this automation: it goes to your Build draft as an ordinary proposal, exactly as if you had composed it there. The automation adds no authority and no limits to it. Nothing is signed: apply it, simulate and review the Strategy Manifest first.')}</p>
    </form>}
    <p className="muted">{t('Waiting until')} <When iso={o.expiresAt} zone={zone}/>{o.notifications.map(n => <span key={n.channel}> · {t('Telegram')}: {t(n.status === 'QUEUED' ? 'sent to your chat' : 'not delivered')}</span>)}</p>
    <div className="automation-row-actions">
      {o.action && <button type="button" className="workspace-action primary-action" disabled={busy} onClick={() => void review()}>{t('Review in FloFi')}</button>}
      <button type="button" className="workspace-action" disabled={busy} onClick={() => void run(() => dismissAutomationOccurrence(owner, o.occurrenceId), 'Proposal dismissed.')}>
        {t(o.kind === 'WATCH' ? 'Ignore' : o.action ? 'Dismiss' : 'Acknowledge')}</button>
    </div>
    {o.action && <p className="muted automation-authority">{t('Nothing is authorized yet. Review opens FloFi’s approval: prove your wallet, run a fresh simulation, review the Strategy Manifest and sign with your own wallet.')}</p>}
  </article>;
}

// ── Rules ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function RuleCard({ rule, busy, run, owner, onHistory }: { rule: RuleView; busy: boolean; run: (work: () => Promise<{ ok: boolean; code?: string }>, done?: string) => Promise<boolean>;
  owner: WorkflowOwner; onHistory: () => void }) {
  const { t } = useLocale(), text = useAutomationText();
  const state = (action: 'PAUSE' | 'RESUME' | 'ARCHIVE', done: string) => void run(() => changeAutomationState(owner, rule.ruleId, rule.version, action), done);
  return <article className="automation-card" aria-label={t('Automation {0}', rule.name)}>
    <header className="automation-card-head"><div><h3>{rule.name}</h3><p>{t(KIND_LABEL[rule.kind])} · {t(rule.executionMode === 'DELEGATED_WITH_LIMITS' ? 'Automatic within limits' : 'Ask me before every execution')}</p></div>
      <span className="automation-badge" data-state={rule.state}>{t(STATE_LABEL[rule.state] ?? rule.state)}</span></header>
    <dl className="automation-facts">
      {rule.schedule && <div><dt>{t('When')}</dt><dd>{text.schedule(rule)}</dd></div>}
      {rule.condition && <div><dt>{t('Condition')}</dt><dd>{text.condition(rule.condition)} · {t('checked every {0} min', String(rule.condition.checkEveryMinutes))}</dd></div>}
      {rule.watch && <div><dt>{t('Assets')}</dt><dd>{rule.watch.assets.join(' / ')} · {t('Notify me')}</dd></div>}
      {rule.kind !== 'DAILY_WATCH' && <div><dt>{t('Action')}</dt><dd>{rule.executionMode === 'DELEGATED_WITH_LIMITS' && !rule.action ? t('Multi-step workflow (see Automatic within limits)') : text.action(rule.action)}{rule.source && <> · {t('from saved workflow (version {0})', String(rule.source.version))}</>}</dd></div>}
      {rule.kind !== 'DAILY_WATCH' && text.limits(rule.limits).length > 0 && <div><dt>{t('Limits')}</dt><dd>{text.limits(rule.limits).join(' · ')}</dd></div>}
      <div><dt>{t('Next evaluation')}</dt><dd><When iso={rule.nextEvaluationAt} zone={rule.timezone}/></dd></div>
      {rule.lastObservation && <div><dt>{t('Last observation')}</dt><dd><Observation o={rule.lastObservation}/></dd></div>}
      {rule.lastOutcome && <div><dt>{t('Last evaluation')}</dt><dd>{t(OUTCOME_LABEL[rule.lastOutcome] ?? rule.lastOutcome)}</dd></div>}
      {rule.pending > 0 && <div><dt>{t('Waiting for you')}</dt><dd>{t('{0} pending proposal(s)', String(rule.pending))}</dd></div>}
      {rule.expiresAt && <div><dt>{t('Expires')}</dt><dd><When iso={rule.expiresAt} zone={rule.timezone}/></dd></div>}
    </dl>
    {rule.attention && <p className="automation-attention" role="status">{t(rule.attention === 'WORKFLOW_CHANGED' ? 'The saved workflow changed after this automation was created. FloFi proposes nothing until you rebind it to the current version.'
      : 'This action no longer reproduces with FloFi’s current engine. FloFi proposes nothing until you rebind it.')}
      {rule.executionMode === 'DELEGATED_WITH_LIMITS' ? <> {t('Re-authorize it under Automatic within limits.')}</>
        : <button type="button" className="workspace-action" disabled={busy} onClick={() => void run(() => rebindAutomation(owner, rule.ruleId, rule.version), 'Automation rebound.')}>{t('Rebind')}</button>}</p>}
    <div className="automation-row-actions">
      {rule.state === 'ACTIVE' && <button type="button" className="workspace-action" disabled={busy} onClick={() => state('PAUSE', 'Automation paused.')}>{t('Pause')}</button>}
      {rule.state === 'PAUSED' && <button type="button" className="workspace-action" disabled={busy} onClick={() => state('RESUME', 'Automation resumed.')}>{t('Resume')}</button>}
      {rule.state !== 'ARCHIVED' && <button type="button" className="workspace-action" disabled={busy} onClick={() => state('ARCHIVE', 'Automation archived.')}>{t('Archive')}</button>}
      <button type="button" className="workspace-action" onClick={onHistory}>{t('History')}</button>
    </div>
  </article>;
}

function HistoryPanel({ history, onClose }: { history: RuleHistoryView; onClose: () => void }) {
  const { t } = useLocale();
  const zone = history.rule.timezone;
  return <section className="workspace-section automation-history" aria-label={t('History of {0}', history.rule.name)}>
    <div className="workspace-section-heading"><div><h2>{t('History of {0}', history.rule.name)}</h2></div>
      <button type="button" className="workspace-action" onClick={onClose}>{t('Close')}</button></div>
    <p className="muted">{t('Evaluations and proposals are not transaction evidence. Executions, reconciliation and evidence are in your runs.')}</p>
    <h3>{t('Proposals')}</h3>
    {history.occurrences.length ? <ul className="automation-history-list">{history.occurrences.map(o => <li key={o.occurrenceId}>
      <When iso={o.dueAt} zone={zone}/> · {t(OCCURRENCE_LABEL[o.state] ?? o.state)}{o.outcome && OUTCOME_LABEL[o.outcome] && o.outcome !== 'APPROVAL_APPLIED' ? <> · {t(OUTCOME_LABEL[o.outcome])}</> : null}
      {o.approval?.runs.map(r => <span key={r.executionId}> · {t(r.reconciled ? 'Execution reconciled' : r.terminal ? 'Execution ended' : 'Owner executed — reconciling')}
        {r.evidenceEnvironment && <> ({t('evidence')}: {r.evidenceEnvironment})</>} · <a href={`/app/dashboard/runs/${encodeURIComponent(r.executionId)}`}>{t('Open run')}</a></span>)}
    </li>)}</ul> : <p className="muted">{t('No proposals yet.')}</p>}
    <h3>{t('Evaluations')}</h3>
    <ul className="automation-history-list">{history.entries.map((e: HistoryEntryView, i) => <li key={`${e.at}-${i}`}><When iso={e.at} zone={zone}/> · {t(OUTCOME_LABEL[e.outcome] ?? e.outcome)}
      {e.observation && <> · <Observation o={e.observation}/></>}{e.outcome === 'MISSED' && typeof e.detail?.count === 'number' ? <> · {t('{0} slot(s)', String(e.detail.count))}</> : null}
      {e.outcome === 'LIMIT_BLOCKED' && typeof e.detail?.code === 'string' ? <> · {t(ERROR_TEXT[e.detail.code] ?? e.detail.code)}</> : null}</li>)}</ul>
  </section>;
}

// ── Create ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Draft = { kind: Kind; name: string; source: 'ROUTE' | 'SAVED_WORKFLOW' | 'NONE'; workflowId: string; side: 'BUY' | 'SELL'; asset: Asset; network: string; amount: string;
  slippageBps: string; frequency: 'DAILY' | 'WEEKLY'; weekday: string; time: string; timezone: string; condition: 'PRICE_BELOW' | 'PRICE_ABOVE' | 'PERCENT_DROP' | 'PERCENT_RISE';
  threshold: string; reference: string; percent: string; every: string; maxPerExecution: string; periodAmount: string; periodAmountPeriod: string; periodCount: string;
  periodCountPeriod: string; cooldown: string; maxSlippage: string; expires: string; watch: Asset[] };
const initialDraft = (): Draft => ({ kind: 'SCHEDULED_DCA', name: '', source: 'ROUTE', workflowId: '', side: 'BUY', asset: 'ETH', network: 'base-sepolia', amount: '', slippageBps: '50',
  frequency: 'WEEKLY', weekday: '1', time: '09:00', timezone: browserZone(), condition: 'PRICE_BELOW', threshold: '', reference: '', percent: '', every: '15', maxPerExecution: '',
  periodAmount: '', periodAmountPeriod: 'WEEK', periodCount: '', periodCountPeriod: 'DAY', cooldown: '0', maxSlippage: '', expires: '', watch: ['BTC', 'ETH', 'SOL'] });
function inputOf(d: Draft): unknown {
  const limits = { maxAmountPerExecution: d.maxPerExecution || (d.source === 'ROUTE' && d.amount ? d.amount : null),
    maxAmountPerPeriod: d.periodAmount ? { amount: d.periodAmount, period: d.periodAmountPeriod } : null,
    maxOccurrencesPerPeriod: d.periodCount ? { count: Number(d.periodCount), period: d.periodCountPeriod } : null, cooldownMinutes: Number(d.cooldown || '0'),
    maxSlippageBps: d.maxSlippage ? Number(d.maxSlippage) : null };
  const action = d.source === 'NONE' ? null : d.source === 'SAVED_WORKFLOW' ? { kind: 'SAVED_WORKFLOW', workflowId: d.workflowId }
    : { kind: 'ROUTE', asset: d.asset, side: d.side, network: d.network, amount: d.amount, slippageBps: Number(d.slippageBps) };
  const schedule = { frequency: d.frequency, weekday: d.frequency === 'WEEKLY' ? Number(d.weekday) : null, time: d.time, timezone: d.timezone };
  const expiresAt = d.expires ? new Date(`${d.expires}T00:00:00Z`).toISOString().replace('.000Z', 'Z') : null;
  if (d.kind === 'DAILY_WATCH') return { version: 1, kind: d.kind, name: d.name, schedule, watch: { assets: d.watch }, expiresAt };
  if (d.kind === 'SCHEDULED_DCA') return { version: 1, kind: d.kind, name: d.name, schedule, action, limits, expiresAt };
  const condition = d.condition === 'PRICE_BELOW' || d.condition === 'PRICE_ABOVE' ? { type: d.condition, asset: d.asset, threshold: d.threshold, checkEveryMinutes: Number(d.every) }
    : { type: d.condition, asset: d.asset, reference: d.reference, percent: d.percent, checkEveryMinutes: Number(d.every) };
  return { version: 1, kind: d.kind, name: d.name, timezone: d.timezone, condition, action, limits, expiresAt };
}

function CreateForm({ capabilities, owner, busy, run }: { capabilities: CapabilityView; owner: WorkflowOwner; busy: boolean;
  run: (work: () => Promise<{ ok: boolean; code?: string }>, done?: string) => Promise<boolean> }) {
  const { t } = useLocale();
  const [d, setD] = useState<Draft>(initialDraft);
  const [saved, setSaved] = useState<readonly OwnerWorkflow[]>([]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD(prev => ({ ...prev, [key]: value }));
  useEffect(() => { let live = true; void listWorkflows(owner).then(r => { if (live && r.ok) setSaved(r.value.items.filter(i => i.saved)); }).catch(() => undefined); return () => { live = false; }; }, [owner]);
  const routes = useMemo(() => capabilities.routes.filter(r => r.asset === d.asset), [capabilities, d.asset]);
  const route: RouteCapability | undefined = routes.find(r => r.network === d.network);
  // A network the chosen asset has no route on is replaced by its first executable one (or its first one).
  useEffect(() => {
    if (!routes.some(r => r.network === d.network) && routes[0]) setD(prev => ({ ...prev, network: (routes.find(r => r.executable) ?? routes[0]!).network }));
  }, [d.network, routes]);
  const btc = d.asset === 'BTC' && d.source === 'ROUTE';
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await run(() => createAutomation(owner, inputOf(d)), 'Automation created. FloFi will ask you before every execution.')) setD(prev => ({ ...initialDraft(), kind: prev.kind, timezone: prev.timezone }));
  }
  // The visible label is also the control's accessible name (a wrapped select would otherwise add its current value to the name).
  const named = (control: ReactNode, label: string) => isValidElement<{ 'aria-label'?: string }>(control) && (control.type === 'input' || control.type === 'select')
    ? cloneElement(control, { 'aria-label': label }) : control;
  const field = (label: string, control: ReactNode, wide = false) => <label className={wide ? 'automation-field automation-field-wide' : 'automation-field'}>{label}{named(control, label)}</label>;
  const periodSelect = (value: string, onChange: (v: string) => void, label: string) => <select aria-label={t(label)} value={value} onChange={e => onChange(e.currentTarget.value)}>
    {['DAY', 'WEEK', 'MONTH'].map(p => <option key={p} value={p}>{t(p.toLowerCase())}</option>)}</select>;
  return <form className="automation-form" aria-label={t('Create an automation')} onSubmit={event => void submit(event)}>
    <fieldset className="automation-kind"><legend>{t('Type')}</legend>
      {(['SCHEDULED_DCA', 'PRICE_TRIGGER', 'DAILY_WATCH'] as const).map(kind => <label key={kind} className="automation-kind-option" data-selected={d.kind === kind ? 'true' : undefined}>
        <input type="radio" name="automation-kind" value={kind} checked={d.kind === kind} onChange={() => set('kind', kind)}/>{t(KIND_LABEL[kind])}</label>)}
    </fieldset>
    <div className="automation-grid">
      {field(t('Name'), <input value={d.name} maxLength={80} onChange={e => set('name', e.currentTarget.value)} required/>, true)}
      {(d.kind === 'SCHEDULED_DCA' || d.kind === 'DAILY_WATCH') && <>
        {field(t('Repeat'), <select value={d.frequency} onChange={e => set('frequency', e.currentTarget.value as Draft['frequency'])}>
          <option value="DAILY">{t('Every day')}</option><option value="WEEKLY">{t('Every week')}</option></select>)}
        {d.frequency === 'WEEKLY' && field(t('Day'), <select value={d.weekday} onChange={e => set('weekday', e.currentTarget.value)}>
          {WEEKDAYS.map((w, i) => <option key={w} value={String(i + 1)}>{t(w)}</option>)}</select>)}
        {field(t('Time'), <input type="time" value={d.time} onChange={e => set('time', e.currentTarget.value)} required/>)}
      </>}
      {d.kind === 'PRICE_TRIGGER' && <>
        {field(t('Watched asset'), <select value={d.asset} onChange={e => set('asset', e.currentTarget.value as Asset)}>
          {(['ETH', 'BTC', 'SOL'] as const).map(a => <option key={a} value={a} disabled={!capabilities.observable.includes(a)}>{a}</option>)}</select>)}
        {field(t('Condition'), <select value={d.condition} onChange={e => set('condition', e.currentTarget.value as Draft['condition'])}>
          <option value="PRICE_BELOW">{t('Price falls below')}</option><option value="PRICE_ABOVE">{t('Price rises above')}</option>
          <option value="PERCENT_DROP">{t('Price falls by a percentage')}</option><option value="PERCENT_RISE">{t('Price rises by a percentage')}</option></select>)}
        {d.condition === 'PRICE_BELOW' || d.condition === 'PRICE_ABOVE'
          ? field(t('Threshold (USD)'), <input inputMode="decimal" value={d.threshold} onChange={e => set('threshold', e.currentTarget.value.trim())} required/>)
          : <>{field(t('Reference price (USD)'), <input inputMode="decimal" value={d.reference} onChange={e => set('reference', e.currentTarget.value.trim())} required/>)}
            {field(t('Percentage'), <input inputMode="decimal" value={d.percent} onChange={e => set('percent', e.currentTarget.value.trim())} required/>)}</>}
        {field(t('Check every'), <select value={d.every} onChange={e => set('every', e.currentTarget.value)}>
          {['5', '15', '30', '60', '240', '1440'].map(m => <option key={m} value={m}>{t('{0} minutes', m)}</option>)}</select>)}
      </>}
      {field(t('Time zone'), <><input list="automation-zones" aria-label={t('Time zone')} value={d.timezone} onChange={e => set('timezone', e.currentTarget.value.trim())} required/>
        <datalist id="automation-zones">{zones().map(z => <option key={z} value={z}/>)}</datalist></>)}
    </div>
    {d.kind === 'DAILY_WATCH' ? <fieldset className="automation-assets"><legend>{t('Assets to check')}</legend>
      {(['BTC', 'ETH', 'SOL'] as const).map(a => <label key={a}><input type="checkbox" checked={d.watch.includes(a)} disabled={!capabilities.observable.includes(a)}
        onChange={e => set('watch', e.currentTarget.checked ? [...d.watch, a] : d.watch.filter(x => x !== a))}/>{a}</label>)}
      <p className="muted">{t('Action: notify me. FloFi reports what it observed; you decide to buy, sell or ignore. It is not financial advice.')}</p></fieldset>
      : <fieldset className="automation-action-fields"><legend>{t('Action')}</legend><div className="automation-grid">
        {field(t('Prepare'), <select value={d.source} onChange={e => set('source', e.currentTarget.value as Draft['source'])}>
          <option value="ROUTE">{t('A buy or a sell')}</option><option value="SAVED_WORKFLOW">{t('A saved workflow')}</option>
          {d.kind === 'PRICE_TRIGGER' && <option value="NONE">{t('Nothing — notify me only')}</option>}</select>)}
        {d.source === 'SAVED_WORKFLOW' && field(t('Saved workflow'), <select value={d.workflowId} onChange={e => set('workflowId', e.currentTarget.value)} required>
          <option value="">{t('Choose a saved workflow')}</option>{saved.map(w => <option key={w.workflowId} value={w.workflowId}>{w.name ?? w.workflowId}</option>)}</select>, true)}
        {d.source === 'ROUTE' && <>
          {field(t('Side'), <select value={d.side} onChange={e => set('side', e.currentTarget.value as Draft['side'])}><option value="BUY">{t('Buy')}</option><option value="SELL">{t('Sell')}</option></select>)}
          {d.kind === 'SCHEDULED_DCA' && field(t('Asset'), <select value={d.asset} onChange={e => set('asset', e.currentTarget.value as Asset)}>
            {(['ETH', 'SOL', 'BTC'] as const).map(a => <option key={a} value={a}>{a}</option>)}</select>)}
          {field(t('Network'), <select value={d.network} onChange={e => set('network', e.currentTarget.value)} disabled={!routes.length}>
            {routes.map(r => <option key={r.network} value={r.network} disabled={!r.executable}>{t(r.networkLabel)}{r.executable ? '' : ` — ${t('not available here')}`}</option>)}</select>)}
          {field(route ? t('Amount ({0})', d.side === 'BUY' ? route.quote : route.base) : t('Amount'), <input inputMode="decimal" value={d.amount} onChange={e => set('amount', e.currentTarget.value.trim())} required/>)}
          {field(t('Slippage (bps)'), <input inputMode="numeric" value={d.slippageBps} onChange={e => set('slippageBps', e.currentTarget.value.trim())} required/>)}
        </>}
      </div>
      {btc && <p className="automation-attention" role="status">{t('FloFi has no BTC swap route yet (no BTC, WBTC or cbBTC swap). You can watch BTC and get alerts, but FloFi cannot prepare a BTC purchase, and it never substitutes another asset.')}</p>}
      {route && !route.executable && <p className="automation-attention" role="status">{t('This action is not available on this deployment ({0}).', route.reason ?? 'UNAVAILABLE')}</p>}
      {route?.fundsClass === 'TEST_FUNDS' && <p className="muted">{t('Test network: the swap executes at the test pool’s price, not at the observed market price.')}</p>}
      </fieldset>}
    {d.kind !== 'DAILY_WATCH' && <fieldset className="automation-limits"><legend>{t('Limits')}</legend><div className="automation-grid">
      {field(t('Max per execution'), <input inputMode="decimal" value={d.maxPerExecution} placeholder={d.amount} onChange={e => set('maxPerExecution', e.currentTarget.value.trim())}/>)}
      {field(t('Max amount per period'), <span className="automation-pair"><input inputMode="decimal" aria-label={t('Max amount per period')} value={d.periodAmount} onChange={e => set('periodAmount', e.currentTarget.value.trim())}/>
        {periodSelect(d.periodAmountPeriod, v => set('periodAmountPeriod', v), 'Amount period')}</span>)}
      {field(t('Max proposals per period'), <span className="automation-pair"><input inputMode="numeric" aria-label={t('Max proposals per period')} value={d.periodCount} onChange={e => set('periodCount', e.currentTarget.value.trim())}/>
        {periodSelect(d.periodCountPeriod, v => set('periodCountPeriod', v), 'Proposal period')}</span>)}
      {field(t('Cooldown (minutes)'), <input inputMode="numeric" value={d.cooldown} onChange={e => set('cooldown', e.currentTarget.value.trim())}/>)}
      {field(t('Max slippage (bps)'), <input inputMode="numeric" value={d.maxSlippage} onChange={e => set('maxSlippage', e.currentTarget.value.trim())}/>)}
      {field(t('Expires on'), <input type="date" value={d.expires} onChange={e => set('expires', e.currentTarget.value)}/>)}
    </div><p className="muted">{t('Limits bound what FloFi proposes. They are not on-chain spending limits: every execution still needs your review and your wallet signature.')}</p></fieldset>}
    <p className="automation-execution"><strong>{t('Execution')}:</strong> {t('Ask me before every execution')}</p>
    <div className="automation-row-actions"><button type="submit" className="workspace-action primary-action" disabled={busy || btc || (route !== undefined && !route.executable && d.source === 'ROUTE')}>{t('Create automation')}</button></div>
  </form>;
}

// ── Notifications ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function Notifications({ overview, owner, busy, run }: { overview: OverviewView; owner: WorkflowOwner; busy: boolean; run: (work: () => Promise<{ ok: boolean; code?: string }>, done?: string) => Promise<boolean> }) {
  const { t } = useLocale();
  const [code, setCode] = useState<LinkCodeView | null>(null);
  return <section className="workspace-section" aria-labelledby="automation-notifications">
    <div className="workspace-section-heading"><div><h2 id="automation-notifications">{t('Notifications')}</h2></div></div>
    <div className="automation-card">
      <p><strong>{t('In FloFi')}:</strong> {t('always on — proposals wait for you in this workspace.')}</p>
      {!overview.telegram.available ? <p><strong>{t('Telegram')}:</strong> {t('not available on this deployment.')}</p>
        : overview.telegram.linked ? <p><strong>{t('Telegram')}:</strong> {t('linked to your chat until')} <When iso={overview.telegram.linked.expiresAt} zone={browserZone()}/>
          {' '}<button type="button" className="workspace-action" disabled={busy} onClick={() => void run(() => unlinkTelegram(owner), 'Telegram unlinked.')}>{t('Unlink')}</button></p>
          : <><p><strong>{t('Telegram')}:</strong> {t('not linked.')} <button type="button" className="workspace-action" disabled={busy}
            onClick={() => void run(async () => { const r = await createTelegramLinkCode(owner); if (r.ok) setCode(r.value); return r; })}>{t('Connect Telegram')}</button></p>
            {code && <p role="status">{t('Send this message to the FloFi bot within 10 minutes:')} <code>{code.command}</code></p>}</>}
      <p className="muted">{t('A notification never authorizes anything. It only brings you back here, where your own wallet decides.')}</p>
    </div>
  </section>;
}

// ── Workspace ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The shell builds a new owner object on every render: effects key on the owner's identity, never on the object. */
function useStableOwner(owner: WorkflowOwner | null | undefined): WorkflowOwner | null {
  const key = owner ? `${owner.namespace}:${owner.address}` : null;
  return useMemo(() => owner ? { namespace: owner.namespace, address: owner.address } : null, [key]);
}

export function AutomationsWorkspace({ owner: ownerProp, proof, onPropose }: Partial<AutomationNavigation>) {
  const { t } = useLocale(), text = useAutomationText();
  const owner = useStableOwner(ownerProp);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<OverviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<RuleHistoryView | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [mode, setMode] = useState<'CONFIRM' | 'DELEGATED'>('CONFIRM');
  const [review, setReview] = useState<ReviewView | null>(null);
  const proven = Boolean(owner && proof?.proven === owner.address);
  const delegation = useDelegation(enabled ? owner : null, proven);
  const refreshDelegation = delegation.refresh;
  const ownerKey = owner ? `${owner.namespace}:${owner.address}` : null;
  useEffect(() => { void automationsAvailability().then(a => setEnabled(a.enabled)).catch(() => setEnabled(false)); }, []);
  useEffect(() => { try { setHighlight(new URLSearchParams(window.location.search).get('occurrence')); } catch { /* no query */ } }, []);
  const refresh = useCallback(async () => {
    if (!owner || !proven) return;
    const result = await automationOverview(owner).catch(() => ({ ok: false as const, code: 'AUTOMATION_UNAVAILABLE' }));
    if (result.ok) { setOverview(result.value); setError(null); } else setError(result.code);
  }, [owner, proven]);
  useEffect(() => { setOverview(null); setHistory(null); if (enabled && proven) void refresh(); }, [enabled, proven, ownerKey, refresh]);
  useEffect(() => {
    if (!enabled || !proven) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [enabled, proven, refresh]);
  useEffect(() => { if (highlight && overview) document.getElementById(`occurrence-${highlight}`)?.scrollIntoView({ block: 'center' }); }, [highlight, overview]);
  const run = useCallback(async (work: () => Promise<{ ok: boolean; code?: string }>, done?: string) => {
    if (busy) return false;
    setBusy(true); setNotice(''); setError(null);
    try {
      const result = await work();
      if (!result.ok) { setError(result.code ?? 'AUTOMATION_UNAVAILABLE'); return false; }
      if (done) setNotice(done);
      await refresh();
      await refreshDelegation();
      return true;
    } catch { setError('AUTOMATION_UNAVAILABLE'); return false; } finally { setBusy(false); }
  }, [busy, refresh, refreshDelegation]);
  const delegationReady = delegation.overview?.availability.enabled === true;
  const delegationBlocked = delegation.overview?.availability.executor ?? delegation.code;
  const rules = overview?.rules ?? [], byId = new Map(rules.map(r => [r.ruleId, r]));
  const live = rules.filter(r => r.state !== 'ARCHIVED'), archived = rules.filter(r => r.state === 'ARCHIVED');
  return <section className="automations" aria-label={t('Automations')}>
    <header className="secondary-workspace-heading"><h1>{t('Automations')}</h1>
      <p>{t('FloFi evaluates the schedules and price conditions you set, and asks you before every execution. Nothing runs or signs on its own: each proposal goes through a fresh simulation, your Strategy Manifest review and your own wallet signature.')}</p></header>
    <p className="workspace-notice" role="status">{t(notice)}</p>
    {error && <p className="error-banner" role="alert">{text.error(error)}</p>}
    {enabled === null ? <p role="status">{t('Loading automations…')}</p>
      : !enabled ? <div className="workspace-empty"><h3>{t('Automations are not enabled on this deployment.')}</h3></div>
        : !owner ? <div className="workspace-empty"><p>{t('Connect a wallet from the header to use automations.')}</p></div>
          : !proven ? <div className="workspace-empty"><p>{t('Verify wallet ownership to use automations.')}</p>{proof && <WalletProof namespace={owner.namespace} proof={{ ...proof, proven: null }}/>}</div>
            : !overview ? <p role="status">{t('Loading automations…')}</p> : <>
              <section className="workspace-section" aria-labelledby="automation-pending">
                <div className="workspace-section-heading"><div><h2 id="automation-pending">{t('Waiting for you')}</h2><span className="workspace-count">{overview.pending.length}</span></div>
                  <button type="button" className="workspace-action" disabled={busy} onClick={() => void refresh()}>{t('Refresh')}</button></div>
                {overview.pending.length ? <div className="automation-list">{overview.pending.map(o => <PendingCard key={o.occurrenceId} o={o} rule={byId.get(o.ruleId)} highlighted={o.occurrenceId === highlight}
                  capabilities={overview.capabilities} busy={busy} run={run} onPropose={command => onPropose?.(command)} owner={owner}/>)}</div>
                  : <div className="workspace-empty"><p>{t('Nothing is waiting for you. FloFi will ask here when an automation is due or a condition is met.')}</p></div>}
              </section>
              <section className="workspace-section" aria-labelledby="automation-rules">
                <div className="workspace-section-heading"><div><h2 id="automation-rules">{t('Your automations')}</h2><span className="workspace-count">{live.length}</span></div></div>
                {live.length ? <div className="automation-list">{live.map(rule => <RuleCard key={rule.ruleId} rule={rule} busy={busy} run={run} owner={owner}
                  onHistory={() => void automationHistory(owner, rule.ruleId).then(r => { if (r.ok) setHistory(r.value); else setError(r.code); })}/>)}</div>
                  : <div className="workspace-empty"><p>{t('No automations yet. Create one below.')}</p></div>}
                {archived.length > 0 && <details className="automation-archived"><summary>{t('Archived ({0})', String(archived.length))}</summary>
                  <div className="automation-list">{archived.map(rule => <RuleCard key={rule.ruleId} rule={rule} busy={busy} run={run} owner={owner}
                    onHistory={() => void automationHistory(owner, rule.ruleId).then(r => { if (r.ok) setHistory(r.value); else setError(r.code); })}/>)}</div></details>}
              </section>
              {history && <HistoryPanel history={history} onClose={() => setHistory(null)}/>}
              {delegationReady && <section className="workspace-section" aria-labelledby="automation-delegated">
                <div className="workspace-section-heading"><div><h2 id="automation-delegated">{t('Automatic within limits')}</h2>
                  <span className="workspace-count">{delegation.overview!.authorizations.length}</span></div>
                  <button type="button" className="workspace-action" disabled={busy} onClick={() => void refreshDelegation()}>{t('Refresh')}</button></div>
                {review && <AuthorizationReview review={review} owner={owner} busy={busy} run={run} onDone={() => setReview(null)}/>}
                <DelegatedAuthorizations overview={delegation.overview!} owner={owner} busy={busy} run={run} onReview={setReview}/>
              </section>}
              <section className="workspace-section" aria-labelledby="automation-create">
                <div className="workspace-section-heading"><div><h2 id="automation-create">{t('Create an automation')}</h2></div></div>
                <div className="delegation-mode" role="radiogroup" aria-label={t('Execution')}>
                  <label><input type="radio" name="automation-mode" checked={mode === 'CONFIRM'} onChange={() => setMode('CONFIRM')}/> {t('Ask every time')}</label>
                  <label><input type="radio" name="automation-mode" checked={mode === 'DELEGATED'} disabled={!delegationReady || Boolean(delegationBlocked)} onChange={() => setMode('DELEGATED')}/> {t('Automatic within limits')}</label>
                  {delegationReady && delegationBlocked && <p className="muted">{t(DELEGATION_ERROR_TEXT[delegationBlocked] ?? delegationBlocked)}</p>}
                </div>
                {mode === 'DELEGATED' && delegationReady && !delegationBlocked ? <DelegatedCreate owner={owner} busy={busy} run={run} onReview={setReview}/>
                  : <CreateForm capabilities={overview.capabilities} owner={owner} busy={busy} run={run}/>}
                <p className="muted">{t('Prices: {0}.', overview.capabilities.priceSource === 'chainlink' ? t('Chainlink feeds on Base (read-only)')
                  : overview.capabilities.priceSource === 'fixture' ? t('test fixture (MOCKED)') : t('no price source on this deployment'))}</p>
              </section>
              {overview.recent.length > 0 && <section className="workspace-section" aria-labelledby="automation-recent">
                <div className="workspace-section-heading"><div><h2 id="automation-recent">{t('Recent proposals')}</h2></div></div>
                <ul className="automation-history-list">{overview.recent.map(o => <li key={o.occurrenceId}>{o.ruleName} · <When iso={o.dueAt} zone={byId.get(o.ruleId)?.timezone ?? 'UTC'}/> · {t(OCCURRENCE_LABEL[o.state] ?? o.state)}
                  {o.approval?.runs.map(r => <span key={r.executionId}> · {t(r.reconciled ? 'Execution reconciled' : r.terminal ? 'Execution ended' : 'Owner executed — reconciling')} · <a href={`/app/dashboard/runs/${encodeURIComponent(r.executionId)}`}>{t('Open run')}</a></span>)}</li>)}</ul>
              </section>}
              <Notifications overview={overview} owner={owner} busy={busy} run={run}/>
            </>}
  </section>;
}

/** The in-app notice of proposals waiting for the owner, shown on the product stages while there are any. */
export function AutomationInbox({ owner: ownerProp, proven, open }: { owner: WorkflowOwner | null; proven: boolean; open: () => void }) {
  const { t } = useLocale();
  const owner = useStableOwner(ownerProp);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!owner || !proven) { setCount(0); return; }
    let live = true;
    const load = async () => {
      const availability = await automationsAvailability().catch(() => ({ enabled: false }));
      if (!availability.enabled) return;
      const result = await automationOverview(owner).catch(() => null);
      if (live && result?.ok) setCount(result.value.pending.length);
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => { live = false; clearInterval(timer); };
  }, [owner, proven]);
  if (!count) return null;
  return <div className="automation-inbox" role="status"><span>{t(count === 1 ? '1 automation proposal is waiting for you.' : '{0} automation proposals are waiting for you.', String(count))}</span>
    <button type="button" className="workspace-action" onClick={open}>{t('Open Automations')}</button></div>;
}
