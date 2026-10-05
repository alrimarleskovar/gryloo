// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { loadMigrations, SHIPPED_MIGRATIONS } from '../src/index.js';

describe('BUILD-CLOUD-PARITY-001 shipped migration manifest', () => {
  it('equals the identities of the SQL files exactly (a new or edited migration must update it)', async () => {
    const files = await loadMigrations();
    expect(SHIPPED_MIGRATIONS).toEqual(files.map(({ version, name, sha256 }) => ({ version, name, sha256 })));
  });
  it('is frozen', () => {
    expect(Object.isFrozen(SHIPPED_MIGRATIONS)).toBe(true);
    expect(SHIPPED_MIGRATIONS.every(Object.isFrozen)).toBe(true);
  });
});
