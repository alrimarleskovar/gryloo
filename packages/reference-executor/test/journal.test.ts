import { describe, expect, it } from 'vitest';
import { createJournal, appendJournalState } from '../src/journal.js';
const hash = '0x' + 'a'.repeat(64);
const at = '2026-09-24T18:00:00.000Z';
describe('frozen v1 journal appending', () => {
  it('validates every transition and links exact entry hashes', () => {
    let journal = createJournal({ journalId: 'journal-1', workflowId: 'workflow-1', executionPlanHash: hash, manifestHash: hash });
    const add = (level: 'workflow' | 'segment' | 'step' | 'attempt', entityId: string, toState: 'DRAFT' | 'REVIEWED' | 'PLANNED' | 'PREPARED' | 'CONFIRMED') => {
      const next = appendJournalState(journal, { level, entityId, segmentId: level === 'workflow' ? null : 'segment-1',
        stepId: level === 'step' || level === 'attempt' ? 'step-1' : null,
        executionAttemptId: level === 'attempt' ? 'attempt-1' : null, toState, recordedAt: at });
      journal = next.journal; return next.headHash;
    };
    const head = add('workflow', 'workflow-1', 'DRAFT');
    expect(add('workflow', 'workflow-1', 'REVIEWED')).not.toBe(head);
    add('segment', 'segment-1', 'PLANNED'); add('step', 'step-1', 'PLANNED'); add('attempt', 'attempt-1', 'PREPARED');
    expect(journal.entries).toHaveLength(5);
    expect(() => add('workflow', 'workflow-1', 'CONFIRMED')).toThrow();
  });
});

import { INITIAL_STATES, STATE_TRANSITIONS, type JournalLevel } from '@defi-workflow-engine/workflow-contracts';

describe('exhaustive frozen v1 state-machine enforcement', () => {
  it('accepts every listed edge and rejects every unlisted edge at journal append', () => {
    for (const level of ['workflow', 'segment', 'step', 'attempt'] as const satisfies readonly JournalLevel[]) {
      const table = STATE_TRANSITIONS[level];
      const initial = INITIAL_STATES[level];
      const routes = new Map<string, string[]>([[initial, [initial]]]);
      const queue = [initial as string];
      while (queue.length) {
        const from = queue.shift()!;
        for (const to of (table as Record<string, readonly string[]>)[from] ?? []) {
          if (!routes.has(to)) { routes.set(to, [...routes.get(from)!, to]); queue.push(to); }
        }
      }
      expect(routes.size).toBe(Object.keys(table).length);
      let accepted = 0, rejected = 0;
      for (const [from, path] of routes) {
        let journal = createJournal({ journalId: `journal-${level}-${from}`, workflowId: 'workflow-1',
          executionPlanHash: hash, manifestHash: hash });
        const entry = (toState: string) => ({ level, entityId: `${level}-1`,
          segmentId: level === 'workflow' ? null : 'segment-1',
          stepId: level === 'step' || level === 'attempt' ? 'step-1' : null,
          executionAttemptId: level === 'attempt' ? 'attempt-1' : null,
          toState: toState as Parameters<typeof appendJournalState>[1]['toState'], recordedAt: at });
        if (level !== 'workflow') journal = appendJournalState(journal, {
          level: 'workflow', entityId: 'workflow-1', segmentId: null, stepId: null,
          executionAttemptId: null, toState: 'DRAFT', recordedAt: at }).journal;
        if (level === 'step' || level === 'attempt') journal = appendJournalState(journal, {
          level: 'segment', entityId: 'segment-1', segmentId: 'segment-1', stepId: null,
          executionAttemptId: null, toState: 'PLANNED', recordedAt: at }).journal;
        if (level === 'attempt') journal = appendJournalState(journal, {
          level: 'step', entityId: 'step-1', segmentId: 'segment-1', stepId: 'step-1',
          executionAttemptId: null, toState: 'PLANNED', recordedAt: at }).journal;
        for (const state of path) journal = appendJournalState(journal, entry(state)).journal;
        for (const target of Object.keys(table)) {
          if ((table as Record<string, readonly string[]>)[from]?.includes(target)) {
            expect(() => appendJournalState(journal, entry(target))).not.toThrow(); accepted++;
          } else {
            expect(() => appendJournalState(journal, entry(target))).toThrow(); rejected++;
          }
        }
      }
      expect(accepted).toBeGreaterThan(0);
      expect(rejected).toBeGreaterThan(0);
    }
  });
});
