// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { useWorkflow } from './workflow-store';
import { injected, useBuild009Wallet, BASE_SEPOLIA_HEX } from './build009-wallet-store';
import { uniswapLiquidityBegin, uniswapLiquidityHandoff, uniswapLiquidityInvalidate, uniswapLiquidityMode, uniswapLiquidityObserve, uniswapLiquidityPrice,
  uniswapLiquidityRefresh, uniswapLiquidityReport, uniswapLiquidityReview, uniswapLiquiditySimulate, uniswapLiquidityStatus, uniswapLiquidityWalletFailure,
  uniswapLiquidityInfo } from '../app/uniswap-liquidity-action';
import type { UniswapLiquidityPrice, UniswapLiquidityRecord, UniswapWalletDiagnostic } from '../server/uniswap-liquidity-service';

const KEY = 'flofi:uniswap-liquidity:run';
const REFUSALS = [4001, 4100, 4200];
type Store = { available: boolean; executionEnabled: boolean; record: UniswapLiquidityRecord | null; busy: boolean; signing: boolean; error: string | null;
  retired: boolean; recovered: boolean; price: UniswapLiquidityPrice | null;
  simulate(): Promise<void>; refresh(): Promise<void>; review(): Promise<void>; execute(): Promise<void>; observe(): Promise<void>;
  switchNetwork(): Promise<void>; fetchPrice(): Promise<UniswapLiquidityPrice | null> };
const Context = createContext<Store | null>(null);
function quantity(value: unknown): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) return BigInt(value);
  throw new Error('UNISWAP_WALLET_NONCE_RESPONSE_INVALID');
}
function errorValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 512) : value ?? null;
  const v = value as { code?: unknown; message?: unknown };
  return { code: typeof v.code === 'number' || typeof v.code === 'string' ? v.code : null, message: typeof v.message === 'string' ? v.message.slice(0, 512) : null };
}
const unwrap = <T,>(result: { ok: true; value: T } | { ok: false; code: string }): T => { if (!result.ok) throw new Error(result.code); return result.value; };

