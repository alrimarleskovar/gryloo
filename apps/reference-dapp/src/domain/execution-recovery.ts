// SPDX-License-Identifier: AGPL-3.0-only
/** Presentation only: a check can observe a recorded request, never replay it. */
import type { ExecutionLifecycle, ExecutionLifecycleSource } from './execution-lifecycle';
import type { ReviewWallet } from './review-presentation';
import { shellChainLabel } from './product-shell';
import type { Workflow } from './initial-workflow';
/** A fresh Build template must not hide a restored local execution behind the default swap. */
export function restoredLocalExecutionKind(workflow: Workflow, restored: { composition: boolean; liquidity: boolean; cow: boolean }) {
  if (workflow.revision !== 0 || !workflow.nodes.every(node => node.actionType.startsWith('mock-'))) return null;
  return restored.composition ? 'composition' : restored.liquidity ? 'fork-pool' : restored.cow ? 'cow' : null;
}
export type RecoveryCheck = 'observe' | 'reconcile' | 'recover-known' | 'recover-unknown' | 'track' | 'refresh';
export type ExecutionRecovery = {
  action: RecoveryCheck | null; label: string; message: string; contextIssue: string | null;
  operationId: string | null; checking: boolean; recordOnly: boolean; check: (() => void | Promise<void>) | null;
};
export function projectExecutionRecovery(source: ExecutionLifecycleSource, progress: ExecutionLifecycle, wallet: ReviewWallet): Omit<ExecutionRecovery, 'check'> {
  let action: RecoveryCheck | null = null, owner: string | null = null, chain: string | null = null;
  let operationId = progress.active?.operations.find(op => !['waiting', 'confirmed'].includes(op.state))?.id ?? null;
  const unresolved = progress.steps.some(step => step.operations.some(op => ['preparing', 'submitting', 'submitted', 'pending', 'uncertain', 'posted', 'settling', 'partial'].includes(op.state)));
  switch (source.kind) {
    case 'supply': { const r = source.state.record; owner = r?.review.account ?? null; chain = r?.review.chain ?? null; if (r?.attempts.length && unresolved) action = 'observe'; break; }
    case 'lending': { const r = source.state.record, q = r?.reviews.at(-1); owner = q?.fields.owner ?? null; chain = q?.manifest.owner.chainId ?? null; if (r?.attempts.length && unresolved) action = 'observe'; break; }
    case 'router': { const r = source.state.record; owner = r?.owner ?? null; chain = r?.review.intent.sourceChain ?? null; if (r?.verdict === 'PENDING' && unresolved && (r.attempts.some(a => ['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(a.state)) || ['SOURCE_CONFIRMED', 'IN_FLIGHT', 'DESTINATION_OBSERVED', 'RECOVERY_REQUIRED'].includes(r.phase))) action = 'observe'; break; }
    case 'public': { const r = source.state.run; owner = r?.attempts[0]?.account ?? null; chain = r ? `eip155:${r.quote.chainId}` : null; const a = r?.attempts.at(-1); if (unresolved && a?.txHash && ['HASH', 'PENDING', 'CONFIRMED'].includes(a.state) && !r?.outcome) action = 'observe'; break; }
    case 'uniswap-pool': { const r = source.state.record; owner = r?.owner ?? null; chain = r ? `eip155:${r.review.chainId}` : null; if (r?.verdict === 'PENDING' && unresolved && ['PREPARED', 'SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN', 'PENDING'].includes(r.attempts.at(-1)?.state ?? '')) action = 'observe'; break; }
    case 'solana-swap': case 'solana-pool': { const r = source.state.record; owner = r?.review.owner ?? null; chain = r?.review.chain ?? null; if (r?.attempt && r.verdict === 'PENDING' && !r.notSubmitted && unresolved) action = 'observe'; break; }
    case 'transfer': { const r = source.state.record; owner = r?.review.account ?? null; chain = r?.review.chain ?? null; if (r?.attempt && r.verdict === 'PENDING' && !r.notSubmitted && unresolved) action = 'observe'; break; }
    case 'fork-swap': {
      const s = source.state, r = s.execution; owner = s.prepared?.owner ?? null; chain = 'eip155:31337';
      const approve = r?.attempts.filter(a => a.stepId === 'step-approve').at(-1), swap = r?.attempts.filter(a => a.stepId === 'step-swap').at(-1);
      if (approve?.transactionHash && approve.state === 'CONFIRMED' && swap?.transactionHash && ['CONFIRMED', 'REVERTED'].includes(swap.state)) action = 'reconcile';
      else if (operationId && r?.attempts.some(a => a.stepId === operationId)) action = 'observe';
      break;
    }
    case 'fork-pool': {
      const s = source.state, a = s.status?.journal?.attempts.at(-1); owner = s.prepared?.owner ?? null; chain = 'eip155:31337';
      if (a && ['SUBMITTING', 'SUBMISSION_RESULT_UNKNOWN'].includes(a.state)) action = 'recover-unknown';
      else if (a?.state === 'PENDING') action = 'observe'; break;
    }
    case 'delegated-swap': {
      const s = source.state, q = s.status?.prepared; owner = typeof q?.compiled.permission.owner === 'string' ? q.compiled.permission.owner : null; chain = 'eip155:31337';
      if (q?.executionHash && q.reconciliation?.outcome !== 'RECONCILED') action = 'reconcile';
      // Refresh only reads wallet permission state; it does not resolve an unknown worker submission.
      else if (s.unknownSubmission && operationId?.startsWith('permission-')) action = 'observe'; break;
    }
    case 'composition': {
      const s = source.state, e = s.status?.events.filter(e => e.level === 'ATTEMPT').at(-1);
      owner = typeof s.status?.prepared.compiled.permission.owner === 'string' ? s.status.prepared.compiled.permission.owner : null; chain = 'eip155:31337';
      if (e?.state === 'INCONCLUSIVE' && e.transactionHash && s.reviewed && !s.retired && !s.recoveryOnly) action = 'recover-known';
      else if (unresolved) action = 'refresh'; break;
    }
    case 'cow': {
      const r = source.state.execution?.record; owner = r?.quote.owner ?? null; chain = r?.quote.chainId ?? null;
      if (r && ['RECONCILIATION_REQUIRED', 'INCONCLUSIVE'].includes(r.state)) action = 'reconcile';
      else if (r?.postingAttemptId && r.postCount === 1 && ['POSTING', 'POST_RESULT_UNKNOWN', 'POSTED', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED'].includes(r.state)) action = 'track'; break;
    }
  }
  const sameOwner = !owner || Boolean(wallet.account && (chain?.startsWith('solana:') ? wallet.account === owner : wallet.account.toLowerCase() === owner.toLowerCase()));
  const contextIssue = owner && !wallet.account ? 'Connect the wallet used for this execution. Status checks do not send transactions.' : !sameOwner ? 'Wallet changed. Connect the wallet used for this execution before continuing.' : chain && chain !== wallet.chain ? `Switch to ${shellChainLabel(chain)} before continuing. Recorded status remains available.` : null;
  // Composition's known-receipt recovery requires the reviewed context even though it does not send.
  if (action === 'recover-known' && contextIssue) action = null;
  const recordOnly = action === 'refresh';
  if (!progress.started || progress.busy) action = null;
  const busy = source.state.busy;
  const checking = progress.started && typeof busy === 'string' && /^(Reading|Checking|Reconciling|Scanning|Recovering known receipt)/i.test(busy);
  const label = checking ? recordOnly ? 'Updating recorded status…' : 'Checking execution status…' : progress.state === 'uncertain' ? 'Unable to confirm execution' : progress.state === 'attention' ? 'Needs attention' : progress.restored && progress.state === 'complete' ? 'Execution recovered' : progress.restored ? 'Current execution restored' : progress.label;
  const message = checking ? recordOnly ? 'Refreshing the saved execution record. No transaction is resent.' : 'Verifying the recorded request against the available execution state. No transaction is resent.' : progress.state === 'uncertain' ? 'FloFi has not confirmed whether this step completed. No transaction is repeated.' : progress.restored ? `${progress.completed} of ${progress.steps.length} actions completed. The recorded run is preserved; no request is repeated.` : progress.message;
  if (!operationId && action === 'reconcile') operationId = progress.steps.flatMap(step => step.operations).at(-1)?.id ?? null;
  return { action, label, message, contextIssue, operationId, checking, recordOnly };
}
