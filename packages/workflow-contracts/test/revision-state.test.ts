import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { nextRevision, RevisionConflictError } from '../src/revision.js';
import { assertTransition, INITIAL_STATES, STATE_TRANSITIONS, type JournalLevel } from '../src/state-transitions.js';

const read = (name: string) => JSON.parse(readFileSync(new URL('../../../tests/compatibility/v1/' + name, import.meta.url), 'utf8'));

describe('revision compatibility', () => {
  it('replays frozen successful and conflicting updates', () => {
    for (const item of read('revision-conflicts.json').cases) {
      if (item.error) expect(() => nextRevision(item.currentRevision, item.baseRevision, item.materialChange)).toThrow(RevisionConflictError);
      else expect(nextRevision(item.currentRevision, item.baseRevision, item.materialChange)).toBe(item.expectedRevision);
    }
  });
  it('prevents concurrent stale updates including a no-op', () => {
    const accepted = nextRevision(4, 4, true);
    expect(accepted).toBe(5);
    expect(() => nextRevision(accepted, 4, true)).toThrow(RevisionConflictError);
    expect(() => nextRevision(accepted, 4, false)).toThrow(RevisionConflictError);
    expect(accepted).toBe(5);
  });
  it('rejects invalid and overflowing revisions', () => {
    for (const value of [-1, 0.1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => nextRevision(value, value, true)).toThrow();
    }
    expect(() => nextRevision(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, true)).toThrow('overflow');
  });
});

describe('hierarchical state contracts', () => {
  it('replays independently specified positive and negative cases', () => {
    for (const item of read('state-transitions.json').cases) {
      const action = () => assertTransition(item.level, item.from, item.to);
      if (item.valid) expect(action).not.toThrow();
      else expect(action).toThrow();
    }
  });
  it('rejects wrong-level states, terminal restarts and repeated transitions', () => {
    expect(() => assertTransition('workflow', 'PREPARED', 'SUBMITTING')).toThrow();
    expect(() => assertTransition('attempt', 'CONFIRMED', 'COMPLETED')).toThrow();
    expect(() => assertTransition('attempt', 'NOT_FOUND', 'SUBMITTING')).toThrow();
    expect(() => assertTransition('workflow', 'COMPLETED', 'EXECUTING')).toThrow();
    for (const level of Object.keys(STATE_TRANSITIONS) as JournalLevel[]) {
      expect(() => assertTransition(level, INITIAL_STATES[level], INITIAL_STATES[level])).toThrow();
      expect(() => assertTransition(level, null, 'SUBMITTING')).toThrow();
    }
  });
});
