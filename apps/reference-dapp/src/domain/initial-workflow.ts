// SPDX-License-Identifier: AGPL-3.0-only
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createMockNode } from './mock-actions';

export type Immutable<T> = T extends readonly (infer V)[] ? readonly Immutable<V>[]
  : T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type Workflow = Immutable<SemanticWorkflow>;

export function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

export function initialWorkflow(): Workflow {
  return freeze<SemanticWorkflow>({
    schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 0,
    nodes: [createMockNode('node-001', 'read')], resourceEdges: [],
  });
}
