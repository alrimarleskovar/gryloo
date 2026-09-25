// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModeAPair } from '../src/payload.js';
import { compilePolicy, type CompileContext } from '../src/policy.js';
import { compileManifest } from '../src/manifest.js';
import { compileExecutionPlan } from '../src/execution-plan.js';
import { compileEnforcementMatrix } from '../src/enforcement.js';
const vector = JSON.parse(readFileSync(new URL('../../../tests/compatibility/v1/mode-a-payload-vectors.json', import.meta.url), 'utf8'));
const hash = (digit: string) => '0x' + digit.repeat(64);
const context: CompileContext = { nodeId: 'swap-1', revision: 1, forkBlock: 123,
  semanticWorkflowHash: hash('1'), artifactSetHash: hash('2'), simulationHash: hash('3'),
  owner: vector.owner, tokenIn: vector.tokenIn, tokenOut: vector.tokenOut,
  tokenInDecimals: 6, tokenOutDecimals: 18, amountIn: 1_000_000n,
  quotedOut: 100_000_000_000_000n, minimumOut: 99_000_000_000_000n,
  slippageBps: 100, fee: 500, nonce: 0n, deadline: 1_790_000_180n,
  approveGasLimit: 60_000n, swapGasLimit: 250_000n, maxFeePerGas: 3_000_000n };
function compile(c = context) {
  const pair = buildModeAPair({ ...c, amountOutMinimum: c.minimumOut });
  const { policy, policyHash } = compilePolicy(c);
  const { manifest, manifestHash } = compileManifest(c, policy, policyHash);
  const { plan, executionPlanHash } = compileExecutionPlan(c, manifestHash, pair.approveBytes, pair.swapBytes);
  const { matrix, enforcementMatrixHash } = compileEnforcementMatrix(c,
    { sourceBlock: { height: 100, hash: hash('4') }, stateSourceHash: hash('5'), simulationRawHash: hash('6') },
    { policyHash, manifestHash, executionPlanHash }, pair.approveBytes, pair.swapBytes);
  return { policy, policyHash, manifest, manifestHash, plan, executionPlanHash, matrix, enforcementMatrixHash };
}
describe('deterministic Mode A contract compilation', () => {
  it('links the four artifacts and two exact payloads deterministically', () => {
    const a = compile(), b = compile();
    expect(a).toEqual(b);
    expect(a.manifest.policyHash).toBe(a.policyHash);
    expect(a.plan.manifestHash).toBe(a.manifestHash);
    expect(a.matrix.executionPlanHash).toBe(a.executionPlanHash);
    expect(a.matrix.payloads).toHaveLength(2);
  });
  it('rejects invalid slippage and broken upstream links', () => {
    expect(() => compile({ ...context, minimumOut: context.minimumOut - 1n })).toThrow('COMPILER_INPUT_INVALID');
    const { policy, policyHash } = compilePolicy(context);
    expect(() => compileManifest(context, { ...policy, simulationHash: hash('7') }, policyHash)).toThrow('ARTIFACT_LINK_MISMATCH');
  });
});

describe('material-change and invalidation table', () => {
  const keys = ['policyHash', 'manifestHash', 'executionPlanHash', 'enforcementMatrixHash'] as const;
  it('changes all dependent hashes when a quote artifact or simulation is refreshed, without changing the IR', () => {
    const baseline = compile();
    for (const changed of [{ ...context, artifactSetHash: hash('8') }, { ...context, simulationHash: hash('9') }]) {
      const next = compile(changed);
      expect(changed.semanticWorkflowHash).toBe(context.semanticWorkflowHash);
      for (const key of keys) expect(next[key]).not.toBe(baseline[key]);
    }
  });
  it('changes payload-bound plan and matrix when a fee tier or amount changes', () => {
    const baseline = compile();
    for (const changed of [{ ...context, fee: 3000 as const },
      { ...context, amountIn: 2_000_000n }]) {
      const next = compile(changed);
      expect(next.executionPlanHash).not.toBe(baseline.executionPlanHash);
      expect(next.enforcementMatrixHash).not.toBe(baseline.enforcementMatrixHash);
      expect(next.matrix.payloads[1]?.payloadHash).not.toBe(baseline.matrix.payloads[1]?.payloadHash);
    }
  });
});
