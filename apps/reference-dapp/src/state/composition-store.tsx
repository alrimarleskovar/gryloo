// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Workflow } from '../domain/initial-workflow';
import { compositionInfo, compositionPrepare, compositionExecution, compositionInstallationStep,
  compositionConfirm, compositionRunWorker, compositionRecoverKnown } from '../app/composition-action';
import { connectWallet, injectedProvider, type WalletConnection } from '../wallet/eip1193';
import { useWorkflow } from './workflow-store';
const Context = createContext<Store | null>(null);
type Info = Awaited<ReturnType<typeof compositionInfo>> extends { ok: true; value: infer T } ? T :
  { available: boolean; owner?: string; executor?: string; safe?: string; environment?: 'MOCKED' | 'FORK_REPRODUCED'; executions?: readonly { executionId: string; preparedAt: string }[] };
type Status = Extract<Awaited<ReturnType<typeof compositionExecution>>, { ok: true }>['value'];
type Store = { readonly info: Info | null; readonly status: Status | null; readonly wallet: WalletConnection | null;
  readonly reviewed: boolean; readonly retired: boolean; readonly recoveryOnly: boolean;
  readonly busy: string | null; readonly error: string | null; readonly unknownSubmission: boolean;
  prepare(): void; connect(): void; acceptReview(): void; installNext(): void; revokeNext(): void;
  runWorker(): void; recoverKnown(): void; refresh(): void };
function unwrap<T>(r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string }): T {
  if (!r.ok) throw new Error(r.code); return r.value;
}
function code(e: unknown) { const value = e instanceof Error ? e.message : '';
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(value) ? value : 'COMPOSITION_CLIENT_ERROR'; }
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export function CompositionProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow();
  const workflowRef = useRef(state.workflow); workflowRef.current = state.workflow;
  const [info, setInfo] = useState<Info | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [source, setSource] = useState<Workflow | null>(null);
  const [wallet, setWallet] = useState<WalletConnection | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unknownSubmission, setUnknownSubmission] = useState(false);
  const busyRef = useRef(false);
  const retired = Boolean(status && source && source !== state.workflow);
  const recoveryOnly = Boolean(status && !source);
  const guarded = useCallback((label: string, task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(null);
    task().catch(e => setError(code(e))).finally(() => { busyRef.current = false; setBusy(null); });
  }, []);
  const reload = useCallback(async (executionId: string) => {
    const value = unwrap(await compositionExecution({ executionId }));
    setStatus(value); return value;
  }, []);
  useEffect(() => {
    let mounted = true;
    compositionInfo().then(async result => {
      const value = unwrap(result);
      if (!mounted) return;
      setInfo(value);
      const latest = value.executions?.[0];
      if (latest) { const recovered = unwrap(await compositionExecution({ executionId: latest.executionId }));
        if (mounted) setStatus(recovered); }
    }).catch(e => { if (mounted) setError(code(e)); });
    return () => { mounted = false; };
  }, []);
  const prepare = useCallback(() => guarded('Preparing composition', async () => {
    const workflow = workflowRef.current;
    const prepared = unwrap(await compositionPrepare({ workflow }));
    setSource(workflow); setReviewed(false); setUnknownSubmission(false);
    await reload(prepared.executionId);
  }), [guarded, reload]);
  const connect = useCallback(() => guarded('Connecting local wallet', async () => {
    if (!info?.available || !info.owner) throw new Error('COMPOSITION_OFF');
    const provider = injectedProvider(); if (!provider) throw new Error('WALLET_UNSUPPORTED');
    setWallet(await connectWallet(provider, info.owner));
  }), [guarded, info]);
  const ownerStep = useCallback((phase: 'installation' | 'revocation') => guarded(`Requesting ${phase}`, async () => {
    const prepared = status?.prepared;
    if (!prepared || !reviewed || !wallet || unknownSubmission || (phase === 'installation' && (retired || recoveryOnly)))
      throw new Error('COMPOSITION_REVIEW_REQUIRED');
    const list = phase === 'installation' ? prepared.compiled.installation : prepared.compiled.revocation;
    const index = phase === 'installation' ? prepared.installation.length : prepared.revocation.length;
    const item = list[index]; if (!item) throw new Error('COMPOSITION_STEP_UNAVAILABLE');
    if (phase === 'installation') { const exact = unwrap(await compositionInstallationStep({ executionId: prepared.executionId, index }));
      if (exact.to !== item.to || exact.data !== item.data) throw new Error('COMPOSITION_STEP_CHANGED'); }
    const provider = injectedProvider(); if (!provider || await provider.request({ method: 'eth_chainId' }) !== '0x7a69')
      throw new Error('WALLET_WRONG_CHAIN');
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== wallet.account.toLowerCase())
      throw new Error('WALLET_WRONG_ACCOUNT');
    const reported = await provider.request({ method: 'eth_getTransactionCount', params: [wallet.account, 'pending'] });
    const count = typeof reported === 'number' && Number.isSafeInteger(reported) && reported >= 0 ? BigInt(reported)
      : typeof reported === 'string' && /^0x[0-9a-fA-F]{1,16}$/.test(reported) ? BigInt(reported) : null;
    if (count === null) throw new Error('WALLET_NONCE_INVALID');
    let hash: unknown;
    try { hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: wallet.account, to: item.to,
      data: item.data, value: '0x0', chainId: '0x7a69', nonce: '0x' + count.toString(16), gas: '0x4c4b40' }] }); }
    catch { setUnknownSubmission(true); throw new Error('COMPOSITION_WALLET_RESULT_UNKNOWN'); }
    if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/.test(hash)) {
      setUnknownSubmission(true); throw new Error('COMPOSITION_WALLET_RESULT_UNKNOWN'); }
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await compositionConfirm({ executionId: prepared.executionId, phase, index, hash });
      if (result.ok) { await reload(prepared.executionId); return; }
      if (result.code !== 'COMPOSITION_TX_UNCONFIRMED') throw new Error(result.code);
      await pause(500);
    }
    setUnknownSubmission(true); throw new Error('COMPOSITION_CONFIRMATION_PENDING');
  }), [guarded, status, reviewed, wallet, unknownSubmission, retired, recoveryOnly, reload]);
  const work = useCallback((recover: boolean) => guarded(recover ? 'Recovering known receipt' : 'Running fixed worker', async () => {
    if (!status || !reviewed || retired || recoveryOnly) throw new Error('COMPOSITION_REVIEW_REQUIRED');
    const request = { executionId: status.prepared.executionId };
    unwrap(await (recover ? compositionRecoverKnown(request) : compositionRunWorker(request)));
    await reload(request.executionId);
  }), [guarded, status, reviewed, retired, recoveryOnly, reload]);
  const refresh = useCallback(() => guarded('Reading fork status', async () => {
    if (status) await reload(status.prepared.executionId);
  }), [guarded, status, reload]);
  return <Context.Provider value={{ info, status, wallet, reviewed, retired, recoveryOnly, busy, error,
    unknownSubmission, prepare, connect, acceptReview: () => setReviewed(true),
    installNext: () => ownerStep('installation'), revokeNext: () => ownerStep('revocation'),
    runWorker: () => work(false), recoverKnown: () => work(true), refresh }}>{children}</Context.Provider>;
}
export function useComposition() { const value = useContext(Context); if (!value) throw new Error('COMPOSITION_PROVIDER_MISSING'); return value; }
