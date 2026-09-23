// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import { editorReducer, initialEditor, type EditorState } from '../domain/editor';
import type { Command } from '../domain/commands';

const Context = createContext<{ state: EditorState; dispatch: Dispatch<Command> } | null>(null);

export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorReducer, undefined, initialEditor);
  return <Context.Provider value={{ state, dispatch }}>{children}</Context.Provider>;
}

export function useWorkflow() {
  const value = useContext(Context);
  if (!value) throw new Error('WorkflowProvider is required');
  return value;
}
