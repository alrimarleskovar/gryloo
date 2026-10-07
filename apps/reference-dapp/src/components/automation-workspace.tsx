// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AutomationEvent, AutomationRule } from '@defi-workflow-engine/cloud-runtime';
import { automationSnapshot, createAutomation, dismissAutomationEvent, openAutomationEvent, setAutomationState } from '../app/automation-action';
import { scheduledDcaSpec } from '../domain/automation';
import { composeStrategy } from '../engine/strategy-engine';
import { useWorkflow } from '../state/workflow-store';
import { WalletProof, useWalletProof } from './wallet-proof';

type Snapshot = { rules: readonly AutomationRule[]; events: readonly AutomationEvent[] };
const code = (cause: unknown) => cause instanceof Error ? cause.message : 'AUTOMATION_UNAVAILABLE';
const weekdays = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

export function AutomationWorkspace() {
  const proof = useWalletProof('eip155'), { state, propose } = useWorkflow(), router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot>({ rules: [], events: [] });
  const [name, setName] = useState('Weekly WETH DCA'), [amount, setAmount] = useState('25'), [time, setTime] = useState('09:00');
  const [cadence, setCadence] = useState<'DAILY' | 'WEEKLY'>('WEEKLY'), [weekday, setWeekday] = useState(1);
  const [network, setNetwork] = useState<'base-sepolia' | 'ethereum-sepolia'>('base-sepolia');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const timezone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }, []);
  const refresh = useCallback(async () => {
    if (!proof.proven) { setSnapshot({ rules: [], events: [] }); return; }
    const result = await automationSnapshot();
    if (result.ok) setSnapshot(result.value); else setError(result.code);
  }, [proof.proven]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function create() {
    if (busy || !proof.proven) return;
    setBusy(true); setError(null);
    try {
      const spec = scheduledDcaSpec({ name: name.trim() || 'DCA', network, amount, cadence, timezone, localTime: time,
        ...(cadence === 'WEEKLY' ? { weekday } : {}) });
      const result = await createAutomation(spec);
      if (!result.ok) throw new Error(result.code);
      await refresh();
    } catch (cause) { setError(code(cause)); } finally { setBusy(false); }
  }
  async function toggle(rule: AutomationRule) {
    if (busy) return; setBusy(true); setError(null);
    try {
      const result = await setAutomationState(rule.automationId, rule.state === 'ACTIVE' ? 'PAUSED' : 'ACTIVE');
      if (!result.ok) throw new Error(result.code);
      await refresh();
    } catch (cause) { setError(code(cause)); } finally { setBusy(false); }
  }
  async function load(event: AutomationEvent) {
    if (busy) return; setBusy(true); setError(null);
    try {
      const composed = composeStrategy(event.strategy);
      if (!composed.ok || composed.workflowHash !== event.workflowHash) throw new Error('AUTOMATION_EVENT_INVALID');
      const opened = await openAutomationEvent(event.eventId);
      if (!opened.ok) throw new Error(opened.code);
      propose({ ...composed.command, baseRevision: state.workflow.revision });
      router.push('/');
    } catch (cause) { setError(code(cause)); setBusy(false); }
  }
  async function dismiss(event: AutomationEvent) {
    if (busy) return; setBusy(true); setError(null);
    try {
      const result = await dismissAutomationEvent(event.eventId);
      if (!result.ok) throw new Error(result.code);
      await refresh();
    } catch (cause) { setError(code(cause)); } finally { setBusy(false); }
  }

  const pending = snapshot.events.filter(event => event.status === 'PENDING_OWNER' || event.status === 'OPENED');
  return <>
    <header className="secondary-workspace-heading"><h1>Automations</h1>
      <p>Schedule a strategy. FloFi prepares each occurrence, but your wallet still reviews and signs every execution.</p></header>
    <section className="workspace-section" aria-labelledby="automation-owner">
      <div className="workspace-section-heading"><div><h2 id="automation-owner">Owner</h2></div></div>
      <WalletProof namespace="eip155" proof={proof}/>
    </section>
    {proof.proven && <section className="workspace-section" aria-labelledby="new-dca">
      <div className="workspace-section-heading"><div><h2 id="new-dca">New DCA</h2></div></div>
      <div className="automation-form">
        <label>Name<input value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label>
        <label>Network<select value={network} onChange={event => setNetwork(event.target.value as typeof network)}>
          <option value="base-sepolia">Base Sepolia</option><option value="ethereum-sepolia">Ethereum Sepolia</option>
        </select></label>
        <label>Spend each time<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)}/><span> USDC</span></label>
        <label>Cadence<select value={cadence} onChange={event => setCadence(event.target.value as typeof cadence)}>
          <option value="DAILY">Every day</option><option value="WEEKLY">Every week</option>
        </select></label>
        {cadence === 'WEEKLY' && <label>Day<select value={weekday} onChange={event => setWeekday(Number(event.target.value))}>
          {weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}
        </select></label>}
        <label>Time<input type="time" value={time} onChange={event => setTime(event.target.value)}/></label>
        <p className="muted">Timezone: {timezone}. Strategy: swap {amount || '…'} USDC → WETH. Each occurrence requires fresh simulation, Manifest review and your wallet signature.</p>
        <button type="button" className="primary" disabled={busy} onClick={() => void create()}>{busy ? 'Saving…' : 'Create DCA'}</button>
      </div>
    </section>}
    {proof.proven && <section className="workspace-section" aria-labelledby="due-automations">
      <div className="workspace-section-heading"><div><h2 id="due-automations">Needs your decision</h2><span className="workspace-count">{pending.length}</span></div></div>
      {pending.length ? <div className="automation-list">{pending.map(event => <article className="workspace-wallet-card" key={event.eventId}>
        <div className="workspace-wallet-heading"><div><h3>DCA occurrence</h3><p>{new Date(event.occurrenceAt).toLocaleString()}</p></div></div>
        <p>This event has no transaction authority. Open it to put the strategy into Build, then simulate and review.</p>
        <div className="workspace-wallet-actions"><button type="button" className="primary" disabled={busy} onClick={() => void load(event)}>Load into Build</button>
          <button type="button" disabled={busy} onClick={() => void dismiss(event)}>Dismiss</button></div>
      </article>)}</div> : <div className="workspace-empty"><h3>No DCA occurrence needs a decision.</h3><p>FloFi will surface the next scheduled occurrence here.</p></div>}
    </section>}
    {proof.proven && <section className="workspace-section" aria-labelledby="saved-automations">
      <div className="workspace-section-heading"><div><h2 id="saved-automations">Scheduled</h2><span className="workspace-count">{snapshot.rules.length}</span></div></div>
      {snapshot.rules.length ? <div className="automation-list">{snapshot.rules.map(rule => {
        const spec = rule.spec as { name?: unknown; trigger?: { cadence?: unknown } };
        return <article className="workspace-wallet-card" key={rule.automationId}><div className="workspace-wallet-heading"><div>
          <h3>{typeof spec.name === 'string' ? spec.name : 'Automation'}</h3><p>{rule.state} · next {new Date(rule.nextEvaluationAt).toLocaleString()}</p>
        </div></div><p>{String(spec.trigger?.cadence ?? 'SCHEDULE')} · owner confirmation required</p>
          <div className="workspace-wallet-actions"><button type="button" disabled={busy} onClick={() => void toggle(rule)}>{rule.state === 'ACTIVE' ? 'Pause' : 'Resume'}</button></div>
        </article>;
      })}</div> : <div className="workspace-empty"><h3>No scheduled strategies yet.</h3></div>}
    </section>}
    {error && <div className="error-banner" role="alert"><strong>Automation not updated</strong><span>{error}</span></div>}
  </>;
}
