// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { build009BridgeQuote, build009DestinationQuote } from '../app/build009-action';
import { useWorkflow } from './workflow-store';
import { ARBITRUM_USDC, ARBITRUM_WETH } from '../domain/bridge-swap-authoring';
import { useBuild009Wallet, BASE_HEX, ARBITRUM_HEX } from './build009-wallet-store';
import { advanceMockedBridge, authorizeBridge, authorizeSwap, manifestHash, newBuild009Run, quoteDestination,
  reconcileMockedDestination, reconcileMockedSwap, recheckMockedSource, recheckMockedSwap, submitMockedSource,
  submitMockedSwap, validateRecoveredRun, type Build009Run } from '../domain/build009-run';
const KEY = 'gryloo.build009.mocked.v1';
type Store = { readonly run: Build009Run | null; readonly recovered: boolean; readonly busy: boolean;
  readonly error: string | null; readonly uncertain: boolean; setUncertain(value: boolean): void;
  quoteBridge(): void; authorizeBridge(): void; submitSource(): void; recheckSource(): void;
  advanceBridge(): void; reconcileBridge(): void; quoteSwap(): void; authorizeSwap(): void;
  submitSwap(): void; recheckSwap(): void; reconcileSwap(): void; clear(): void };
const Context = createContext<Store | null>(null);
export function BridgeSwapProvider({ children }: { children: ReactNode }) {
  const { state } = useWorkflow(); const wallet = useBuild009Wallet();
  const [run, setRun] = useState<Build009Run | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false); const lock = useRef(false);
  const previousWalletRevision = useRef(wallet.revision);
  const activeWalletRevision = useRef(wallet.revision);
  activeWalletRevision.current = wallet.revision;
  useEffect(() => {
    try { const saved = localStorage.getItem(KEY); if (saved) { setRun(validateRecoveredRun(JSON.parse(saved))); setRecovered(true); } }
    catch { localStorage.removeItem(KEY); setError('Saved MOCKED journal was invalid and was cleared'); }
    setHydrated(true);
  }, []);
  useEffect(() => { if (!hydrated) return; if (run) localStorage.setItem(KEY, JSON.stringify(run)); else localStorage.removeItem(KEY); }, [run, hydrated]);
  useEffect(() => {
    if (wallet.revision === previousWalletRevision.current) return;
    previousWalletRevision.current = wallet.revision;
    setRun(current => {
      if (!current) return null;
      if (current.state === 'BRIDGE_QUOTED' || current.state === 'BRIDGE_AUTHORIZED') return null;
      if (current.state === 'SWAP_QUOTED' || current.state === 'SWAP_AUTHORIZED')
        return { ...current, state: 'PARTIAL_COMPLETION', swap: null, swapManifestHash: null,
          events: [...current.events, { sequence: current.events.length, state: 'PARTIAL_COMPLETION',
            at: new Date().toISOString(), note: 'Wallet account or chain changed; destination quote and authority retired' }] };
      return current;
    });
  }, [wallet.revision]);
  const work = useCallback((action: () => Promise<void> | void) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null);
    Promise.resolve().then(action).catch(cause => setError(cause instanceof Error ? cause.message : 'BUILD009_ERROR'))
      .finally(() => { lock.current = false; setBusy(false); });
  }, []);
  const requireWallet = (chain: string, owner?: string) => {
    if (!wallet.account || wallet.chainId !== chain || (owner && wallet.account !== owner)) throw new Error('BUILD009_WALLET_OR_CHAIN_REQUIRED');
    return wallet.account;
  };
  const current = () => { if (!run) throw new Error('BUILD009_RUN_MISSING'); return run; };
  const quoteBridge = () => work(async () => {
    const owner = requireWallet(BASE_HEX);
    const walletRevision = wallet.revision;
    const workflow = JSON.parse(JSON.stringify(state.workflow)) as SemanticWorkflow;
    if (workflow.nodes.length !== 2 || workflow.nodes[0]?.nodeId !== 'build009-bridge') throw new Error('BUILD009_WORKFLOW_REQUIRED');
    const quote = await build009BridgeQuote(workflow, owner);
    if (activeWalletRevision.current !== walletRevision) throw new Error('BUILD009_WALLET_CHANGED_DURING_QUOTE');
    const hash = await manifestHash({ workflow, owner, quote, scope: 'MOCKED_BRIDGE_ONLY' });
    if (activeWalletRevision.current !== walletRevision) throw new Error('BUILD009_WALLET_CHANGED_DURING_QUOTE');
    setRun(newBuild009Run(workflow, owner, quote, hash)); setRecovered(false);
  });
  const authorizeB = () => work(() => { const item = current(); if (recovered) throw new Error('BUILD009_RECOVERY_ONLY');
    setRun(authorizeBridge(item, requireWallet(BASE_HEX, item.owner), item.bridgeManifestHash)); });
  const submitSource = () => work(() => { const item = current(); if (recovered) throw new Error('BUILD009_RECOVERY_ONLY');
    requireWallet(BASE_HEX, item.owner); setRun(submitMockedSource(item, uncertain)); });
  const recheckSource = () => work(() => setRun(recheckMockedSource(current())));
  const advanceBridge = () => work(() => setRun(advanceMockedBridge(current())));
  const reconcileBridge = () => work(() => { const item = current();
    setRun(reconcileMockedDestination(item, { owner: item.owner, token: ARBITRUM_USDC, chainId: 42161,
      sourceHash: item.sourceHash ?? '', destinationHash: item.destinationHash ?? '',
      before: item.destinationObservation?.before ?? '', after: item.destinationObservation?.after ?? '' })); });
  const quoteSwap = () => work(async () => { const item = current(); requireWallet(ARBITRUM_HEX, item.owner);
    const walletRevision = wallet.revision;
    if (!item.received) throw new Error('BUILD009_DESTINATION_NOT_RECONCILED');
    const quote = await build009DestinationQuote(item.workflow, item.owner, item.received);
    if (activeWalletRevision.current !== walletRevision) throw new Error('BUILD009_WALLET_CHANGED_DURING_QUOTE');
    const hash = await manifestHash({ workflow: item.workflow, owner: item.owner, received: item.received,
      bridgeManifestHash: item.bridgeManifestHash, quote, scope: 'MOCKED_DESTINATION_SWAP_ONLY' });
    if (activeWalletRevision.current !== walletRevision) throw new Error('BUILD009_WALLET_CHANGED_DURING_QUOTE');
    setRun(quoteDestination(item, quote, hash)); });
  const authorizeS = () => work(() => { const item = current();
    setRun(authorizeSwap(item, requireWallet(ARBITRUM_HEX, item.owner), item.swapManifestHash ?? '')); });
  const submitSwap = () => work(() => { const item = current(); requireWallet(ARBITRUM_HEX, item.owner);
    setRun(submitMockedSwap(item, uncertain)); });
  const recheckSwap = () => work(() => setRun(recheckMockedSwap(current())));
  const reconcileSwap = () => work(() => { const item = current();
    setRun(reconcileMockedSwap(item, { owner: item.owner, token: ARBITRUM_WETH, chainId: 42161,
      swapHash: item.swapHash ?? '', before: '0', after: item.swap?.minimumOut ?? '0' })); });
  const clear = () => { setRun(null); setRecovered(false); setError(null); };
  return <Context.Provider value={{ run, recovered, busy, error, uncertain, setUncertain, quoteBridge,
    authorizeBridge: authorizeB, submitSource, recheckSource, advanceBridge, reconcileBridge, quoteSwap,
    authorizeSwap: authorizeS, submitSwap, recheckSwap, reconcileSwap, clear }}>{children}</Context.Provider>;
}
export function useBridgeSwap(): Store { const value = useContext(Context); if (!value) throw new Error('BRIDGE_SWAP_PROVIDER_MISSING'); return value; }
