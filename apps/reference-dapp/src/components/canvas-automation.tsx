// SPDX-License-Identifier: AGPL-3.0-only
'use client';
/**
 * BUILD-AUTOMATION-002: "Automate this workflow" — the exact workflow already in the Canvas, never rebuilt or reinterpreted. The server
 * derives its steps by exact node reproduction (`automations/automation-steps.ts`) and names the precise reason for anything it cannot run.
 *
 *   Ask every time          AUTOMATION-001 unchanged: its own create form, prefilled with the Canvas's one step (one-step workflows only,
 *                           as AUTOMATION-001's owner execution is one step).
 *   Automatic within limits the shared delegated flow with the Canvas workflow as its source: limits → the authority check over the complete
 *                           workflow → "Create and review authorization" → the Universal Authorization Review → one passkey signature.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { canvasAutomationSteps } from '../app/automation-action';
import { EXECUTION_ROUTES, type RouteAction } from '../automations/assets';
import type { AutomationStep, AutomationSteps } from '../automations/automation-steps';
import type { WorkflowOwner } from '../domain/saved-workflow';
import { useLocale } from '../i18n/locale';
import { DELEGATION_ERROR_TEXT, DelegatedLimitsFlow, ScheduleFields, scheduleTrigger, useDelegationRunner, type ScheduleDraft } from './delegated-automations';

export type CanvasAutomationDraft = { readonly workflow: unknown; readonly name: string; readonly dismiss: () => void };
const NETWORK_LABEL: Readonly<Record<string, string>> = { 'base-sepolia': 'Base Sepolia', 'ethereum-sepolia': 'Ethereum Sepolia', 'solana-devnet': 'Solana Devnet', base: 'Base', solana: 'Solana' };
const MAINNET_CHAINS = new Set(['eip155:1', 'eip155:8453', 'eip155:42161', 'eip155:10', 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d']);
const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  AUTOMATION_WORKFLOW_NOT_REPRESENTABLE: 'Some steps cannot run as an automation yet.', AUTOMATION_WORKFLOW_EMPTY: 'Add an action to the Canvas first.',
  AUTOMATION_WORKFLOW_TOO_LONG: 'An automation can have at most four steps.', AUTOMATION_WORKFLOW_ORDER_UNSUPPORTED: 'A step depends on a later step; reorder the Canvas first.',
  AUTOMATION_WORKFLOW_INVALID: 'The Canvas workflow could not be read.', WALLET_SESSION_REQUIRED: 'Verify wallet ownership to automate this workflow.',
};
const labelOf = (r: RouteAction) => {
  const route = EXECUTION_ROUTES[r.asset].find(x => x.network === r.network);
  if (!route) return `${r.amount} · ${NETWORK_LABEL[r.network] ?? r.network}`;
  const [from, to] = r.side === 'BUY' ? [route.quote, route.base] : [route.base, route.quote];
  return `${r.amount} ${from} → ${to} · ${NETWORK_LABEL[r.network] ?? r.network}`;
};
/** Why a Canvas step cannot run as an automation: precise, before anything is created. */
const reasonOf = (s: AutomationStep) => MAINNET_CHAINS.has(s.chainId) ? 'real-funds networks are disabled for automatic execution'
  : s.actionType !== 'asset.swap.exact-input' ? 'this action cannot run automatically yet' : 'FloFi cannot reproduce this step exactly';
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

