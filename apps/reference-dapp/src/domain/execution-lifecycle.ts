// SPDX-License-Identifier: AGPL-3.0-only
/** Observations only. This module cannot submit, retry, reconcile or recover an execution. */
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import { CROSSCHAIN_ROUTER_PROFILES, ROBINHOOD_TESTNET_TRANSFER, solanaSwapRuntime } from '@defi-workflow-engine/action-registry';
import type { Workflow } from './initial-workflow';
import { composerActions, composerSummary } from './composer-presentation';
import { simulationAmount, simulationProvider } from './simulation-presentation';
import { shellChainLabel } from './product-shell';
import type { ExecutionStepEvidence } from './execution-step-evidence';
import type { ExecutionEvidence } from './execution-evidence';
import type { useSupply } from '../state/supply-store';
import type { useLending } from '../state/lending-store';
import type { useRouter } from '../state/router-store';
import type { usePublicTestnet } from '../state/public-testnet-store';
import type { useJupiter } from '../state/jupiter-store';
import type { useSolanaLiquidity } from '../state/solana-liquidity-store';
import type { useUniswapLiquidity } from '../state/uniswap-liquidity-store';
import type { useRobinhoodTransfer } from '../state/robinhood-transfer-store';
import type { useModeA } from '../state/mode-a-store';
import type { useModeB } from '../state/mode-b-store';
import type { useComposition } from '../state/composition-store';
import type { useLiquidity } from '../state/liquidity-store';
import type { useCow } from '../state/cow-store';

type ReadonlyStore<T> = Omit<T, { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T]>;
export type ExecutionLifecycleSource =
  | { kind: 'supply'; state: ReadonlyStore<ReturnType<typeof useSupply>> }
  | { kind: 'lending'; state: ReadonlyStore<ReturnType<typeof useLending>> }
  | { kind: 'router'; state: ReadonlyStore<ReturnType<typeof useRouter>> }
  | { kind: 'public'; state: ReadonlyStore<ReturnType<typeof usePublicTestnet>> }
  | { kind: 'solana-swap'; state: ReadonlyStore<ReturnType<typeof useJupiter>> }
  | { kind: 'solana-pool'; state: ReadonlyStore<ReturnType<typeof useSolanaLiquidity>> }
  | { kind: 'uniswap-pool'; state: ReadonlyStore<ReturnType<typeof useUniswapLiquidity>> }
  | { kind: 'transfer'; state: ReadonlyStore<ReturnType<typeof useRobinhoodTransfer>> }
  | { kind: 'fork-swap'; state: ReadonlyStore<ReturnType<typeof useModeA>> }
  | { kind: 'fork-pool'; state: ReadonlyStore<ReturnType<typeof useLiquidity>> }
  | { kind: 'delegated-swap'; state: ReadonlyStore<ReturnType<typeof useModeB>> }
  | { kind: 'composition'; state: ReadonlyStore<ReturnType<typeof useComposition>> }
  | { kind: 'cow'; state: ReadonlyStore<ReturnType<typeof useCow>> }
  | { kind: 'unavailable'; state: { busy: boolean | string | null; error: string | null } };
