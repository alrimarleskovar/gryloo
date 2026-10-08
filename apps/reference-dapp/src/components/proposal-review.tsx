// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import { createPortal } from 'react-dom';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import { useWorkflow } from '../state/workflow-store';
import { composerActions, composerSummary } from '../domain/composer-presentation';
import { editorReducer, type EditorState } from '../domain/editor';
import type { Command } from '../domain/commands';
import { proposalReviewPosition } from './proposal-review-position';

/** A display projection of the existing proposal; no preview nodes enter the editor. */
export function workflowProposalSummary(state: EditorState, command: Command, context: ReviewContext) {
  const preview = editorReducer(state, command, context);
  const before = composerActions(state.workflow);
  const after = composerActions(preview.workflow);
  const removed = command.type === 'REMOVE' ? before.filter(node => node.nodeId === command.nodeId) : [];
  const changed = removed.length ? removed : after.filter(node => {
    const previous = before.find(item => item.nodeId === node.nodeId);
    return !previous || JSON.stringify(previous) !== JSON.stringify(node);
  });
  const nodes = command.type.startsWith('AUTHOR_') ? after : changed;
  const summaries = nodes.map(node => composerSummary(removed.length ? state.workflow : preview.workflow, node, context));
  return {
    summary: preview.error || !summaries.length ? 'Workflow change' : `${removed.length ? 'Remove ' : ''}${summaries.map(item => item.action).join(' → ')}`,
    detail: preview.error ? 'Check this change before applying.' : summaries.map(item => `${item.action} ${item.amount}${summaries.length === 1 && item.detail ? ` · ${item.detail}` : ''}`).join(' · '),
    current: !preview.error,
  };
}

type Pending = NonNullable<ReturnType<typeof useWorkflow>['pending']>;
type ReviewProps = { canApply?: boolean; onApply?: () => void; portalFromCard?: boolean };
export function ProposalReviewArtifact(props: ReviewProps = {}) {
  const { pending } = useWorkflow();
  return pending ? <ContextualProposal pending={pending} {...props}/> : null;
}

function ContextualProposal({ pending, canApply = true, onApply, portalFromCard = false }: { pending: Pending } & ReviewProps) {
  const { t: tr } = useLocale();
  const { state, context, applyProposal, dismissProposal } = useWorkflow();
  const presentation = useMemo(() => workflowProposalSummary(state, pending.command, context), [state, pending.command, context]);
  const [openCommand, setOpenCommand] = useState<Command | null>(null);
  const open = openCommand === pending.command;
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const submitted = useRef(false);
  const id = useId();
  const marker = useRef<HTMLSpanElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (portalFromCard) setPortalTarget(marker.current?.closest<HTMLElement>('.build-flow-surface') ?? null);
  }, [portalFromCard]);
  const [position, setPosition] = useState<{ left: number; top: number; maxWidth: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    submitted.current = false;
    if (!open) return;
    const anchor = trigger.current;
    const review = popover.current;
    const surface = anchor?.closest<HTMLElement>('.build-flow-surface');
    if (!anchor || !review || !surface) return;
    function place() {
      const canvas = surface!.getBoundingClientRect();
      const x = Math.max(canvas.left + 8, 8), y = Math.max(canvas.top + 8, 8);
      const width = Math.max(1, Math.min(canvas.right - 8, window.innerWidth - 8) - x);
      const height = Math.max(1, Math.min(canvas.bottom - 8, window.innerHeight - 8) - y);
      const obstacles = [...surface!.querySelectorAll<HTMLElement>('.canvas-navigator, .canvas-primary-action, .floating-toolbox')].map(element => element.getBoundingClientRect());
      const placed = proposalReviewPosition(anchor!.getBoundingClientRect(), { width: Math.min(review!.offsetWidth, width), height: Math.min(review!.offsetHeight, height) }, { x, y, width, height }, obstacles);
      setPosition({ left: placed.x - canvas.left, top: placed.y - canvas.top, maxWidth: width, maxHeight: height });
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !anchor!.contains(event.target) && !review!.contains(event.target)) setOpenCommand(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setOpenCommand(null);
      anchor!.focus({ preventScroll: true });
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(surface); observer.observe(anchor); observer.observe(review);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true);
    };
  }, [open, pending.command]);
  const positioned = position !== null;
  useLayoutEffect(() => {
    if (open && positioned) popover.current?.focus({ preventScroll: true });
  }, [open, positioned]);

  function accept() {
    if (submitted.current || !canApply || !pending.valid || !presentation.current) return;
    submitted.current = true;
    setOpenCommand(null);
    (onApply ?? applyProposal)();
  }
  function dismiss() {
    if (submitted.current) return;
    submitted.current = true;
    setOpenCommand(null);
    dismissProposal();
  }
  const content = <>
    <button ref={trigger} type="button" className="proposal-artifact nodrag nopan nowheel" aria-label={tr(`Review proposed change: ${presentation.summary}`)}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setPosition(null); setOpenCommand(open ? null : pending.command); }}>
      <span className="proposal-artifact-label">{tr("Proposed")}</span><span className="proposal-artifact-flow">{tr(presentation.summary)}</span>
    </button>
    {open && <div ref={popover} id={id} className="proposal-review-popover nodrag nopan nowheel" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`} tabIndex={-1}
      style={{ ...position, visibility: position ? 'visible' : 'hidden' }} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <strong id={`${id}-title`}>{tr("Proposed change")}</strong><p id={`${id}-summary`} className="proposal-review-summary">{tr(presentation.summary)}</p>
      {presentation.detail && <p className="proposal-review-detail">{tr(presentation.detail)}</p>}
      <div className="proposal-review-actions">
        <button type="button" className="proposal-dismiss" aria-label={tr("Dismiss proposal")} title={tr("Dismiss proposal")} onClick={dismiss}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
        <button type="button" className="proposal-apply" aria-label={tr("Apply proposal")} title={tr("Apply proposal")} disabled={!canApply || !pending.valid || !presentation.current} onClick={accept}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
        </button>
      </div>
    </div>}
  </>;
  return portalFromCard ? <><span ref={marker} hidden/>{tr(portalTarget && createPortal(content, portalTarget))}</> : content;
}
