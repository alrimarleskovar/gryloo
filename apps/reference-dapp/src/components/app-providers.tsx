// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { CowProvider } from '../state/cow-store';
import { ModeAProvider } from '../state/mode-a-store';
import { WorkflowProvider } from '../state/workflow-store';
import { LiquidityProvider } from '../state/liquidity-store';
import { BridgeProvider } from '../state/bridge-store';
import { Build009WalletProvider } from '../state/build009-wallet-store';
import { BridgeSwapProvider } from '../state/bridge-swap-store';
import { AcrossProvider } from '../state/across-store';
import { PublicTestnetProvider } from '../state/public-testnet-store';
import { LendingProvider } from '../state/lending-store';
import { SupplyProvider } from '../state/supply-store';
import { RobinhoodTransferProvider } from '../state/robinhood-transfer-store';
import { JupiterProvider } from '../state/jupiter-store';
import { SolanaLiquidityProvider } from '../state/solana-liquidity-store';
import { UniswapLiquidityProvider } from '../state/uniswap-liquidity-store';
import { RouterProvider } from '../state/router-store';

const initialContext = {
  registryId: referenceRegistry.registryId,
  capabilityId: referenceRegistry.capabilities[0]!.id,
  actionId: referenceRegistry.actions[0]!.id,
  assets: baseAssetRegistry,
};
/**
 * Every store of the FloFi app, in the order the flows depend on them. BUILD-MCP-002: shared by `/` and `/approve`, so an external
 * proposal is executed by exactly the same workflow store, flow stores and panels as anything authored in FloFi itself.
 * The local-fork Mode A boundary is a separate provider; the mocked chain and Base observation never reach it.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <WorkflowProvider initialContext={initialContext}><BridgeProvider><Build009WalletProvider><PublicTestnetProvider><SupplyProvider><LendingProvider><RobinhoodTransferProvider><JupiterProvider><AcrossProvider><BridgeSwapProvider><ModeAProvider><CowProvider><LiquidityProvider><SolanaLiquidityProvider><UniswapLiquidityProvider><RouterProvider>{children}</RouterProvider></UniswapLiquidityProvider></SolanaLiquidityProvider></LiquidityProvider></CowProvider></ModeAProvider></BridgeSwapProvider></AcrossProvider></JupiterProvider></RobinhoodTransferProvider></LendingProvider></SupplyProvider></PublicTestnetProvider></Build009WalletProvider></BridgeProvider></WorkflowProvider>;
}