export type LifecycleState = 'waiting' | 'preparing' | 'wallet' | 'submitting' | 'submitted' | 'pending' | 'confirmed' | 'failed' | 'uncertain' | 'signed' | 'posted' | 'settling' | 'partial' | 'cancelled' | 'expired' | 'not-submitted';
const labels: Record<LifecycleState, string> = {
  'not-submitted': 'Not submitted', waiting: 'Waiting', preparing: 'Preparing request', wallet: 'Confirm in wallet', submitting: 'Submitting', submitted: 'Transaction submitted', pending: 'Pending confirmation',
  confirmed: 'Confirmed', failed: 'Failed', uncertain: 'Execution status uncertain', signed: 'Order signed', posted: 'Order posted', settling: 'Settlement pending', partial: 'Partially settled', cancelled: 'Cancelled', expired: 'Transaction expired',
};
export function transactionLifecycle(state: string | null, hash: string | null, signing = false, verified = false): LifecycleState {
  if (['REVERTED', 'FAILED', 'REJECTED'].includes(state ?? '')) return 'failed';
  if (state === 'EXPIRED') return 'expired';
  if (state === 'CANCELLED') return 'cancelled';
  if (['SUBMISSION_RESULT_UNKNOWN', 'UNKNOWN', 'INCONCLUSIVE', 'DIVERGENT', 'NOT_FOUND', 'RECONCILIATION_REQUIRED'].includes(state ?? '') && !verified) return 'uncertain';
  if (verified || state === 'CONFIRMED' || state === 'RECONCILED') return 'confirmed';
  if (state === 'PENDING') return 'pending';
  if (signing && !hash && ['PREPARED', 'SUBMITTING'].includes(state ?? '')) return 'wallet';
  if (state === 'HASH') return 'submitted';
  if (state === 'SUBMITTING') return hash ? 'submitted' : 'submitting';
  if (state === 'PREPARED' || state === 'RESERVED') return 'preparing';
  return state ? 'uncertain' : 'waiting';
}
export function intentLifecycle(state: string): LifecycleState {
  const map: Record<string, LifecycleState> = { REVIEWED: 'waiting', SIGNED: 'signed', POSTING: 'submitting', POSTED: 'posted', OPEN: 'settling', PARTIALLY_FILLED: 'partial', FULFILLED: 'settling', RECONCILIATION_REQUIRED: 'settling', RECONCILED: 'confirmed', EXPIRED: 'expired', CANCELLED: 'cancelled', CANCEL_REQUESTED: 'settling' };
  return map[state] ?? 'uncertain';
}
/** Explorer profiles already used by these runtimes. Local hashes never link to a public explorer. */
export function executionExplorer(chain: string, hash: string, local = false): string | null {
  if (local) return null;
  if (chain.startsWith('solana:')) return /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(hash) ? solanaSwapRuntime(chain)?.explorerTx(hash) ?? null : null;
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) return null;
  if (chain === ROBINHOOD_TESTNET_TRANSFER.chain) return `${ROBINHOOD_TESTNET_TRANSFER.explorer}/tx/${hash}`;
  for (const profile of Object.values(CROSSCHAIN_ROUTER_PROFILES)) {
    if (profile.source.chain === chain) return `${profile.source.explorer.replace(/\/$/, '')}/tx/${hash}`;
    if (profile.destination.chain === chain) return `${profile.destination.explorer.replace(/\/$/, '')}/tx/${hash}`;
  }
  return null;
}
export type LifecycleOperation = { id: string; nodeId: string; title: string; state: LifecycleState; label: string; hash: string | null; chain: string; explorer: string | null; fee: string | null; approval: boolean; intent: boolean };
export type LifecycleStep = { id: string; number: number; action: string; input: string; pair: string | null; network: string; provider: string | null; tokens: string[]; state: LifecycleState; label: string; operations: LifecycleOperation[] };
export type ExecutionLifecycle = { started: boolean; restored: boolean; local: boolean; matchesWorkflow?: boolean; planUnavailable?: boolean; stepEvidence?: Record<string, ExecutionStepEvidence>; evidence?: ExecutionEvidence; steps: LifecycleStep[]; active: LifecycleStep | null; completed: number; label: string; message: string; state: 'idle' | 'active' | 'complete' | 'attention' | 'uncertain'; runKey: string | null; fingerprint: string; busy: boolean };

