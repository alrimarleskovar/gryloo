// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import {
  modeABeginStep, modeAConfirmRevocation, modeAExecution, modeAObserveStep, modeAPrepare, modeAPrepareRevocation,
  modeARecordSubmission, modeAReconcile, modeAStatus, type ModeAInfo, type ModeAResult,
} from '../app/mode-a-action';
import type { ExecutionStatus, PreparedExecution, StepId } from '../server/mode-a-service';
import type { Workflow } from '../domain/initial-workflow';
import {
  connectWallet, injectedProvider, requestExactTransaction, verifyReviewedPayload, type Verified, type WalletConnection,
} from '../wallet/eip1193';
import { useWorkflow } from './workflow-store';

/**
 * Local-fork Mode A view state, kept apart from the BUILD-003B mocked chain and the BUILD-003C
 * observation: neither of those can ever reach this store or authorize a request.
 */
export type WalletRequestRecord = { readonly stepId: StepId; readonly payloadHash: string; readonly outcome: string };
type Store = {
  info: ModeAInfo | null; infoError: string | null;
  prepared: PreparedExecution | null; recoveryOnly: boolean; retired: boolean;
  verified: Readonly<Partial<Record<StepId, Verified>>>; verifyError: string | null;
  execution: ExecutionStatus | null; reviewAccepted: boolean;
  wallet: WalletConnection | null; walletError: string | null;
  busy: string | null; error: string | null; requests: readonly WalletRequestRecord[];
  simulate(): void; acceptReview(): void; connect(): void; request(stepId: StepId): void; observe(stepId: StepId): void;
  reconcile(): void; prepareRevocation(): void; confirmRevocation(): void; discard(): void;
};
const Context = createContext<Store | null>(null);
const POLL_MS = 250;
const POLLS = 240;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function unwrap<T>(result: ModeAResult<T>): T {
  if (!result.ok) throw new Error(result.code);
  return result.value;
}
const codeOf = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}(?::[A-Za-z0-9_ ,:.()-]{0,120})?$/.test(error.message) ? error.message : 'MODE_A_CLIENT_ERROR';

