// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest';
import { assertPrivacyExecutionReady, markPrivacyConfirmationForReconciliation } from '../src/privacy.js';
import { appendJournalState, createJournal } from '../src/journal.js';
import { hashJournalBytes } from '@defi-workflow-engine/workflow-contracts';
it('blocks every failed privacy precondition before a financial hand-off', () => {
  const ready = { id: 'cloak' as const, preparedStateDurable: true, simulationVerified: true, manifestRequirementHonored: true, ownerUnchanged: true };
  expect(() => assertPrivacyExecutionReady(ready)).not.toThrow();
  for (const field of ['preparedStateDurable', 'simulationVerified', 'manifestRequirementHonored', 'ownerUnchanged'])
    expect(() => assertPrivacyExecutionReady({ ...ready, [field]: false })).toThrow();
});
it('uses the canonical hash-linked journal to mark a public confirmation as requiring reconciliation', () => {
  const at = '2026-10-04T12:00:00.000Z';
  let journal = createJournal({ journalId: 'cloak-run', workflowId: 'workflow', executionPlanHash: '0x' + '1'.repeat(64), manifestHash: '0x' + '2'.repeat(64) });
  const append = (level: 'workflow' | 'segment' | 'step' | 'attempt', toState: 'DRAFT' | 'PLANNED' | 'PREPARED' | 'SUBMITTING' | 'CONFIRMED') => {
    journal = appendJournalState(journal, { level, entityId: level === 'workflow' ? 'workflow' : level === 'segment' ? 'segment' : level === 'step' ? 'swap' : 'attempt',
      segmentId: level === 'workflow' ? null : 'segment', stepId: ['step', 'attempt'].includes(level) ? 'swap' : null,
      executionAttemptId: level === 'attempt' ? 'attempt' : null, toState, recordedAt: at }).journal;
  };
  append('workflow', 'DRAFT'); append('segment', 'PLANNED'); append('step', 'PLANNED');
  append('attempt', 'PREPARED'); append('attempt', 'SUBMITTING'); append('attempt', 'CONFIRMED');
  const requiring = markPrivacyConfirmationForReconciliation(journal, 'attempt', at);
  expect(requiring.entries.at(-1)?.toState).toBe('RECONCILIATION_REQUIRED');
  expect(hashJournalBytes(new TextEncoder().encode(JSON.stringify(requiring)))).toHaveLength(7);
  expect(journal.entries).toHaveLength(6);
});
