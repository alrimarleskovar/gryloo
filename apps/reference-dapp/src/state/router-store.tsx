// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { useWorkflow } from './workflow-store';
import { injected, useBuild009Wallet, BASE_HEX } from './build009-wallet-store';
import { crossChainRouterMode, routerBegin, routerHandoff, routerInfo, routerInvalidate, routerObserve, routerRefresh, routerReport, routerReview, routerSimulate,
  routerStatus, routerWalletFailure } from '../app/router-action';
import type { RouterRecord, RouterWalletDiagnostic } from '../server/router-service';

/**
 * BUILD-ROUTER-001 browser state for the Cross-chain Router. The server-held run is authoritative; this store only
 * keeps a pointer (run id and the last wallet hash) so a reload resumes observation. The only submission point is the
 * owner's Execute click, after a durable handoff and fresh account/chain/nonce checks.
 */
const KEY = 'flofi:crosschain-router:run';
const REFUSALS = [4001, 4100, 4200];
const ACTIVE = ['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'];
type Store = { available: boolean; executionEnabled: boolean; record: RouterRecord | null; busy: boolean; signing: boolean; error: string | null;
  retired: boolean; recovered: boolean;
  simulate(): Promise<void>; refresh(): Promise<void>; review(): Promise<void>; execute(): Promise<void>; observe(): Promise<void>; switchNetwork(): Promise<void> };
const Context = createContext<Store | null>(null);
function quantity(value: unknown): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) return BigInt(value);
  throw new Error('ROUTER_WALLET_NONCE_RESPONSE_INVALID');
}
function errorValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 512) : value ?? null;
  const v = value as { code?: unknown; message?: unknown };
  return { code: typeof v.code === 'number' || typeof v.code === 'string' ? v.code : null, message: typeof v.message === 'string' ? v.message.slice(0, 512) : null };
}
const unwrap = <T,>(result: { ok: true; value: T } | { ok: false; code: string }): T => { if (!result.ok) throw new Error(result.code); return result.value; };

