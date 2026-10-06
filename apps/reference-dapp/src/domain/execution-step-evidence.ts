// SPDX-License-Identifier: AGPL-3.0-only
/** Read-only projection of existing attempts, observations and reconciliation. */
import type { ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';
import type { ExecutionLifecycle, ExecutionLifecycleSource, LifecycleStep } from './execution-lifecycle';
import { simulationAmount } from './simulation-presentation';

export type EvidenceComparison = { label: string; planned: string; actual: string };
export type ExecutionStepEvidence = {
  label: string; message: string; reconciled: boolean; recovered: boolean; restored: boolean;
  comparisons: EvidenceComparison[];
};
type OperationEvidence = { reconciled: boolean; recovered: boolean; comparisons: EvidenceComparison[] };
const uncertainStates = ['SUBMISSION_RESULT_UNKNOWN', 'UNKNOWN', 'INCONCLUSIVE', 'DIVERGENT', 'NOT_FOUND', 'POST_RESULT_UNKNOWN', 'RECONCILIATION_REQUIRED'];
function resolvedUncertainty(states: readonly string[]) {
  const confirmed = states.findLastIndex(state => state === 'CONFIRMED' || state === 'RECONCILED');
  return confirmed > 0 && states.slice(0, confirmed).some(state => uncertainStates.includes(state));
}
function journalRecovery(journal: ExecutionJournal | null | undefined, entityId?: string) {
  return resolvedUncertainty((journal?.entries ?? []).filter(entry => entry.level === 'attempt' && (!entityId || entry.entityId === entityId)).map(entry => entry.toState));
}
function comparison(label: string, planned: string | null | undefined, actual: string | null | undefined, decimals: number, symbol: string): EvidenceComparison[] {
  const expected = simulationAmount(planned, decimals, symbol), observed = simulationAmount(actual, decimals, symbol);
  return expected !== null && observed !== null ? [{ label, planned: expected, actual: observed }] : [];
}

export function executionStepEvidence(step: LifecycleStep, restored = false, facts: ReadonlyMap<string, OperationEvidence> = new Map()): ExecutionStepEvidence {
  const business = step.operations.filter(operation => !operation.approval);
  const confirmed = step.state === 'confirmed';
  const reconciled = confirmed && business.length > 0 && business.every(operation => facts.get(operation.id)?.reconciled);
  const recovered = confirmed && step.operations.some(operation => facts.get(operation.id)?.recovered);
  const declined = step.operations.some(operation => operation.label === 'Wallet request declined' && !operation.hash);
  const label = reconciled ? 'Reconciled' : step.state === 'uncertain' ? 'Unresolved' : declined && step.state === 'failed' ? 'Wallet confirmation declined' : step.label;
  const message = recovered ? 'A previously uncertain request is now confirmed from its recorded execution.'
    : reconciled ? 'Reconciliation confirmed this step’s execution effects.'
    : confirmed ? business.some(operation => operation.intent) ? 'Order settlement is confirmed in the execution record.' : 'The recorded requests for this step are confirmed.'
    : step.state === 'uncertain' ? 'FloFi has not yet confirmed the final state of this step.'
    : declined ? 'Wallet confirmation was declined. This request has no recorded transaction.'
    : step.state === 'waiting' ? 'Awaiting the next authorized action.'
    : step.state === 'failed' ? 'This step did not complete. Earlier confirmed actions remain recorded.'
    : step.state === 'not-submitted' ? 'This request was recorded as not submitted.'
    : step.state === 'cancelled' ? 'This request is recorded as cancelled.'
    : step.state === 'expired' ? 'This request is recorded as expired.' : 'The final result is still pending.';
  const comparisons = confirmed ? business.flatMap(operation => facts.get(operation.id)?.comparisons ?? []) : [];
  return { label, message, reconciled, recovered, restored, comparisons };
}

export function projectExecutionStepEvidence(source: ExecutionLifecycleSource, progress: ExecutionLifecycle): Record<string, ExecutionStepEvidence> {
  const facts = new Map<string, OperationEvidence>();
  const add = (id: string, reconciled: boolean, recovered = false, comparisons: EvidenceComparison[] = []) => facts.set(id, { reconciled, recovered, comparisons });
  switch (source.kind) {
    case 'supply': {
      const record = source.state.record;
      for (const attempt of record?.attempts ?? []) add(attempt.step, attempt.reconciled, journalRecovery(record?.journal, `${record?.id}.${attempt.step}`));
      break;
    }
    case 'lending': {
      const record = source.state.record;
      for (const attempt of record?.attempts ?? []) add(attempt.step, attempt.reconciled, journalRecovery(record?.journal, attempt.id));
      break;
    }
    case 'public': {
      const run = source.state.run, outcome = run?.outcome;
      const reconciled = outcome?.evidence.outcome === 'RECONCILED';
      const decimals = (symbol: 'USDC' | 'WETH') => symbol === 'USDC' ? 6 : 18;
      add('swap', reconciled, false, reconciled && run ? [
        ...comparison('Input', run.quote.amountIn, outcome?.inputSpent, decimals(run.quote.inputSymbol), run.quote.inputSymbol),
        ...comparison('Output', run.quote.expectedOut, outcome?.outputReceived, decimals(run.quote.outputSymbol), run.quote.outputSymbol),
      ] : []);
      break;
    }
    case 'router': {
      const record = source.state.record;
      for (const attempt of record?.attempts ?? []) add(attempt.step, attempt.reconciled);
      add('destination', record?.verdict === 'RECONCILED');
      break;
    }
    case 'uniswap-pool': {
      for (const attempt of source.state.record?.attempts ?? []) add(attempt.step, attempt.reconciled);
      break;
    }
    case 'solana-swap': case 'solana-pool': {
      const record = source.state.record;
      add('transaction', Boolean(record?.attempt?.reconciled), journalRecovery(record?.journal));
      break;
    }
    case 'transfer': {
      const record = source.state.record;
      add('transfer', Boolean(record?.attempt?.reconciled), journalRecovery(record?.journal));
      break;
    }
    case 'fork-swap': {
      const record = source.state.execution, prepared = source.state.prepared, evidence = record?.evidence.at(-1);
      const swap = record?.attempts.filter(attempt => attempt.stepId === 'step-swap').at(-1);
      const observations = record?.observations.filter(observation => observation.attemptId === swap?.executionAttemptId) ?? [];
      add('step-swap', evidence?.outcome === 'RECONCILED', resolvedUncertainty(observations.map(observation => observation.outcome === 'CONFIRMED_NOT_RECONCILED' ? 'CONFIRMED' : observation.outcome)),
        evidence?.outcome === 'RECONCILED' && prepared ? comparison('Output', prepared.quotedOut, evidence.observedOut, prepared.decimalsOut, prepared.symbolOut) : []);
      break;
    }
    case 'fork-pool': {
      const status = source.state.status, attempt = status?.journal?.attempts.at(-1);
      add('liquidity', status?.reconciliation?.outcome === 'RECONCILED', attempt ? journalRecovery(status?.canonicalJournal, attempt.executionAttemptId) : false);
      break;
    }
    case 'delegated-swap': {
      add('swap', source.state.status?.prepared.reconciliation?.outcome === 'RECONCILED');
      break;
    }
    case 'composition': {
      const status = source.state.status;
      for (const id of ['SWAP', 'MINT'] as const) {
        const events = status?.events.filter(event => event.level === 'ATTEMPT' && event.step === id) ?? [], latest = events.at(-1);
        const history = events.filter(event => event.callHash === latest?.callHash);
        add(id, latest?.state === 'RECONCILED', resolvedUncertainty(history.map(event => event.state)),
          id === 'SWAP' && latest?.state === 'RECONCILED' ? comparison('Output', status?.prepared.quoteOut, latest.actualWETH, 18, 'WETH') : []);
      }
      break;
    }
    case 'cow': {
      const record = source.state.execution?.record;
      // RECONCILIATION_REQUIRED is a normal settlement stage for an intent.
      add('order', record?.state === 'RECONCILED', resolvedUncertainty((record?.history ?? []).filter(entry => entry.state !== 'RECONCILIATION_REQUIRED').map(entry => entry.state)));
      break;
    }
    case 'unavailable': break;
  }
  return Object.fromEntries(progress.steps.map(step => [step.id, executionStepEvidence(step, progress.restored, facts)]));
}
