// SPDX-License-Identifier: AGPL-3.0-only
// Read-only context for the isolated browser component suite. Aliased only by its Vite build.
import { createContext, useContext, type ReactNode } from 'react';
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { Workflow } from '../domain/initial-workflow';
const Context = createContext<{ state: { workflow: Workflow }; context: ReviewContext; canvasLayout: Record<string, { x: number; y: number }>; reviewError: null } | null>(null);
export function ExecuteAcceptanceWorkflowProvider({ workflow, context, children }: { workflow: Workflow; context: ReviewContext; children: ReactNode }) {
  return <Context.Provider value={{ state: { workflow }, context, canvasLayout: {}, reviewError: null }}>{children}</Context.Provider>;
}
export function useWorkflow() { const value = useContext(Context); if (!value) throw Error('Acceptance context missing'); return value; }
// Inspection cards do not call authoring APIs. These aliases exclude Next server actions from Vite.
export function useExecutionEnvironment() { return { walletEnvironment: 'testnet' as const }; }
export function useUniswapLiquidity() { return {}; }
export function useSolanaLiquidity() { return {}; }
