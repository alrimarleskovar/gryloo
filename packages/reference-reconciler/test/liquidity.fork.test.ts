// SPDX-License-Identifier: AGPL-3.0-only
/** Independent assessment of the owner-local full replay result, when supplied. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const runtime = process.env.GRYLOO_LIQUIDITY_REPLAY_RUNTIME;
const resultPath = runtime ? join(runtime, 'scenario-results.json') : '';
const transcriptPath = join(process.cwd(), 'apps/reference-dapp/e2e/fork/liquidity-transcript.json');
describe.skipIf(!resultPath || !existsSync(resultPath) || !existsSync(transcriptPath))('BUILD-006 replay reconciliation', () => {
  it('requires every signed lifecycle step to carry independent reconciled evidence', () => {
    const bytes = readFileSync(resultPath);
    const scenario = JSON.parse(bytes.toString('utf8'));
    const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(transcript.scenarioResultsSha256);
    expect(scenario.lifecycle.status).toBe('COMPLETE');
    const operations = scenario.lifecycle.steps.map((step: { operation: string }) => step.operation);
    for (const required of ['APPROVE_WETH', 'APPROVE_USDC', 'MINT', 'INCREASE', 'DECREASE_PARTIAL',
      'COLLECT_PARTIAL', 'DECREASE_FULL', 'COLLECT_FINAL', 'BURN']) expect(operations).toContain(required);
    for (const step of scenario.lifecycle.steps) {
      expect(step.outcome).toBe('RECONCILED');
      expect(step.evidenceBundleHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(step.journalEntries).toBeGreaterThan(0);
      expect(step.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});
