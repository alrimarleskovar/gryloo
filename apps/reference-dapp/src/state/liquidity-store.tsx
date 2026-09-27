// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { liquidityBegin, liquidityInspect, liquidityObserve, liquidityPrepare, liquidityRecoverUnknown, liquidityStatus, liquiditySubmission,
  type LiquidityInfo, type LiquidityResult } from '../app/liquidity-action';
import type { LiquidityOperation, PreparedLiquidity, LiquidityStatus } from '../server/liquidity-service';
import { connectWallet, injectedProvider, requestExactTransaction, type WalletConnection } from '../wallet/eip1193';
import { liquidityCallFromReview, verifyLiquidityBrowserPayload, type LiquidityVerified } from '../wallet/liquidity-eip1193';
import { useWorkflow } from './workflow-store';
const errorCode = (cause: unknown) => cause instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(cause.message)
  ? cause.message : 'LIQUIDITY_CLIENT_ERROR';
function unwrap<T>(result: LiquidityResult<T>): T { if (!result.ok) throw new Error(result.code); return result.value; }
type Store = { readonly info: LiquidityInfo | null; readonly prepared: PreparedLiquidity | null; readonly status: LiquidityStatus | null;
  readonly verified: LiquidityVerified | null; readonly wallet: WalletConnection | null; readonly error: string | null;
  readonly busy: string | null; readonly reviewAccepted: boolean; readonly retired: boolean; readonly recoveryOnly: boolean;
  readonly consumed: boolean;
  readonly inspection: Awaited<ReturnType<typeof liquidityInspect>> | null;
  prepare(operation: LiquidityOperation, tokenId?: string, partBps?: number): void; acceptReview(): void; connect(): void;
  request(): void; observe(): void; recoverUnknown(): void; inspect(tokenId: string): void; refresh(): void };
