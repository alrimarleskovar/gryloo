// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Workflow } from '../domain/initial-workflow';
import { modeBConfirm, modeBExecution, modeBInfo, modeBInstallationStep, modeBPrepare, modeBReconcile, modeBRunWorker } from '../app/mode-b-action';
import type { ModeBPrepared } from '../server/mode-b-service';
import { connectWallet, injectedProvider, type WalletConnection } from '../wallet/eip1193';
import { useWorkflow } from './workflow-store';

type Info = Awaited<ReturnType<typeof modeBInfo>> extends { ok: true; value: infer T } ? T :
  { available: boolean; owner?: string; executor?: string; safe?: string; executions?: readonly { executionId: string; preparedAt: string }[] };
type Status = Awaited<ReturnType<typeof modeBExecution>> extends { ok: true; value: infer T } ? T :
  { prepared: ModeBPrepared; remainingBudget: string; residualTokenAllowance: string; moduleEnabled: boolean; executorEnabled: boolean };
type Store = { info: Info | null; status: Status | null; wallet: WalletConnection | null; reviewed: boolean;
  retired: boolean; recoveryOnly: boolean; quoteExpired: boolean; busy: string | null; error: string | null; unknownSubmission: boolean;
  prepare(): void; connect(): void; acceptReview(): void; installNext(): void; revokeNext(): void;
  runWorker(): void; reconcile(): void; refresh(): void };
const Context = createContext<Store | null>(null);
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function unwrap<T>(value: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string }): T {
  if (!value.ok) throw new Error(value.code);
  return value.value;
}
const code = (error: unknown): string => error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message)
  ? error.message : 'MODE_B_CLIENT_ERROR';
export function ModeBProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow();
  const workflowRef = useRef(state.workflow);
  workflowRef.current = state.workflow;
  const [info, setInfo] = useState<Info | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [source, setSource] = useState<Workflow | null>(null);
  const [wallet, setWallet] = useState<WalletConnection | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [unknownSubmission, setUnknownSubmission] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const retired = Boolean(status && source && source !== state.workflow);
  const recoveryOnly = Boolean(status && !source);
  const quoteExpired = Boolean(status && Date.now() / 1000 > status.prepared.quoteExpiresAt);
  const guarded = useCallback((label: string, task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(null);
    task().catch(cause => setError(code(cause))).finally(() => { busyRef.current = false; setBusy(null); });
  }, []);
  const reload = useCallback(async (executionId: string) => {
    const value = unwrap(await modeBExecution({ executionId }));
    setStatus(value);
    return value;
  }, []);
  useEffect(() => {
    let mounted = true;
    modeBInfo().then(async result => {
      const value = unwrap(result);
      if (!mounted) return;
      setInfo(value);
      const latest = value.executions?.[0];
      if (latest) {
        const recovered = unwrap(await modeBExecution({ executionId: latest.executionId }));
        if (mounted) setStatus(recovered);
      }
    }).catch(cause => { if (mounted) setError(code(cause)); });
    return () => { mounted = false; };
  }, []);
  const prepare = useCallback(() => guarded('Simulating finite authority', async () => {
    const workflow = workflowRef.current;
    const prepared = unwrap(await modeBPrepare({ workflow }));
    setSource(workflow); setReviewed(false); setUnknownSubmission(false);
    await reload(prepared.executionId);
  }), [guarded, reload]);
  const connect = useCallback(() => guarded('Connecting local wallet', async () => {
    if (!info?.available || !info.owner) throw new Error('MODE_B_OFF');
    const provider = injectedProvider();
    if (!provider) throw new Error('WALLET_UNSUPPORTED');
    setWallet(await connectWallet(provider, info.owner));
  }), [guarded, info]);
  const ownerStep = useCallback((phase: 'installation' | 'revocation') => guarded(`Requesting ${phase} signature`, async () => {
    const prepared = status?.prepared;
    if (!prepared || !wallet || !reviewed || unknownSubmission || (phase === 'installation' && (retired || recoveryOnly || quoteExpired))) throw new Error('MODE_B_REVIEW_REQUIRED');
    const list = phase === 'installation' ? prepared.compiled.installation : prepared.compiled.revocation;
    const index = phase === 'installation' ? prepared.installationStart + prepared.installation.length : prepared.revocation.length;
    const item = list[index];
    if (!item) throw new Error('MODE_B_STEP_UNAVAILABLE');
    if (phase === 'installation') {
      const fresh = unwrap(await modeBInstallationStep({ executionId: prepared.executionId, index }));
      if (fresh.to !== item.to || fresh.data !== item.data) throw new Error('MODE_B_STEP_CHANGED');
    }
    const provider = injectedProvider();
    if (!provider || await provider.request({ method: 'eth_chainId' }) !== '0x7a69') throw new Error('WALLET_WRONG_CHAIN');
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== wallet.account.toLowerCase())
      throw new Error('WALLET_WRONG_ACCOUNT');
    const nonce = await provider.request({ method: 'eth_getTransactionCount', params: [wallet.account, 'pending'] });
    if (typeof nonce !== 'string' || !/^0x[0-9a-f]+$/.test(nonce)) throw new Error('WALLET_NONCE_INVALID');
    let hash: unknown;
    try { hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: wallet.account, to: item.to,
      data: item.data, value: '0x0', chainId: '0x7a69', nonce, gas: '0x2dc6c0' }] }); }
    catch { setUnknownSubmission(true); throw new Error('MODE_B_WALLET_RESULT_UNKNOWN'); }
    if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(hash)) {
      setUnknownSubmission(true); throw new Error('MODE_B_WALLET_RESULT_UNKNOWN');
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await modeBConfirm({ executionId: prepared.executionId, phase, index, hash });
      if (result.ok) { await reload(prepared.executionId); return; }
      if (result.code !== 'MODE_B_TX_UNCONFIRMED') throw new Error(result.code);
      await pause(500);
    }
    setUnknownSubmission(true); throw new Error('MODE_B_CONFIRMATION_PENDING');
  }), [guarded, reload, retired, recoveryOnly, quoteExpired, reviewed, status, unknownSubmission, wallet]);
  const runWorker = useCallback(() => guarded('Running local executor', async () => {
    if (!status || !reviewed || retired || recoveryOnly) throw new Error('MODE_B_REVIEW_REQUIRED');
    unwrap(await modeBRunWorker({ executionId: status.prepared.executionId }));
    await reload(status.prepared.executionId);
  }), [guarded, reload, retired, recoveryOnly, reviewed, status]);
  const reconcile = useCallback(() => guarded('Reconciling fork effects', async () => {
    if (!status) throw new Error('MODE_B_NOT_PREPARED');
    unwrap(await modeBReconcile({ executionId: status.prepared.executionId }));
    await reload(status.prepared.executionId);
  }), [guarded, reload, status]);
  const refresh = useCallback(() => guarded('Reading permission state', async () => {
    if (!status) return;
    await reload(status.prepared.executionId);
  }), [guarded, reload, status]);
  return <Context.Provider value={{ info, status, wallet, reviewed, retired, recoveryOnly, quoteExpired, busy, error, unknownSubmission, prepare, connect,
    acceptReview: () => setReviewed(true), installNext: () => ownerStep('installation'), revokeNext: () => ownerStep('revocation'),
    runWorker, reconcile, refresh }}>{children}</Context.Provider>;
}
export function useModeB() {
  const value = useContext(Context);
  if (!value) throw new Error('ModeBProvider is required');
  return value;
}