export function UniswapLiquidityProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow(), wallet = useBuild009Wallet();
  const [record, setRecord] = useState<UniswapLiquidityRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false), [available, setAvailable] = useState(false), [executionEnabled, setExecutionEnabled] = useState(false);
  const [recovered, setRecovered] = useState(false), [price, setPrice] = useState<UniswapLiquidityPrice | null>(null);
  const workflow = state.workflow as unknown as SemanticWorkflow;
  const latest = useRef(workflow); latest.current = workflow;
  const latestWallet = useRef(wallet); latestWallet.current = wallet;
  const busyRef = useRef(false);
  // A recovered run stays visible on the untouched template; any other workflow change retires its Review.
  const retired = Boolean(record && JSON.stringify(record.workflow) !== JSON.stringify(workflow) &&
    !(recovered && workflow.revision === 0 && workflow.nodes.every(n => n.actionType.startsWith('mock-'))));
  function accept(value: UniswapLiquidityRecord) {
    setRecord(value);
    const hash = value.attempts.at(-1)?.transactionHash;
    try { window.localStorage.setItem(KEY, JSON.stringify({ id: value.id, ...hash ? { hash } : {} })); } catch { /* The server run remains authoritative. */ }
  }
  useEffect(() => {
    let mounted = true;
    uniswapLiquidityMode().then(mode => {
      if (!mounted) return;
      setAvailable(mode !== 'off');
      if (mode !== 'off') uniswapLiquidityInfo().then(info => { if (mounted && info.ok) setExecutionEnabled(info.value.executionEnabled); }).catch(() => undefined);
    }).catch(() => undefined);
    try {
      const pointer = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as { id?: unknown; hash?: unknown } | null;
      if (pointer && typeof pointer.id === 'string' && /^unilp-[a-f0-9]{32}$/.test(pointer.id)) (async () => {
        // A hash saved before the browser closed reaches the server first; it is never resent to a wallet.
        if (typeof pointer.hash === 'string' && /^0x[0-9a-f]{64}$/.test(pointer.hash))
          await uniswapLiquidityReport(pointer.id as string, { kind: 'HASH', hash: pointer.hash }).catch(() => undefined);
        return uniswapLiquidityStatus(pointer.id as string);
      })().then(result => { if (mounted && result.ok) { setRecord(result.value); setRecovered(true); } }).catch(() => undefined);
    } catch { setError('UNISWAP_RECOVERY_POINTER_INVALID'); }
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (record && retired && record.authorization) uniswapLiquidityInvalidate(record.id).then(r => { if (r.ok) setRecord(r.value); }).catch(() => setError('UNISWAP_AUTHORIZATION_INVALIDATION_FAILED'));
  }, [record, retired]);
  async function operation(action: () => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'UNISWAP_OPERATION_FAILED'); } finally { busyRef.current = false; setBusy(false); }
  }
  async function ownerSession() {
    let session = await wallet.session(); if (!session) session = await wallet.connect();
    if (!session) throw new Error('UNISWAP_WALLET_REQUIRED');
    return session;
  }
  async function fetchPrice(): Promise<UniswapLiquidityPrice | null> {
    let value: UniswapLiquidityPrice | null = null;
    await operation(async () => { value = unwrap(await uniswapLiquidityPrice()); setPrice(value); });
    return value;
  }
  async function simulate() { await operation(async () => {
    if (record && !retired && record.verdict === 'PENDING' && record.attempts.some(a => ['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(a.state)))
      throw new Error('UNISWAP_ATTEMPT_ACTIVE_OBSERVE_EXISTING');
    const session = await ownerSession(), snapshot = latest.current;
    const value = unwrap(await uniswapLiquiditySimulate(snapshot, session.account));
    if (latest.current !== snapshot) throw new Error('UNISWAP_SEMANTIC_REVISION_CHANGED');
    setRecovered(false); accept(value);
  }); }
  async function refresh() { await operation(async () => { if (!record) throw new Error('UNISWAP_RUN_MISSING'); accept(unwrap(await uniswapLiquidityRefresh(record.id))); }); }
  async function review() { await operation(async () => {
    if (!record || retired) throw new Error('UNISWAP_SIMULATION_REQUIRED');
    accept(unwrap(await uniswapLiquidityReview(record.id, record.review.commitment, record.workflow)));
  }); }
  async function observe() { await operation(async () => { if (!record) throw new Error('UNISWAP_RUN_MISSING'); accept(unwrap(await uniswapLiquidityObserve(record.id))); }); }
  async function switchNetwork() { await operation(async () => { await wallet.switchTo(BASE_SEPOLIA_HEX); }); }
  /** One Execute click = one exact wallet request (the next approval or the mint). */
  async function execute() { await operation(async () => {
    if (!record || retired || record.authorization !== record.review.commitment) throw new Error('UNISWAP_REVIEW_REQUIRED');
    const session = await ownerSession();
    if (session.chainId !== BASE_SEPOLIA_HEX) throw new Error('UNISWAP_WRONG_CHAIN');
    if (session.account !== record.owner) throw new Error('UNISWAP_WRONG_OWNER');
    const provider = injected(); if (!provider) throw new Error('UNISWAP_WALLET_REQUIRED');
    const snapshot = record.workflow, id = record.id;
    const diagnostic: UniswapWalletDiagnostic = { invoked: false, calls: [], code: 'UNISWAP_WALLET_PREFLIGHT' };
    const request = async (method: string, params: unknown[] = []) => {
      const call: UniswapWalletDiagnostic['calls'][number] = { method, ...method === 'eth_sendTransaction' ? { submission: true } : {} }; diagnostic.calls.push(call);
      try { const result = await provider.request({ method, ...params.length ? { params } : {} }); call.result = typeof result === 'string' ? result.slice(0, 200) : null; return result; }
      catch (cause) { call.error = errorValue(cause); throw cause; }
    };
    // Read-only session checks before and after the durable preparation; any change fails closed.
    const validateSession = async (nonce: string | null) => {
      const accounts = await request('eth_accounts'), chain = await request('eth_chainId');
      if (JSON.stringify(latest.current) !== JSON.stringify(snapshot)) throw new Error('UNISWAP_SEMANTIC_REVISION_CHANGED');
      if (injected() !== provider) throw new Error('UNISWAP_WALLET_PROVIDER_CHANGED');
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== record.owner) throw new Error('UNISWAP_WRONG_OWNER');
      if (typeof chain !== 'string' || chain.toLowerCase() !== BASE_SEPOLIA_HEX) throw new Error('UNISWAP_WRONG_CHAIN');
      if (nonce !== null && quantity(await request('eth_getTransactionCount', [record.owner, 'pending'])) !== BigInt(nonce)) throw new Error('UNISWAP_WALLET_NONCE_MISMATCH');
    };
    let prepared = false;
    try {
      await validateSession(null);
      const begun = unwrap(await uniswapLiquidityBegin(id, session.account, snapshot)); accept(begun.record); prepared = true;
      const tx = begun.transaction;
      if (tx.from !== record.owner || tx.chainId !== BASE_SEPOLIA_HEX || tx.value !== '0x0' ||
          !record.review.calls.some(c => c.step === begun.attempt.step && c.to === tx.to && c.data === tx.data)) throw new Error('UNISWAP_TRANSACTION_ARTIFACT_CHANGED');
      await validateSession(begun.attempt.nonce);
      accept(unwrap(await uniswapLiquidityHandoff(id)));
      if (latestWallet.current.account !== session.account || latestWallet.current.chainId !== session.chainId) throw new Error('UNISWAP_WRONG_OWNER');
      // The sole submission point, reachable only from the owner's Execute click. The wallet assigns the reviewed nonce.
      setSigning(true); diagnostic.invoked = true;
      let hash: unknown;
      try { hash = await request('eth_sendTransaction', [tx]); } finally { setSigning(false); }
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('UNISWAP_SUBMISSION_UNKNOWN');
      try { window.localStorage.setItem(KEY, JSON.stringify({ id, hash: hash.toLowerCase() })); } catch { /* Reported to the server next. */ }
      accept(unwrap(await uniswapLiquidityReport(id, { kind: 'HASH', hash: hash.toLowerCase() })));
    } catch (cause) {
      const send = diagnostic.calls.find(c => c.submission), sendError = send?.error as { code?: unknown } | undefined;
      const refused = Boolean(send) && send!.result === undefined && typeof sendError?.code === 'number' && REFUSALS.includes(sendError.code);
      if (refused) diagnostic.rejectionCode = sendError!.code as number;
      diagnostic.code = refused ? 'UNISWAP_REJECTED' : !diagnostic.invoked ? (cause instanceof Error && /^UNISWAP_[A-Z0-9_]+$/.test(cause.message) ? cause.message : 'UNISWAP_RPC_ERROR_BEFORE_WALLET_SUBMISSION') : 'UNISWAP_SUBMISSION_UNKNOWN';
      if (prepared && (!diagnostic.invoked || refused)) {
        const failure = await uniswapLiquidityWalletFailure(id, diagnostic); if (failure.ok) accept(failure.value);
        throw new Error(diagnostic.code, { cause });
      }
      if (diagnostic.invoked) {
        // The request may have reached the network: never resend, only observe.
        const report = await uniswapLiquidityReport(id, { kind: 'UNKNOWN', code: diagnostic.code }); if (report.ok) accept(report.value);
        throw new Error('UNISWAP_SUBMISSION_UNKNOWN_OBSERVE_EXISTING', { cause });
      }
      if (cause instanceof Error && /STATE_CHANGED|REVIEW_EXPIRED/.test(cause.message)) {
        const current = await uniswapLiquidityStatus(id); if (current.ok) accept(current.value);
      }
      throw cause;
    }
    for (let i = 0; i < 20; i++) {
      const observed = await uniswapLiquidityObserve(id);
      if (!observed.ok) break;
      accept(observed.value);
      const last = observed.value.attempts.at(-1);
      if (!last || !['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(last.state) || observed.value.verdict !== 'PENDING') break;
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  }); }
  return <Context.Provider value={{ available, executionEnabled, record, busy, signing, error, retired, recovered, price,
    simulate, refresh, review, execute, observe, switchNetwork, fetchPrice }}>
    {signing && <p role="status">Confirm or reject the pending request in your wallet.</p>}
    <div inert={signing} data-uniswap-wallet-pending={signing ? 'true' : undefined}>{children}</div></Context.Provider>;
}
export function useUniswapLiquidity() { const value = useContext(Context); if (!value) throw new Error('UNISWAP_LIQUIDITY_PROVIDER_MISSING'); return value; }
