// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import type { BridgeExecution } from '@defi-workflow-engine/reference-executor';
import { bridgeApprove, bridgeAuthorize, bridgeConfirmDestination, bridgeConfirmSource, bridgeInfo,
  bridgeLoad, bridgeProgress, bridgeQuote, bridgeRecheck, bridgeReconcile, bridgeSubmit } from '../app/bridge-action';
import { useWorkflow } from './workflow-store';
type Store = { readonly enabled: boolean; readonly wallet: string | null; readonly execution: BridgeExecution | null;
  readonly busy: string | null; readonly error: string | null; readonly recoveryOnly: boolean; readonly retired: boolean;
  readonly scenario: 'normal' | 'uncertain'; setScenario(value: 'normal' | 'uncertain'): void;
  connect(): void; quote(): void; authorize(): void; approve(): void; submit(): void; recheck(): void;
  confirmSource(): void; progress(): void; confirmDestination(): void; reconcile(): void; refresh(): void };
const Context = createContext<Store | null>(null);
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string }): T {
  if (!result.ok) throw new Error(result.code);
  return result.value;
}
function code(error: unknown): string { return error instanceof Error ? error.message : 'BRIDGE_CLIENT_ERROR'; }
export function BridgeProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow();
  const workflowRef = useRef(state.workflow);
  workflowRef.current = state.workflow;
  const [enabled, setEnabled] = useState(false);
  const [execution, setExecution] = useState<BridgeExecution | null>(null);
  const [source, setSource] = useState<SemanticWorkflow | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [scenario, setScenario] = useState<'normal' | 'uncertain'>('normal');
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const retired = Boolean(source && source !== state.workflow);
  const work = useCallback((label: string, action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError(null);
    action().catch(cause => setError(code(cause))).finally(() => { lock.current = false; setBusy(null); });
  }, []);
  useEffect(() => {
    let stopped = false;
    (async () => {
      const info = await bridgeInfo();
      if (!info.ok || stopped) return;
      setEnabled(info.value.enabled);
      const active = [...info.value.executions].reverse().find(x => !['RECONCILED', 'FAILED'].includes(x.state));
      if (active) {
        const found = await bridgeLoad(active.executionId);
        if (found.ok && !stopped) { setExecution(found.value); setRecoveryOnly(true); }
      }
    })().catch(cause => { if (!stopped) setError(code(cause)); });
    return () => { stopped = true; };
  }, []);
  const connect = useCallback(() => work('Connecting wallet for address review', async () => {
    const provider = (window as Window & { ethereum?: { request(input: { method: string }): Promise<unknown> } }).ethereum;
    if (!provider) throw new Error('BRIDGE_WALLET_UNAVAILABLE');
    const chain = await provider.request({ method: 'eth_chainId' });
    if (chain !== '0x2105') throw new Error('BRIDGE_WALLET_WRONG_CHAIN');
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0]))
      throw new Error('BRIDGE_WALLET_ACCOUNT_INVALID');
    setWallet(accounts[0].toLowerCase());
  }), [work]);
  const quote = useCallback(() => work('Requesting live LI.FI route', async () => {
    if (!wallet) throw new Error('BRIDGE_WALLET_REQUIRED');
    const workflow = workflowRef.current as SemanticWorkflow;
    const next = unwrap(await bridgeQuote({ workflow, owner: wallet, scenario }));
    setExecution(next); setSource(workflow); setRecoveryOnly(false);
  }), [work, wallet, scenario]);
  const mutate = useCallback((label: string, action: (id: string) => Promise<{ readonly ok: true; readonly value: BridgeExecution } | { readonly ok: false; readonly code: string }>,
    requiresWallet = false) => work(label, async () => {
    if (!execution) throw new Error('BRIDGE_EXECUTION_UNAVAILABLE');
    if (requiresWallet && (!wallet || wallet !== execution.route.owner || recoveryOnly || retired)) throw new Error('BRIDGE_REVIEW_INVALIDATED');
    setExecution(unwrap(await action(execution.executionId)));
  }), [work, execution, wallet, recoveryOnly, retired]);
  const authorize = useCallback(() => mutate('Authorizing mocked Manifest', id => bridgeAuthorize(id, execution?.compiled.hashes.manifest ?? ''), true), [mutate, execution]);
  const approve = useCallback(() => mutate('Rehearsing exact approval', bridgeApprove, true), [mutate]);
  const submit = useCallback(() => mutate('Rehearsing source submission', bridgeSubmit, true), [mutate]);
  const recheck = useCallback(() => mutate('Rechecking existing uncertain submission', bridgeRecheck), [mutate]);
  const confirmSource = useCallback(() => mutate('Checking source receipt', bridgeConfirmSource), [mutate]);
  const progress = useCallback(() => mutate('Checking bridge progress', bridgeProgress), [mutate]);
  const confirmDestination = useCallback(() => mutate('Checking destination receipt', bridgeConfirmDestination), [mutate]);
  const reconcile = useCallback(() => mutate('Reconciling destination balance', bridgeReconcile), [mutate]);
  const refresh = useCallback(() => mutate('Loading durable bridge journal', bridgeLoad), [mutate]);
  return <Context.Provider value={{ enabled, wallet, execution, busy, error, recoveryOnly, retired, scenario, setScenario,
    connect, quote, authorize, approve, submit, recheck, confirmSource, progress, confirmDestination, reconcile, refresh }}>{children}</Context.Provider>;
}
export function useBridge(): Store {
  const value = useContext(Context);
  if (!value) throw new Error('BRIDGE_PROVIDER_MISSING');
  return value;
}
