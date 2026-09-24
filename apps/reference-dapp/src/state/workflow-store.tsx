// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useReducer, useState, useMemo, type Dispatch, type ReactNode } from 'react';
import { createReviewContext, lintWorkflow, type ReviewContext, type ReviewResult } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor, type EditorState } from '../domain/editor';
import { describeProposal } from '../domain/proposal';
import type { Command } from '../domain/commands';

type Pending = { command: Command; diff: readonly string[]; review: ReviewResult | null };
type Store = { state: EditorState; dispatch: Dispatch<Command>; context: ReviewContext;
  pending: Pending | null; propose(command: Command): void; applyProposal(): void; dismissProposal(): void;
  review: ReviewResult | null; reviewError: string | null };
const Context = createContext<Store | null>(null);

export function WorkflowProvider({ children, initialContext }: { children: ReactNode; initialContext: unknown }) {
  const context = useMemo(() => createReviewContext(initialContext), [initialContext]);
  const [state, dispatch] = useReducer((current: EditorState, command: Command) => editorReducer(current, command, context), undefined, initialEditor);
  const [pending, setPending] = useState<Pending | null>(null);
  const reviewState = useMemo(() => {
    try { return { review: lintWorkflow(state.workflow, context), reviewError: null }; }
    catch (cause) { return { review: null, reviewError: cause instanceof Error ? cause.message : 'INVALID_WORKFLOW' }; }
  }, [state.workflow, context]);
  function propose(command: Command) {
    const preview = editorReducer(state, command, context);
    const diff = describeProposal(state, preview, command, context);
    let review: ReviewResult | null = null;
    if (!preview.error) {
      try { review = lintWorkflow(preview.workflow, context); } catch { /* Invalid draft is already rejected by reducer. */ }
    }
    setPending({ command, diff, review });
  }
  function applyProposal() {
    if (!pending) return;
    dispatch(pending.command);
    setPending(null);
  }
  return <Context.Provider value={{ state, dispatch, context, pending, propose, applyProposal, dismissProposal: () => setPending(null), ...reviewState }}>
    {children}
  </Context.Provider>;
}
export function useWorkflow() {
  const value = useContext(Context);
  if (!value) throw new Error('WorkflowProvider is required');
  return value;
}
