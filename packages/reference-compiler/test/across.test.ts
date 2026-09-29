// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { providerAuthorized } from '../src/across';
describe('provider identity in signed policy', () => {
  it('never replaces fixed LI.FI authority with Across', () => {
    expect(providerAuthorized({ kind: 'FIXED', providerId: 'lifi.rest' }, 'across.direct', true)).toBe(false);
    expect(providerAuthorized({ kind: 'FIXED', providerId: 'across.direct' }, 'across.direct', true)).toBe(true);
  });
  it('requires both explicit set membership and matching material bounds', () => {
    const set = { kind: 'AUTHORIZED_SET' as const, providerIds: ['lifi.rest', 'across.direct'] };
    expect(providerAuthorized(set, 'across.direct', true)).toBe(true);
    expect(providerAuthorized(set, 'across.direct', false)).toBe(false);
    expect(providerAuthorized({ ...set, providerIds: ['lifi.rest'] }, 'across.direct', true)).toBe(false);
  });
});
