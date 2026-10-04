// SPDX-License-Identifier: AGPL-3.0-only
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { AppShell } from '../components/app-shell';
import { CowProvider } from '../state/cow-store';
import { ModeAProvider } from '../state/mode-a-store';
import { WorkflowProvider } from '../state/workflow-store';
import { LiquidityProvider } from '../state/liquidity-store';
import { BridgeProvider } from '../state/bridge-store';
import { Build009WalletProvider } from '../state/build009-wallet-store';
import { BridgeSwapProvider } from '../state/bridge-swap-store';
import { AcrossProvider } from '../state/across-store';
import { PublicTestnetProvider } from '../state/public-testnet-store';

import {LendingProvider} from '../state/lending-store';
import { SupplyProvider } from '../state/supply-store';
import { RobinhoodTransferProvider } from '../state/robinhood-transfer-store';
import { JupiterProvider } from '../state/jupiter-store';
import { SolanaLiquidityProvider } from '../state/solana-liquidity-store';
import { UniswapLiquidityProvider } from '../state/uniswap-liquidity-store';

const initialContext = {
  registryId: referenceRegistry.registryId,
  capabilityId: referenceRegistry.capabilities[0]!.id,
  actionId: referenceRegistry.actions[0]!.id,
  assets: baseAssetRegistry,
};
// Serverless deployments (BUILD-CLOUD-001): forwarded server actions may wait on paced public RPC reads in the API.
export const maxDuration = 300;
// The local-fork Mode A boundary is a separate provider; the mocked chain and Base observation never reach it.
export default function Page() { return <WorkflowProvider initialContext={initialContext}><BridgeProvider><Build009WalletProvider><PublicTestnetProvider><SupplyProvider><LendingProvider><RobinhoodTransferProvider><JupiterProvider><AcrossProvider><BridgeSwapProvider><ModeAProvider><CowProvider><LiquidityProvider><SolanaLiquidityProvider><UniswapLiquidityProvider><AppShell/></UniswapLiquidityProvider></SolanaLiquidityProvider></LiquidityProvider></CowProvider></ModeAProvider></BridgeSwapProvider></AcrossProvider></JupiterProvider></RobinhoodTransferProvider></LendingProvider></SupplyProvider></PublicTestnetProvider></Build009WalletProvider></BridgeProvider></WorkflowProvider>; }
