// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useTempo } from './tempo-store';
import { isTempoNode } from '../domain/tempo-authoring';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { JUPITER_SOLANA_MAINNET, ORCA_WHIRLPOOLS_DEVNET, resolveWorkflowCapability, solanaSwapRuntime, type ExecutionEnvironment } from '@defi-workflow-engine/action-registry';
import { chainStatus } from '../domain/artifact-chain';
import { useWorkflow } from './workflow-store';
import { useModeA } from './mode-a-store';
import { useModeB } from './mode-b-store';
import { useComposition } from './composition-store';
import { useLiquidity } from './liquidity-store';
import { useBuild009Wallet } from './build009-wallet-store';
import { useCow } from './cow-store';
import { usePublicTestnet } from './public-testnet-store';
import { walletChainRef } from '../wallet/evm-networks';

import {isLendingComposition} from '@defi-workflow-engine/workflow-contracts';
import {useLending} from './lending-store';
import { useSupply } from './supply-store';
import { useRobinhoodTransfer } from './robinhood-transfer-store';
import { useJupiter } from './jupiter-store';
import { useSolanaLiquidity } from './solana-liquidity-store';

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
  const testnetSwap = workflow.nodes.some(node => ['supply','borrow','repay','withdraw','asset.transfer'].includes(node.actionType) || node.actionType === 'asset.swap.exact-input' && node.chainId === 'eip155:84532');
  const solanaSwap = workflow.nodes.find(node => node.actionType === 'asset.swap.exact-input' && node.chainId.startsWith('solana:'));
  // The Solana runtime's environment: mainnet-beta (Jupiter) is MAINNET; Devnet (Orca, test tokens) is a public test network.
  const solanaPosition = workflow.nodes.some(node => node.actionType === 'asset.liquidity.concentrated' && node.chainId === ORCA_WHIRLPOOLS_DEVNET.chain);
  const solanaEnvironment = solanaSwap ? solanaSwapRuntime(solanaSwap.chainId)?.environment ?? 'MAINNET' : solanaPosition ? 'PUBLIC_TESTNET' : null;
  const environment: ExecutionEnvironment = selection.selected ?? (solanaEnvironment ?? (testnetSwap ? 'PUBLIC_TESTNET' : forkPrepared ? 'LOCAL_FORK' : 'MOCK'));
  return { environment, selectEnvironment: selection.select };
}
export function useWorkflowCapability() {
  const { state, chain } = useWorkflow();
  const { environment, selectEnvironment } = useExecutionEnvironment();
  const modeA = useModeA(), modeB = useModeB(), liquidity = useLiquidity(), composition = useComposition();
  const lending=useLending(),lendingPath=isLendingComposition(state.workflow);
  const supply = useSupply(), supplyPath = state.workflow.nodes.some(n => ['supply','borrow','repay','withdraw'].includes(n.actionType));
  const tempo = useTempo(), tempoPath = state.workflow.nodes.some(isTempoNode);
  const transfer = useRobinhoodTransfer(), transferPath = state.workflow.nodes.some(n => n.actionType === 'asset.transfer' && !isTempoNode(n));
  const jupiter = useJupiter(), orca = useSolanaLiquidity();
  const positionPath = state.workflow.nodes.some(n => n.actionType === 'asset.liquidity.concentrated' && n.chainId === ORCA_WHIRLPOOLS_DEVNET.chain);
  const solanaPath = positionPath || state.workflow.nodes.some(n => n.actionType === 'asset.swap.exact-input' && n.chainId.startsWith('solana:'));
  // The Solana liquidity flow has its own reviewed record; the wallet session is shared with the Solana swap.
  const solanaRecord = positionPath ? orca.record : jupiter.record, solanaRetired = positionPath ? orca.retired : jupiter.retired;
  const cow = useCow(), wallet = useBuild009Wallet(), publicTestnet = usePublicTestnet();
  const forkAvailable = Boolean(modeA.info?.available || modeB.info?.available || liquidity.info?.available || composition.info?.available);
  const forkEvidence = modeA.info?.available ? modeA.info.environment : liquidity.info?.available ? liquidity.info.environment :
    composition.info?.available ? composition.info.environment ?? 'MOCKED' : 'FORK_REPRODUCED';
  const selectedForkWallet = modeA.wallet ?? modeB.wallet ?? liquidity.wallet ?? composition.wallet;
  const walletConnected = solanaPath ? Boolean(jupiter.owner) : environment === 'LOCAL_FORK' ? Boolean(selectedForkWallet) :
    state.workflow.nodes.some(node => node.adapterConstraints.protocols.includes('cow-protocol')) ? Boolean(cow.wallet) : Boolean(wallet.account);
  const walletChainId = solanaPath ? jupiter.owner ? jupiter.network === 'Solana Devnet' ? ORCA_WHIRLPOOLS_DEVNET.chain : JUPITER_SOLANA_MAINNET.chain : null : environment === 'LOCAL_FORK' ? selectedForkWallet ? 'eip155:31337' : null :
    cow.wallet ? 'eip155:8453' : walletChainRef(wallet.chainId);
  const status = chainStatus(chain);
  const artifacts = tempoPath ? tempo.retired ? 'STALE' : tempo.record ? 'CURRENT' : 'MISSING' : transferPath ? transfer.retired ? 'STALE' : transfer.record ? 'CURRENT' : 'MISSING' : lendingPath ? lending.retired?'STALE':lending.record?'CURRENT':'MISSING' : solanaPath ? solanaRetired ? 'STALE' : solanaRecord ? 'CURRENT' : 'MISSING' : supplyPath ? supply.retired ? 'STALE' : supply.record ? 'CURRENT' : 'MISSING' : environment === 'PUBLIC_TESTNET' ? (publicTestnet.retired ? 'STALE' : publicTestnet.run ? 'CURRENT' : 'MISSING') :
    modeA.retired || liquidity.retired || modeB.retired || status === 'INVALIDATED' || status === 'EXPIRED'
    ? 'STALE' : modeA.prepared || liquidity.prepared || modeB.status?.prepared || status === 'CURRENT' ? 'CURRENT' : 'MISSING';
  const simulationReady = tempoPath ? Boolean(tempo.record && !tempo.retired) : transferPath ? Boolean(transfer.record && !transfer.retired) : lendingPath ? Boolean(lending.record&&!lending.retired) : solanaPath ? Boolean(solanaRecord && !solanaRetired) : supplyPath ? Boolean(supply.record && !supply.retired) : environment === 'PUBLIC_TESTNET' ? Boolean(publicTestnet.run && !publicTestnet.retired) :
    Boolean(modeA.prepared || liquidity.prepared || modeB.status?.prepared || composition.status?.prepared || status === 'CURRENT');
  const authorizationReady = tempoPath ? Boolean(tempo.record?.authorization && !tempo.retired) : transferPath ? Boolean(transfer.record?.authorization && !transfer.retired) : lendingPath ? Boolean(lending.record?.authorization&&!lending.retired) : solanaPath ? Boolean(solanaRecord?.authorization && !solanaRetired) : supplyPath ? Boolean(supply.record?.authorization && !supply.retired) : environment === 'PUBLIC_TESTNET' ? Boolean(publicTestnet.run?.reviewedManifestHash) :
    Boolean(modeA.reviewAccepted || liquidity.reviewAccepted || modeB.reviewed);
  const result = useMemo(() => resolveWorkflowCapability(state.workflow, { environment, runtime: {
    lendingCompositionViable:lendingPath&&Boolean(lending.record&&!lending.retired&&!lending.error),forkAvailable, forkEvidence, ...(environment === 'PUBLIC_TESTNET' ? { quoteProviderAvailable: tempoPath || transferPath || supplyPath || solanaPath ? true : publicTestnet.available } : {}), walletConnected, walletChainId, artifacts, simulationReady, authorizationReady,
  } }), [state.workflow, environment, forkAvailable, forkEvidence, walletConnected, walletChainId, artifacts, simulationReady, authorizationReady, publicTestnet.available, tempoPath, supplyPath,transferPath,transfer.record,transfer.retired,lendingPath,lending.record,lending.retired,lending.error]);
  return { environment, selectEnvironment, result };
}
