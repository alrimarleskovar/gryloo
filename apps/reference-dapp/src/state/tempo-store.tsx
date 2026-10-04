// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import type { TempoRecord } from '../server/tempo-service';
import { tempoSimulate, tempoRecoverReview, tempoReview, tempoBegin, tempoHandoff, tempoReport, tempoInvalidate, tempoStatus, tempoObserve } from '../app/tempo-action';
import { useWorkflow } from './workflow-store';
import { injected, useBuild009Wallet } from './build009-wallet-store';
import { requestTempoPayment } from '../wallet/tempo';
const KEY = 'flofi.tempo.run';
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false; code: string }) => { if (!r.ok) throw new Error(r.code); return r.value; };
type Store = { record: TempoRecord | null; busy: boolean; error: string; retired: boolean;
  simulate(): Promise<void>; review(): Promise<void>; execute(): Promise<void>; observe(): Promise<void>; restore(id: string): Promise<void>; recoverReview(): Promise<void> };
const Context = createContext<Store | null>(null);
export function TempoProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow(), wallet = useBuild009Wallet();
  const [record, setRecord] = useState<TempoRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), workflow = useRef(state.workflow), session = useRef(wallet.revision);
  workflow.current = state.workflow; session.current = wallet.revision;
  const retired = !!record && (JSON.stringify(record.review.workflow) !== JSON.stringify(state.workflow) || wallet.account !== record.review.account || wallet.chainId !== '0xa5bf');
  async function task(fn: () => Promise<void>) { if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'TEMPO_UNAVAILABLE'); } finally { lock.current = false; setBusy(false); } }
  const remember = (r: TempoRecord) => { setRecord(r); localStorage.setItem(KEY, r.id); };
  useEffect(() => { const id = localStorage.getItem(KEY); if (id) void tempoStatus(id).then(r => { if (r.ok) setRecord(r.value); }); }, []);
  useEffect(() => { if (record?.authorization && retired) void tempoInvalidate(record.id).then(r => { if (r.ok) setRecord(r.value); }); }, [retired, record?.id, record?.authorization]);
  const api: Store = { record, busy, error, retired,
    simulate: () => task(async () => {
      if (record?.attempt && record.verdict === 'PENDING' && !record.expiredUnusedNonce) throw new Error('TEMPO_EXISTING_ATTEMPT_OBSERVE_ONLY');
      const s = await wallet.session() ?? await wallet.connect(); if (!s) throw new Error('TEMPO_OWNER_REQUIRED');
      if (s.chainId !== '0xa5bf') throw new Error('TEMPO_WRONG_CHAIN');
      remember(unwrap(await tempoSimulate(workflow.current as SemanticWorkflow, s.account)));
    }),
    review: () => task(async () => { if (!record || retired) throw new Error('TEMPO_FRESH_SIMULATION_REQUIRED'); remember(unwrap(await tempoReview(record.id, record.review.commitment, workflow.current as SemanticWorkflow))); }),
    execute: () => task(async () => {
      if (!record || retired || !record.authorization || record.attempt) throw new Error('TEMPO_REVIEW_REQUIRED');
      const provider = injected(); if (!provider) throw new Error('TEMPO_WALLET_UNAVAILABLE');
      const source = workflow.current, revision = session.current;
      const prepared = unwrap(await tempoBegin(record.id, record.review.account, source as SemanticWorkflow)); remember(prepared.record);
      await requestTempoPayment(provider, prepared.record.review, async hash => {
        remember(unwrap(await tempoHandoff(record.id, hash, workflow.current as SemanticWorkflow)));
      }, () => workflow.current === source && session.current === revision);
      remember(unwrap(await tempoReport(record.id)));
    }),
    observe: () => task(async () => { if (record) remember(unwrap(await tempoObserve(record.id))); }),
    recoverReview: () => task(async () => { if (record) remember(unwrap(await tempoRecoverReview(record.id, workflow.current as SemanticWorkflow))); }),
    restore: id => task(async () => { remember(unwrap(await tempoStatus(id))); }),
  };
  return <Context.Provider value={api}>{children}</Context.Provider>;
}
export function useTempo() { const value = useContext(Context); if (!value) throw new Error('TEMPO_PROVIDER_REQUIRED'); return value; }