const Context = createContext<Store | null>(null);
export function LiquidityProvider({ children }: { children: ReactNode }) {
  const { state, context } = useWorkflow();
  const [info, setInfo] = useState<LiquidityInfo | null>(null);
  const [prepared, setPrepared] = useState<PreparedLiquidity | null>(null);
  const [status, setStatus] = useState<LiquidityStatus | null>(null);
  const [verified, setVerified] = useState<LiquidityVerified | null>(null);
  const [wallet, setWallet] = useState<WalletConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewAccepted, setReviewAccepted] = useState(false);
  const [source, setSource] = useState<typeof state.workflow | null>(null);
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [inspection, setInspection] = useState<Store['inspection']>(null);
  const workflowRef = useRef(state.workflow); workflowRef.current = state.workflow;
  const busyRef = useRef(false);
  const retired = Boolean(prepared && source && source !== state.workflow);
  // One reviewed payload authorizes at most one wallet request; any recorded attempt consumes it.
  const consumed = Boolean(prepared && status?.journal?.executionId === prepared.executionId && status.journal.attempts.length > 0);
  const guarded = useCallback((label: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(null);
    action().catch(cause => setError(errorCode(cause))).finally(() => { busyRef.current = false; setBusy(null); });
  }, []);
  useEffect(() => {
    let cancelled = false;
    liquidityStatus().then(async response => {
      const result = unwrap(response);
      if (cancelled) return;
      setInfo(result);
      if (result.available) {
        setStatus(result.status);
        if (result.status.prepared) {
          setPrepared(result.status.prepared); setRecoveryOnly(true);
          // Reloaded pending/unknown work is readback-only. It never reuses a wallet authorization.
          setReviewAccepted(false); setVerified(null);
        }
      }
    }).catch(cause => { if (!cancelled) setError(errorCode(cause)); });
    return () => { cancelled = true; };
  }, []);
  const refresh = useCallback(() => guarded('Refreshing local fork status', async () => {
    const result = unwrap(await liquidityStatus()); setInfo(result);
    if (result.available) { setStatus(result.status); setPrepared(result.status.prepared); }
  }), [guarded]);
  const prepare = useCallback((operation: LiquidityOperation, tokenId?: string, partBps?: number) => guarded('Simulating exact local fork operation', async () => {
    if (!info?.available) throw new Error('LIQUIDITY_OFF');
    const workflow = workflowRef.current;
    const value = unwrap(await liquidityPrepare({ workflow: workflow as unknown as SemanticWorkflow, operation,
      ...(tokenId ? { tokenId } : {}), ...(partBps ? { partBps } : {}) }));
    const call = liquidityCallFromReview(value, workflow as unknown as SemanticWorkflow, context);
    const check = await verifyLiquidityBrowserPayload(value, call);
    setPrepared(value); setSource(workflow); setVerified(check); setReviewAccepted(false); setRecoveryOnly(false);
    const current = unwrap(await liquidityStatus()); setStatus(current.available ? current.status : null);
  }), [guarded, context, info]);
  const connect = useCallback(() => guarded('Connecting local chain wallet', async () => {
    if (!info?.available) throw new Error('LIQUIDITY_OFF');
    const provider = injectedProvider(); if (!provider) throw new Error('WALLET_UNSUPPORTED');
    setWallet(await connectWallet(provider, info.owner));
  }), [guarded, info]);
  const request = useCallback(() => guarded('Requesting exact wallet signature', async () => {
    if (!info?.available || !prepared || !verified || !wallet || !reviewAccepted || retired || recoveryOnly || consumed)
      throw new Error('LIQUIDITY_REVIEW_REQUIRED');
    const provider = injectedProvider(); if (!provider) throw new Error('WALLET_UNSUPPORTED');
    await connectWallet(provider, info.owner);
    const begun = unwrap(await liquidityBegin({ executionId: prepared.executionId, idempotencyKey: `liquidity-${crypto.randomUUID()}`, workflow: workflowRef.current }));
    setReviewAccepted(false);
    let report: { kind: 'HASH' | 'REJECTED' | 'UNKNOWN'; transactionHash?: string } = { kind: 'UNKNOWN' };
    try {
      const currentWorkflow = workflowRef.current as unknown as SemanticWorkflow;
      const call = liquidityCallFromReview(begun.prepared, currentWorkflow, context);
      const check = await verifyLiquidityBrowserPayload(begun.prepared, call);
      if (check.payloadHash !== verified.payloadHash || JSON.stringify(check.request) !== JSON.stringify(verified.request))
        throw new Error('LIQUIDITY_BROWSER_PAYLOAD_CHANGED');
      report = await requestExactTransaction(provider, check.request);
    } finally {
      // Unknown/rejection still reaches the durable journal; neither is retried here.
      const next = unwrap(await liquiditySubmission({ executionId: prepared.executionId, attemptId: begun.attemptId, report }));
      setStatus(next);
    }
  }), [guarded, info, prepared, verified, wallet, reviewAccepted, retired, recoveryOnly, consumed, context]);
  const observe = useCallback(() => guarded('Reconciling independent local fork reads', async () => {
    if (!prepared) throw new Error('LIQUIDITY_NOT_PREPARED');
    setStatus(unwrap(await liquidityObserve({ executionId: prepared.executionId })));
  }), [guarded, prepared]);
  const recoverUnknown = useCallback(() => guarded('Scanning local fork for the exact signed transaction', async () => {
    if (!prepared) throw new Error('LIQUIDITY_NOT_PREPARED');
    setStatus(unwrap(await liquidityRecoverUnknown({ executionId: prepared.executionId })));
  }), [guarded, prepared]);
  const inspect = useCallback((tokenId: string) => guarded('Inspecting position NFT and balances', async () => {
    setInspection(await liquidityInspect({ tokenId }));
  }), [guarded]);
  const acceptReview = useCallback(() => {
    if (prepared && verified && !retired && !recoveryOnly && !consumed) setReviewAccepted(true);
  }, [prepared, verified, retired, recoveryOnly, consumed]);
  return <Context.Provider value={{ info, prepared, status, verified, wallet, error, busy, reviewAccepted, retired,
    recoveryOnly, consumed, inspection, prepare, acceptReview, connect, request, observe, recoverUnknown, inspect, refresh }}>{children}</Context.Provider>;
}
export function useLiquidity(): Store {
  const value = useContext(Context); if (!value) throw new Error('LiquidityProvider missing'); return value;
}
