// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, useMemo, type Dispatch, type ReactNode } from 'react';
import { BaseObservationError, createBaseSepoliaReviewContext, createReviewContext, lintWorkflow, type ReviewContext, type ReviewResult } from '@defi-workflow-engine/reference-linter';
import { editorReducer, type EditorState } from '../domain/editor';
import { editorHistoryReducer, initialEditorHistory } from '../domain/editor-history';
import { readCanvasLayout, saveCanvasLayout, type CanvasLayout } from '../domain/canvas-layout';
import { describeProposal } from '../domain/proposal';
import { chainReducer, checkChainAccess, initialChainState, type ChainState } from '../domain/artifact-chain';
import { generateMockedChain, generationEligibility, type Eligibility } from '../domain/mock-artifacts';
import type { Command } from '../domain/commands';
import type {SemanticWorkflow} from '@defi-workflow-engine/workflow-contracts';
import { amountCommandTarget, canvasAmountCommand, canvasAmountMessage, canvasAuthoringIncomplete, type CanvasActionSetup, type CanvasAmountInputs } from '../domain/canvas-action-setup';
import { readBaseQuote } from '../app/observation-action';
import { browserFailureMessage, initialObservationState, observationReducer, receiveObservation, type ObservationState } from '../domain/base-observation';

type Pending = { valid: boolean; command: Command; diff: readonly string[]; review: ReviewResult | null; authoringId?: string; authoringAmount?: string };
type Store = { state: EditorState; dispatch: Dispatch<Command>; context: ReviewContext;
  actionSetup: CanvasActionSetup | null; amountInputs: CanvasAmountInputs; authoringIncomplete: boolean;
  startActionSetup(action: CanvasActionSetup['action'], position: { x: number; y: number }, beneficiary?: string): string;
  editCanvasAmount(id: string, amount: string): void; cancelCanvasAmount(id: string): void;
  reviewCanvasAmount(id: string): string | null; removeActionSetup(): void;
  restoreLendingCanvas(workflow:SemanticWorkflow):void;
  canvasLayout: CanvasLayout; canUndo: boolean; canRedo: boolean; undo(): void; redo(): void;
  moveCanvasNodes(positions: Readonly<Record<string, { x: number; y: number }>>): void;
  addCanvasCommand(command: Command, position: { x: number; y: number }): void;
  duplicateCanvasNodes(nodeIds: readonly string[]): void;
  pending: Pending | null; propose(command: Command): void; applyProposal(): void; dismissProposal(): void;
  review: ReviewResult | null; reviewError: string | null;
  chain: ChainState; eligibility: Eligibility; generateArtifacts(): void; refreshArtifacts(): void; accessCheck(): void };
const Context = createContext<Store | null>(null);

