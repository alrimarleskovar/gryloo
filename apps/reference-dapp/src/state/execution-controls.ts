// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useRef, useState } from 'react';
import { canContinueExecution, projectExecution, startReviewedExecution, type ExecutionWorkspaceState } from '../domain/execution-presentation';
import type { ExecutionLifecycle } from '../domain/execution-lifecycle';
import type { ExecutionRecovery } from '../domain/execution-recovery';
import { projectExecutionResult } from '../domain/execution-result';

export type ExecutionControlsState = ExecutionWorkspaceState & { progress?: ExecutionLifecycle; recovery?: ExecutionRecovery };
/** Shared explicit request controls. Mounted across stages so navigation cannot clear a submission lock. */
export function useExecutionControls(props: ExecutionControlsState) {
  const { wallet, authorization, execution } = props;
  const requestLock = useRef<{ fingerprint: string; error: string | null; sawBusy: boolean } | null>(null);
  const checkLock = useRef<{ sawBusy: boolean } | null>(null);
  const [checking, setChecking] = useState(false), [checkFailed, setCheckFailed] = useState(false);
  const [requesting, setRequesting] = useState(false), [requestFailed, setRequestFailed] = useState(false);
  const progress = props.progress, live = progress?.started ? progress : null;
  const [clock, setClock] = useState(() => Date.now());
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const acknowledgementKey = JSON.stringify([authorization.key, wallet.account, wallet.chain, wallet.changed]);
  const current = { ...props, acknowledged: acknowledgement === acknowledgementKey };
  const view = projectExecution(current, Math.max(clock, Date.now())), expiresAt = view.expiresAt;
  useEffect(() => {
    const lock = requestLock.current;
    if (!lock) return;
    if (props.source.state.busy) { lock.sawBusy = true; return; }
    if (lock.sawBusy || props.progress?.fingerprint !== lock.fingerprint && Boolean(props.progress) || props.source.state.error !== lock.error) { requestLock.current = null; setRequesting(false); }
  }, [props.source.state.busy, props.source.state.error, props.progress?.fingerprint]);
  const providers = live ? [...new Set(live.steps.map(step => step.provider).filter((provider): provider is string => Boolean(provider)))] : view.providers;
  const recovery = props.recovery;
  const verifying = checking || Boolean(recovery?.checking);
  const result = verifying ? null : projectExecutionResult(live);
  const reconciledCount = Object.values(live?.stepEvidence ?? {}).filter(step => step.reconciled).length;
  const recoveredCount = Object.values(live?.stepEvidence ?? {}).filter(step => step.recovered).length;
  const resultUnit = live?.planUnavailable ? 'recorded action' : 'step';
  const canContinue = Boolean(live && live.state === 'active' && canContinueExecution(current) && !requesting && !verifying && !recovery?.contextIssue);
  const check = recovery ? recovery.check : execution.check;
  const canCheck = Boolean(live && check && !requesting && !verifying && !props.source.state.busy && (recovery?.action || !recovery && live.steps.some(step => step.operations.some(op => ['submitted', 'pending', 'posted', 'settling', 'partial'].includes(op.state)))));
  useEffect(() => {
    const lock = checkLock.current; if (!lock) return;
    if (props.source.state.busy) lock.sawBusy = true;
    else if (lock.sawBusy) { checkLock.current = null; setChecking(false); }
  }, [props.source.state.busy]);
  function checkStatus() {
    if (checkLock.current || requestLock.current || !canCheck || !check) return;
    checkLock.current = { sawBusy: false }; setChecking(true); setCheckFailed(false);
    const finish = () => { checkLock.current = null; setChecking(false); };
    try {
      void Promise.resolve(check()).catch(() => setCheckFailed(true)).finally(finish);
    } catch { setCheckFailed(true); finish(); }
  }
  function request(continuation: boolean) {
    if (requestLock.current || checkLock.current || verifying || recovery?.contextIssue || !(continuation ? canContinueExecution(current) && live?.state === 'active' : projectExecution(current).canExecute)) return;
    requestLock.current = { fingerprint: props.progress?.fingerprint ?? '', error: props.source.state.error, sawBusy: false };
    setRequesting(true); setRequestFailed(false);
    const lock = requestLock.current;
    const failed = () => {
      if (requestLock.current !== lock) return;
      requestLock.current = null; setRequesting(false); setRequestFailed(true);
    };
    try { void Promise.resolve(continuation ? execution.next?.() : startReviewedExecution(current)).catch(failed); } catch { failed(); }
  }
  useEffect(() => {
    if (expiresAt === null || expiresAt <= Date.now()) return;
    const update = () => setClock(Date.now());
    const timer = window.setTimeout(update, Math.min(expiresAt - Date.now() + 1, 2_147_483_647));
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [expiresAt]);
  return { live, view, current, providers, recovery, verifying, result, reconciledCount, recoveredCount, resultUnit,
    canContinue, canCheck, checkStatus, request, requesting, requestFailed, checkFailed, acknowledgementKey, setAcknowledgement };
}
export type ExecutionControls = ReturnType<typeof useExecutionControls>;
