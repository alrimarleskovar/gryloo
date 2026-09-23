import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { invalidationFor, type ChangeKind } from '../src/invalidation.js';

it('matches frozen invalidation cases', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../tests/compatibility/v1/invalidation-cases.json', import.meta.url), 'utf8'));
  for (const item of fixture.cases) expect(invalidationFor(item.change)).toEqual(item.invalidates);
});
it('quote refresh preserves the semantic workflow while retiring dependent authority', () => {
  const result = invalidationFor('QUOTE_REFRESH');
  expect(result).not.toContain('semantic-workflow');
  expect(result).toEqual(expect.arrayContaining(['simulation-bundle', 'authorization-policy', 'strategy-manifest', 'authorization']));
  expect(Object.isFrozen(result)).toBe(true);
});
it('expiration retires authority; journal/evidence append never creates it', () => {
  expect(invalidationFor('ARTIFACT_EXPIRED')).toContain('authorization');
  expect(invalidationFor('JOURNAL_APPEND')).toEqual([]);
  expect(invalidationFor('EVIDENCE_APPEND')).toEqual([]);
  expect(() => invalidationFor('UNKNOWN' as ChangeKind)).toThrow();
});
