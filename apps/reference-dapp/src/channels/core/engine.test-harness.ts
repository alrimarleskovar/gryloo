// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test-only: a MOCKED engine runtime for channel tests at the HTTP boundary — flows in harness mode and a MOCKED Aave preview; any
 * execution method (run, journal, evidence) is recorded as `EXECUTION_PATH` and refused, so a test can prove a channel never reached one.
 */
import type { FlowName } from '../../../backend/flows.ts';
import type { EngineRuntime } from '../../platform/index.ts';

export function recordingRuntime(calls: string[]): EngineRuntime {
  const modes: Partial<Record<FlowName, 'harness'>> = { 'aave-supply': 'harness', 'crosschain-router-testnet': 'harness', 'base-sepolia-swap': 'harness' };
  const never = async (): Promise<never> => { calls.push('EXECUTION_PATH'); throw new Error('NEVER'); };
  return { kind: 'embedded', mode: async flow => { calls.push(`mode:${flow}`); return modes[flow] ?? 'off'; },
    info: async flow => { calls.push(`info:${flow}`); return { executionEnabled: true }; },
    preview: async flow => { calls.push(`preview:${flow}`); const at = new Date().toISOString();
      return flow === 'aave-supply' ? { ok: true, value: { provenance: 'MOCKED', review: { state: { observedAt: at }, expiresAt: at } } } : { ok: false, code: 'PREVIEW_UNAVAILABLE' }; },
    run: never, journal: never, evidence: never };
}
