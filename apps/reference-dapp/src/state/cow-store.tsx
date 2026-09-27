// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { cowCancel, cowExecution, cowInfo, cowPost, cowPrepare, cowReconcile, cowTrack } from '../app/cow-action';
import type { CowExecution, CowScenario } from '../server/cow-service';
import { connectLocalCowWallet, localCowProvider, reviewCowTypedData, signLocalCowTypedData } from '../wallet/cow-eip712';
import { useWorkflow } from './workflow-store';

type Info = Extract<Awaited<ReturnType<typeof cowInfo>>, { ok: true }>['value'];
type Store = { readonly info: Info | null; readonly execution: CowExecution | null; readonly wallet: string | null;
  readonly recoveryOnly: boolean; readonly retired: boolean; readonly busy: string | null; readonly error: string | null;
  readonly scenario: CowScenario; setScenario(value: CowScenario): void; connect(): void; prepare(): void;
  signAndPost(): void; track(): void; cancel(): void; reconcile(): void; refresh(): void };
const Context = createContext<Store | null>(null);
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string }): T {
  if (!result.ok) throw new Error(result.code);
  return result.value;
}
function code(cause: unknown): string {
  return cause instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(cause.message) ? cause.message : 'COW_CLIENT_ERROR';
}
export function CowProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow();
  const workflowRef = useRef(state.workflow);
  workflowRef.current = state.workflow;
  const [info, setInfo] = useState<Info | null>(null);
  const [execution, setExecution] = useState<CowExecution | null>(null);
  const [source, setSource] = useState<SemanticWorkflow | null>(null);
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [wallet, setWallet] = useState<string | null>(null);
  const [scenario, setScenario] = useState<CowScenario>('fill');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const retired = Boolean(execution && source && source !== state.workflow);
  const guarded = useCallback((label: string, work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(null);
    work().catch(cause => setError(code(cause))).finally(() => { busyRef.current = false; setBusy(null); });
  }, []);
  const refresh = useCallback(() => guarded('Loading CoW status', async () => {
    const result = await cowInfo({ workflow: workflowRef.current as SemanticWorkflow });
    if (!result.ok) throw new Error(result.code);
    setInfo(result.value);
  }), [guarded]);
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const result = await cowInfo({ workflow: workflowRef.current as SemanticWorkflow });
        if (!result.ok) throw new Error(result.code);
        const value = result.value;
        if (stopped) return;
        setInfo(value);
        const latest = value.executions?.find(item => !['RECONCILED', 'CANCELLED', 'EXPIRED', 'DIVERGENT'].includes(item.state));
        if (latest) {
          const recovered = unwrap(await cowExecution({ executionId: latest.executionId }));
          if (!stopped) { setExecution(recovered); setRecoveryOnly(true); }
        }
      } catch (cause) { if (!stopped) setError(code(cause)); }
    })();
    return () => { stopped = true; };
  }, []);
  useEffect(() => {
    let stopped = false;
    cowInfo({ workflow: state.workflow as SemanticWorkflow }).then(result => {
      if (!stopped && result.ok) setInfo(result.value);
    }).catch(() => undefined);
    return () => { stopped = true; };
  }, [state.workflow]);
  const connect = useCallback(() => guarded('Connecting disposable local wallet', async () => {
    const provider = localCowProvider();
    if (!provider) throw new Error('COW_LOCAL_WALLET_REQUIRED');
    setWallet(await connectLocalCowWallet(provider));
  }), [guarded]);
  const prepare = useCallback(() => guarded('Preparing scripted CoW quote', async () => {
    if (!wallet || !info?.enabled || !info.discovery?.available) throw new Error('COW_CAPABILITY_UNAVAILABLE');
    const workflow = workflowRef.current as SemanticWorkflow;
    const value = unwrap(await cowPrepare({ workflow, owner: wallet, scenario }));
    setExecution(value); setSource(workflow); setRecoveryOnly(false);
  }), [guarded, wallet, info, scenario]);
  const signAndPost = useCallback(() => guarded('Signing and posting local order', async () => {
    const current = execution;
    if (!current || !wallet || current.record.state !== 'REVIEWED' || recoveryOnly ||
      source !== workflowRef.current || current.record.quote.owner !== wallet) throw new Error('COW_REVIEW_INVALIDATED');
    if (Date.parse(current.record.quote.expiresAt) <= Date.now()) throw new Error('COW_QUOTE_EXPIRED');
    const provider = localCowProvider();
    if (!provider) throw new Error('COW_LOCAL_WALLET_REQUIRED');
    reviewCowTypedData(current.record.compiled.typedData, current.record.compiled.order, wallet);
    const signature = await signLocalCowTypedData(provider, wallet, current.record.compiled.typedData);
    setExecution(unwrap(await cowPost({ executionId: current.record.executionId, signature })));
  }), [guarded, execution, wallet, recoveryOnly, source]);
  const track = useCallback(() => guarded('Checking the loopback orderbook', async () => {
    if (!execution) throw new Error('COW_EXECUTION_UNAVAILABLE');
    setExecution(unwrap(await cowTrack({ executionId: execution.record.executionId })));
  }), [guarded, execution]);
  const cancel = useCallback(() => guarded('Signing local cancellation', async () => {
    const current = execution;
    if (!current || !wallet || current.record.quote.owner !== wallet) throw new Error('COW_WALLET_ACCOUNT_MISMATCH');
    const provider = localCowProvider();
    if (!provider) throw new Error('COW_LOCAL_WALLET_REQUIRED');
    const typed = { ...current.record.compiled.typedData,
      types: { EIP712Domain: current.record.compiled.typedData.types.EIP712Domain,
        OrderCancellations: [{ name: 'orderUids', type: 'bytes[]' }] },
      primaryType: 'OrderCancellations' as const, message: { orderUids: [current.record.compiled.orderUid] } };
    const signature = await signLocalCowTypedData(provider, wallet, typed);
    setExecution(unwrap(await cowCancel({ executionId: current.record.executionId, signature })));
  }), [guarded, execution, wallet]);
  const reconcile = useCallback(() => guarded('Reconciling scripted settlement', async () => {
    if (!execution) throw new Error('COW_EXECUTION_UNAVAILABLE');
    setExecution(unwrap(await cowReconcile({ executionId: execution.record.executionId })));
  }), [guarded, execution]);
  return <Context.Provider value={{ info, execution, wallet, recoveryOnly, retired, busy, error, scenario,
    setScenario, connect, prepare, signAndPost, track, cancel, reconcile, refresh }}>{children}</Context.Provider>;
}
export function useCow(): Store {
  const value = useContext(Context);
  if (!value) throw new Error('COW_PROVIDER_MISSING');
  return value;
}
