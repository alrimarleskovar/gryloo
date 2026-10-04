// SPDX-License-Identifier: AGPL-3.0-only
import { assertTransition, type ExecutionJournal, type JournalEntry, type JournalLevel } from '@defi-workflow-engine/workflow-contracts';
import { digestCloakJournal } from '@defi-workflow-engine/reference-linter';
import { PrivateStateVault, type PrivateStateIdentity } from './vault';

export function cloakJournalIdentity(identity: PrivateStateIdentity, workflowId: string, planHash: string): ExecutionJournal {
  return { schemaVersion: '1.0.0', journalId: identity.runId, workflowId, executionPlanHash: planHash, manifestHash: identity.manifestHash, entries: [] };
}
export async function appendCloakJournal(journal: ExecutionJournal, level: JournalLevel, state: JournalEntry['toState'], recordedAt: string): Promise<ExecutionJournal> {
  const hashes = await digestCloakJournal(journal);
  const entityId = level === 'workflow' ? journal.workflowId : level === 'segment' ? 'cloak.live.segment' : level === 'step' ? 'cloak.live.submit' : journal.journalId + '-attempt';
  const prior = [...journal.entries].reverse().find(e => e.level === level && e.entityId === entityId);
  assertTransition(level, prior?.toState ?? null, state);
  const entry: JournalEntry = { schemaVersion: '1.0.0', entryId: 'entry-' + journal.entries.length, sequence: journal.entries.length,
    previousEntryHash: hashes.at(-1) ?? null, recordedAt, eventType: 'STATE_TRANSITION', level, entityId, workflowId: journal.workflowId,
    segmentId: level === 'workflow' ? null : 'cloak.live.segment', stepId: ['workflow', 'segment'].includes(level) ? null : 'cloak.live.submit',
    executionAttemptId: level === 'attempt' ? entityId : null, fromState: prior?.toState ?? null, toState: state };
  const result = { ...journal, entries: [...journal.entries, entry] }; await digestCloakJournal(result); return result;
}
export async function saveCloakJournal(vault: PrivateStateVault, identity: PrivateStateIdentity, journal: ExecutionJournal): Promise<void> {
  if (journal.manifestHash !== identity.manifestHash || journal.journalId !== identity.runId) throw new Error('CLOAK_JOURNAL_IDENTITY_CHANGED');
  await digestCloakJournal(journal); await vault.saveExecution(identity, 'execution.journal.' + journal.entries.length, journal);
}
export async function loadCloakJournal(vault: PrivateStateVault, identity: PrivateStateIdentity): Promise<ExecutionJournal | null> {
  let latest: ExecutionJournal | null = null;
  // Bounded catalogue, no mutable head pointer. Missing a record in the middle is recovery-required.
  for (let i = 0; i < 64; i++) {
    const value = await vault.loadExecution(identity, 'execution.journal.' + i);
    if (value === null) continue;
    const journal = value as ExecutionJournal;
    if (journal.manifestHash !== identity.manifestHash || journal.journalId !== identity.runId || journal.entries.length !== i ||
        latest && (latest.entries.length !== i - 1 || JSON.stringify(journal.entries.slice(0, -1)) !== JSON.stringify(latest.entries)))
      throw new Error('CLOAK_JOURNAL_CHECKPOINT_DIVERGENT');
    if (!latest && i !== 0) throw new Error('CLOAK_JOURNAL_CHECKPOINT_MISSING');
    await digestCloakJournal(journal); latest = journal;
  }
  return latest;
}
