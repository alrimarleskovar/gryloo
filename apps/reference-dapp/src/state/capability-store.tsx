// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { resolveWorkflowCapability, type ExecutionEnvironment } from '@defi-workflow-engine/action-registry';
import { chainStatus } from '../domain/artifact-chain';
import { useWorkflow } from './workflow-store';
import { useModeA } from './mode-a-store';
import { useModeB } from './mode-b-store';
import { useComposition } from './composition-store';
import { useLiquidity } from './liquidity-store';
import { useBuild009Wallet } from './build009-wallet-store';
import { useCow } from './cow-store';
import { usePublicTestnet } from './public-testnet-store';

type Selection = { readonly selected: ExecutionEnvironment | null; select(environment: ExecutionEnvironment): void };
const Context = createContext<Selection | null>(null);
export function CapabilityProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ExecutionEnvironment | null>(null);
  return <Context.Provider value={{ selected, select: setSelected }}>{children}</Context.Provider>;
}
export function useExecutionEnvironment() {
  const selection = useContext(Context);
  if (!selection) throw new Error('CAPABILITY_PROVIDER_MISSING');
  const modeA = useModeA(), modeB = useModeB(), liquidity = useLiquidity(), composition = useComposition();
  const forkPrepared = Boolean(modeA.prepared || modeB.status?.prepared || liquidity.prepared || composition.status?.prepared);
  const workflow = useWorkflow().state.workflow;
  const testnetSwap = workflow.nodes.some(node => node.actionType === 'asset.swap.exact-input' && node.chainId === 'eip155:84532');
  const environment: ExecutionEnvironment = selection.selected ?? (testnetSwap ? 'PUBLIC_TESTNET' : forkPrepared ? 'LOCAL_FORK' : 'MOCK');
  return { environment, selectEnvironment: selection.select };
}
export function useWorkflowCapability() {
  const { state, chain } = useWorkflow();
  const { environment, selectEnvironment } = useExecutionEnvironment();
  const modeA = useModeA(), modeB = useModeB(), liquidity = useLiquidity(), composition = useComposition();
  const cow = useCow(), wallet = useBuild009Wallet(), publicTestnet = usePublicTestnet();
  const forkAvailable = Boolean(modeA.info?.available || modeB.info?.available || liquidity.info?.available || composition.info?.available);
  const forkEvidence = modeA.info?.available ? modeA.info.environment : liquidity.info?.available ? liquidity.info.environment :
    composition.info?.available ? composition.info.environment ?? 'MOCKED' : 'FORK_REPRODUCED';
  const selectedForkWallet = modeA.wallet ?? modeB.wallet ?? liquidity.wallet ?? composition.wallet;
  const walletConnected = environment === 'LOCAL_FORK' ? Boolean(selectedForkWallet) :
    state.workflow.nodes.some(node => node.adapterConstraints.protocols.includes('cow-protocol')) ? Boolean(cow.wallet) : Boolean(wallet.account);
  const walletChainId = environment === 'LOCAL_FORK' ? selectedForkWallet ? 'eip155:31337' : null :
    cow.wallet ? 'eip155:8453' : wallet.chainId === '0x2105' ? 'eip155:8453' :
    wallet.chainId === '0xa4b1' ? 'eip155:42161' : wallet.chainId === '0x14a34' ? 'eip155:84532' : null;
  const status = chainStatus(chain);
  const artifacts = environment === 'PUBLIC_TESTNET' ? (publicTestnet.retired ? 'STALE' : publicTestnet.run ? 'CURRENT' : 'MISSING') :
    modeA.retired || liquidity.retired || modeB.retired || status === 'INVALIDATED' || status === 'EXPIRED'
    ? 'STALE' : modeA.prepared || liquidity.prepared || modeB.status?.prepared || status === 'CURRENT' ? 'CURRENT' : 'MISSING';
  const simulationReady = environment === 'PUBLIC_TESTNET' ? Boolean(publicTestnet.run && !publicTestnet.retired) :
    Boolean(modeA.prepared || liquidity.prepared || modeB.status?.prepared || composition.status?.prepared || status === 'CURRENT');
  const authorizationReady = environment === 'PUBLIC_TESTNET' ? Boolean(publicTestnet.run?.reviewedManifestHash) :
    Boolean(modeA.reviewAccepted || liquidity.reviewAccepted || modeB.reviewed);
  const result = useMemo(() => resolveWorkflowCapability(state.workflow, { environment, runtime: {
    forkAvailable, forkEvidence, ...(environment === 'PUBLIC_TESTNET' ? { quoteProviderAvailable: publicTestnet.available } : {}), walletConnected, walletChainId, artifacts, simulationReady, authorizationReady,
  } }), [state.workflow, environment, forkAvailable, forkEvidence, walletConnected, walletChainId, artifacts, simulationReady, authorizationReady, publicTestnet.available]);
  return { environment, selectEnvironment, result };
}
