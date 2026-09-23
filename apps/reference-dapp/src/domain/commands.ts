// SPDX-License-Identifier: AGPL-3.0-only
import { actionKinds, type ActionKind } from './mock-actions';
import type { Workflow } from './initial-workflow';

type Base = { readonly baseRevision: number; readonly source: 'CHAT' | 'CANVAS' };
export type Command = Base & (
  | { readonly type: 'ADD'; readonly kind: ActionKind }
  | { readonly type: 'SET_AMOUNT'; readonly nodeId: string; readonly amount: string }
  | { readonly type: 'LOCK'; readonly nodeId: string; readonly locked: boolean }
  | { readonly type: 'CONNECT'; readonly from: string; readonly to: string }
  | { readonly type: 'REMOVE'; readonly nodeId: string }
);

export const HELP = 'Try “add read”, “add transform”, “add condition”, “set node-001 amount 2500000”, or “explain”. Amounts are integer sample units on mock:local.';

export function parseMockCommand(text: string, baseRevision: number): Command {
  const input = text.trim();
  const add = /^add (read|transform|condition)$/.exec(input);
  if (add) return { type: 'ADD', kind: add[1] as ActionKind, source: 'CHAT', baseRevision };
  const set = /^set (node-\d+) amount (0|[1-9][0-9]{0,77})$/.exec(input);
  if (set) return { type: 'SET_AMOUNT', nodeId: set[1]!, amount: set[2]!, source: 'CHAT', baseRevision };
  throw new Error(HELP);
}

export function commandIsValid(command: Command): boolean {
  if (!command || typeof command !== 'object' || !Number.isSafeInteger(command.baseRevision)
      || command.baseRevision < 0 || !['CHAT', 'CANVAS'].includes(command.source)) return false;
  const keys: Record<Command['type'], string[]> = {
    ADD: ['kind'], SET_AMOUNT: ['nodeId', 'amount'], LOCK: ['nodeId', 'locked'],
    CONNECT: ['from', 'to'], REMOVE: ['nodeId'],
  };
  const fields = keys[command.type];
  if (!fields || Object.keys(command).sort().join() !== ['type', 'source', 'baseRevision', ...fields].sort().join()) return false;
  const id = (value: unknown) => typeof value === 'string' && /^node-\d{3,16}$/.test(value);
  switch (command.type) {
    case 'ADD': return actionKinds.includes(command.kind);
    case 'SET_AMOUNT': return id(command.nodeId) && typeof command.amount === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(command.amount);
    case 'LOCK': return id(command.nodeId) && typeof command.locked === 'boolean' && command.source === 'CANVAS';
    case 'CONNECT': return id(command.from) && id(command.to);
    case 'REMOVE': return id(command.nodeId);
  }
}

export function amountOf(node: Workflow['nodes'][number]): string {
  const input = node.inputs.find((parameter) => parameter.name === 'amount');
  return input?.kind === 'QUANTITY' ? input.value.amount : '';
}

export function summarize(workflow: Workflow): string {
  return `Revision ${workflow.revision}. ` + workflow.nodes.map((node) =>
    `${node.nodeId}: ${node.actionType}, ${amountOf(node)} sample units on ${node.chainId}`
    + `${node.lockedParameters.length ? ', amount locked' : ''}`
    + `${node.dependencies.length ? ', after ' + node.dependencies.join(', ') : ''}.`,
  ).join(' ');
}
