// SPDX-License-Identifier: AGPL-3.0-only
import type { Workflow } from './initial-workflow';

export type CanvasPosition = { x: number; y: number; actionType: string };
export type CanvasLayout = Record<string, CanvasPosition>;
export const canvasLayoutKey = (workflowId: string) => `gryloo:canvas:${workflowId}`;
export function defaultCanvasPosition(index: number) {
  return { x: 85 + (index % 3) * 270, y: 90 + Math.floor(index / 3) * 190 };
}
export function canvasPosition(layout: CanvasLayout, node: Workflow['nodes'][number], index: number) {
  const stored = layout[node.nodeId];
  return stored?.actionType === node.actionType ? { x: stored.x, y: stored.y } : defaultCanvasPosition(index);
}
export function reconcileCanvasLayout(layout: CanvasLayout, workflow: Workflow): CanvasLayout {
  return Object.fromEntries(workflow.nodes.flatMap(node => {
    const position = layout[node.nodeId];
    return position && position.actionType === node.actionType && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? [[node.nodeId, position]] : [];
  }));
}
export function readCanvasLayout(workflow: Workflow): CanvasLayout {
  try {
    const value = JSON.parse(localStorage.getItem(canvasLayoutKey(workflow.workflowId)) ?? '{}');
    return reconcileCanvasLayout(value && typeof value === 'object' && !Array.isArray(value) ? value : {}, workflow);
  } catch { return {}; }
}
export function saveCanvasLayout(workflowId: string, layout: CanvasLayout) {
  try { localStorage.setItem(canvasLayoutKey(workflowId), JSON.stringify(layout)); } catch { /* storage is optional */ }
}