export function RouterProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow(), wallet = useBuild009Wallet();
  const [record, setRecord] = useState<RouterRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false), [available, setAvailable] = useState(false), [executionEnabled, setExecutionEnabled] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const workflow = state.workflow as unknown as SemanticWorkflow;
  const latest = useRef(workflow); latest.current = workflow;
  const latestWallet = useRef(wallet); latestWallet.current = wallet;
  const busyRef = useRef(false);
  // A recovered run stays visible on the untouched template; any other workflow change retires its Review.
  const retired = Boolean(record && JSON.stringify(record.workflow) !== JSON.stringify(workflow) &&
    !(recovered && workflow.revision === 0 && workflow.nodes.every(n => n.actionType.startsWith('mock-'))));
  function accept(value: RouterRecord) {
    setRecord(value);
    const hash = value.attempts.at(-1)?.transactionHash;
    try { window.localStorage.setItem(KEY, JSON.stringify({ id: value.id, ...hash ? { hash } : {} })); } catch { /* The server run remains authoritative. */ }
  }
  useEffect(() => {
    let mounted = true;
    crossChainRouterMode().then(mode => {
      if (!mounted) return;
      setAvailable(mode !== 'off');
      if (mode !== 'off') routerInfo().then(info => { if (mounted && info.ok) setExecutionEnabled(info.value.executionEnabled); }).catch(() => undefined);
    }).catch(() => undefined);
    try {
      const pointer = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { id?: unknown; hash?: unknown } | null;
      if (pointer && typeof pointer.id === 'string' && /^xroute-[a-f0-9]{32}$/.test(pointer.id)) (async () => {
        // A hash saved before the browser closed reaches the server first; it is never resent to a wallet.
        if (typeof pointer.hash === 'string' && /^0x[0-9a-f]{64}$/.test(pointer.hash))
          await routerReport(pointer.id as string, { kind: 'HASH', hash: pointer.hash }).catch(() => undefined);
        return routerStatus(pointer.id as string);
      })().then(result => { if (mounted && result.ok) { setRecord(result.value); setRecovered(true); } }).catch(() => undefined);
    } catch { setError('ROUTER_RECOVERY_POINTER_INVALID'); }
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (record && retired && record.phase === 'AUTHORIZED') routerInvalidate(record.id).then(r => { if (r.ok) setRecord(r.value); }).catch(() => setError('ROUTER_AUTHORIZATION_INVALIDATION_FAILED'));
  }, [record, retired]);
  async function operation(action: () => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'ROUTER_OPERATION_FAILED'); } finally { busyRef.current = false; setBusy(false); }
  }
  async function ownerSession() {
    let session = await wallet.session(); if (!session) session = await wallet.connect();
    if (!session) throw new Error('ROUTER_WALLET_REQUIRED');
    return session;
  }
  async function simulate() { await operation(async () => {
    if (record && !retired && record.verdict === 'PENDING' && (record.attempts.some(a => ACTIVE.includes(a.state)) || !['PREPARED', 'AUTHORIZED'].includes(record.phase)))
      throw new Error('ROUTER_ATTEMPT_ACTIVE_OBSERVE_EXISTING');
    const session = await ownerSession(), snapshot = latest.current;
    const value = unwrap(await routerSimulate(snapshot, session.account));
    if (latest.current !== snapshot) throw new Error('ROUTER_SEMANTIC_REVISION_CHANGED');
    setRecovered(false); accept(value);
  }); }
  async function refresh() { await operation(async () => { if (!record) throw new Error('ROUTER_RUN_MISSING'); accept(unwrap(await routerRefresh(record.id))); }); }
  async function review() { await operation(async () => {
    if (!record || retired) throw new Error('ROUTER_SIMULATION_REQUIRED');
    accept(unwrap(await routerReview(record.id, record.review.commitment, record.workflow)));
  }); }
  async function observe() { await operation(async () => { if (!record) throw new Error('ROUTER_RUN_MISSING'); accept(unwrap(await routerObserve(record.id))); }); }
  async function switchNetwork() { await operation(async () => { await wallet.switchTo(BASE_HEX); }); }
  /** One Execute click = one exact wallet request (the exact approval, or the bridge deposit). */
  async function execute() { await operation(async () => {
    if (!record || retired || record.phase !== 'AUTHORIZED' || record.authorization !== record.review.commitment) throw new Error('ROUTER_REVIEW_REQUIRED');
    const session = await ownerSession();
    if (session.chainId !== BASE_HEX) throw new Error('ROUTER_WRONG_CHAIN');
    if (session.account !== record.owner) throw new Error('ROUTER_WRONG_OWNER');
    const provider = injected(); if (!provider) throw new Error('ROUTER_WALLET_REQUIRED');
    const snapshot = record.workflow, editing = latest.current, id = record.id;
    const diagnostic: RouterWalletDiagnostic = { invoked: false, calls: [], code: 'ROUTER_WALLET_PREFLIGHT' };
    const request = async (method: string, params: unknown[] = []) => {
      const call: RouterWalletDiagnostic['calls'][number] = { method, ...method === 'eth_sendTransaction' ? { submission: true } : {} }; diagnostic.calls.push(call);
      try { const result = await provider.request({ method, ...params.length ? { params } : {} }); call.result = typeof result === 'string' ? result.slice(0, 200) : null; return result; }
      catch (cause) { call.error = errorValue(cause); throw cause; }
    };
    // Read-only session checks before and after the durable preparation; any change fails closed.
    const validateSession = async (nonce: string | null) => {
      const accounts = await request('eth_accounts'), chain = await request('eth_chainId');
      if (latest.current !== editing) throw new Error('ROUTER_SEMANTIC_REVISION_CHANGED');
      if (injected() !== provider) throw new Error('ROUTER_WALLET_PROVIDER_CHANGED');
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== record.owner) throw new Error('ROUTER_WRONG_OWNER');
      if (typeof chain !== 'string' || chain.toLowerCase() !== BASE_HEX) throw new Error('ROUTER_WRONG_CHAIN');
      if (nonce !== null && quantity(await request('eth_getTransactionCount', [record.owner, 'pending'])) !== BigInt(nonce)) throw new Error('ROUTER_WALLET_NONCE_MISMATCH');
    };
    let prepared = false;
    try {
      await validateSession(null);
      const begun = unwrap(await routerBegin(id, session.account, snapshot)); accept(begun.record); prepared = true;
      const tx = begun.transaction;
      if (tx.from !== record.owner || tx.chainId !== BASE_HEX || tx.value !== '0x0' ||
          !record.review.calls.some(c => c.to === tx.to && c.data === tx.data)) throw new Error('ROUTER_TRANSACTION_ARTIFACT_CHANGED');
      await validateSession(begun.attempt.nonce);
      accept(unwrap(await routerHandoff(id)));
      if (latestWallet.current.account !== session.account || latestWallet.current.chainId !== session.chainId) throw new Error('ROUTER_WRONG_OWNER');
      // The sole submission point, reachable only from the owner's Execute click. The wallet assigns the reviewed nonce.
      setSigning(true); diagnostic.invoked = true;
      let hash: unknown;
      try { hash = await request('eth_sendTransaction', [tx]); } finally { setSigning(false); }
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('ROUTER_SUBMISSION_UNKNOWN');
      try { window.localStorage.setItem(KEY, JSON.stringify({ id, hash: hash.toLowerCase() })); } catch { /* Reported to the server next. */ }
      accept(unwrap(await routerReport(id, { kind: 'HASH', hash: hash.toLowerCase() })));
    } catch (cause) {
      const send = diagnostic.calls.find(c => c.submission), sendError = send?.error as { code?: unknown } | undefined;
      const refused = Boolean(send) && send!.result === undefined && typeof sendError?.code === 'number' && REFUSALS.includes(sendError.code);
      if (refused) diagnostic.rejectionCode = sendError!.code as number;
      diagnostic.code = refused ? 'ROUTER_REJECTED' : !diagnostic.invoked ? (cause instanceof Error && /^ROUTER_[A-Z0-9_]+$/.test(cause.message) ? cause.message : 'ROUTER_RPC_ERROR_BEFORE_WALLET_SUBMISSION') : 'ROUTER_SUBMISSION_UNKNOWN';
      if (prepared && (!diagnostic.invoked || refused)) {
        const failure = await routerWalletFailure(id, diagnostic); if (failure.ok) accept(failure.value);
        throw new Error(diagnostic.code, { cause });
      }
      if (diagnostic.invoked) {
        // The request may have reached the network: never resend, only observe.
        const report = await routerReport(id, { kind: 'UNKNOWN', code: diagnostic.code }); if (report.ok) accept(report.value);
        throw new Error('ROUTER_SUBMISSION_UNKNOWN_OBSERVE_EXISTING', { cause });
      }
      if (cause instanceof Error && /ROUTE_CHANGED|STATE_CHANGED|REVIEW_EXPIRED/.test(cause.message)) {
        const current = await routerStatus(id); if (current.ok) accept(current.value);
      }
      throw cause;
    }
    for (let i = 0; i < 20; i++) {
      const observed = await routerObserve(id);
      if (!observed.ok) break;
      accept(observed.value);
      const last = observed.value.attempts.at(-1);
      if (!last || !['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(last.state) || observed.value.verdict !== 'PENDING') break;
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  }); }
  return <Context.Provider value={{ available, executionEnabled, record, busy, signing, error, retired, recovered, simulate, refresh, review, execute, observe, switchNetwork }}>
    {signing && <p role="status">Confirm or reject the pending request in your wallet.</p>}
    <div inert={signing} data-router-wallet-pending={signing ? 'true' : undefined}>{children}</div></Context.Provider>;
}
export function useRouter() { const value = useContext(Context); if (!value) throw new Error('ROUTER_PROVIDER_MISSING'); return value; }
