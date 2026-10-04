// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { useWorkflow } from './workflow-store';
import { injected, useBuild009Wallet } from './build009-wallet-store';
import { crossChainRouterMode, routerBegin, routerHandoff, routerInfo, routerInvalidate, routerObserve, routerRefresh, routerReport, routerReview, routerRuns,
  routerSimulate, routerStatus, routerWalletFailure, type RouterRunSummary } from '../app/router-action';
import { walletSessionStatus, walletSignIn, walletSignInChallenge, walletSignOut } from '../app/wallet-session-action';
import { ROUTER_NETWORK_OPTIONS, routerNetworkOf, type RouterNetwork } from '../domain/router-authoring';
import type { RouterRecord, RouterWalletDiagnostic } from '../server/router-service';
import type { WalletSession } from '../server/wallet-session';

/**
 * BUILD-ROUTER-001 browser state for the Cross-chain Router. The server-held run is authoritative; this store only
 * keeps a pointer (run id, owner and the last wallet hash) so a reload resumes observation. The only submission point is
 * the owner's Execute click, after a durable handoff and fresh account/chain/nonce checks.
 * BUILD-JOURNEY-001: the network follows the authored bridge (mainnet or testnet). Every call runs as the signed-in wallet
 * session (one EIP-4361 signature; no transaction); the signed-in wallet's runs are listed from the server, so any browser
 * can recover them. When the connected account changes, an unused authorization of the previous account is cleared and
 * that session ends: another wallet never sees, authorizes or resumes the run.
 */
const KEY: Readonly<Record<RouterNetwork, string>> = { mainnet: 'flofi:crosschain-router:run', testnet: 'flofi:crosschain-router-testnet:run' };
const REFUSALS = [4001, 4100, 4200];
const ACTIVE = ['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'];
type Pointer = { id: string; owner?: string; hash?: string };
type Store = { network: RouterNetwork; available: boolean; availability: Readonly<Record<RouterNetwork, boolean>>; executionEnabled: boolean; record: RouterRecord | null;
  busy: boolean; signing: boolean; error: string | null; retired: boolean; recovered: boolean; session: WalletSession | null; sessionReady: boolean;
  runs: readonly RouterRunSummary[]; notice: string | null;
  simulate(): Promise<void>; refresh(): Promise<void>; review(): Promise<void>; execute(): Promise<void>; observe(): Promise<void>; switchNetwork(): Promise<void>;
  signIn(): Promise<void>; signOut(): Promise<void>; open(runId: string): Promise<void>; loadRuns(): Promise<void> };
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
const utf8Hex = (text: string) => '0x' + Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('');
/** The network a stored run belongs to (its reviewed source chain). */
const networkOfRecord = (record: RouterRecord): RouterNetwork =>
  record.review.intent.sourceChain === ROUTER_NETWORK_OPTIONS.testnet.pair.source.chainId ? 'testnet' : 'mainnet';
