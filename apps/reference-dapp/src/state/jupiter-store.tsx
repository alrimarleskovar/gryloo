// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { useWorkflow } from './workflow-store';
import { connectSolanaWallet, signWithSolanaWallet, type SolanaSession } from '../wallet/solana-wallet';
import { jupiterBegin, jupiterInfo, jupiterInvalidate, jupiterObserve, jupiterReview, jupiterSimulate, jupiterStatus, jupiterSubmit, jupiterWalletFailure } from '../app/jupiter-action';
import type { JupiterRecord } from '../server/jupiter-service';

const key = 'gryloo:build014:jupiter';
type Store = { record: JupiterRecord | null; owner: string | null; busy: boolean; error: string | null; retired: boolean; recovered: boolean;
  executionEnabled: boolean; connect(): Promise<void>; simulate(): Promise<void>; review(): Promise<void>; execute(): Promise<void>; observe(): Promise<void> };
const Context = createContext<Store | null>(null);
const unresolved = (record: JupiterRecord | null) => Boolean(record?.attempt && record.verdict === 'PENDING' && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(record.attempt.state));
function walletCode(cause: unknown): string {
  const value = cause as { code?: unknown; name?: unknown; message?: unknown } | null;
  return value && (value.code === 4001 || /reject|declin|denied|cancel/i.test(String(value.name ?? '') + String(value.message ?? ''))) ? 'JUPITER_WALLET_REJECTED' : 'JUPITER_WALLET_SIGN_FAILED';
}
const bounded = (cause: unknown) => { try { const v = cause as Record<string, unknown>; return { name: String(v?.name ?? ''), code: typeof v?.code === 'number' ? v.code : null, message: String(v?.message ?? cause).slice(0, 500) }; } catch { return { message: 'unreadable' }; } };

export function JupiterProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow();
  const [record, setRecord] = useState<JupiterRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false), [signing, setSigning] = useState(false), [session, setSession] = useState<SolanaSession | null>(null);
  const [executionEnabled, setExecutionEnabled] = useState(false);
  const workflow = state.workflow as unknown as SemanticWorkflow;
  const latest = useRef(workflow); latest.current = workflow;
  const busyRef = useRef(false);
  const pristineRecovery = recovered && workflow.revision === 0 && workflow.nodes.length === 1 && workflow.nodes[0]?.actionType === 'mock-read';
  const retired = Boolean(record && JSON.stringify(record.review.workflow) !== JSON.stringify(workflow) && !pristineRecovery);
  function accept(value: JupiterRecord) { setRecord(value); try { window.localStorage.setItem(key, JSON.stringify({ id: value.id })); } catch { /* server journal remains authoritative */ } }
  useEffect(() => {
    let mounted = true;
    jupiterInfo().then(result => { if (mounted && result.ok) setExecutionEnabled(result.value.executionEnabled); }).catch(() => undefined);
    try {
      const pointer = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { id?: unknown } | null;
      if (pointer && typeof pointer.id === 'string' && /^jupiter-[a-f0-9]{32}$/.test(pointer.id))
        jupiterStatus(pointer.id).then(result => { if (mounted && result.ok) { setRecord(result.value); setRecovered(true); } }).catch(() => undefined);
    } catch { setError('JUPITER_RECOVERY_POINTER_INVALID'); }
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (!signing) return;
    const prevent = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener('keydown', prevent, true);
    return () => window.removeEventListener('keydown', prevent, true);
  }, [signing]);
  // A semantic edit after Review invalidates the authorization; any existing transaction stays observable.
  useEffect(() => { if (record && retired && record.authorization) jupiterInvalidate(record.id).then(result => { if (result.ok) setRecord(result.value); }).catch(() => setError('JUPITER_AUTHORIZATION_INVALIDATION_FAILED')); }, [record, retired]);
  async function operation(action: () => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'JUPITER_OPERATION_FAILED'); } finally { busyRef.current = false; setBusy(false); }
  }
  async function ensureSession(): Promise<SolanaSession> {
    if (session) return session;
    const next = await connectSolanaWallet(); setSession(next); return next;
  }
  async function connect() { await operation(async () => { await ensureSession(); }); }
  async function poll(id: string) {
    for (let i = 0; i < 30; i++) {
      const observed = await jupiterObserve(id); if (!observed.ok) throw new Error(observed.code);
      accept(observed.value);
      if (!unresolved(observed.value)) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  async function simulate() { await operation(async () => {
    if (unresolved(record)) throw new Error('JUPITER_EXISTING_ATTEMPT_OBSERVE_ONLY');
    const owner = (await ensureSession()).account.address, snapshot = latest.current;
    const result = await jupiterSimulate(snapshot, owner); if (!result.ok) throw new Error(result.code);
    if (latest.current !== snapshot) throw new Error('JUPITER_SEMANTIC_REVISION_CHANGED');
    accept(result.value); setRecovered(false);
  }); }
  async function review() { await operation(async () => {
    if (!record || retired) throw new Error('JUPITER_SIMULATION_REQUIRED');
    const result = await jupiterReview(record.id, record.review.commitment, latest.current); if (!result.ok) throw new Error(result.code);
    accept(result.value);
  }); }
  async function execute() { await operation(async () => {
    if (!record || retired || record.authorization !== record.review.commitment) throw new Error('JUPITER_REVIEW_REQUIRED');
    const current = await ensureSession();
    if (current.account.address !== record.review.owner) throw new Error('JUPITER_WRONG_OWNER');
    const snapshot = latest.current;
    const begin = await jupiterBegin(record.id, current.account.address, snapshot); if (!begin.ok) throw new Error(begin.code);
    accept(begin.value.record);
    let signed: string;
    setSigning(true);
    try {
      if (JSON.stringify(latest.current) !== JSON.stringify(snapshot)) throw new Error('JUPITER_SEMANTIC_REVISION_CHANGED');
      // The sole owner-signature request, reachable only from the owner's Execute click.
      signed = await signWithSolanaWallet(current, begin.value.unsignedTransaction);
    } catch (cause) {
      const failure = cause instanceof Error && /^JUPITER_[A-Z_]+$/.test(cause.message) ? cause.message : walletCode(cause);
      const recorded = await jupiterWalletFailure(record.id, { stage: 'SIGN', code: failure, error: bounded(cause) });
      if (recorded.ok) accept(recorded.value);
      throw new Error(failure, { cause });
    } finally { setSigning(false); }
    const submitted = await jupiterSubmit(record.id, signed); if (!submitted.ok) throw new Error(submitted.code);
    accept(submitted.value);
    if (submitted.value.attempt?.signature) await poll(record.id);
  }); }
  async function observe() { await operation(async () => { if (!record) throw new Error('JUPITER_RUN_MISSING'); await poll(record.id); }); }
  return <Context.Provider value={{ record, owner: session?.account.address ?? null, busy, error, retired, recovered, executionEnabled, connect, simulate, review, execute, observe }}>
    {signing && <p role="status">Confirm or reject the pending request in your Solana wallet.</p>}
    <div inert={signing} data-jupiter-wallet-pending={signing ? 'true' : undefined}>{children}</div></Context.Provider>;
}
export function useJupiter() { const value = useContext(Context); if (!value) throw new Error('JUPITER_PROVIDER_MISSING'); return value; }
