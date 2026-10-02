// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { ORCA_WHIRLPOOLS_DEVNET } from '@defi-workflow-engine/action-registry';
import { useWorkflow } from './workflow-store';
import { connectSolanaWallet, signWithSolanaWallet, solanaWalletNames, type SolanaSession, type SolanaWalletChain } from '../wallet/solana-wallet';
import { jupiterBegin, jupiterInfo, jupiterInvalidate, jupiterObserve, jupiterReview, jupiterSimulate, jupiterStatus, jupiterSubmit, jupiterWalletFailure } from '../app/jupiter-action';
import { solanaDevnetBegin, solanaDevnetInfo, solanaDevnetInvalidate, solanaDevnetObserve, solanaDevnetReview, solanaDevnetSimulate, solanaDevnetStatus,
  solanaDevnetSubmit, solanaDevnetWalletFailure } from '../app/solana-devnet-action';
import { solanaSwapDetails, type SolanaNetwork } from '../domain/jupiter-authoring';
import { solanaLiquidityDetails } from '../domain/solana-liquidity-authoring';
import type { JupiterRecord } from '../server/jupiter-service';

/**
 * One Solana swap store for both runtimes of the canonical swap. The workflow's cluster selects the runtime:
 * Solana (mainnet-beta, Jupiter) or Solana Devnet (Orca Whirlpools). Journal, recovery and wallet handoff are shared.
 */
const key = 'gryloo:build014:jupiter';
const runtimes = {
  Solana: { prefix: 'JUPITER', idPrefix: 'jupiter', walletChain: 'solana:mainnet' as SolanaWalletChain, info: jupiterInfo, simulate: jupiterSimulate, review: jupiterReview,
    invalidate: jupiterInvalidate, begin: jupiterBegin, walletFailure: jupiterWalletFailure, submit: jupiterSubmit, observe: jupiterObserve, status: jupiterStatus },
  'Solana Devnet': { prefix: 'DEVNET_SWAP', idPrefix: 'orca', walletChain: 'solana:devnet' as SolanaWalletChain, info: solanaDevnetInfo, simulate: solanaDevnetSimulate,
    review: solanaDevnetReview, invalidate: solanaDevnetInvalidate, begin: solanaDevnetBegin, walletFailure: solanaDevnetWalletFailure, submit: solanaDevnetSubmit,
    observe: solanaDevnetObserve, status: solanaDevnetStatus },
} as const;
const networkOfRecord = (record: JupiterRecord): SolanaNetwork => record.review.chain === ORCA_WHIRLPOOLS_DEVNET.chain ? 'Solana Devnet' : 'Solana';
const networkOfId = (id: string): SolanaNetwork | null => /^jupiter-[a-f0-9]{32}$/.test(id) ? 'Solana' : /^orca-[a-f0-9]{32}$/.test(id) ? 'Solana Devnet' : null;
type Store = { record: JupiterRecord | null; owner: string | null; network: SolanaNetwork;
  /** The owner-chosen Wallet Standard session; shared with the Solana liquidity flow (one wallet experience). */
  session: SolanaSession | null; codePrefix: string; busy: boolean; error: string | null; retired: boolean; recovered: boolean;
  executionEnabled: boolean; walletChoices: string[] | null; connect(chain?: SolanaWalletChain): Promise<void>; chooseWallet(name: string): Promise<void>; cancelWalletChoice(): void;
  simulate(): Promise<void>; review(): Promise<void>; execute(): Promise<void>; observe(): Promise<void> };
const Context = createContext<Store | null>(null);
const unresolved = (record: JupiterRecord | null) => Boolean(record?.attempt && record.verdict === 'PENDING' && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(record.attempt.state));
function walletCode(cause: unknown, prefix: string): string {
  const value = cause as { code?: unknown; name?: unknown; message?: unknown } | null;
  return value && (value.code === 4001 || /reject|declin|denied|cancel/i.test(String(value.name ?? '') + String(value.message ?? ''))) ? `${prefix}_WALLET_REJECTED` : `${prefix}_WALLET_SIGN_FAILED`;
}
const bounded = (cause: unknown) => { try { const v = cause as Record<string, unknown>; return { name: String(v?.name ?? ''), code: typeof v?.code === 'number' ? v.code : null, message: String(v?.message ?? cause).slice(0, 500) }; } catch { return { message: 'unreadable' }; } };

