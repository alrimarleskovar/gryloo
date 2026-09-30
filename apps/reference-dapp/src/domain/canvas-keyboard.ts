// SPDX-License-Identifier: AGPL-3.0-only
import type { Workflow } from './initial-workflow';
export function isTextEntry(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="searchbox"], [role="spinbutton"], [aria-multiline="true"]'));
}
export function canDeleteCanvasNode(workflow: Workflow, nodeId: string | null): boolean {
  if (!nodeId || nodeId === 'node-001' || !/^node-\d{3,16}$/.test(nodeId) || workflow.nodes.length <= 1) return false;
  const node = workflow.nodes.find(item => item.nodeId === nodeId);
  return Boolean(node && !node.lockedParameters.length
    && !workflow.nodes.some(item => item.dependencies.includes(nodeId)));
}
export function deletableCanvasNodes(workflow: Workflow, selectedIds: readonly string[]): string[] {
  const selected = new Set(selectedIds);
  const candidates = new Set(workflow.nodes.filter(node => selected.has(node.nodeId) && node.nodeId !== 'node-001'
    && /^node-\d{3,16}$/.test(node.nodeId) && !node.lockedParameters.length).map(node => node.nodeId));
  // Keep removing sources with a dependant that cannot be deleted in this same edit.
  let changed: boolean;
  do {
    changed = false;
    for (const id of candidates) if (workflow.nodes.some(node => !candidates.has(node.nodeId) && node.dependencies.includes(id))) {
      candidates.delete(id);
      changed = true;
    }
  } while (changed);
  return workflow.nodes.filter(node => candidates.has(node.nodeId)).map(node => node.nodeId);
}
export function canDeleteCanvasEdge(workflow: Workflow, from: string, to: string): boolean {
  const source = workflow.nodes.find(node => node.nodeId === from);
  const target = workflow.nodes.find(node => node.nodeId === to);
  return Boolean(source && target && workflow.resourceEdges.some(edge => edge.fromNodeId === from && edge.toNodeId === to)
    && source.actionType.startsWith('mock-') && target.actionType.startsWith('mock-'));
}
export function canvasShortcut(key: string, textEntry: boolean, selectedId: string | null,
  workflow: Workflow): 'REMOVE' | 'CLEAR' | null {
  if (!selectedId) return null;
  if (key === 'Escape') return 'CLEAR';
  if (textEntry) return null;
  if ((key === 'Delete' || key === 'Backspace') && canDeleteCanvasNode(workflow, selectedId)) return 'REMOVE';
  return null;
}
