// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { product } from './product';

describe('reference product boundary', () => {
  it('states the local mock and non-execution limits without authority claims', () => {
    expect(product).toMatchObject({
      build: 'BUILD-003A', environment: 'MOCKED', authorization: 'NONE',
      enforcement: 'NOT_ENFORCED', outcome: 'NOT_APPLICABLE', chain: 'Base authoring · mock examples',
    });
    expect(Object.isFrozen(product)).toBe(true);
  });
});
