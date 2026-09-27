// SPDX-License-Identifier: AGPL-3.0-only
/** Credential-free BUILD-006 transcript gate; fork execution is an owner-local gate. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyLiquidityTranscript } from '../../../apps/reference-dapp/e2e/fork/liquidity-replay-upstream.mjs';
import { LIQUIDITY_FACTORY, POSITION_MANAGER } from '../src/liquidity.js';
const path = join(process.cwd(), 'apps/reference-dapp/e2e/fork/liquidity-transcript.json');
describe.skipIf(!existsSync(path))('BUILD-006 closed Base transcript', () => {
  it('binds a source block, complete request inventory, and separately pinned pool and manager code', () => {
    const document = JSON.parse(readFileSync(path, 'utf8'));
    const verified = verifyLiquidityTranscript(document, document.identity.accounts);
    expect(verified.providerRequests).toBeGreaterThan(0);
    expect(verified.pool.pool).not.toBe(LIQUIDITY_FACTORY);
    expect(verified.pool.pool).not.toBe(POSITION_MANAGER);
    expect(document.sourceChainId).toBe(8453);
    expect(document.scenarioResultsSha256).toMatch(/^[0-9a-f]{64}$/);
    const altered = structuredClone(document);
    altered.codeFingerprints.pool.managerCodeHash = '0x1234';
    expect(() => verifyLiquidityTranscript(altered, altered.identity.accounts)).toThrow('LIQUIDITY_TRANSCRIPT_PINS_INVALID');
  });
});
