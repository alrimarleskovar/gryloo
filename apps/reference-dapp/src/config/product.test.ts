// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { product } from './product';

describe('reference product boundary', () => {
  it('states the local mock and non-execution limits without authority claims', () => {
    expect(product).toMatchObject({
      name: 'FloFi', build: 'FloFi', environment: 'MOCKED', authorization: 'NONE',
      enforcement: 'NOT_ENFORCED', outcome: 'NOT_APPLICABLE', chain: 'Base authoring · mock examples',
    });
    expect(Object.isFrozen(product)).toBe(true);
  });
  it('labels the separate local fork as chain 31337 only, never Base or mainnet', () => {
    expect(product.forkChain).toBe('Base authoring · local fork 31337');
    expect(product.forkWallet).toBe('injected · not connected');
    expect(JSON.stringify(product)).not.toMatch(/mainnet|production|certified|FORK_REPRODUCED/i);
  });
});