export function JupiterProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow();
  const [record, setRecord] = useState<JupiterRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false), [signing, setSigning] = useState(false), [session, setSession] = useState<SolanaSession | null>(null);
  const [walletChoices, setWalletChoices] = useState<string[] | null>(null), [choiceChain, setChoiceChain] = useState<SolanaWalletChain | null>(null);
  const [enabled, setEnabled] = useState<Record<SolanaNetwork, boolean>>({ Solana: false, 'Solana Devnet': false });
  const workflow = state.workflow as unknown as SemanticWorkflow;
  const latest = useRef(workflow); latest.current = workflow;
  const busyRef = useRef(false);
  const authored = workflow.nodes.map(node => solanaSwapDetails(node)).find(Boolean) ?? null;
  // A Solana Devnet liquidity position uses the same Devnet wallet session as the Devnet swap.
  const network: SolanaNetwork = authored?.network ?? (workflow.nodes.some(node => solanaLiquidityDetails(node)) ? 'Solana Devnet' : record ? networkOfRecord(record) : 'Solana');
  const runtime = runtimes[network];
  const pristineRecovery = recovered && workflow.revision === 0 && workflow.nodes.length === 1 && workflow.nodes[0]?.actionType === 'mock-read';
  const retired = Boolean(record && JSON.stringify(record.review.workflow) !== JSON.stringify(workflow) && !pristineRecovery);
  function accept(value: JupiterRecord) { setRecord(value); try { window.localStorage.setItem(key, JSON.stringify({ id: value.id })); } catch { /* server journal remains authoritative */ } }
  useEffect(() => {
    let mounted = true;
    for (const name of ['Solana', 'Solana Devnet'] as const)
      runtimes[name].info().then(result => { if (mounted && result.ok) setEnabled(current => ({ ...current, [name]: result.value.executionEnabled })); }).catch(() => undefined);
    try {
      const pointer = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { id?: unknown } | null;
      const recoveredNetwork = pointer && typeof pointer.id === 'string' ? networkOfId(pointer.id) : null;
      if (recoveredNetwork && typeof pointer?.id === 'string')
        runtimes[recoveredNetwork].status(pointer.id).then(result => { if (mounted && result.ok) { setRecord(result.value); setRecovered(true); } }).catch(() => undefined);
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
  useEffect(() => { if (record && retired && record.authorization) runtimes[networkOfRecord(record)].invalidate(record.id).then(result => { if (result.ok) setRecord(result.value); })
    .catch(() => setError(`${runtimes[networkOfRecord(record)].prefix}_AUTHORIZATION_INVALIDATION_FAILED`)); }, [record, retired]);
  async function operation(action: () => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : `${runtime.prefix}_OPERATION_FAILED`); } finally { busyRef.current = false; setBusy(false); }
  }
  // Only an owner-chosen wallet session on the current cluster is used; nothing connects implicitly.
  async function ensureSession(): Promise<SolanaSession> {
    if (session && session.chain === runtime.walletChain) return session;
    throw new Error(`${runtime.prefix}_SOLANA_WALLET_SELECTION_REQUIRED`);
  }
  /** List the Wallet Standard wallets compatible with the current cluster; the owner picks one, even if it is the only one. */
  /** `chain` lets another Solana flow on the same session (BUILD-015 Devnet liquidity) ask for its own cluster explicitly. */
  async function connect(chain: SolanaWalletChain = runtime.walletChain) { await operation(async () => {
    const names = solanaWalletNames(chain);
    if (!names.length) throw new Error(`${runtime.prefix}_SOLANA_WALLET_REQUIRED`);
    setChoiceChain(chain); setWalletChoices(names);
  }); }
  async function chooseWallet(name: string) { await operation(async () => {
    const next = await connectSolanaWallet(name, choiceChain ?? runtime.walletChain, runtime.prefix);
    setSession(next); setWalletChoices(null); setChoiceChain(null);
  }); }
  function cancelWalletChoice() { setWalletChoices(null); setChoiceChain(null); }
  async function poll(id: string) {
    const api = runtimes[networkOfId(id) ?? network];
    for (let i = 0; i < 30; i++) {
      const observed = await api.observe(id); if (!observed.ok) throw new Error(observed.code);
      accept(observed.value);
      if (!unresolved(observed.value)) return;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  async function simulate() { await operation(async () => {
    if (unresolved(record)) throw new Error(`${runtime.prefix}_EXISTING_ATTEMPT_OBSERVE_ONLY`);
    const owner = (await ensureSession()).account.address, snapshot = latest.current;
    const result = await runtime.simulate(snapshot, owner); if (!result.ok) throw new Error(result.code);
    if (latest.current !== snapshot) throw new Error(`${runtime.prefix}_SEMANTIC_REVISION_CHANGED`);
    accept(result.value); setRecovered(false);
  }); }
  async function review() { await operation(async () => {
    if (!record || retired) throw new Error(`${runtime.prefix}_SIMULATION_REQUIRED`);
    const result = await runtimes[networkOfRecord(record)].review(record.id, record.review.commitment, latest.current); if (!result.ok) throw new Error(result.code);
    accept(result.value);
  }); }
  async function execute() { await operation(async () => {
    if (!record || retired || record.authorization !== record.review.commitment) throw new Error(`${runtime.prefix}_REVIEW_REQUIRED`);
    const api = runtimes[networkOfRecord(record)];
    const current = await ensureSession();
    if (current.account.address !== record.review.owner) throw new Error(`${api.prefix}_WRONG_OWNER`);
    // The wallet session must be on the reviewed cluster before any durable attempt exists.
    if (current.chain !== api.walletChain) throw new Error(`${api.prefix}_WRONG_CLUSTER`);
    const snapshot = latest.current;
    const begin = await api.begin(record.id, current.account.address, snapshot); if (!begin.ok) throw new Error(begin.code);
    accept(begin.value.record);
    let signed: string;
    setSigning(true);
    try {
      if (begin.value.walletChain !== current.chain) throw new Error(`${api.prefix}_WRONG_CLUSTER`);
      if (JSON.stringify(latest.current) !== JSON.stringify(snapshot)) throw new Error(`${api.prefix}_SEMANTIC_REVISION_CHANGED`);
      // The sole owner-signature request, reachable only from the owner's Execute click.
      signed = await signWithSolanaWallet(current, begin.value.unsignedTransaction, api.prefix);
    } catch (cause) {
      const failure = cause instanceof Error && new RegExp(`^${api.prefix}_[A-Z_]+$`).test(cause.message) ? cause.message : walletCode(cause, api.prefix);
      const recorded = await api.walletFailure(record.id, { stage: 'SIGN', code: failure, error: bounded(cause) });
      if (recorded.ok) accept(recorded.value);
      throw new Error(failure, { cause });
    } finally { setSigning(false); }
    const submitted = await api.submit(record.id, signed); if (!submitted.ok) throw new Error(submitted.code);
    accept(submitted.value);
    if (submitted.value.attempt?.signature) await poll(record.id);
  }); }
  async function observe() { await operation(async () => { if (!record) throw new Error(`${runtime.prefix}_RUN_MISSING`); await poll(record.id); }); }
  return <Context.Provider value={{ record, owner: session && session.chain === runtime.walletChain ? session.account.address : null, network, session, codePrefix: runtime.prefix,
    busy, error, retired, recovered, executionEnabled: enabled[network], walletChoices, connect, chooseWallet, cancelWalletChoice, simulate, review, execute, observe }}>
    {signing && <p role="status">Confirm or reject the pending request in your Solana wallet.</p>}
    <div inert={signing} data-jupiter-wallet-pending={signing ? 'true' : undefined}>{children}</div></Context.Provider>;
}
export function useJupiter() { const value = useContext(Context); if (!value) throw new Error('JUPITER_PROVIDER_MISSING'); return value; }
export const useSolanaSwap = useJupiter;