export function CanvasAutomation({ canvas, owner, delegationReady, delegationBlocked, confirm, onAuthorized }: { canvas: CanvasAutomationDraft; owner: WorkflowOwner;
  delegationReady: boolean; delegationBlocked: string | null; confirm: (route: RouteAction) => ReactNode; onAuthorized?: () => void }) {
  const { t } = useLocale();
  const [steps, setSteps] = useState<AutomationSteps | null>(null), [code, setCode] = useState<string | null>(null);
  const [mode, setMode] = useState<'CONFIRM' | 'DELEGATED'>('CONFIRM'), [name, setName] = useState(canvas.name.slice(0, 80) || 'Canvas workflow');
  const [schedule, setSchedule] = useState<ScheduleDraft>(() => ({ frequency: 'WEEKLY', weekday: '1', time: '09:00', timezone: browserZone() }));
  const runner = useDelegationRunner();
  useEffect(() => {
    let live = true;
    setSteps(null); setCode(null);
    void canvasAutomationSteps(canvas.workflow).then(r => { if (!live) return; if (r.ok) setSteps(r.value); else setCode(r.code); }).catch(() => { if (live) setCode('AUTOMATIONS_UNAVAILABLE'); });
    return () => { live = false; };
  }, [canvas.workflow]);
  const slippage = useMemo(() => steps?.ok ? Math.max(...steps.steps.map(s => s.route.slippageBps)) : 50, [steps]);
  const refusal = code ?? (steps && !steps.ok ? steps.code : null);
  return <section className="automation-card canvas-automation" aria-label={t('Automate this workflow')}>
    <header className="automation-card-head"><div><h3>{t('Automate this workflow')}</h3><p>{t('From your Canvas: {0}', canvas.name)}</p></div></header>
    {steps ? <ul className="delegation-steps">{steps.steps.map(s => <li key={s.nodeId} data-ok={s.route ? 'true' : 'false'}>
      {t('Step {0}', String(s.index + 1))} · {s.route ? labelOf(s.route) : t('not covered: {0}', t(reasonOf(s)))}</li>)}</ul>
      : !refusal && <p className="muted">{t('Reading your Canvas workflow…')}</p>}
    {refusal && <p className="error-banner" role="alert">{t(REFUSAL_TEXT[refusal] ?? DELEGATION_ERROR_TEXT[refusal] ?? 'FloFi could not complete this ({0}).', refusal)} {t('Nothing was created.')}</p>}
    {steps?.ok && <>
      <div className="delegation-mode" role="radiogroup" aria-label={t('Execution')}>
        <label><input type="radio" name="canvas-automation-mode" checked={mode === 'CONFIRM'} onChange={() => setMode('CONFIRM')}/> {t('Ask every time')}</label>
        <label><input type="radio" name="canvas-automation-mode" checked={mode === 'DELEGATED'} disabled={!delegationReady || Boolean(delegationBlocked)} onChange={() => setMode('DELEGATED')}/> {t('Automatic within limits')}</label>
        {delegationReady && delegationBlocked && <p className="muted">{t(DELEGATION_ERROR_TEXT[delegationBlocked] ?? delegationBlocked)}</p>}
      </div>
      {mode === 'CONFIRM' ? steps.steps.length === 1 ? confirm(steps.steps[0]!.route)
        : <p className="muted">{t('Ask every time runs one-step workflows. This workflow has {0} steps, so it can only run automatically within limits.', String(steps.steps.length))}</p>
        : <div className="automation-form delegation-form">
          <p className="muted">{t('Execution: Automatic within limits — FloFi executes each occurrence without asking you again, inside the limits you sign once.')}</p>
          <label className="automation-field"><span>{t('Name')}</span><input aria-label={t('Name')} value={name} maxLength={80} onChange={e => setName(e.currentTarget.value)}/></label>
          <ScheduleFields value={schedule} onChange={setSchedule}/>
          {runner.messages}
          {/* Remounted whenever the Canvas steps change, so a check of an older workflow can never be created. */}
          <DelegatedLimitsFlow key={JSON.stringify(steps.steps.map(s => s.route))} owner={owner} busy={runner.busy} run={runner.run} prefill slippageBps={slippage}
            source={terms => ({ version: 1, source: 'CANVAS_WORKFLOW', name: name.trim() || 'Canvas workflow', trigger: scheduleTrigger(schedule), workflow: canvas.workflow, terms })}
            {...onAuthorized ? { onAuthorized } : {}}/>
        </div>}
    </>}
    <div className="automation-row-actions"><button type="button" className="workspace-action" onClick={canvas.dismiss}>{t('Use a new workflow instead')}</button></div>
  </section>;
}