export function ModeAProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow();
  const [info, setInfo] = useState<ModeAInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedExecution | null>(null);
  const [source, setSource] = useState<Workflow | null>(null);
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [verified, setVerified] = useState<Partial<Record<StepId, Verified>>>({});
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [execution, setExecution] = useState<ExecutionStatus | null>(null);
  const [reviewAccepted, setReviewAccepted] = useState(false);
  const [wallet, setWallet] = useState<WalletConnection | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<WalletRequestRecord[]>([]);
  const busyRef = useRef(false);
  const workflowRef = useRef(state.workflow);
  workflowRef.current = state.workflow;
  // A semantic edit replaces the immutable IR object: the prepared action is retired for new requests.
  const retired = Boolean(prepared && !recoveryOnly && source !== state.workflow);

  const verifyAll = useCallback(async (value: PreparedExecution) => {
    const result: Partial<Record<StepId, Verified>> = {};
    for (const view of value.payloads) {
      result[view.stepId] = await verifyReviewedPayload(view, value.owner, { tokenIn: value.tokenIn, owner: value.owner });
    }
    return result;
  }, []);
  const load = useCallback(async (executionId: string) => {
    const status = unwrap(await modeAExecution({ executionId }));
    setExecution(status);
    return status;
  }, []);
  const guarded = useCallback((label: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label); setError(null);
    action().catch(cause => setError(codeOf(cause))).finally(() => { busyRef.current = false; setBusy(null); });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = unwrap(await modeAStatus());
        if (cancelled) return;
        setInfo(value);
        // After a browser or server restart, the latest unfinished execution is reloaded from the journal.
        if (value.available) {
          const open = [...value.executions].filter(item => !item.final).sort((a, b) => a.preparedAt < b.preparedAt ? 1 : -1)[0];
          if (open) {
            const status = unwrap(await modeAExecution({ executionId: open.executionId }));
            if (cancelled) return;
            setPrepared(status.prepared); setExecution(status); setRecoveryOnly(true); setReviewAccepted(true);
            const checks = await verifyAll(status.prepared);
            if (status.revocation) {
              checks['step-revoke'] = await verifyReviewedPayload(status.revocation.payload, status.prepared.owner,
                { tokenIn: status.prepared.tokenIn, owner: status.prepared.owner });
            }
            setVerified(checks);
          }
        }
      } catch (cause) { if (!cancelled) setInfoError(codeOf(cause)); }
    })();
    return () => { cancelled = true; };
  }, [verifyAll]);

  const simulate = useCallback(() => guarded('Simulating on the local fork', async () => {
    const workflow = workflowRef.current;
    setVerifyError(null); setReviewAccepted(false); setExecution(null); setRecoveryOnly(false); setRequests([]);
    const value = unwrap(await modeAPrepare({ workflow: workflow as unknown as SemanticWorkflow }));
    try { setVerified(await verifyAll(value)); }
    catch (cause) { setVerifyError(codeOf(cause)); setVerified({}); }
    setPrepared(value); setSource(workflow);
    await load(value.executionId);
  }), [guarded, load, verifyAll]);

  const connect = useCallback(() => guarded('Connecting the injected wallet', async () => {
    if (!info?.available) throw new Error('MODE_A_OFF');
    const provider = injectedProvider();
    if (!provider) { setWalletError('WALLET_UNSUPPORTED'); return; }
    try { setWallet(await connectWallet(provider, info.owner)); setWalletError(null); }
    catch (cause) { setWallet(null); setWalletError(codeOf(cause)); }
  }), [guarded, info]);

  const poll = useCallback(async (executionId: string, stepId: StepId) => {
    for (let i = 0; i < POLLS; i++) {
      const observed = unwrap(await modeAObserveStep({ executionId, stepId }));
      if (observed.attempt.state !== 'PENDING') break;
      await load(executionId);
      await sleep(POLL_MS);
    }
    await load(executionId);
  }, [load]);

  const request = useCallback((stepId: StepId) => guarded(`Requesting ${stepId}`, async () => {
    if (!prepared || !info?.available) throw new Error('MODE_A_NOT_PREPARED');
    if (stepId !== 'step-revoke' && (retired || recoveryOnly)) throw new Error('ARTIFACTS_RETIRED');
    if (!reviewAccepted) throw new Error('MANIFEST_NOT_REVIEWED');
    const provider = injectedProvider();
    if (!provider || !wallet) throw new Error('WALLET_NOT_CONNECTED');
    await connectWallet(provider, info.owner);
    const idempotencyKey = `${stepId}-${crypto.randomUUID()}`;
    const begun = unwrap(await modeABeginStep({ executionId: prepared.executionId, stepId, idempotencyKey }));
    // Recompute from the exact reviewed bytes immediately before the request; any mismatch blocks here.
    const check = await verifyReviewedPayload(begun.payload, prepared.owner, { tokenIn: prepared.tokenIn, owner: prepared.owner });
    const reviewed = verified[stepId];
    if (!reviewed || reviewed.payloadHash !== begun.payload.payloadHash || JSON.stringify(reviewed.request) !== JSON.stringify(check.request)) {
      await modeARecordSubmission({ executionId: prepared.executionId, attemptId: begun.attempt.executionAttemptId, report: { kind: 'REJECTED' } });
      throw new Error('BROWSER_PAYLOAD_CHANGED');
    }
    const report = await requestExactTransaction(provider, check.request);
    setRequests(items => [...items, { stepId, payloadHash: check.payloadHash, outcome: report.kind }]);
    const attempt = unwrap(await modeARecordSubmission({ executionId: prepared.executionId, attemptId: begun.attempt.executionAttemptId, report }));
    if (attempt.state === 'PENDING') await poll(prepared.executionId, stepId);
    else await load(prepared.executionId);
  }), [guarded, prepared, info, retired, recoveryOnly, reviewAccepted, wallet, verified, poll, load]);

  const observe = useCallback((stepId: StepId) => guarded('Reading the fork for this attempt', async () => {
    if (!prepared) throw new Error('MODE_A_NOT_PREPARED');
    unwrap(await modeAObserveStep({ executionId: prepared.executionId, stepId }));
    await load(prepared.executionId);
  }), [guarded, prepared, load]);
  const reconcile = useCallback(() => guarded('Reconciling from independent fork reads', async () => {
    if (!prepared) throw new Error('MODE_A_NOT_PREPARED');
    unwrap(await modeAReconcile({ executionId: prepared.executionId }));
    await load(prepared.executionId);
  }), [guarded, prepared, load]);
  const prepareRevocation = useCallback(() => guarded('Preparing a separate revocation', async () => {
    if (!prepared) throw new Error('MODE_A_NOT_PREPARED');
    const revocation = unwrap(await modeAPrepareRevocation({ executionId: prepared.executionId }));
    const check = await verifyReviewedPayload(revocation.payload, prepared.owner, { tokenIn: prepared.tokenIn, owner: prepared.owner });
    if (check.decoded.approve?.amount !== '0') throw new Error('BROWSER_REVOCATION_NOT_ZERO');
    setVerified(items => ({ ...items, 'step-revoke': check }));
    await load(prepared.executionId);
  }), [guarded, prepared, load]);
  const confirmRevocation = useCallback(() => guarded('Confirming revocation from the fork', async () => {
    if (!prepared) throw new Error('MODE_A_NOT_PREPARED');
    unwrap(await modeAConfirmRevocation({ executionId: prepared.executionId }));
    await load(prepared.executionId);
  }), [guarded, prepared, load]);
  const acceptReview = useCallback(() => { if (prepared && !verifyError && !retired) setReviewAccepted(true); }, [prepared, verifyError, retired]);
  const discard = useCallback(() => {
    setPrepared(null); setExecution(null); setVerified({}); setReviewAccepted(false); setRecoveryOnly(false); setRequests([]); setError(null);
  }, []);

  const value = useMemo<Store>(() => ({ info, infoError, prepared, recoveryOnly, retired, verified, verifyError, execution, reviewAccepted,
    wallet, walletError, busy, error, requests, simulate, acceptReview, connect, request, observe, reconcile, prepareRevocation,
    confirmRevocation, discard }), [info, infoError, prepared, recoveryOnly, retired, verified, verifyError, execution, reviewAccepted,
    wallet, walletError, busy, error, requests, simulate, acceptReview, connect, request, observe, reconcile, prepareRevocation, confirmRevocation, discard]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useModeA(): Store {
  const value = useContext(Context);
  if (!value) throw new Error('ModeAProvider missing');
  return value;
}
