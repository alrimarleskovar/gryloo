// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { product } from '../config/product';
import { useModeB } from '../state/mode-b-store';
import { useModeA } from '../state/mode-a-store';
import { StatusBadge } from './status-badge';
import { useBuild009Wallet, chainName, BASE_HEX, ARBITRUM_HEX, BASE_SEPOLIA_HEX, ROBINHOOD_TESTNET_HEX } from '../state/build009-wallet-store';
import { isLendingComposition } from '@defi-workflow-engine/workflow-contracts';
import { useLending } from '../state/lending-store';
import { useBridgeSwap } from '../state/bridge-swap-store';
import { useWorkflow } from '../state/workflow-store';
import { WORKFLOW_STAGES, workflowShellContext, shellChainLabel, type WorkflowStage } from '../domain/product-shell';
import { EVM_WALLET_NETWORKS } from '../wallet/evm-networks';
import { useRouter } from '../state/router-store';
import { ROUTER_NETWORK_OPTIONS } from '../domain/router-authoring';
import { useJupiter } from '../state/jupiter-store';
import Image from 'next/image';

export type Tab = WorkflowStage;
export function TopBar({ tab, setTab }: { tab: Tab; setTab: (value: Tab) => void }) {
  const { info, wallet } = useModeA();
  const modeB = useModeB();
  const build009 = useBuild009Wallet();
  const bridgeSwap = useBridgeSwap();
  const workflow = useWorkflow().state.workflow;
  const context = workflowShellContext(workflow);
  const router = useRouter();
  const jupiter = useJupiter();
  const lending = useLending();
  const pristine = workflow.revision === 0 && context.mockExample;
  const lendingActive = isLendingComposition(workflow) || Boolean(pristine && lending.recovered && lending.record && !lending.retired);
  const build009Active = workflow.nodes[0]?.nodeId === 'build009-bridge' || Boolean(pristine && bridgeSwap.recovered && bridgeSwap.run);
  const destination = bridgeSwap.run && ['PARTIAL_COMPLETION','SWAP_QUOTED','SWAP_AUTHORIZED','SWAP_UNKNOWN','SWAP_SUBMITTED','SWAP_RECONCILED'].includes(bridgeSwap.run.state);
  const routerRecovery = router.recovered && router.record && pristine;
  const requiredChain = destination && build009Active ? 'eip155:42161' : context.requiredChain
    ?? (routerRecovery ? ROUTER_NETWORK_OPTIONS[router.network].pair.source.chainId : lendingActive ? 'eip155:84532'
      : pristine && jupiter.recovered && jupiter.record ? jupiter.record.review.chain : null);
  const required = EVM_WALLET_NETWORKS.find(network => network.chain === requiredChain)?.hex;
  // This is only a shortcut to existing user-driven wallet switching, never a capability or execution decision.
  const switchTarget = required === BASE_HEX || required === ARBITRUM_HEX || required === BASE_SEPOLIA_HEX || required === ROBINHOOD_TESTNET_HEX ? required : null;
  const solanaActive = requiredChain?.startsWith('solana:') || Boolean(jupiter.recovered && jupiter.record && context.mockExample);
  const fork = info?.available ? info : null;
  return <header className="top-bar">
    <div className="brand"><span className="brand-mark"><Image src="/brand/flofi-logo.png" alt="FloFi" width={1062} height={299} unoptimized/></span><small>Compose · Verify · Execute</small></div>
    <nav aria-label="Workflow stages" className="tabs">{WORKFLOW_STAGES.map((value, index) =>
      <button key={value} type="button" onClick={() => setTab(value)} aria-current={tab === value ? 'page' : undefined} className={tab === value ? 'selected' : ''}><span className="stage-number" aria-hidden="true">{index + 1}</span>{value}</button>)}</nav>
    <div className="top-meta">
      {solanaActive ? <span className="wallet-connection">{jupiter.owner ? `Solana wallet: ${jupiter.owner.slice(0, 6)}…${jupiter.owner.slice(-4)} · ${jupiter.network}` : 'Solana wallet not connected · connect in the workflow panel'}</span>
        : build009.account ? <><span className="build009-wallet-info wallet-connection" title={build009.account}>Wallet: {build009.account.slice(0, 6)}…{build009.account.slice(-4)} · {chainName(build009.chainId)}</span>
          <button type="button" onClick={build009.reset} disabled={build009.busy} title="Clear this app’s wallet connection. Wallet permissions are managed in your wallet.">Disconnect</button></>
          : <><span className="wallet-connection">Wallet not connected</span><button type="button" onClick={() => void build009.connect()} disabled={build009.busy}>Connect Wallet</button></>}
    </div>
    <div className="shell-network-row">
      {requiredChain && <span className="build009-required">Workflow network: {shellChainLabel(requiredChain)}</span>}
      {!solanaActive && build009.account && switchTarget && build009.chainId !== switchTarget && <><span className="network-mismatch" role="status">Switch networks before execution</span><button type="button" onClick={() => void build009.switchTo(switchTarget)} disabled={build009.busy}>Switch to {chainName(switchTarget)}</button></>}
      {!solanaActive && !build009.account && build009.providerError && <span role="status">{build009.providerError}</span>}
      {(fork || modeB.info?.available) && <details className="shell-technical"><summary>Technical connection details</summary><div>
        {fork && <span className="fork-badge"><StatusBadge label={`Local fork · ${fork.environment}`} tone="warning"/></span>}
        {modeB.info?.available && <StatusBadge label="Wallet permissions · local fork" tone="warning"/>}
        <span>Wallet: {modeB.wallet ? `injected · ${modeB.wallet.account.slice(0, 6)}…${modeB.wallet.account.slice(-4)}` : wallet ? `injected · ${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : product.forkWallet}</span>
        <span>Chain 31337 · local environment</span>
      </div></details>}
    </div>
    {!solanaActive && build009.error && <div role="alert" className="wallet-toast">Wallet: {build009.error}</div>}
  </header>;
}
