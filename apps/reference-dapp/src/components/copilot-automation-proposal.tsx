// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { automationOverview, createAutomation } from '../app/automation-action';
import type { AutomationInput } from '../automations/definition';
import type { CapabilityView } from '../automations/views';
import { automationCapabilityIssue } from '../domain/copilot-automation';
import type { WorkflowOwner } from '../domain/saved-workflow';
import { useLocale } from '../i18n/locale';
import { DELEGATION_ERROR_TEXT, DelegatedLimitsFlow, useDelegation, useDelegationEnabled, useDelegationRunner } from './delegated-automations';
import { WalletProof, type useWalletProof } from './wallet-proof';

/**
 * A draft can call only the existing owner-scoped create operation, after an explicit click. BUILD-AUTOMATION-002: where this deployment
 * serves delegated execution, the OWNER may instead choose "Automatic within limits" for a draft that executes something. The draft itself
 * carries no mode, limit, expiry or Credential: the owner enters the limits, FloFi resolves every step's Credential, and nothing is created
 * before "Create and review authorization" or activated before the owner's passkey signs the one workflow authorization.
 */
export function CopilotAutomationProposal({ input, owner, proof, dismiss }: {
  input: AutomationInput; owner: WorkflowOwner | null; proof?: ReturnType<typeof useWalletProof>; dismiss(): void;
}) {
  const { t } = useLocale();
  const [capabilities, setCapabilities] = useState<CapabilityView | null>(null);
  const [busy, setBusy] = useState(false), [created, setCreated] = useState(false), [error, setError] = useState<string | null>(null);
  const lock = useRef(false), generation = useRef(0);
  const [mode, setMode] = useState<'CONFIRM' | 'DELEGATED'>('CONFIRM'), [activated, setActivated] = useState(false), modeGroup = useId();
  const ownerKey = owner ? `${owner.namespace}:${owner.address}` : null;
  const proven = Boolean(owner && proof?.proven === owner.address);
  // The same availability the Automations workspace uses, for the proven owner only: a deployment without a delegated executor shows
  // "Automatic within limits" unavailable with its reason, never as a choice that would fail later.
  // The shell builds a new owner object on every render: key on the owner's identity, never on the object.
  const stableOwner = useMemo(() => owner ? { namespace: owner.namespace, address: owner.address } : null, [ownerKey]);
  const enabled = useDelegationEnabled(), delegation = useDelegation(enabled === true && proven ? stableOwner : null, proven), delegated = useDelegationRunner();
  const delegationReady = delegation.overview?.availability.enabled === true, delegationBlocked = delegation.overview?.availability.executor ?? null;
  useEffect(() => {
    const current = ++generation.current;
    setCapabilities(null); setCreated(false); setError(null); setBusy(false); setMode('CONFIRM'); setActivated(false);
    if (owner && proven) void automationOverview(owner).then(result => {
      if (current !== generation.current) return;
      if (result.ok) setCapabilities(result.value.capabilities); else setError('Automations are unavailable on this deployment right now.');
    }).catch(() => { if (current === generation.current) setError('Automations are unavailable on this deployment right now.'); });
    return () => { generation.current++; };
  }, [ownerKey, proven, input]);
  const issue = capabilities ? automationCapabilityIssue(input, capabilities) : null;
  async function confirm() {
    if (lock.current || !owner || !proven || !capabilities || issue || created) return;
    lock.current = true; setBusy(true); setError(null);
    const current = generation.current;
    try {
      const result = await createAutomation(owner, input);
      if (current !== generation.current) return;
      if (result.ok) setCreated(true); else setError('FloFi could not complete this ({0}).'.replace('{0}', result.code));
    } catch { if (current === generation.current) setError('Automations are unavailable on this deployment right now.'); }
    finally { lock.current = false; if (current === generation.current) setBusy(false); }
  }
  const action = 'action' in input ? input.action : null;
  const route = action?.kind === 'ROUTE' ? capabilities?.routes.find(r => r.network === action.network && r.asset === action.asset) : null;
  const kind = input.kind === 'SCHEDULED_DCA' ? 'Scheduled DCA' : input.kind === 'PRICE_TRIGGER' ? 'Price trigger' : 'Daily watch';
  // Only a draft that executes a route can run automatically; a watch or a notify-only trigger has nothing to delegate.
  const canDelegate = delegationReady && action?.kind === 'ROUTE';
  const condition = input.kind === 'PRICE_TRIGGER' ? input.condition : null;
  return <section className="automation-card copilot-automation-proposal" aria-label={t('Automation proposal')}>
    <h3>{t(kind)}</h3>
    <dl className="simulation-summary-values">
      <div><dt>{t('Asset')}</dt><dd>{input.kind === 'DAILY_WATCH' ? input.watch.assets.join(', ') : action?.kind === 'ROUTE' ? action.asset : input.kind === 'PRICE_TRIGGER' ? input.condition.asset : ''}</dd></div>
      {'schedule' in input && <div><dt>{t('Schedule')}</dt><dd>{t('Every day at {0} ({1})', input.schedule.time, input.schedule.timezone)}</dd></div>}
      {input.kind === 'PRICE_TRIGGER' && <><div><dt>{t('Condition')}</dt><dd>{condition && 'percent' in condition
        ? t(condition.type === 'PERCENT_DROP' ? 'Price falls {0}% from ${1}' : 'Price rises {0}% from ${1}', condition.percent, condition.reference)
        : <>{t(input.condition.type === 'PRICE_BELOW' ? 'Price falls below' : 'Price rises above')} ${'threshold' in input.condition ? input.condition.threshold : ''}</>}</dd></div>
        <div><dt>{t('Check every')}</dt><dd>{t('{0} minutes', input.condition.checkEveryMinutes)} · {input.timezone}</dd></div></>}
      {action?.kind === 'ROUTE' && <><div><dt>{t('Action')}</dt><dd>{t(action.side === 'BUY' ? 'Buy' : 'Sell')} · {action.amount} {action.side === 'BUY' ? route?.quote ?? (action.network === 'solana-devnet' ? 'devUSDC' : 'USDC') : action.asset === 'ETH' ? 'WETH' : action.asset}</dd></div>
        <div><dt>{t('Network')}</dt><dd>{t(route?.networkLabel ?? action.network)}</dd></div>
        <div><dt>{t('Slippage (bps)')}</dt><dd>{action.slippageBps}</dd></div>
        <div><dt>{t('Max per execution')}</dt><dd>{input.kind !== 'DAILY_WATCH' ? input.limits.maxAmountPerExecution : ''}</dd></div></>}
    </dl>
    {action?.kind === 'ROUTE' && action.asset === 'ETH' && <p>{t('ETH trades use WETH on this route.')}</p>}
    {route?.fundsClass === 'REAL_FUNDS' && <p role="alert">{t('REAL FUNDS')}</p>}
    {canDelegate && !created && !activated && <div className="delegation-mode" role="radiogroup" aria-label={t('Execution')}>
      <label><input type="radio" name={modeGroup} checked={mode === 'CONFIRM'} disabled={delegated.busy} onChange={() => setMode('CONFIRM')}/> {t('Ask every time')}</label>
      <label><input type="radio" name={modeGroup} checked={mode === 'DELEGATED'} disabled={delegated.busy || Boolean(delegationBlocked)} onChange={() => setMode('DELEGATED')}/> {t('Automatic within limits')}</label>
      {delegationBlocked && <p className="muted">{t(DELEGATION_ERROR_TEXT[delegationBlocked] ?? delegationBlocked)}</p>}
    </div>}
    {mode === 'CONFIRM' || !canDelegate ? <>
      <p>{t('Execution')}: {t('Ask me before every execution')}</p>
      <p>{t('Creating a rule authorizes no transaction. Each proposal still requires fresh simulation, Manifest Review, explicit approval and your wallet signature.')}</p>
    </> : <p>{t('Execution: Automatic within limits — FloFi executes each occurrence without asking you again, inside the limits you sign once.')} {t('Set every limit and the expiry yourself: the assistant never chooses them.')}</p>}
    {!owner ? <p>{t('Connect a wallet from the header to use automations.')}</p> : !proven && proof ? <WalletProof namespace={owner.namespace} proof={proof}/> : null}
    {(issue ?? error) && <p role="alert">{t(issue ?? error)}</p>}
    {mode === 'DELEGATED' && canDelegate && !delegationBlocked && owner && proven && action?.kind === 'ROUTE' ? <>
      {delegated.messages}
      <DelegatedLimitsFlow owner={owner} busy={delegated.busy} run={delegated.run} prefill={false} slippageBps={action.slippageBps} disabled={!capabilities || Boolean(issue)}
        source={terms => ({ version: 1, source: 'AUTOMATION_INPUT', automation: input, terms })} onAuthorized={() => setActivated(true)}/>
      <div className="automation-row-actions"><button type="button" disabled={delegated.busy} onClick={dismiss}>{t('Dismiss proposal')}</button></div>
    </> : created ? <p role="status">{t('Automation created. FloFi will ask you before every execution.')}</p> : <div className="automation-row-actions">
      <button type="button" className="primary" disabled={busy || !proven || !capabilities || Boolean(issue)} onClick={() => void confirm()}>{t(busy ? 'Creating automation…' : 'Create automation')}</button>
      <button type="button" disabled={busy} onClick={dismiss}>{t('Dismiss proposal')}</button>
    </div>}
  </section>;
}
