// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { projectCanvasAction } from '../domain/canvas-lifecycle';
import type { ExecutionControls, ExecutionControlsState } from '../state/execution-controls';
import { confirmReview } from './review-workspace';
import { useLocale } from '../i18n/locale';

export function CanvasLifecycleAction(props: ExecutionControlsState & {
  controls: ExecutionControls; simulate?: () => void | Promise<void>; simulationDisabled?: boolean;
  onExecute?: () => void; workflowName?: string;
}) {
  const { t } = useLocale();
  const c = props.controls, action = projectCanvasAction(c.current, c);
  const disabled = action.disabled || action.kind === 'simulate' && (!props.simulate || props.simulationDisabled) || action.kind === 'execute' && !c.view.canExecute;
  function act() {
    // Re-project at the click boundary; background tabs cannot preserve expired authority.
    const next = projectCanvasAction(c.current, c);
    if (next.disabled || next.kind !== action.kind) return;
    if (next.kind === 'simulate' && !props.simulationDisabled) void props.simulate?.();
    if (next.kind === 'approve') void confirmReview({ ...c.current, workflowName: props.workflowName ?? '', backToBuild: () => undefined });
    if (next.kind === 'execute' || next.kind === 'continue') { c.request(next.kind === 'continue'); props.onExecute?.(); }
    if (next.kind === 'recover') c.checkStatus();
  }
  return <div className="canvas-lifecycle-control">
    {props.execution.requiresMainnetAcknowledgement && !props.execution.started && <label className="execute-acknowledgement"><input type="checkbox" checked={c.current.acknowledged} onChange={e => c.setAcknowledgement(e.target.checked ? c.acknowledgementKey : null)}/>{t('I understand this executes on Solana mainnet with real funds')}</label>}
    {action.kind === 'status' ? <span role="status" data-lifecycle-action="status">{t(action.label)}</span> : <button data-lifecycle-action={action.kind} type="button" className="primary" disabled={disabled} onClick={act}>{t(action.label)}</button>}
  </div>;
}
