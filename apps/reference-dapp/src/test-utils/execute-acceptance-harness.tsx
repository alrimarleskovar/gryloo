// SPDX-License-Identifier: AGPL-3.0-only
// Component acceptance entry only. No production route imports this module.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ExecuteWorkspace } from '../components/execute-workspace';
import { ExecuteAcceptanceWorkflowProvider } from './execute-acceptance-workflow';
import { reviewFixture, reviewSpender } from './review-fixture';
import { projectExecutionLifecycle, type ExecutionLifecycleSource } from '../domain/execution-lifecycle';
import { projectExecutionRecovery } from '../domain/execution-recovery';
import { classifyWalletEnvironment } from '../wallet/environment';
import { projectExecutionStepEvidence } from '../domain/execution-step-evidence';
import { projectExecutionEvidence } from '../domain/execution-evidence';
import { createRouterNode } from '../domain/router-authoring';
import { createAuthoredSupply } from '../domain/supply-authoring';
import { baseAssetRegistry } from '@defi-workflow-engine/action-registry';

type Lifecycle = 'wallet' | 'submitting' | 'submitted' | 'approval-pending' | 'approval-confirmed' | 'swap-pending' | 'swap-confirmed' | 'failed' | 'uncertain' | 'restored';
type Transition = 'valid' | 'unapproved' | 'blocked' | 'wallet' | 'network' | 'unknown' | 'workflow';
type EvidenceScenario = 'reconciled' | 'attention' | 'declined' | 'partial' | 'bridge-pending' | 'bridge-reconciled' | 'cow-pending' | 'cow-reconciled' | 'recovered';
declare global { interface Window { flofiExecuteAcceptance: { transition(value: Transition): void; lifecycle(value: Lifecycle): void; evidence(value: EvidenceScenario): void; workflowName(value: string): void; holdStart(): void; binding(value: 'wallet' | 'network' | 'workflow' | 'disconnect'): void; checkOutcome(value: 'confirmed' | 'uncertain' | 'error'): void; finishCheck(): void; counts(): { executed: number; simulated: number; edited: number; checked: number } } } }
function acceptedFixture() { const value = reviewFixture(); value.authorization.accepted = true; return value; }
function Harness() {
  const [fixture, setFixture] = useState(acceptedFixture);
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(() => sessionStorage.getItem('flofi:execute-acceptance-record') as Lifecycle | null);
  const [checking, setChecking] = useState(false);
  const checkOutcome = useRef<'confirmed' | 'uncertain' | 'error'>('confirmed');
  const finishCheck = useRef<(() => void) | null>(null);
  const holdStart = useRef(false);
  const [started, setStarted] = useState(false);
  const [evidenceScenario, setEvidenceScenario] = useState<EvidenceScenario | null>(null);
  const [workflowName, setWorkflowName] = useState('Approved swap');
  const counts = useRef({ executed: 0, simulated: 0, edited: 0, checked: 0 });
  useEffect(() => {
    window.flofiExecuteAcceptance = {
      workflowName: setWorkflowName,
      evidence: value => { setEvidenceScenario(value); setLifecycle('swap-confirmed'); setStarted(true); },
      binding: value => setFixture(current => ({ ...current, workflow: value === 'workflow' ? { ...current.workflow, revision: current.workflow.revision + 1 } : current.workflow, wallet: { ...current.wallet, ...(value === 'wallet' ? { account: reviewSpender, changed: true } : value === 'network' ? { chain: 'eip155:42161', environment: 'mainnet' as const, changed: true } : value === 'disconnect' ? { account: null, changed: true } : {}) } })),
      checkOutcome: value => { checkOutcome.current = value; }, finishCheck: () => finishCheck.current?.(),
      counts: () => ({ ...counts.current }), holdStart: () => { holdStart.current = true; }, lifecycle: value => { setEvidenceScenario(null); sessionStorage.setItem('flofi:execute-acceptance-record', value); setLifecycle(value); setStarted(true); },
      transition: value => {
        sessionStorage.removeItem('flofi:execute-acceptance-record'); setStarted(false); setLifecycle(null); setEvidenceScenario(null);
        setFixture(current => {
          if (value === 'valid') return acceptedFixture();
          const next = { ...current, wallet: { ...current.wallet }, authorization: { ...current.authorization, accepted: value !== 'unapproved' } };
          if (value === 'blocked') next.authorization.ready = false;
          if (value === 'wallet') { next.wallet.account = reviewSpender; next.wallet.changed = true; }
          if (value === 'network' || value === 'unknown') {
            next.wallet.chain = value === 'network' ? 'eip155:42161' : null;
            next.wallet.environment = classifyWalletEnvironment(next.wallet.chain); next.wallet.changed = true;
          }
          if (value === 'workflow') next.workflow = { ...next.workflow, revision: next.workflow.revision + 1 };
          return next;
        });
      },
    };
  }, []);
  const hash = '0x' + 'a'.repeat(64);
  const attempts = lifecycle === 'approval-pending' ? [{ step: 'approval', state: 'PENDING', txHash: hash, account: fixture.authorization.owner }] : lifecycle === 'approval-confirmed' ? [{ step: 'approval', state: 'CONFIRMED', txHash: hash, account: fixture.authorization.owner }] : lifecycle ? [{ step: 'approval', state: 'CONFIRMED', txHash: hash, account: fixture.authorization.owner }, { step: 'swap', state: lifecycle === 'swap-confirmed' ? 'CONFIRMED' : lifecycle === 'failed' ? 'REVERTED' : lifecycle === 'uncertain' ? 'UNKNOWN' : lifecycle === 'submitting' ? 'SUBMITTING' : lifecycle === 'submitted' ? 'HASH' : 'PENDING', txHash: ['uncertain', 'submitting'].includes(lifecycle) ? null : hash, account: fixture.authorization.owner }] : [];
  const progressSource = { ...fixture.source, state: { ...fixture.source.state, busy: checking, recoveryOnly: lifecycle === 'restored', run: { ...('run' in fixture.source.state ? fixture.source.state.run : {}), attempts } } } as unknown as ExecutionLifecycleSource;
  const supplyWorkflow = { ...fixture.workflow, nodes: [createAuthoredSupply('supply', { network: 'Base Sepolia', asset: 'USDC', amount: '100', beneficiary: fixture.authorization.owner! })], resourceEdges: [] };
  const walletSource = { kind: 'supply', state: { signing: true, busy: true, recovered: false, record: { id: 'acceptance-wallet-request', provenance: 'PUBLIC_TESTNET',
    review: { workflow: supplyWorkflow, account: fixture.authorization.owner, chain: fixture.authorization.chain }, attempts: [{ step: 'SUPPLY', state: 'SUBMITTING', transactionHash: null, reconciled: false }],
  } } } as unknown as ExecutionLifecycleSource;
  const observedSource = evidenceScenario ? evidenceFixture(evidenceScenario, fixture) : lifecycle === 'wallet' ? walletSource : progressSource;
  // Evidence scenarios render the canonical workflow retained by that record,
  // rather than presenting a different fixture as a newly edited Build.
  const evidenceRecord = evidenceScenario ? (observedSource.state as { record?: { workflow?: typeof fixture.workflow; reviews?: { workflow: typeof fixture.workflow }[] } }).record : null;
  const workflow = evidenceRecord?.workflow ?? evidenceRecord?.reviews?.at(-1)?.workflow ?? fixture.workflow;
  const progress = lifecycle ? projectExecutionLifecycle(workflow, fixture.context, observedSource) : undefined;
  if (progress) { progress.stepEvidence = projectExecutionStepEvidence(observedSource, progress); progress.evidence = projectExecutionEvidence(observedSource, progress); }
  const recovery = progress ? { ...projectExecutionRecovery(observedSource, progress, fixture.wallet), check: () => {
    counts.current.checked += 1; setChecking(true);
    return new Promise<void>((resolve, reject) => { finishCheck.current = () => {
      setChecking(false); finishCheck.current = null;
      if (checkOutcome.current === 'error') { reject(new Error('fixture status unavailable')); return; }
      const next = checkOutcome.current === 'confirmed' ? 'swap-confirmed' : 'uncertain';
      sessionStorage.setItem('flofi:execute-acceptance-record', next); setLifecycle(next); resolve();
    }; });
  } } : undefined;
  return <ExecuteAcceptanceWorkflowProvider workflow={workflow} context={fixture.context}><ExecuteWorkspace {...fixture} workflow={workflow} workflowName={workflowName} {...(progress && recovery ? { progress, recovery } : {})} authorization={fixture.authorization}
    execution={{ ready: true, started: started || Boolean(lifecycle), next: lifecycle === 'approval-confirmed' ? () => { counts.current.executed += 1; } : null, nextLabel: 'Continue to swap', check: () => {}, start: () => { counts.current.executed += 1; if (!holdStart.current) setStarted(true); }, prompt: 'Confirm the reviewed transaction in your wallet.', expiresAt: null, requiresMainnetAcknowledgement: false }}
    backToBuild={() => { counts.current.edited += 1; }} backToSimulate={() => { counts.current.simulated += 1; }}/></ExecuteAcceptanceWorkflowProvider>
}
// Normalized recorded-data fixtures for presentation acceptance only. No RPC or
// signatures are exercised, and no fixture is imported by production routes.
function evidenceFixture(scenario: EvidenceScenario, fixture: ReturnType<typeof acceptedFixture>): ExecutionLifecycleSource {
  const a = '0x' + 'a'.repeat(64), b = '0x' + 'b'.repeat(64), c = '0x' + 'c'.repeat(64), node = fixture.workflow.nodes.at(-1)!;
  const evidenceBundle = { evidenceBundleId: 'acceptance-evidence', outcome: 'RECONCILED', manifestHash: '0x' + 'e'.repeat(64), observedAt: '2026-10-06T12:00:00.000Z', environment: 'TESTNET_EXECUTED', receipts: [], reconciliation: { limitations: [] } };
  if (scenario.startsWith('bridge-')) {
    const workflow = { ...fixture.workflow, nodes: [createRouterNode('bridge', { source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '5', recipient: '', slippage: '50', routing: 'AUTO' })], resourceEdges: [] };
    return { kind: 'router', state: { record: { id: 'acceptance-bridge', owner: fixture.wallet.account, workflow, provenance: 'PUBLIC_TESTNET', verdict: scenario === 'bridge-reconciled' ? 'RECONCILED' : 'PENDING', phase: scenario === 'bridge-reconciled' ? 'RECONCILED' : 'IN_FLIGHT',
      review: { nodeId: workflow.nodes[0]!.nodeId, intent: { sourceChain: 'eip155:84532', destinationChain: 'eip155:421614', amount: '5000000' },
        quote: { expectedOutput: '4900000' }, route: { routingProvider: 'across', inputToken: { symbol: 'USDC', decimals: 6 }, outputToken: { symbol: 'USDC', decimals: 6 } }, calls: [{ purpose: 'BRIDGE_DEPOSIT' }] },
      source: { transactionHash: b, inputAmount: '5000000', depositId: 'provider-reference-' + 'r'.repeat(180), safe: true },
      destination: scenario === 'bridge-reconciled' ? { transactionHash: c, transferAmount: '4890000', safe: true } : null,
      attempts: [{ step: 'DEPOSIT', state: 'CONFIRMED', transactionHash: b, reconciled: true }],
    } } } as unknown as ExecutionLifecycleSource;
  }
  if (scenario.startsWith('cow-')) return { kind: 'cow', state: { recoveryOnly: true, execution: { record: { executionId: 'acceptance-cow', state: scenario === 'cow-reconciled' ? 'RECONCILED' : 'RECONCILIATION_REQUIRED', history: [], compiled: { orderUid: '0x' + 'd'.repeat(112) },
    quote: { chainId: 'eip155:8453', quoteId: 'provider-quote-' + 'q'.repeat(180), owner: fixture.wallet.account, sellToken: 'address' in baseAssetRegistry.USDC.asset ? baseAssetRegistry.USDC.asset.address : '', buyToken: 'address' in baseAssetRegistry.WETH.asset ? baseAssetRegistry.WETH.asset.address : '', sellAmount: '100000000', buyAmount: '25000000000000000' },
    observed: { uid: '0x' + 'd'.repeat(112), executedSellAmount: '100000000', executedBuyAmount: '24300000000000000' },
  }, evidence: scenario === 'cow-reconciled' ? { bundle: { ...evidenceBundle, environment: 'MOCKED' } } : null } } } as unknown as ExecutionLifecycleSource;
  if (scenario === 'partial' || scenario === 'recovered') {
    const supply = createAuthoredSupply('supply', { network: 'Base Sepolia', asset: 'USDC', amount: '100', beneficiary: fixture.authorization.owner! });
    const workflow = { ...fixture.workflow, nodes: [supply, { ...node, nodeId: 'later-swap' }], resourceEdges: [] };
    return { kind: 'lending', state: { recovered: scenario === 'recovered', record: { id: 'acceptance-partial', provenance: 'PUBLIC_TESTNET', reviews: [{ workflow, commitment: 'recorded-review', fields: { owner: fixture.wallet.account }, manifest: { owner: { chainId: 'eip155:84532' } }, calls: [{ id: 'SUPPLY', nodeId: supply.nodeId }, { id: 'SWAP', nodeId: 'later-swap' }] }],
      attempts: [{ id: 'first', step: 'SUPPLY', state: 'CONFIRMED', hash: b, reconciled: true }, { id: 'second', step: 'SWAP', state: scenario === 'recovered' ? 'CONFIRMED' : 'REVERTED', hash: c, reconciled: scenario === 'recovered' }], observations: [],
      journal: { entries: scenario === 'recovered' ? [{ level: 'attempt', entityId: 'second', toState: 'SUBMISSION_RESULT_UNKNOWN' }, { level: 'attempt', entityId: 'second', toState: 'CONFIRMED' }] : [] },
    } } } as unknown as ExecutionLifecycleSource;
  }
  return { ...fixture.source, state: { ...fixture.source.state, run: { ...('run' in fixture.source.state ? fixture.source.state.run : {}),
    attempts: [{ step: 'approval', state: 'CONFIRMED', txHash: a, account: fixture.wallet.account, receipt: { transactionHash: a, gasCostWei: '100000000000000' } }, { step: 'swap', state: scenario === 'declined' ? 'REJECTED' : 'CONFIRMED', txHash: scenario === 'declined' ? null : b, receipt: scenario === 'declined' ? null : { transactionHash: b, gasCostWei: '200000000000000' } }],
    outcome: scenario === 'declined' ? null : { inputSpent: '100000000', outputReceived: '24300000000000000', allowanceAfter: scenario === 'attention' ? '1000000' : '0', evidence: evidenceBundle },
  } } } as unknown as ExecutionLifecycleSource;
}
export function mount(element: HTMLElement) { createRoot(element).render(<Harness/>); }
