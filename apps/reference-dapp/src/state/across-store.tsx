// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AcrossExecution } from '@defi-workflow-engine/reference-executor';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { acrossInfo, acrossQuote, acrossLoad, acrossAuthorize, acrossApprove, acrossPrepare, acrossSubmit,
  acrossRecheck, acrossConfirmSource, acrossProgress, acrossDelay, acrossFill, acrossReconcile,
  acrossExpire, acrossRefundPending, acrossRefundConfirm } from '../app/across-action';
import { useWorkflow } from './workflow-store';
import { useBuild009Wallet, BASE_HEX } from './build009-wallet-store';
type Result = { readonly ok: true; readonly value: AcrossExecution } | { readonly ok: false; readonly code: string };
type Store = { readonly run: AcrossExecution | null; readonly recovered: boolean; readonly retired: boolean;
  readonly busy: boolean; readonly error: string | null; readonly liveQuoteAvailable: boolean;
  readonly uncertain: boolean; setUncertain(value: boolean): void;
  quote(): void; authorize(): void; approve(): void; prepare(): void; submit(): void; recheck(): void;
  confirmSource(): void; progress(): void; delay(): void; fill(): void; reconcile(): void;
  expire(): void; refundPending(): void; refundConfirm(): void; refresh(): void };
const Context = createContext<Store | null>(null);
const STORAGE_KEY = 'gryloo.across.execution-id';
const unwrap = (result: Result): AcrossExecution => { if (!result.ok) throw new Error(result.code); return result.value; };
export function AcrossProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow(); const wallet = useBuild009Wallet();
  const [run, setRun] = useState<AcrossExecution | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [liveQuoteAvailable, setLiveQuoteAvailable] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false); const lock = useRef(false);
  const sourceRevision = useRef<number | null>(null);
  const walletRevision = useRef<number | null>(null);
  const retired = Boolean(run && ((sourceRevision.current !== null && sourceRevision.current !== state.workflow.revision)
    || (walletRevision.current !== null && walletRevision.current !== wallet.revision)));
  useEffect(() => { let stopped = false;
    acrossInfo().then(async info => {
      if (!info.ok || stopped) return;
      setLiveQuoteAvailable(info.value.liveQuoteAvailable);
      const executionId = localStorage.getItem(STORAGE_KEY);
      if (!executionId || !/^across-[0-9a-f]{24}$/.test(executionId)) return;
      const found = await acrossLoad(executionId);
      if (found.ok && !stopped) { setRun(found.value); setRecovered(true); }
    }).catch(() => { if (!stopped) setError('Could not load the bridge history'); });
    return () => { stopped = true; };
  }, []);
  const work = useCallback((action: () => Promise<AcrossExecution>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    action().then(value => { setRun(value); localStorage.setItem(STORAGE_KEY, value.executionId); }).catch(cause => setError(cause instanceof Error ? cause.message : 'ACROSS_ACTION_FAILED'))
      .finally(() => { lock.current = false; setBusy(false); });
  }, []);
  const requireWallet = (owner?: string) => {
    if (!wallet.account || wallet.chainId !== BASE_HEX || owner && wallet.account !== owner)
      throw new Error('Connect your wallet on Base to continue');
    return wallet.account;
  };
  const current = () => { if (!run) throw new Error('ACROSS_RUN_MISSING'); return run; };
  const quote = () => work(async () => { const owner = requireWallet();
    const next = unwrap(await acrossQuote(JSON.parse(JSON.stringify(state.workflow)) as SemanticWorkflow, owner));
    sourceRevision.current = state.workflow.revision; walletRevision.current = wallet.revision; setRecovered(false); return next;
  });
  const mutate = (action: (id: string) => Promise<Result>, financial = false) => work(async () => {
    const item = current(); if (financial && (retired || recovered)) throw new Error('Review this bridge again before a new simulated submission');
    if (financial) requireWallet(item.quote.owner);
    return unwrap(await action(item.executionId));
  });
  return <Context.Provider value={{ run, recovered, retired, busy, error, liveQuoteAvailable, uncertain, setUncertain,
    quote, authorize: () => mutate(id => acrossAuthorize(id, current().review.manifestHash), true),
    approve: () => mutate(acrossApprove, true), prepare: () => mutate(acrossPrepare, true),
    submit: () => mutate(id => acrossSubmit(id, uncertain), true),
    recheck: () => mutate(acrossRecheck), confirmSource: () => mutate(acrossConfirmSource),
    progress: () => mutate(acrossProgress), delay: () => mutate(acrossDelay), fill: () => mutate(acrossFill),
    reconcile: () => mutate(acrossReconcile), expire: () => mutate(acrossExpire),
    refundPending: () => mutate(acrossRefundPending), refundConfirm: () => mutate(acrossRefundConfirm),
    refresh: () => mutate(acrossLoad) }}>{children}</Context.Provider>;
}
export function useAcross(): Store { const value = useContext(Context); if (!value) throw new Error('ACROSS_PROVIDER_MISSING'); return value; }
