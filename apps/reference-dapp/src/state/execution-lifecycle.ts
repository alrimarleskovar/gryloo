// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { projectExecutionRecovery, type ExecutionRecovery } from '../domain/execution-recovery';
import type { ReviewWallet } from '../domain/review-presentation';
import type { SimulationSource } from '../domain/simulation-presentation';
import { projectExecutionLifecycle, type ExecutionLifecycleSource } from '../domain/execution-lifecycle';
import { projectExecutionStepEvidence } from '../domain/execution-step-evidence';
import { projectExecutionEvidence } from '../domain/execution-evidence';
import { useWorkflow } from './workflow-store';
import { useModeA } from './mode-a-store';
import { useModeB } from './mode-b-store';
import { useComposition } from './composition-store';
import { useLiquidity } from './liquidity-store';
import { useSupply } from './supply-store';
import { useLending } from './lending-store';
import { useRouter } from './router-store';
import { usePublicTestnet } from './public-testnet-store';
import { useJupiter } from './jupiter-store';
import { useSolanaLiquidity } from './solana-liquidity-store';
import { useUniswapLiquidity } from './uniswap-liquidity-store';
import { useRobinhoodTransfer } from './robinhood-transfer-store';
import { useCow } from './cow-store';
/** Subscribes to existing durable records. No effect, polling loop or execution callback. */
export function useExecutionLifecycle(kind: SimulationSource['kind'], wallet: ReviewWallet) {
  const { state, context } = useWorkflow();
  const modeA = useModeA(), modeB = useModeB(), composition = useComposition(), liquidity = useLiquidity();
  const supply = useSupply(), lending = useLending(), router = useRouter(), publicSwap = usePublicTestnet();
  const jupiter = useJupiter(), solanaPool = useSolanaLiquidity(), uniswapPool = useUniswapLiquidity(), transfer = useRobinhoodTransfer(), cow = useCow();
  const source: ExecutionLifecycleSource = kind === 'supply' ? { kind, state: supply }
    : kind === 'lending' ? { kind, state: lending } : kind === 'router' ? { kind, state: router }
    : kind === 'public' ? { kind, state: publicSwap } : kind === 'solana-swap' ? { kind, state: jupiter }
    : kind === 'solana-pool' ? { kind, state: solanaPool } : kind === 'uniswap-pool' ? { kind, state: uniswapPool }
    : kind === 'transfer' ? { kind, state: transfer } : kind === 'fork-swap' ? { kind, state: modeA }
    : kind === 'fork-pool' ? { kind, state: liquidity } : kind === 'delegated-swap' ? { kind, state: modeB }
    : kind === 'composition' ? { kind, state: composition }
    : state.workflow.nodes.some(node => node.adapterConstraints.protocols.includes('cow-protocol')) || cow.recoveryOnly ? { kind: 'cow', state: cow }
    : { kind: 'unavailable', state: { busy: false, error: null } };
  const progress = projectExecutionLifecycle(state.workflow, context, source);
  const view = projectExecutionRecovery(source, progress, wallet);
  // Each callback is an existing observation-only path. No start, request, worker or retry callback is used.
  const check = view.action === null ? null
    : source.kind === 'supply' ? supply.observe : source.kind === 'lending' ? lending.observe
    : source.kind === 'router' ? router.observe : source.kind === 'public' ? publicSwap.observe
    : source.kind === 'solana-swap' ? jupiter.observe : source.kind === 'solana-pool' ? solanaPool.observe
    : source.kind === 'uniswap-pool' ? uniswapPool.observe : source.kind === 'transfer' ? transfer.observe
    : source.kind === 'fork-swap' ? view.action === 'reconcile' ? modeA.reconcile : () => modeA.observe(view.operationId as 'step-approve' | 'step-swap')
    : source.kind === 'fork-pool' ? view.action === 'recover-unknown' ? liquidity.recoverUnknown : liquidity.observe
    : source.kind === 'delegated-swap' ? view.action === 'reconcile' ? modeB.reconcile : modeB.refresh
    : source.kind === 'composition' ? view.action === 'recover-known' ? composition.recoverKnown : composition.refresh
    : source.kind === 'cow' ? view.action === 'reconcile' ? cow.reconcile : cow.track : null;
  const recovery: ExecutionRecovery = { ...view, check };
  return { ...progress, stepEvidence: projectExecutionStepEvidence(source, progress), evidence: projectExecutionEvidence(source, progress), recovery };
}
