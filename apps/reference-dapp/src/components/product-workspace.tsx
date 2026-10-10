// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { AppShell } from './app-shell';
import { ApprovalHandoff } from './approval-handoff';
import { ChannelProgressPing } from './channel-progress-ping';
import { WorkflowProvider } from '../state/workflow-store';
import { BridgeProvider } from '../state/bridge-store';
import { Build009WalletProvider } from '../state/build009-wallet-store';
import { WalletSelectorProvider } from './wallet-selector';
import { PublicTestnetProvider } from '../state/public-testnet-store';
import { SupplyProvider } from '../state/supply-store';
import { LendingProvider } from '../state/lending-store';
import { RobinhoodTransferProvider } from '../state/robinhood-transfer-store';
import { JupiterProvider } from '../state/jupiter-store';
import { AcrossProvider } from '../state/across-store';
import { BridgeSwapProvider } from '../state/bridge-swap-store';
import { ModeAProvider } from '../state/mode-a-store';
import { CowProvider } from '../state/cow-store';
import { LiquidityProvider } from '../state/liquidity-store';
import { SolanaLiquidityProvider } from '../state/solana-liquidity-store';
import { UniswapLiquidityProvider } from '../state/uniswap-liquidity-store';
import { EngineeringProbe } from '../test-utils/engineering-probe';
import { RouterProvider } from '../state/router-store';

const initialContext = { registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]!.id,
  actionId: referenceRegistry.actions[0]!.id, assets: baseAssetRegistry };
/** The existing provider hierarchy is shared by all product routes, keeping current runs mounted. */
export function ProductWorkspace({ initialWorkflowId, engineeringEnabled = false }: { initialWorkflowId: string; engineeringEnabled?: boolean }) {
  const pathname = usePathname(), router = useRouter();
  const [approvalAvailable, setApprovalAvailable] = useState(false);
  const [simulationRequest, setSimulationRequest] = useState(0);
  // MCP account management owns its page; approval exposes the existing product
  // only after the server resolves a usable handoff. Product routes keep AppShell unchanged.
  const showWorkspace = pathname !== '/connections' && (pathname !== '/approve' || approvalAvailable);
  return <WalletSelectorProvider><WorkflowProvider initialContext={initialContext} initialWorkflowId={initialWorkflowId}><BridgeProvider><Build009WalletProvider><PublicTestnetProvider><SupplyProvider><LendingProvider><RobinhoodTransferProvider><JupiterProvider><AcrossProvider><BridgeSwapProvider><ModeAProvider><CowProvider><LiquidityProvider><SolanaLiquidityProvider><UniswapLiquidityProvider><RouterProvider>{engineeringEnabled && <EngineeringProbe/>}{pathname === '/approve' && <><ApprovalHandoff onAvailabilityChange={setApprovalAvailable} onContinue={() => { setSimulationRequest(n => n + 1); document.getElementById("workspace")?.scrollIntoView(); }}/><ChannelProgressPing/></>}{showWorkspace && <AppShell engineering={engineeringEnabled && pathname === '/__engineering'} simulationRequest={simulationRequest} pathname={pathname} navigate={path => router.push(path)}/>}</RouterProvider></UniswapLiquidityProvider></SolanaLiquidityProvider></LiquidityProvider></CowProvider></ModeAProvider></BridgeSwapProvider></AcrossProvider></JupiterProvider></RobinhoodTransferProvider></LendingProvider></SupplyProvider></PublicTestnetProvider></Build009WalletProvider></BridgeProvider></WorkflowProvider></WalletSelectorProvider>;
}
