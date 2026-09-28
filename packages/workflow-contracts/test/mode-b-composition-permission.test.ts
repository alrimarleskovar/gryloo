import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashModeBCompositionPermission } from '../src/mode-b-composition-permission.js';
const vector = JSON.parse(readFileSync(new URL('../../../tests/compatibility/v2/mode-b-composition-vectors.json', import.meta.url), 'utf8')) as
  { permission: Record<string, unknown>; digest: string };
describe('additive Mode B composition permission', () => {
  it('binds all fields, rejects extras and leaves earlier vectors untouched', () => {
    expect(hashModeBCompositionPermission(vector.permission)).toBe(vector.digest);
    for (const changed of [
      { ...vector.permission, recipient: '0x5555555555555555555555555555555555555555' },
      { ...vector.permission, tickUpper: -197300 },
      { ...vector.permission, swapCalldata: '0x1234' },
      { ...vector.permission, totalUSDCBudget: '599999999' },
      { ...vector.permission, extra: 1 },
    ]) {
      if ('extra' in changed || changed.recipient !== vector.permission.recipient || changed.totalUSDCBudget !== vector.permission.totalUSDCBudget)
        expect(() => hashModeBCompositionPermission(changed)).toThrow();
      else expect(hashModeBCompositionPermission(changed)).not.toBe(vector.digest);
    }
  });
});
