// SPDX-License-Identifier: AGPL-3.0-only
import { getViewportForBounds } from '@xyflow/react';

/**
 * Deterministic Simulate canvas viewport (BUILD-003D §3.16).
 *
 * The viewport is a pure function of the final layout: the pane size and every
 * measured top-level node box. It uses the same bounds and fit as the
 * @xyflow/react 12.11.6 `fitView` default (padding 0.1) for the Simulate
 * canvas zoom limits, so a settled layout renders the same pixels as before.
 */
export const SIMULATION_VIEWPORT = Object.freeze({ minZoom: 0.35, maxZoom: 1.2, padding: 0.1 });

export type CanvasNodeBox = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number | undefined;
  readonly height: number | undefined;
};
export type CanvasViewportInputs = {
  readonly paneWidth: number;
  readonly paneHeight: number;
  readonly nodes: readonly CanvasNodeBox[];
};
export type CanvasViewport = { readonly x: number; readonly y: number; readonly zoom: number };

/** Every input that determines the viewport; equal signatures give equal viewports. */
export function canvasViewportSignature(inputs: CanvasViewportInputs): string {
  return JSON.stringify([inputs.paneWidth, inputs.paneHeight,
    inputs.nodes.map(node => [node.id, node.x, node.y, node.width ?? null, node.height ?? null])]);
}

/** Returns `null` (pending) until the pane and every node are measured. */
export function canvasViewportFor(inputs: CanvasViewportInputs): CanvasViewport | null {
  if (!(inputs.paneWidth > 0 && inputs.paneHeight > 0)) return null;
  if (inputs.nodes.length === 0) return { x: 0, y: 0, zoom: 1 };
  let x = Infinity;
  let y = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const node of inputs.nodes) {
    if (!node.width || !node.height) return null;
    x = Math.min(x, node.x);
    y = Math.min(y, node.y);
    x2 = Math.max(x2, node.x + node.width);
    y2 = Math.max(y2, node.y + node.height);
  }
  const { minZoom, maxZoom, padding } = SIMULATION_VIEWPORT;
  const viewport = getViewportForBounds({ x, y, width: x2 - x, height: y2 - y },
    inputs.paneWidth, inputs.paneHeight, minZoom, maxZoom, padding);
  return { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
}