function readPointer(network: RouterNetwork): Pointer | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY[network]) ?? 'null') as Pointer | null;
    return value && typeof value.id === 'string' && /^xroute-[a-f0-9]{32}$/.test(value.id) ? value : null;
  } catch { return null; }
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow(), wallet = useBuild009Wallet();
  const [record, setRecord] = useState<RouterRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false), [executionEnabled, setExecutionEnabled] = useState(false);
  const [availability, setAvailability] = useState<Record<RouterNetwork, boolean>>({ mainnet: false, testnet: false });
  const [recovered, setRecovered] = useState(false), [session, setSession] = useState<WalletSession | null>(null), [sessionReady, setSessionReady] = useState(false);
  const [runs, setRuns] = useState<readonly RouterRunSummary[]>([]), [notice, setNotice] = useState<string | null>(null);
  const workflow = state.workflow as unknown as SemanticWorkflow;
  // The authored bridge decides the network; a recovered run keeps its own; the journey defaults to the testnet.
  const network: RouterNetwork = routerNetworkOf(workflow) ?? (record ? networkOfRecord(record) : 'testnet');
  const profile = ROUTER_NETWORK_OPTIONS[network].profile;
  const latest = useRef(workflow); latest.current = workflow;
  const latestWallet = useRef(wallet); latestWallet.current = wallet;
  const latestSession = useRef(session); latestSession.current = session;
  const busyRef = useRef(false);
  // A recovered run stays visible on the untouched template; any other workflow change retires its Review.
  const retired = Boolean(record && JSON.stringify(record.workflow) !== JSON.stringify(workflow) &&
    !(recovered && workflow.revision === 0 && workflow.nodes.every(n => n.actionType.startsWith('mock-'))));
  function accept(value: RouterRecord) {
    // Only the signed-in wallet's run is shown; a late answer for a previous session never repaints the view.
    if (value.owner !== latestSession.current?.account) return;
    setRecord(value);
    const hash = value.attempts.at(-1)?.transactionHash;
    try { window.localStorage.setItem(KEY[networkOfRecord(value)], JSON.stringify({ id: value.id, owner: value.owner, ...hash ? { hash } : {} })); }
    catch { /* The server run remains authoritative. */ }
  }
  async function refreshRuns(net: RouterNetwork = network) {
    const listed = await routerRuns(net).catch(() => null);
    setRuns(listed?.ok ? listed.value : []);
  }
  /** Resumes a stored pointer of the signed-in wallet: a hash saved before the browser closed reaches the server first (never a wallet). */
  async function resume(current: WalletSession) {
    for (const net of ['testnet', 'mainnet'] as const) {
      const pointer = readPointer(net);
      if (!pointer || pointer.owner !== current.account) continue;
      if (typeof pointer.hash === 'string' && /^0x[0-9a-f]{64}$/.test(pointer.hash)) await routerReport(net, pointer.id, { kind: 'HASH', hash: pointer.hash }).catch(() => undefined);
      const result = await routerStatus(net, pointer.id).catch(() => null);
      if (result?.ok && latestSession.current?.account === current.account) { setRecord(result.value); setRecovered(true); return; }
    }
  }
  /**
   * Another account is connected: clear the previous account's unused authorization (the open run, or its stored pointer when the
   * switch happened while the page was closed), end that session and hide its runs. Reviews also expire on their own within minutes.
   */
  async function endStaleSession(stale: WalletSession, open: RouterRecord | null) {
    let target = open && open.owner === stale.account ? open : null;
    for (const net of ['testnet', 'mainnet'] as const) {
      if (target) break;
      const pointer = readPointer(net);
      if (pointer?.owner !== stale.account) continue;
      const result = await routerStatus(net, pointer.id).catch(() => null);
      if (result?.ok) target = result.value;
    }
    if (target && target.phase === 'AUTHORIZED' && !target.attempts.some(a => ACTIVE.includes(a.state)))
      await routerInvalidate(networkOfRecord(target), target.id, 'WALLET_CHANGED').catch(() => undefined);
    await walletSignOut().catch(() => undefined);
    latestSession.current = null; setSession(null); setRecord(null); setRecovered(false); setRuns([]); setExecutionEnabled(false);
    setNotice('ROUTER_WALLET_ACCOUNT_CHANGED');
  }
  useEffect(() => {
    let mounted = true;
    for (const net of ['mainnet', 'testnet'] as const)
      crossChainRouterMode(net).then(mode => { if (mounted) setAvailability(value => ({ ...value, [net]: mode !== 'off' })); }).catch(() => undefined);
    walletSessionStatus().then(async current => {
      if (!mounted) return;
      setSessionReady(true);
      if (!current) return;
      // Passive (no prompt): a wallet now on another account never resumes the stored session's runs.
      const connected = await wallet.session();
      if (connected && connected.account !== current.account) { await endStaleSession(current, null); return; }
      latestSession.current = current; setSession(current);
      await resume(current);
    }).catch(() => { if (mounted) setSessionReady(true); });
    return () => { mounted = false; };
  }, []);
  const available = availability[network];
  useEffect(() => {
    let mounted = true;
    setExecutionEnabled(false);
    if (available) routerInfo(network).then(info => { if (mounted && info.ok) setExecutionEnabled(info.value.executionEnabled); }).catch(() => undefined);
    if (session) void refreshRuns(network);
    return () => { mounted = false; };
  }, [available, network, session?.account]);
  useEffect(() => {
    if (record && retired && record.phase === 'AUTHORIZED')
      routerInvalidate(networkOfRecord(record), record.id).then(r => { if (r.ok) setRecord(r.value); }).catch(() => setError('ROUTER_AUTHORIZATION_INVALIDATION_FAILED'));
  }, [record, retired]);
  // A different connected account ends the previous account's session and clears its unused authorization (fail closed).
  useEffect(() => {
    const current = latestSession.current;
    if (!current || !wallet.account || wallet.account === current.account) return;
    void endStaleSession(current, record);
  }, [wallet.account, session?.account]);
  async function operation(action: () => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'ROUTER_OPERATION_FAILED'); } finally { busyRef.current = false; setBusy(false); }
  }
  async function ownerSession() {
    let current = await wallet.session(); if (!current) current = await wallet.connect();
    if (!current) throw new Error('ROUTER_WALLET_REQUIRED');
    return current;
  }
  /** One EIP-4361 `personal_sign` request; the server verifies the signer and sets the HttpOnly session. No transaction. */
  async function establishSession(): Promise<WalletSession> {
    const connected = await ownerSession();
    if (latestSession.current?.account === connected.account) return latestSession.current;
    const provider = injected(); if (!provider) throw new Error('ROUTER_WALLET_REQUIRED');
    const { message } = unwrap(await walletSignInChallenge(connected.account, Number.parseInt(connected.chainId, 16)));
    const signature = await provider.request({ method: 'personal_sign', params: [utf8Hex(message), connected.account] });
    if (typeof signature !== 'string') throw new Error('WALLET_SIGNATURE_INVALID');
    const established = unwrap(await walletSignIn(connected.account, Number.parseInt(connected.chainId, 16), signature));
    setSession(established); latestSession.current = established; setNotice(null);
    return established;
  }
  async function signIn() { await operation(async () => {
    const established = await establishSession();
    if (!record) await resume(established);
    await refreshRuns();
  }); }
  async function signOut() { await operation(async () => {
    await walletSignOut(); setSession(null); setRecord(null); setRecovered(false); setRuns([]);
  }); }
  async function open(runId: string) { await operation(async () => {
    if (!latestSession.current) throw new Error('WALLET_SESSION_REQUIRED');
    accept(unwrap(await routerStatus(network, runId))); setRecovered(true);
  }); }
  async function loadRuns() { await operation(async () => { await refreshRuns(); }); }
  async function simulate() { await operation(async () => {
    if (record && !retired && record.verdict === 'PENDING' && (record.attempts.some(a => ACTIVE.includes(a.state)) || !['PREPARED', 'AUTHORIZED'].includes(record.phase)))
      throw new Error('ROUTER_ATTEMPT_ACTIVE_OBSERVE_EXISTING');
    const owner = await establishSession(), snapshot = latest.current;
    const value = unwrap(await routerSimulate(network, snapshot, owner.account));
    if (latest.current !== snapshot) throw new Error('ROUTER_SEMANTIC_REVISION_CHANGED');
    setRecovered(false); accept(value); void refreshRuns();
  }); }
  async function refresh() { await operation(async () => { if (!record) throw new Error('ROUTER_RUN_MISSING'); accept(unwrap(await routerRefresh(networkOfRecord(record), record.id))); }); }
  async function review() { await operation(async () => {
    if (!record || retired) throw new Error('ROUTER_SIMULATION_REQUIRED');
    accept(unwrap(await routerReview(networkOfRecord(record), record.id, record.review.commitment, record.workflow)));
  }); }
  async function observe() { await operation(async () => {
    if (!record) throw new Error('ROUTER_RUN_MISSING');
    accept(unwrap(await routerObserve(networkOfRecord(record), record.id))); void refreshRuns(networkOfRecord(record));
  }); }
  async function switchNetwork() { await operation(async () => { await wallet.switchTo(profile.source.chainHex as Parameters<typeof wallet.switchTo>[0]); }); }
  /** One Execute click = one exact wallet request (the exact approval, or the bridge deposit). */
  async function execute() { await operation(async () => {
    if (!record || retired || record.phase !== 'AUTHORIZED' || record.authorization !== record.review.commitment) throw new Error('ROUTER_REVIEW_REQUIRED');
    const net = networkOfRecord(record), source = ROUTER_NETWORK_OPTIONS[net].profile.source.chainHex;
    const current = await ownerSession();
    if (current.chainId !== source) throw new Error('ROUTER_WRONG_CHAIN');
    if (current.account !== record.owner || latestSession.current?.account !== record.owner) throw new Error('ROUTER_WRONG_OWNER');
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
      if (typeof chain !== 'string' || chain.toLowerCase() !== source) throw new Error('ROUTER_WRONG_CHAIN');
      if (nonce !== null && quantity(await request('eth_getTransactionCount', [record.owner, 'pending'])) !== BigInt(nonce)) throw new Error('ROUTER_WALLET_NONCE_MISMATCH');
    };
    let prepared = false;
    try {
      await validateSession(null);
      const begun = unwrap(await routerBegin(net, id, current.account, snapshot)); accept(begun.record); prepared = true;
      const tx = begun.transaction;
      if (tx.from !== record.owner || tx.chainId !== source || tx.value !== '0x0' ||
          !record.review.calls.some(c => c.to === tx.to && c.data === tx.data)) throw new Error('ROUTER_TRANSACTION_ARTIFACT_CHANGED');
      await validateSession(begun.attempt.nonce);
      accept(unwrap(await routerHandoff(net, id)));
      if (latestWallet.current.account !== current.account || latestWallet.current.chainId !== current.chainId) throw new Error('ROUTER_WRONG_OWNER');
      // The sole submission point, reachable only from the owner's Execute click. The wallet assigns the reviewed nonce.
      setSigning(true); diagnostic.invoked = true;
      let hash: unknown;
      try { hash = await request('eth_sendTransaction', [tx]); } finally { setSigning(false); }
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('ROUTER_SUBMISSION_UNKNOWN');
      try { window.localStorage.setItem(KEY[net], JSON.stringify({ id, owner: record.owner, hash: hash.toLowerCase() })); } catch { /* Reported to the server next. */ }
      accept(unwrap(await routerReport(net, id, { kind: 'HASH', hash: hash.toLowerCase() })));
    } catch (cause) {
      const send = diagnostic.calls.find(c => c.submission), sendError = send?.error as { code?: unknown } | undefined;
      const refused = Boolean(send) && send!.result === undefined && typeof sendError?.code === 'number' && REFUSALS.includes(sendError.code);
      if (refused) diagnostic.rejectionCode = sendError!.code as number;
      diagnostic.code = refused ? 'ROUTER_REJECTED' : !diagnostic.invoked ? (cause instanceof Error && /^ROUTER_[A-Z0-9_]+$/.test(cause.message) ? cause.message : 'ROUTER_RPC_ERROR_BEFORE_WALLET_SUBMISSION') : 'ROUTER_SUBMISSION_UNKNOWN';
      if (prepared && (!diagnostic.invoked || refused)) {
        const failure = await routerWalletFailure(net, id, diagnostic); if (failure.ok) accept(failure.value);
        throw new Error(diagnostic.code, { cause });
      }
      if (diagnostic.invoked) {
        // The request may have reached the network: never resend, only observe.
        const report = await routerReport(net, id, { kind: 'UNKNOWN', code: diagnostic.code }); if (report.ok) accept(report.value);
        throw new Error('ROUTER_SUBMISSION_UNKNOWN_OBSERVE_EXISTING', { cause });
      }
      if (cause instanceof Error && /ROUTE_CHANGED|STATE_CHANGED|REVIEW_EXPIRED/.test(cause.message)) {
        const latestRun = await routerStatus(net, id); if (latestRun.ok) accept(latestRun.value);
      }
      throw cause;
    }
    for (let i = 0; i < 20; i++) {
      const observed = await routerObserve(net, id);
      if (!observed.ok) break;
      accept(observed.value);
      const last = observed.value.attempts.at(-1);
      if (!last || !['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(last.state) || observed.value.verdict !== 'PENDING') break;
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    void refreshRuns(net);
  }); }
  return <Context.Provider value={{ network, available, availability, executionEnabled, record, busy, signing, error, retired, recovered, session, sessionReady, runs, notice,
    simulate, refresh, review, execute, observe, switchNetwork, signIn, signOut, open, loadRuns }}>
    {signing && <p role="status">Confirm or reject the pending request in your wallet.</p>}
    <div inert={signing} data-router-wallet-pending={signing ? 'true' : undefined}>{children}</div></Context.Provider>;
}
export function useRouter() { const value = useContext(Context); if (!value) throw new Error('ROUTER_PROVIDER_MISSING'); return value; }
