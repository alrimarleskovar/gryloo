// SPDX-License-Identifier: AGPL-3.0-only
/** Owner-local full closed replay gate. No provider credential or external network route. */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const enabled = process.env.GRYLOO_LIQUIDITY_OWNER_REPLAY === '1';
describe.skipIf(!enabled)('BUILD-006 complete chain-31337 replay', () => {
  it('reproduces the owner-recorded lifecycle byte-identically', () => {
    const run = spawnSync(process.execPath, ['apps/reference-dapp/e2e/fork/liquidity-recording.mjs', 'replay-verify'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 1_800_000,
      env: { ...process.env, GRYLOO_LIQUIDITY_REPLAY_RUNTIME: join(tmpdir(), `gryloo-build-006-replay-${randomUUID()}`) },
    });
    expect(run.status, `${run.error?.message ?? ''} ${run.stderr.slice(-500)}`).toBe(0);
    expect(JSON.parse(run.stdout).status).toBe('REPLAY_BYTE_IDENTICAL');
  }, 1_800_000);
});
