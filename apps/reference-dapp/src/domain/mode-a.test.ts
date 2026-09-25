// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { canvasViewportFor, canvasViewportSignature, SIMULATION_VIEWPORT, type CanvasViewportInputs } from './mode-a';

// Measured on the committed simulate-expired layout (1440×900, approved headless shell 1243).
const EXPIRED_LAYOUT: CanvasViewportInputs = {
  paneWidth: 818,
  paneHeight: 405,
  nodes: [
    { id: 'node-001', x: 60, y: 70, width: 236, height: 132 },
    { id: 'node-002', x: 340, y: 110, width: 236, height: 132 },
  ],
};

describe('deterministic Simulate canvas viewport (BUILD-003D §3.16)', () => {
  it('reproduces the committed fitted transform translate(27.4px, 15.3px) scale(1.2)', () => {
    const viewport = canvasViewportFor(EXPIRED_LAYOUT);
    expect(viewport).not.toBeNull();
    expect(viewport!.x).toBeCloseTo(27.4, 9);
    expect(viewport!.y).toBeCloseTo(15.3, 9);
    expect(viewport!.zoom).toBe(SIMULATION_VIEWPORT.maxZoom);
  });

  it('stays pending until the pane and every node are measured', () => {
    expect(canvasViewportFor({ ...EXPIRED_LAYOUT, paneWidth: 0 })).toBeNull();
    expect(canvasViewportFor({ ...EXPIRED_LAYOUT, paneHeight: 0 })).toBeNull();
    const unmeasured = EXPIRED_LAYOUT.nodes.map((node, index) => index === 1 ? { ...node, height: undefined } : node);
    expect(canvasViewportFor({ ...EXPIRED_LAYOUT, nodes: unmeasured })).toBeNull();
    expect(canvasViewportFor({ ...EXPIRED_LAYOUT, nodes: [] })).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('is a pure function of its inputs, whatever the order in which they settle', () => {
    const first = canvasViewportFor(EXPIRED_LAYOUT);
    const transient = canvasViewportFor({ ...EXPIRED_LAYOUT, paneWidth: 817 });
    expect(transient).not.toEqual(first);
    expect(canvasViewportFor({ ...EXPIRED_LAYOUT })).toEqual(first);
    expect(canvasViewportSignature({ ...EXPIRED_LAYOUT })).toBe(canvasViewportSignature(EXPIRED_LAYOUT));
    for (const changed of [
      { ...EXPIRED_LAYOUT, paneWidth: 817 },
      { ...EXPIRED_LAYOUT, paneHeight: 404 },
      { ...EXPIRED_LAYOUT, nodes: EXPIRED_LAYOUT.nodes.map(node => ({ ...node, width: 235 })) },
      { ...EXPIRED_LAYOUT, nodes: EXPIRED_LAYOUT.nodes.slice(0, 1) },
    ]) expect(canvasViewportSignature(changed)).not.toBe(canvasViewportSignature(EXPIRED_LAYOUT));
  });
});
