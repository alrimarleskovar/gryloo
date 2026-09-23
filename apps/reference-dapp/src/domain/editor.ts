// SPDX-License-Identifier: AGPL-3.0-only
import { commandIsValid, type Command } from './commands';
import { freeze, initialWorkflow, type Workflow } from './initial-workflow';
import { createMockNode } from './mock-actions';

export interface EditorState { readonly workflow: Workflow; readonly error: string | null }
export const initialEditor = (): EditorState => ({ workflow: initialWorkflow(), error: null });

/** One pure reducer for both views. View selection and layout never enter the IR. */
export function editorReducer(state: EditorState, command: Command): EditorState {
  const reject = (error: string): EditorState => ({ workflow: state.workflow, error });
  if (!commandIsValid(command)) return reject('INVALID_COMMAND');
  const current = state.workflow;
  if (command.baseRevision !== current.revision) return reject('BASE_REVISION_CONFLICT: review a fresh proposal.');
  if (current.revision === Number.MAX_SAFE_INTEGER) return reject('REVISION_OVERFLOW');
  let nodes = [...current.nodes];
  let resourceEdges = [...current.resourceEdges];
  if (command.type === 'ADD') {
    if (nodes.length >= 1024) return reject('NODE_LIMIT');
    // The revision makes identifiers deterministic and prevents deleted-ID reuse.
    const id = `node-${String(current.revision + 2).padStart(3, '0')}`;
    if (nodes.some((node) => node.nodeId === id)) return reject('DUPLICATE_NODE');
    nodes.push(createMockNode(id, command.kind));
  } else if (command.type === 'CONNECT') {
    if (command.from === command.to || !nodes.some((n) => n.nodeId === command.from)
        || !nodes.some((n) => n.nodeId === command.to)) return reject('INVALID_CONNECTION');
    const target = nodes.find((n) => n.nodeId === command.to)!;
    if (target.dependencies.includes(command.from)) return { workflow: current, error: null };
    if (target.dependencies.length) return reject('INPUT_ALREADY_CONNECTED');
    const ancestors = (id: string, seen = new Set<string>()): boolean => {
      if (id === command.to) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return nodes.find((n) => n.nodeId === id)!.dependencies.some((parent) => ancestors(parent, seen));
    };
    if (ancestors(command.from)) return reject('CYCLIC_CONNECTION');
    nodes = nodes.map((n) => n.nodeId === command.to ? { ...n, dependencies: [...n.dependencies, command.from] } : n);
    resourceEdges.push({ fromNodeId: command.from, outputId: 'result', toNodeId: command.to, inputName: 'amount' });
  } else {
    const node = nodes.find((n) => n.nodeId === command.nodeId);
    if (!node) return reject('UNKNOWN_NODE');
    if (command.type === 'REMOVE') {
      if (nodes.length === 1) return reject('WORKFLOW_REQUIRES_ONE_NODE');
      if (node.lockedParameters.length) return reject('LOCKED_PARAMETER: unlock before removing this node.');
      nodes = nodes.filter((n) => n.nodeId !== node.nodeId).map((n) => ({ ...n, dependencies: n.dependencies.filter((id) => id !== node.nodeId) }));
      resourceEdges = resourceEdges.filter((edge) => edge.fromNodeId !== node.nodeId && edge.toNodeId !== node.nodeId);
    } else {
      const parameter = node.inputs.find((input) => input.name === 'amount');
      if (!parameter || parameter.kind !== 'QUANTITY') return reject('UNKNOWN_PARAMETER');
      const locked = node.lockedParameters.some((input) => input.name === 'amount');
      if (command.type === 'LOCK') {
        if (locked === command.locked) return { workflow: current, error: null };
        nodes = nodes.map((n) => n.nodeId === node.nodeId ? { ...n, lockedParameters: command.locked ? [parameter] : [] } : n);
      } else {
        if (locked) return reject('LOCKED_PARAMETER: unlock on canvas before editing.');
        if (BigInt(command.amount) > (1n << 256n) - 1n) return reject('AMOUNT_OUT_OF_RANGE');
        if (command.amount === parameter.value.amount) return { workflow: current, error: null };
        nodes = nodes.map((n) => n.nodeId === node.nodeId ? { ...n, inputs: n.inputs.map((input) => input.name === 'amount'
          ? { ...parameter, value: { ...parameter.value, amount: command.amount } } : input) } : n);
      }
    }
  }
  return { workflow: freeze({ ...current, revision: current.revision + 1, nodes, resourceEdges }), error: null };
}
