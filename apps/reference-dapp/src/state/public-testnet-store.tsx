// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { publicAvailability, publicBegin, publicObserve, publicPrepare, publicRefresh, publicReport, publicReview, publicStatus } from '../app/public-testnet-action';
import type { PublicRun } from '../server/public-testnet-service';
import { BASE_SEPOLIA } from '../domain/public-testnet-swap';
import { BASE_SEPOLIA_HEX, injected, useBuild009Wallet } from './build009-wallet-store';
import { useWorkflow } from './workflow-store';

const KEY = 'gryloo:public-testnet-execution-id';
type Store = { readonly available: boolean; readonly run: PublicRun | null; readonly recoveryOnly: boolean;
  readonly retired: boolean; readonly busy: string | null; readonly error: string | null;
  simulate(): void; review(): void; execute(): void; observe(): void; switchNetwork(): void };
const Context = createContext<Store | null>(null);
function unwrap<T>(result: { ok: true; value: T } | { ok: false; code: string }): T {
  if (!result.ok) throw new Error(result.code);
  return result.value;
}
function message(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const messages: Record<string, string> = {
    PUBLIC_RECORDING_OFF: 'Public testnet recording is not enabled on this app instance.',
    QUOTE_CHANGED_REVIEW_REQUIRED: 'The quote changed. Review the updated amounts before executing.',
    QUOTE_EXPIRED_REVIEW_REQUIRED: 'Quote expired. Review a fresh quote.',
    REVIEW_EXPIRED: 'Quote expired. Simulate again.', REVIEW_REQUIRED: 'Review the current swap first.',
    INSUFFICIENT_INPUT: 'Insufficient test token balance.', INSUFFICIENT_TEST_ETH: 'Insufficient Base Sepolia ETH for network fees.',
    POOL_UNUSABLE: 'The selected pool is unavailable. Try again later.', POOL_FACTORY_MISMATCH: 'The selected pool could not be verified.',
    WRONG_PROVIDER_CHAIN: 'Base Sepolia is unavailable from this provider.',
    ATTEMPT_ALREADY_ACTIVE: 'A transaction is already in progress. Check its result before trying again.',
    SWAP_ALREADY_ATTEMPTED: 'This swap was already submitted. Check its result before trying again.',
    RECONCILIATION_MISMATCH: 'The transaction needs manual review. The observed balances did not match the swap bounds.',
  };
  return messages[code] ?? (code.startsWith('PUBLIC_') ? 'The public testnet request could not be completed. Try again.' : code || 'Could not continue. Try again.');
}
function rejected(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error.code === 4001 || error.code === 'ACTION_REJECTED');
}
async function calldataDigest(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return '0x' + Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}
export function PublicTestnetProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow();
  const wallet = useBuild009Wallet();
  const [available, setAvailable] = useState(false);
  const [run, setRun] = useState<PublicRun | null>(null);
  const [source, setSource] = useState<SemanticWorkflow | null>(null);
  const [recoveryOnly, setRecoveryOnly] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const workflowRef = useRef(state.workflow);
  workflowRef.current = state.workflow;
  const retired = Boolean(run && (recoveryOnly || source !== state.workflow));
  const guarded = useCallback((label: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(null);
    action().catch(cause => setError(message(cause))).finally(() => { busyRef.current = false; setBusy(null); });
  }, []);
  useEffect(() => {
    let cancelled = false;
    publicAvailability().then(value => { if (!cancelled) setAvailable(value); });
    const id = localStorage.getItem(KEY);
    if (id) publicStatus(id).then(async result => {
      if (cancelled || !result.ok) return;
      let recovered = result.value;
      const last = recovered.attempts.at(-1);
      if (last?.state === 'PREPARED') {
        const hash = localStorage.getItem(KEY + ':' + last.attemptId);
        if (hash && /^0x[0-9a-f]{64}$/.test(hash)) {
          const reported = await publicReport(id, last.attemptId, { kind: 'HASH', txHash: hash });
          if (reported.ok) recovered = reported.value;
        }
      }
      if (!cancelled) { setRun(recovered); setRecoveryOnly(true); }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const simulate = useCallback(() => guarded('Reading Base Sepolia', async () => {
    if (!available) throw new Error('PUBLIC_RECORDING_OFF');
    if (run?.attempts.some(a => ['PREPARED', 'HASH', 'PENDING', 'UNKNOWN'].includes(a.state))) throw new Error('ATTEMPT_ALREADY_ACTIVE');
    const workflow = workflowRef.current;
    const approval = run?.attempts.at(-1);
    const resumeApproval = Boolean(run && !run.outcome && approval?.step === 'approval' &&
      approval.state === 'CONFIRMED' && (recoveryOnly || source === workflow));
    const prepared = unwrap(resumeApproval ? await publicRefresh(run!.quote.executionId) :
      await publicPrepare(workflow as unknown as SemanticWorkflow));
    localStorage.setItem(KEY, prepared.quote.executionId);
    setSource(workflow as unknown as SemanticWorkflow); setRecoveryOnly(false); setRun(prepared);
  }), [guarded, available, run, recoveryOnly, source]);
  const review = useCallback(() => guarded('Reviewing swap', async () => {
    if (!run || retired) throw new Error('REVIEW_REQUIRED');
    setRun(unwrap(await publicReview(run.quote.executionId, run.quote.manifestHash)));
  }), [guarded, run, retired]);
  const observe = useCallback(() => guarded('Checking transaction', async () => {
    if (!run) throw new Error('EXECUTION_NOT_FOUND');
    setRun(unwrap(await publicObserve(run.quote.executionId)));
  }), [guarded, run]);
  const switchNetwork = useCallback(() => guarded('Switching wallet network', async () => {
    await wallet.switchTo(BASE_SEPOLIA_HEX);
  }), [guarded, wallet]);
  const execute = useCallback(() => guarded('Preparing transaction', async () => {
    if (!run || retired) throw new Error('REVIEW_REQUIRED');
    if (run.reviewedManifestHash !== run.quote.manifestHash) throw new Error('REVIEW_REQUIRED');
    const provider = injected();
    if (!provider) throw new Error('WALLET_NOT_FOUND');
    let session = await wallet.session();
    if (!session) session = await wallet.connect();
    if (!session) throw new Error('WALLET_CONNECTION_REJECTED');
    if (session.chainId !== BASE_SEPOLIA_HEX) throw new Error('WRONG_WALLET_CHAIN');
    const begun = await publicBegin(run.quote.executionId, session.account);
    if (!begun.ok) {
      const current = await publicStatus(run.quote.executionId);
      if (current.ok) setRun(current.value);
      throw new Error(begun.code);
    }
    const { attempt, tx } = begun.value;
    setRun(unwrap(await publicStatus(run.quote.executionId)));
    if (tx.chainId !== BASE_SEPOLIA_HEX || tx.from !== session.account || tx.value !== '0x0' ||
        tx.to !== (attempt.step === 'approval' ? run.quote.inputToken : BASE_SEPOLIA.router) ||
        await calldataDigest(tx.data) !== attempt.calldataDigest) {
      unwrap(await publicReport(run.quote.executionId, attempt.attemptId, { kind: 'UNKNOWN' }));
      throw new Error('TRANSACTION_ARTIFACT_CHANGED');
    }
    const actualChain = await provider.request({ method: 'eth_chainId' });
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (typeof actualChain !== 'string' || actualChain.toLowerCase() !== BASE_SEPOLIA_HEX ||
        !Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== session.account) {
      unwrap(await publicReport(run.quote.executionId, attempt.attemptId, { kind: 'UNKNOWN' }));
      throw new Error('WRONG_WALLET_CHAIN');
    }
    let hash: unknown;
    try { hash = await provider.request({ method: 'eth_sendTransaction', params: [tx] }); }
    catch (cause) {
      setRun(unwrap(await publicReport(run.quote.executionId, attempt.attemptId, { kind: rejected(cause) ? 'REJECTED' : 'UNKNOWN' })));
      if (rejected(cause)) throw new Error('WALLET_AUTHORIZATION_REJECTED', { cause });
      throw new Error('SUBMISSION_RESULT_UNKNOWN', { cause });
    }
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      setRun(unwrap(await publicReport(run.quote.executionId, attempt.attemptId, { kind: 'UNKNOWN' })));
      throw new Error('SUBMISSION_RESULT_UNKNOWN');
    }
    const txHash = hash.toLowerCase();
    localStorage.setItem(KEY + ':' + attempt.attemptId, txHash);
    setRun(unwrap(await publicReport(run.quote.executionId, attempt.attemptId, { kind: 'HASH', txHash })));
    for (let i = 0; i < 30; i++) {
      const observed = unwrap(await publicObserve(run.quote.executionId));
      setRun(observed);
      const state = observed.attempts.at(-1)?.state;
      if (state !== 'PENDING') break;
      await new Promise<void>(resolve => setTimeout(resolve, 2_000));
    }
  }), [guarded, run, retired, wallet]);
  return <Context.Provider value={{ available, run, recoveryOnly, retired, busy, error,
    simulate, review, execute, observe, switchNetwork }}>{children}</Context.Provider>;
}
export function usePublicTestnet(): Store { const value = useContext(Context); if (!value) throw new Error('PUBLIC_TESTNET_PROVIDER_MISSING'); return value; }
