// SPDX-License-Identifier: AGPL-3.0-only
import { hashJournalBytes, type ExecutionJournal, type JournalEntry, type JournalLevel } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';

export type JournalIdentity = { readonly journalId: string; readonly workflowId: string;
  readonly executionPlanHash: string; readonly manifestHash: string };
export type TransitionInput = { readonly level: JournalLevel; readonly entityId: string;
  readonly segmentId: string | null; readonly stepId: string | null;
  readonly executionAttemptId: string | null; readonly toState: JournalEntry['toState'];
  readonly recordedAt: string };
export function createJournal(identity: JournalIdentity): ExecutionJournal {
  return validateArtifact('execution-journal', { schemaVersion: '1.0.0', ...identity, entries: [] });
}
export function appendJournalState(journal: ExecutionJournal, next: TransitionInput): {
  readonly journal: ExecutionJournal; readonly headHash: string;
} {
  const verified = validateArtifact('execution-journal', journal);
  const priorHashes = hashJournalBytes(new TextEncoder().encode(JSON.stringify(verified)));
  const prior = [...verified.entries].reverse().find(entry => entry.level === next.level && entry.entityId === next.entityId);
  const entry: JournalEntry = {
    schemaVersion: '1.0.0', entryId: `entry-${verified.entries.length}`, sequence: verified.entries.length,
    previousEntryHash: priorHashes.at(-1) ?? null, recordedAt: next.recordedAt,
    eventType: 'STATE_TRANSITION', level: next.level, entityId: next.entityId,
    workflowId: verified.workflowId, segmentId: next.segmentId, stepId: next.stepId,
    executionAttemptId: next.executionAttemptId, fromState: prior?.toState ?? null,
    toState: next.toState,
  };
  const updated = validateArtifact('execution-journal', { ...verified, entries: [...verified.entries, entry] });
  const hashes = hashJournalBytes(new TextEncoder().encode(JSON.stringify(updated)));
  const headHash = hashes.at(-1);
  if (!headHash) throw new Error('JOURNAL_CORRUPT');
  return { journal: updated, headHash };
}
