// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import type { CSSProperties } from 'react';
import { Panel, useReactFlow, useStore, type FitViewOptions, type ReactFlowState } from '@xyflow/react';

/**
 * Laptop-first canvas gestures, shared by every FloFi canvas. Two-finger trackpad movement (and a plain mouse wheel) pans
 * the viewport 1:1; a trackpad pinch (the browser's ctrl+wheel) or Ctrl/⌘ + wheel zooms. React Flow intercepts wheel
 * events only over the canvas pane, never over its `nowheel` controls, so the page keeps normal scrolling elsewhere.
 */
export const CANVAS_GESTURES = Object.freeze({ panOnScroll: true, panOnScrollSpeed: 1, zoomOnScroll: true, zoomOnPinch: true, preventScrolling: true });

/** React Flow owns the viewport, including zoom changes from gestures and automatic fitting. */
export function CanvasNavigator({ fitViewOptions, compactBelow = 800 }: { fitViewOptions?: FitViewOptions; compactBelow?: number }) {
  const { t: tr } = useLocale();
  const zoom = useStore((state: ReactFlowState) => state.transform[2]);
  const minZoom = useStore((state: ReactFlowState) => state.minZoom);
  const maxZoom = useStore((state: ReactFlowState) => state.maxZoom);
  const compact = useStore((state: ReactFlowState) => state.width < compactBelow);
  const narrow = useStore((state: ReactFlowState) => state.width < 400);
  const { fitView, zoomTo } = useReactFlow();
  const percentage = `${Math.round(zoom * 100)}%`;
  const progress = (zoom - minZoom) / (maxZoom - minZoom) * 100;

  return <Panel position="bottom-center" className="canvas-navigator nodrag nopan nowheel" role="group" aria-label={tr("Canvas navigator")}
    data-compact={compact} data-narrow={narrow}>
    <button type="button" className="canvas-navigator-fit" aria-label={tr("Fit workflow")} title={tr("Fit workflow")} onClick={() => { void fitView(fitViewOptions); }}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>
      </svg>
    </button>
    <input className="canvas-navigator-slider" type="range" aria-label={tr("Canvas zoom")} aria-valuetext={percentage}
      min={minZoom} max={maxZoom} step={0.01} value={zoom}
      style={{ '--zoom-progress': `${progress}%` } as CSSProperties}
      onChange={event => { void zoomTo(Number(event.currentTarget.value)); }}/>
    <button type="button" className="canvas-navigator-percentage" aria-label={tr(`Zoom ${percentage}. Reset to 100%`)} title={tr("Reset zoom to 100%")}
      onClick={() => { void zoomTo(Math.min(maxZoom, Math.max(minZoom, 1))); }}>{tr(percentage)}</button>
  </Panel>;
}
