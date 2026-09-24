// SPDX-License-Identifier: AGPL-3.0-only
import { validateAuthoringWorkflow, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import { commandIsValid, type Command } from './commands';
import { freeze, initialWorkflow, type Workflow } from './initial-workflow';
import { createMockNode } from './mock-actions';
import { createSwapNode, parseHumanAmount, parseSlippage, swapDetails, SWAP_ACTION } from './swap-authoring';

export interface EditorState { readonly workflow: Workflow; readonly error: string | null }
export const initialEditor = (): EditorState => ({ workflow: initialWorkflow(), error: null });

/** One pure reducer for both views. View selection and layout never enter the IR. */
export function editorReducer(state: EditorState, command: Command, context?: ReviewContext): EditorState {
  const reject = (error: string): EditorState => ({ workflow: state.workflow, error });
  if (!commandIsValid(command)) return reject('INVALID_COMMAND');
  const current = state.workflow;
  if (command.baseRevision !== current.revision) return reject('BASE_REVISION_CONFLICT: review a fresh proposal.');
  if (current.revision === Number.MAX_SAFE_INTEGER) return reject('REVISION_OVERFLOW');
  let nodes = [...current.nodes];
  let resourceEdges = [...current.resourceEdges];
  if (command.type === 'ADD' || command.type === 'ADD_SWAP') {
    if (nodes.length >= 1024) return reject('NODE_LIMIT');
    const id = `node-${String(current.revision + 2).padStart(3, '0')}`;
    if (nodes.some(node => node.nodeId === id)) return reject('DUPLICATE_NODE');
    if (command.type === 'ADD') nodes.push(createMockNode(id, command.kind));
    else {
      if (!context) return reject('REVIEW_CONTEXT_REQUIRED');
      try { nodes.push(createSwapNode(id, command.direction, command.amount, command.slippage, context)); }
      catch (cause) { return reject(cause instanceof Error ? cause.message : 'INVALID_SWAP_INPUT'); }
    }
  } else if (command.type === 'CONNECT') {
    if (command.from === command.to || !nodes.some(n => n.nodeId === command.from)
        || !nodes.some(n => n.nodeId === command.to)) return reject('INVALID_CONNECTION');
    if (nodes.some(n => (n.nodeId === command.from || n.nodeId === command.to) && n.actionType === SWAP_ACTION)) return reject('SWAP_EDGE_UNSUPPORTED');
    const target = nodes.find(n => n.nodeId === command.to)!;
    if (target.dependencies.includes(command.from)) return { workflow: current, error: null };
    if (target.dependencies.length) return reject('INPUT_ALREADY_CONNECTED');
    const ancestors = (id: string, seen = new Set<string>()): boolean => {
      if (id === command.to) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return nodes.find(n => n.nodeId === id)!.dependencies.some(parent => ancestors(parent, seen));
    };
    if (ancestors(command.from)) return reject('CYCLIC_CONNECTION');
    nodes = nodes.map(n => n.nodeId === command.to ? { ...n, dependencies: [...n.dependencies, command.from] } : n);
    resourceEdges.push({ fromNodeId: command.from, outputId: 'result', toNodeId: command.to, inputName: 'amount' });
  } else {
    const node = nodes.find(n => n.nodeId === command.nodeId);
    if (!node) return reject('UNKNOWN_NODE');
    if (command.type === 'REMOVE') {
      if (nodes.length === 1) return reject('WORKFLOW_REQUIRES_ONE_NODE');
      if (node.lockedParameters.length) return reject('LOCKED_PARAMETER: unlock before removing this node.');
      nodes = nodes.filter(n => n.nodeId !== node.nodeId).map(n => ({ ...n, dependencies: n.dependencies.filter(id => id !== node.nodeId) }));
      resourceEdges = resourceEdges.filter(edge => edge.fromNodeId !== node.nodeId && edge.toNodeId !== node.nodeId);
    } else if (node.actionType === SWAP_ACTION) {
      if (!context) return reject('REVIEW_CONTEXT_REQUIRED');
      const details = swapDetails(node, context);
      const parameter = node.inputs.find(p => p.name === 'amount-in');
      if (!details || parameter?.kind !== 'QUANTITY') return reject('INVALID_SWAP_NODE');
      const locked = node.lockedParameters.some(p => p.name === 'amount-in');
      if (command.type === 'LOCK') {
        if (locked === command.locked) return { workflow: current, error: null };
        nodes = nodes.map(n => n.nodeId === node.nodeId ? { ...n,
          lockedParameters: command.locked ? [parameter] : [],
          editableBounds: command.locked ? [] : [{ parameterName: 'amount-in', asset: { ...parameter.value.asset }, minimumAmount: '1', maximumAmount: context.assets[details.from].maximumAmountUnits }],
        } : n);
      } else if (command.type === 'SET_SWAP_AMOUNT') {
        if (locked) return reject('LOCKED_PARAMETER: unlock on canvas before editing.');
        let amount: string;
        try { amount = parseHumanAmount(command.amount, details.from, context); }
        catch (cause) { return reject(cause instanceof Error ? cause.message : 'INVALID_AMOUNT'); }
        if (amount === details.units) return { workflow: current, error: null };
        nodes = nodes.map(n => n.nodeId === node.nodeId ? { ...n,
          inputs: n.inputs.map(p => p.name === 'amount-in' ? { ...parameter, value: { ...parameter.value, amount } } : p),
          userConstraints: n.userConstraints.map(c => c.kind === 'MAXIMUM_INPUT' ? { ...c, quantity: { ...c.quantity, amount } } : c),
        } : n);
      } else if (command.type === 'SET_SLIPPAGE') {
        let bps: number;
        try { bps = parseSlippage(command.slippage); }
        catch (cause) { return reject(cause instanceof Error ? cause.message : 'INVALID_SLIPPAGE'); }
        if (details.slippage === bps) return { workflow: current, error: null };
        if (node.userConstraints.filter(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS').length !== 1) return reject('SLIPPAGE_REQUIRED_ONCE');
        nodes = nodes.map(n => n.nodeId === node.nodeId ? { ...n,
          userConstraints: n.userConstraints.map(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS' ? { ...c, maximumBps: bps } : c),
        } : n);
      } else return reject('INVALID_SWAP_COMMAND');
    } else {
      const parameter = node.inputs.find(input => input.name === 'amount');
      if (!parameter || parameter.kind !== 'QUANTITY') return reject('UNKNOWN_PARAMETER');
      const locked = node.lockedParameters.some(input => input.name === 'amount');
      if (command.type === 'LOCK') {
        if (locked === command.locked) return { workflow: current, error: null };
        nodes = nodes.map(n => n.nodeId === node.nodeId ? { ...n, lockedParameters: command.locked ? [parameter] : [] } : n);
      } else if (command.type === 'SET_AMOUNT') {
        if (locked) return reject('LOCKED_PARAMETER: unlock on canvas before editing.');
        if (BigInt(command.amount) > (1n << 256n) - 1n) return reject('AMOUNT_OUT_OF_RANGE');
        if (command.amount === parameter.value.amount) return { workflow: current, error: null };
        nodes = nodes.map(n => n.nodeId === node.nodeId ? { ...n, inputs: n.inputs.map(input => input.name === 'amount'
          ? { ...parameter, value: { ...parameter.value, amount: command.amount } } : input) } : n);
      } else return reject('INVALID_MOCK_COMMAND');
    }
  }
  const candidate = { ...current, revision: current.revision + 1, nodes, resourceEdges };
  if (nodes.some(n => n.actionType === SWAP_ACTION)) {
    if (!context) return reject('REVIEW_CONTEXT_REQUIRED');
    try { validateAuthoringWorkflow(candidate, context); }
    catch (cause) { return reject(cause instanceof Error ? cause.message : 'INVALID_WORKFLOW'); }
  }
  return { workflow: freeze(candidate), error: null };
}