export function projectExecutionLifecycle(currentWorkflow: Workflow, context: ReviewContext, source: ExecutionLifecycleSource): ExecutionLifecycle {
  let workflow = currentWorkflow, runKey: string | null = null, local = false, restored = false;
  const reconciliation = source.kind === 'fork-swap' ? source.state.execution?.evidence.at(-1)?.outcome : source.kind === 'fork-pool' ? source.state.status?.reconciliation?.outcome : null;
  const runUncertain = ['DIVERGENT', 'INCONCLUSIVE'].includes(reconciliation ?? '') || 'record' in source.state && source.state.record && 'verdict' in source.state.record && ['DIVERGENT', 'INCONCLUSIVE'].includes(source.state.record.verdict);
  const runFailed = source.kind === 'lending' && source.state.record?.status === 'FAILED';
  const operations: LifecycleOperation[] = [];
  const state = source.state;
  const signing = 'signing' in state && state.signing;
  const select = (saved: Workflow, key: string, provenance: string, recovered = false) => { workflow = saved; runKey = key; local = ['MOCKED', 'FORK_REPRODUCED'].includes(provenance); restored = recovered; };
  const actionId = (action: string) => composerActions(workflow).find(node => node.actionType === action)?.nodeId ?? composerActions(workflow)[0]?.nodeId ?? '';
  const add = (id: string, nodeId: string, title: string, chain: string, raw: string | null, hash: string | null = null, verified = false, approval = false, fee: string | null = null, intent = false) => {
    const status = intent ? intentLifecycle(raw ?? 'REVIEWED') : transactionLifecycle(raw, hash, Boolean(signing), verified);
    const label = intent && raw === 'EXPIRED' ? 'Order expired' : intent && raw === 'CANCEL_REQUESTED' ? 'Cancellation requested' : intent && raw === 'POSTING' ? 'Posting order' : intent && status === 'confirmed' ? 'Settled' : status === 'failed' && raw === 'REJECTED' ? 'Wallet request declined' : labels[status];
    operations.push({ id, nodeId, title, chain, state: status, label, hash, explorer: hash ? executionExplorer(chain, hash, local) : null, fee, approval, intent });
  };
  switch (source.kind) {
    case 'supply': {
      const r = source.state.record; if (!r) break;
      select(r.review.workflow, r.id, r.provenance, source.state.recovered);
      const nodeId = actionId(r.review.withdraw ? 'withdraw' : r.review.repay ? 'repay' : r.review.borrow ? 'borrow' : 'supply');
      const latest = (step: string) => r.attempts.filter(a => a.step === step).at(-1);
      if (r.review.approvalRequired || latest('APPROVAL')) { const a = latest('APPROVAL'); add('approval', nodeId, 'Approve USDC', r.review.chain, a?.state ?? null, a?.transactionHash ?? null, Boolean(a?.reconciled || r.approvalProof), true); }
      const step = r.review.withdraw ? 'WITHDRAW' : r.review.repay ? 'REPAY' : r.review.borrow ? 'BORROW' : 'SUPPLY', a = latest(step);
      add(step, nodeId, step.charAt(0) + step.slice(1).toLowerCase(), r.review.chain, a?.state ?? null, a?.transactionHash ?? null, Boolean(a?.reconciled));
      if (r.notSubmitted) for (const op of operations) if (op.state !== 'confirmed' && op.state !== 'waiting') { op.state = 'not-submitted'; op.label = labels['not-submitted']; }
      break;
    }
    case 'lending': {
      const r = source.state.record, q = r?.reviews.at(-1); if (!r || !q) break;
      select(q.workflow, r.id, r.provenance, source.state.recovered);
      // Earlier completed calls can disappear from refreshed Reviews. Keep their real attempts in the run.
      const calls = [...r.reviews.flatMap(review => review.calls)].filter((call, index, all) => all.findIndex(c => c.id === call.id) === index);
      for (const call of calls) {
        const a = r.attempts.filter(a => a.step === call.id).at(-1), approval = call.id.includes('APPROVAL');
        const observed = a ? r.observations.filter(o => o.attemptId === a.id).at(-1) : null;
        const title = approval ? 'Approve USDC' : call.id.charAt(0) + call.id.slice(1).toLowerCase();
        add(call.id, call.nodeId, title, q.manifest.owner.chainId, a?.state ?? null, a?.hash ?? null, Boolean(a?.reconciled), approval, observed?.cost ? simulationAmount(observed.cost, 18, 'ETH') : null);
        if (a?.notSubmitted && !a.reconciled) { const op = operations.at(-1)!; op.state = 'not-submitted'; op.label = labels['not-submitted']; }
      } break;
    }
    case 'public': {
      const r = source.state.run; if (!r) break;
      select(r.workflow, r.quote.executionId, 'PUBLIC_TESTNET', source.state.recoveryOnly);
      const nodeId = r.quote.nodeId, chain = `eip155:${r.quote.chainId}`;
      const approve = r.attempts.filter(a => a.step === 'approval').at(-1), swap = r.attempts.filter(a => a.step === 'swap').at(-1);
      if (approve) add('approval', nodeId, `Approve ${r.quote.inputSymbol}`, chain, approve.state, approve.txHash, false, true, simulationAmount(approve.receipt?.gasCostWei, 18, 'ETH'));
      add('swap', nodeId, 'Swap', chain, swap?.state ?? null, swap?.txHash ?? null, false, false, simulationAmount(swap?.receipt?.gasCostWei, 18, 'ETH')); break;
    }
    case 'router': {
      const r = source.state.record; if (!r) break;
      select(r.workflow, r.id, r.provenance, source.state.recovered);
      const nodeId = r.review.nodeId;
      for (const call of r.review.calls) {
        const step = call.purpose === 'APPROVAL' ? 'APPROVAL' : 'DEPOSIT', a = r.attempts.filter(a => a.step === step).at(-1);
        add(step, nodeId, step === 'APPROVAL' ? `Approve ${r.review.route.inputToken.symbol}` : 'Bridge deposit', r.review.intent.sourceChain, a?.state ?? null, a?.replacementHash ?? a?.transactionHash ?? null, Boolean(a?.reconciled), step === 'APPROVAL', simulationAmount(a?.receipt?.gasCostWei, 18, 'ETH'));
      }
      const settling = ['SOURCE_CONFIRMED', 'IN_FLIGHT', 'DESTINATION_OBSERVED'].includes(r.phase);
      const destinationState = r.verdict === 'RECONCILED' ? 'CONFIRMED' : ['RECOVERY_REQUIRED', 'RECONCILIATION_REQUIRED'].includes(r.phase) || r.verdict === 'DIVERGENT' ? 'INCONCLUSIVE' : r.verdict === 'FAILED' ? 'FAILED' : r.verdict === 'REFUNDED' ? 'CANCELLED' : settling ? 'PENDING' : null;
      add('destination', nodeId, 'Destination settlement', r.review.intent.destinationChain, destinationState, r.destination?.transactionHash ?? null, r.verdict === 'RECONCILED'); break;
    }
    case 'uniswap-pool': {
      const r = source.state.record; if (!r) break;
      select(r.workflow, r.id, r.provenance, source.state.recovered);
      const nodeId = composerActions(workflow)[0]?.nodeId ?? '', chain = `eip155:${r.review.chainId}`;
      for (const call of r.review.calls) {
        const a = r.attempts.filter(a => a.step === call.step).at(-1), approval = call.step !== 'MINT';
        add(call.step, nodeId, approval ? `Approve ${call.step === 'APPROVE_TOKEN0' ? r.review.token0.symbol : r.review.token1.symbol}` : 'Add liquidity', chain, a?.state ?? null, a?.replacementHash ?? a?.transactionHash ?? null, Boolean(a?.reconciled), approval, simulationAmount(a?.receipt?.gasCostWei, 18, 'ETH'));
      } break;
    }
    case 'solana-swap': case 'solana-pool': {
      const r = source.state.record; if (!r) break;
      select(r.review.workflow, r.id, r.provenance, source.state.recovered);
      const a = r.attempt; add('transaction', composerActions(workflow)[0]?.nodeId ?? '', source.kind === 'solana-swap' ? 'Swap' : 'Liquidity transaction', r.review.chain, a?.state ?? null, a?.signature ?? null, Boolean(a?.reconciled));
      if (a && r.verdict === 'NOT_EXECUTED') { const op = operations.at(-1)!; op.state = 'expired'; op.label = labels.expired; }
      if (a?.state === 'SUBMITTING' && a.signature) { const op = operations.at(-1)!; op.state = 'submitting'; op.label = labels.submitting; }
      break;
    }
    case 'transfer': {
      const r = source.state.record; if (!r) break;
      select(r.review.workflow, r.id, r.provenance);
      const a = r.attempt; add('transfer', composerActions(workflow)[0]?.nodeId ?? '', 'Transfer', r.review.chain, a?.state ?? null, a?.transactionHash ?? null, Boolean(a?.reconciled));
      if (a && r.notSubmitted && !a.reconciled) { const op = operations.at(-1)!; op.state = 'not-submitted'; op.label = labels['not-submitted']; } break;
    }
    case 'fork-swap': {
      const r = source.state.execution, q = source.state.prepared; if (!q) break;
      select(q.workflow, q.executionId, q.environment, source.state.recoveryOnly);
      const nodeId = actionId('asset.swap.exact-input');
      for (const [id, title, approval] of [['step-approve', `Approve ${q.symbolIn}`, true], ['step-swap', 'Swap', false]] as const) {
        const a = r?.attempts.filter(a => a.stepId === id).at(-1), observed = a ? r?.observations.filter(o => o.attemptId === a.executionAttemptId).at(-1) : null;
        add(id, nodeId, title, 'eip155:31337', observed?.outcome === 'REVERTED' ? 'REVERTED' : a?.state ?? null, a?.transactionHash ?? null, observed?.outcome === 'CONFIRMED_NOT_RECONCILED', approval);
      } break;
    }
    case 'fork-pool': {
      const s = source.state, q = s.prepared; if (!q) break;
      runKey = q.executionId; local = true; restored = s.recoveryOnly;
      const a = s.status?.journal?.attempts.at(-1);
      add('liquidity', composerActions(workflow)[0]?.nodeId ?? '', 'Liquidity transaction', 'eip155:31337', a?.state ?? null, s.status?.transactionHash ?? null, s.status?.reconciliation?.outcome === 'RECONCILED'); break;
    }
    case 'delegated-swap': case 'composition': {
      const s = source.state, q = s.status?.prepared; if (!q) break;
      runKey = q.executionId; local = true; restored = s.recoveryOnly;
      const first = composerActions(workflow)[0]?.nodeId ?? '';
      q.compiled.installation.forEach((call, index) => {
        const confirmed = q.installation.find(entry => entry.index === index);
        const preEnabled = 'installationStart' in q && index < q.installationStart;
        // Pre-enabled authority is a readback, not a newly confirmed transaction.
        if (!preEnabled) add(`permission-${index}`, first, `Wallet permission ${index + 1}`, 'eip155:31337', confirmed ? 'CONFIRMED' : s.unknownSubmission && index === q.compiled.installation.findIndex((_, i) => !q.installation.some(entry => entry.index === i) && !('installationStart' in q && i < q.installationStart)) ? 'INCONCLUSIVE' : null, confirmed?.hash ?? null, Boolean(confirmed), true);
      });
      if (source.kind === 'delegated-swap') {
        const prepared = source.state.status?.prepared;
        const verdict = prepared?.reconciliation?.outcome;
        const installed = Boolean(prepared && prepared.installationStart + prepared.installation.length === prepared.compiled.installation.length);
        add('swap', first, 'Swap', 'eip155:31337', verdict === 'RECONCILED' ? 'CONFIRMED' : verdict === 'REVERTED' ? 'REVERTED' : verdict ? 'INCONCLUSIVE' : prepared?.executionHash ? 'HASH' : s.unknownSubmission && installed ? 'INCONCLUSIVE' : null, prepared?.executionHash ?? null);
      } else {
        for (const [step, action] of [['SWAP', 'asset.swap.exact-input'], ['MINT', 'asset.liquidity.uniswap-v3']] as const) {
          const event = source.state.status?.events.filter(e => e.level === 'ATTEMPT' && e.step === step).at(-1);
          add(step, actionId(action), step === 'SWAP' ? 'Swap' : 'Add liquidity', 'eip155:31337', event?.state ?? null, event?.transactionHash ?? null);
        }
      } break;
    }
    case 'cow': {
      const r = source.state.execution?.record; if (!r) break;
      runKey = r.executionId; local = true; restored = source.state.recoveryOnly;
      add('order', actionId('asset.swap.exact-input'), 'Signed order', r.quote.chainId, r.state, null, false, false, null, true); break;
    }
  }
  const planUnavailable = restored && ['fork-pool', 'delegated-swap', 'composition', 'cow'].includes(source.kind);
  let steps = composerActions(workflow).map((node, index): LifecycleStep => {
    const card = composerSummary(workflow, node, context), own = operations.filter(op => op.nodeId === node.nodeId);
    const live = own.find(op => !['waiting', 'confirmed'].includes(op.state));
    const completed = own.length > 0 && own.every(op => op.state === 'confirmed');
    const status = completed ? 'confirmed' : live?.state ?? 'waiting';
    const intent = own.some(op => op.intent);
    return { id: node.nodeId, number: index + 1, action: card.action.includes('.') ? 'Action' : card.action, input: card.amount === 'Amount not available' ? '—' : card.amount, pair: card.bridgePair ?? card.detail ?? null, network: card.chain,
      provider: source.kind === 'router' ? simulationProvider(source.state.record?.review.route.routingProvider ?? '') ?? card.provider ?? null : source.kind === 'cow' ? 'CoW Protocol' : card.provider === 'Provider not specified' ? null : card.provider ?? null,
      tokens: [...new Set(`${card.amount} ${card.detail ?? ''} ${card.bridgePair ?? ''}`.match(/\b(?:devUSDC|USDC|WETH|ETH|WSOL|SOL|USDT)\b/g) ?? [])],
      state: status, label: intent && completed ? 'Settled' : labels[status], operations: own };
  });
  // These legacy records retain requests, but no original workflow. Display their
  // actual operations without borrowing amounts or actions from the current Build.
  if (planUnavailable) {
    for (const op of operations) op.nodeId = '';
    const business = operations.filter(op => !op.approval);
    const groups = business.length ? business.map((op, index) => index === 0 ? [...operations.filter(item => item.approval), op] : [op]) : operations.length ? [operations] : [];
    steps = groups.map((own, index): LifecycleStep => {
      const op = own.at(-1)!, live = own.find(item => !['waiting', 'confirmed'].includes(item.state));
      const status = own.every(item => item.state === 'confirmed') ? 'confirmed' : live?.state ?? 'waiting';
      return { id: `recorded-${op.id}`, number: index + 1, action: op.approval ? 'Wallet setup' : op.title, input: '—', pair: null,
        network: shellChainLabel(op.chain), provider: op.intent ? 'CoW Protocol' : null, tokens: [], state: status,
        label: op.intent && status === 'confirmed' ? 'Settled' : labels[status], operations: own };
    });
  }
  const started = operations.some(op => op.state !== 'waiting'), completed = steps.filter(step => step.state === 'confirmed').length;
  const uncertain = Boolean(runUncertain) || operations.some(op => op.state === 'uncertain'), failed = runFailed || operations.some(op => ['failed', 'cancelled', 'expired', 'not-submitted'].includes(op.state));
  const complete = started && steps.length > 0 && completed === steps.length;
  const lifecycleState = !started ? 'idle' : uncertain ? 'uncertain' : failed ? 'attention' : complete ? 'complete' : 'active';
  const active = steps.find(step => step.state !== 'confirmed') ?? null;
  const label = lifecycleState === 'uncertain' ? 'Execution status uncertain' : lifecycleState === 'attention' ? 'Execution needs attention' : lifecycleState === 'complete' ? 'Execution confirmed' : lifecycleState === 'active' ? 'Execution in progress' : 'Waiting to start';
  const message = lifecycleState === 'uncertain' ? 'The current request cannot be confirmed or ruled out. No transaction is repeated.' : lifecycleState === 'attention' ? 'The current step could not complete. Any confirmed actions remain recorded. Nothing is retried automatically.' : lifecycleState === 'complete' ? planUnavailable ? 'The saved requests are confirmed. Original workflow details remain unavailable.' : 'All workflow actions are confirmed in the current execution record.' : `${completed} of ${steps.length} actions completed. Each new wallet request requires your explicit confirmation.`;
  return { started, restored, local, matchesWorkflow: !planUnavailable && JSON.stringify(workflow) === JSON.stringify(currentWorkflow), planUnavailable, steps, active, completed, label, message, state: lifecycleState, runKey, fingerprint: JSON.stringify(operations.map(op => [op.id, op.state, op.hash])), busy: Boolean(state.busy) };
}