export function WorkflowProvider({ children, initialContext }: { children: ReactNode; initialContext: unknown }) {
  const [history, dispatchHistory] = useReducer(editorHistoryReducer, undefined, initialEditorHistory);
  const state = history.editor;
  const authoringIncomplete = canvasAuthoringIncomplete(history.actionSetup, history.amountInputs);
  const incompleteRef = useRef(authoringIncomplete);
  incompleteRef.current = authoringIncomplete;
  const context = useMemo(() => state.workflow.nodes.some(n => n.actionType === 'asset.swap.exact-input' && n.chainId === 'eip155:84532')
    ? createBaseSepoliaReviewContext() : createReviewContext(initialContext), [state.workflow, initialContext]);
  const dispatch = useCallback((command: Command) => {
    dispatchHistory({ type: 'COMMAND', command, context });
  }, [context]);
  const restoreLendingCanvas=useCallback((workflow:SemanticWorkflow)=>dispatchHistory({type:'RESTORE_LENDING_CANVAS',workflow}),[]);
  const addCanvasCommand = useCallback((command: Command, position: { x: number; y: number }) => {
    dispatchHistory({ type: 'COMMAND', command, position, context });
  }, [context]);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const initialWorkflow = useRef(state.workflow);
  useEffect(() => { dispatchHistory({ type: 'LOAD_LAYOUT', layout: readCanvasLayout(initialWorkflow.current) }); setLayoutLoaded(true); }, []);
  useEffect(() => { if (layoutLoaded) saveCanvasLayout(state.workflow.workflowId, history.layout); }, [layoutLoaded, state.workflow.workflowId, history.layout]);
  const moveCanvasNodes = useCallback((positions: Readonly<Record<string, { x: number; y: number }>>) =>
    dispatchHistory({ type: 'MOVE', positions }), []);
  const duplicateCanvasNodes = useCallback((nodeIds: readonly string[]) =>
    dispatchHistory({ type: 'DUPLICATE', nodeIds, context }), [context]);
  const undo = useCallback(() => dispatchHistory({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatchHistory({ type: 'REDO' }), []);
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    // History/restoration can change a reviewed field without invoking its input handler.
    setPending(current => {
      if (!current?.authoringId) return current;
      const amount = history.actionSetup?.id === current.authoringId ? history.actionSetup.amount : history.amountInputs[current.authoringId];
      return amount === current.authoringAmount && current.command.baseRevision === state.workflow.revision ? current : null;
    });
  }, [history.actionSetup, history.amountInputs, state.workflow.revision]);
  const [chain, dispatchChain] = useReducer(chainReducer, undefined, initialChainState);
  const workflowRef = useRef(state.workflow);
  const chainRef = useRef(chain);
  const generationRef = useRef(0);
  workflowRef.current = state.workflow;
  chainRef.current = chain;
  const reviewState = useMemo(() => {
    try { return { review: lintWorkflow(state.workflow, context), reviewError: null }; }
    catch (cause) { return { review: null, reviewError: cause instanceof Error ? cause.message : 'INVALID_WORKFLOW' }; }
  }, [state.workflow, context]);
  const eligibility: Eligibility = useMemo(() => authoringIncomplete ? { eligible: false, reason: 'Configure the amount in Build before simulating.' }
    : generationEligibility(state.workflow, context), [state.workflow, context, authoringIncomplete]);

  // An accepted semantic edit replaces the immutable IR object and invalidates the chain.
  useEffect(() => { dispatchChain({ type: 'REVISION_ACCEPTED', workflow: state.workflow }); }, [state.workflow]);
  const accessCheck = useCallback(() => {
    dispatchChain({ type: 'ACCESS_CHECK', workflow: workflowRef.current, wallNowMs: Date.now(), monotonicNowMs: performance.now() });
  }, []);
  // Background tabs throttle timers, so expiry is re-checked whenever the tab resumes.
  useEffect(() => {
    document.addEventListener('visibilitychange', accessCheck);
    window.addEventListener('focus', accessCheck);
    window.addEventListener('pageshow', accessCheck);
    return () => {
      document.removeEventListener('visibilitychange', accessCheck);
      window.removeEventListener('focus', accessCheck);
      window.removeEventListener('pageshow', accessCheck);
    };
  }, [accessCheck]);
  // The timer only triggers a re-check; it is never the check itself.
  useEffect(() => {
    if (!chain.record || chain.retired) return;
    const timer = setTimeout(accessCheck, Math.max(0, chain.record.expiresAtMs - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [chain.record, chain.retired, accessCheck]);

  function propose(command: Command, authoring?: { authoringId: string; authoringAmount: string }) {
    const preview = editorReducer(state, command, context);
    const diff = describeProposal(state, preview, command, context);
    let review: ReviewResult | null = null;
    if (!preview.error) {
      try { review = lintWorkflow(preview.workflow, context); } catch { /* Invalid draft is already rejected by reducer. */ }
    }
    const target = amountCommandTarget(command, state.workflow);
    const amountEdit = target && history.amountInputs[target.id] === target.amount ? { authoringId: target.id, authoringAmount: target.amount } : undefined;
    setPending({ valid: !preview.error, command, diff, review, ...(authoring ?? amountEdit) });
  }
  function applyProposal() {
    if (!pending || !pending.valid) return;
    dispatchHistory({ type: 'COMMAND', command: pending.command, context,
      ...(pending.authoringId ? { authoringId: pending.authoringId, authoringAmount: pending.authoringAmount! } : {}) });
    setPending(null);
  }
  function startActionSetup(action: CanvasActionSetup['action'], position: { x: number; y: number }, beneficiary?: string) {
    if (history.actionSetup) return history.actionSetup.id;
    dispatchHistory({ type: 'START_ACTION_SETUP', action, position, ...(beneficiary ? { beneficiary } : {}) });
    return `action-setup-${history.setupSerial + 1}`;
  }
  function editCanvasAmount(id: string, amount: string) {
    dispatchHistory({ type: 'EDIT_CANVAS_AMOUNT', id, amount, context });
    setPending(current => current?.authoringId === id ? null : current);
  }
  function cancelCanvasAmount(id: string) { dispatchHistory({ type: 'CANCEL_CANVAS_AMOUNT', id }); setPending(current => current?.authoringId === id ? null : current); }
  function removeActionSetup() { dispatchHistory({ type: 'REMOVE_ACTION_SETUP' }); setPending(current => current?.authoringId === history.actionSetup?.id ? null : current); }
  function reviewCanvasAmount(id: string) {
    try {
      const command = canvasAmountCommand(state, history.actionSetup, history.amountInputs, id, context);
      const amount = history.actionSetup?.id === id ? history.actionSetup.amount : history.amountInputs[id]!;
      propose(command, { authoringId: id, authoringAmount: amount });
      return null;
    } catch (cause) { return canvasAmountMessage(cause); }
  }
  const generateArtifacts = useCallback(() => {
    const workflow = workflowRef.current;
    if (incompleteRef.current || chainRef.current.pending || !generationEligibility(workflow, context).eligible) return;
    generationRef.current += 1;
    const generation = generationRef.current;
    const nowMs = Date.now(), monotonicStartMs = performance.now();
    dispatchChain({ type: 'GENERATE_STARTED', workflow, generation });
    generateMockedChain(workflow, context, { nowMs, generation }).then(({ chain: artifacts, review }) => {
      dispatchChain({ type: 'GENERATE_SUCCEEDED', currentWorkflow: workflowRef.current, record: {
        chain: artifacts, review, sourceWorkflow: workflow, generation,
        observedAtMs: nowMs, expiresAtMs: Date.parse(review.expiresAt), monotonicStartMs,
      } });
    }, (cause: unknown) => {
      dispatchChain({ type: 'GENERATE_FAILED', generation, code: cause instanceof Error ? cause.message : 'GENERATION_FAILED' });
    });
  }, [context]);
  const refreshArtifacts = useCallback(() => {
    // Refresh is a use of the chain: it is refused unless the guard passes now.
    if (!checkChainAccess(chainRef.current, workflowRef.current, Date.now(), performance.now()).ok) { accessCheck(); return; }
    generateArtifacts();
  }, [accessCheck, generateArtifacts]);
  return <Context.Provider value={{ state, dispatch, context, restoreLendingCanvas, canvasLayout: history.layout, canUndo: history.past.length > 0,
    actionSetup: history.actionSetup, amountInputs: history.amountInputs, authoringIncomplete,
    startActionSetup, editCanvasAmount, cancelCanvasAmount, reviewCanvasAmount, removeActionSetup,
    canRedo: history.future.length > 0, undo, redo, moveCanvasNodes, addCanvasCommand, duplicateCanvasNodes,
    pending, propose, applyProposal, dismissProposal: () => setPending(null), ...reviewState,
    chain, eligibility, generateArtifacts, refreshArtifacts, accessCheck }}>
    <BaseObservationProvider>{children}</BaseObservationProvider>
  </Context.Provider>;
}

type Observations = { observations: ObservationState; readQuote(nodeId: string): void; accessCheck(): void };
const ObservationContext = createContext<Observations | null>(null);

/**
 * Read-only Base observations live in their own context. They are never part
 * of the workflow state, never feed an edit and never reach authorization.
 */
function BaseObservationProvider({ children }: { children: ReactNode }) {
  const { state, context, authoringIncomplete } = useWorkflow();
  const incompleteRef = useRef(authoringIncomplete); incompleteRef.current = authoringIncomplete;
  const [observations, dispatchObservation] = useReducer(observationReducer, undefined, initialObservationState);
  const workflowRef = useRef(state.workflow);
  const observationsRef = useRef(observations);
  const tokenRef = useRef(0);
  workflowRef.current = state.workflow;
  observationsRef.current = observations;
  useEffect(() => { dispatchObservation({ type: 'REVISION_ACCEPTED', workflow: state.workflow }); }, [state.workflow]);
  const accessCheck = useCallback(() => {
    dispatchObservation({ type: 'ACCESS_CHECK', workflow: workflowRef.current, wallNowMs: Date.now(), monotonicNowMs: performance.now() });
  }, []);
  useEffect(() => {
    document.addEventListener('visibilitychange', accessCheck);
    window.addEventListener('focus', accessCheck);
    window.addEventListener('pageshow', accessCheck);
    return () => {
      document.removeEventListener('visibilitychange', accessCheck);
      window.removeEventListener('focus', accessCheck);
      window.removeEventListener('pageshow', accessCheck);
    };
  }, [accessCheck]);
  // The timer only triggers a re-check at the earliest expiry; it is never the check itself.
  useEffect(() => {
    const expiries = Object.values(observations).flatMap(entry => entry.status === 'CURRENT' ? [entry.record.expiresAtMs] : []);
    if (expiries.length === 0) return;
    const timer = setTimeout(accessCheck, Math.max(0, Math.min(...expiries) - Date.now()) + 1);
    return () => clearTimeout(timer);
  }, [observations, accessCheck]);
  const readQuote = useCallback((nodeId: string) => {
    if (incompleteRef.current) return;
    if (observationsRef.current[nodeId]?.status === 'READING') return;
    const workflow = workflowRef.current;
    tokenRef.current += 1;
    const token = tokenRef.current;
    dispatchObservation({ type: 'READ_STARTED', nodeId, token, workflow });
    readBaseQuote({ workflow, nodeId }).then(async (result) => {
      if (!result.ok) {
        dispatchObservation({ type: 'READ_FAILED', nodeId, token, code: result.code, message: result.message });
        return;
      }
      try {
        const record = await receiveObservation(result, { nodeId, sourceWorkflow: workflow, currentWorkflow: workflowRef.current,
          wallNowMs: Date.now(), monotonicNowMs: performance.now() }, context);
        dispatchObservation({ type: 'READ_SUCCEEDED', nodeId, token, record, currentWorkflow: workflowRef.current });
        accessCheck();
      } catch (cause) {
        const code = cause instanceof BaseObservationError ? cause.code : 'INTERNAL_ERROR';
        dispatchObservation({ type: 'READ_FAILED', nodeId, token, code, message: browserFailureMessage(code) });
      }
    }, () => {
      dispatchObservation({ type: 'READ_FAILED', nodeId, token, code: 'INTERNAL_ERROR', message: browserFailureMessage('INTERNAL_ERROR') });
    });
  }, [context, accessCheck]);
  return <ObservationContext.Provider value={{ observations, readQuote, accessCheck }}>{children}</ObservationContext.Provider>;
}
export function useBaseObservations() {
  const value = useContext(ObservationContext);
  if (!value) throw new Error('BaseObservationProvider is required');
  return value;
}
export function useWorkflow() {
  const value = useContext(Context);
  if (!value) throw new Error('WorkflowProvider is required');
  return value;
}
