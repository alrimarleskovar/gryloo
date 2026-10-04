// SPDX-License-Identifier: AGPL-3.0-only
import { appendJournalState } from './journal.js';
import type { ExecutionJournal } from '@defi-workflow-engine/workflow-contracts';

/** A narrow provider hand-off, reusing the existing hash-linked attempt journal. */
export type PrivacyProvider = { readonly id: 'cloak'; readonly preparedStateDurable: boolean; readonly simulationVerified: boolean;
  readonly manifestRequirementHonored: boolean; readonly ownerUnchanged: boolean };
export function assertPrivacyExecutionReady(provider: PrivacyProvider): void {
  if (provider.id !== 'cloak' || !provider.manifestRequirementHonored) throw new Error('PRIVACY_REQUIREMENT_NOT_HONORED');
  if (!provider.ownerUnchanged) throw new Error('PRIVACY_OWNER_CHANGED');
  if (!provider.preparedStateDurable) throw new Error('PRIVACY_PREPARED_STATE_NOT_DURABLE');
  if (!provider.simulationVerified) throw new Error('PRIVACY_SIMULATION_REQUIRED');
}

/** Confirmation denotes a chain observation only. The attempt requires separate private reconciliation. */
export function markPrivacyConfirmationForReconciliation(journal: ExecutionJournal, attemptId: string, recordedAt: string): ExecutionJournal {
  const latest = [...journal.entries].reverse().find(e => e.level === 'attempt' && e.executionAttemptId === attemptId);
  if (!latest || latest.toState !== 'CONFIRMED') throw new Error('PRIVACY_ATTEMPT_NOT_CONFIRMED');
  return appendJournalState(journal, { level: 'attempt', entityId: attemptId, segmentId: latest.segmentId,
    stepId: latest.stepId, executionAttemptId: attemptId, toState: 'RECONCILIATION_REQUIRED', recordedAt }).journal;
}
