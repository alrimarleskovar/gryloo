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

import { SupplyProvider } from '../state/supply-store';

const initialContext = {
  registryId: referenceRegistry.registryId,
  capabilityId: referenceRegistry.capabilities[0]!.id,
  actionId: referenceRegistry.actions[0]!.id,
  assets: baseAssetRegistry,
};
// The local-fork Mode A boundary is a separate provider; the mocked chain and Base observation never reach it.
export default function Page() { return <WorkflowProvider initialContext={initialContext}><BridgeProvider><Build009WalletProvider><PublicTestnetProvider><SupplyProvider><AcrossProvider><BridgeSwapProvider><ModeAProvider><CowProvider><LiquidityProvider><AppShell/></LiquidityProvider></CowProvider></ModeAProvider></BridgeSwapProvider></AcrossProvider></SupplyProvider></PublicTestnetProvider></Build009WalletProvider></BridgeProvider></WorkflowProvider>; }
