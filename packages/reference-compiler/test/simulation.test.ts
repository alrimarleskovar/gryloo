// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { interpretExactSimulation, type ExactSimulation } from '../src/simulation.js';
const result: ExactSimulation = {
  approval: { status: 'SUCCESS', gasUsed: 40_001n, gasLimit: 50_002n, revertReason: null },
  swap: { status: 'SUCCESS', gasUsed: 200_001n, gasLimit: 250_002n, revertReason: null },
  decodedAmountOut: 110n, ownerTransferAmountOut: 110n,
  inputDebited: 1000n, allowanceAfterSwap: 0n, residualAllowanceIfSwapFails: 1000n,
  stateOverrides: [], validation: true,
};
const inspect = (first = result, rebuilt = result) => interpretExactSimulation(first, rebuilt, 1000n, 110n, 100n);
describe('exact two-call simulation interpretation', () => {
  it('requires rebuilt results and rounds gas limits up to five quarters', () => {
    expect(inspect()).toEqual({ amountOut: 110n, approveGasLimit: 50_002n,
      swapGasLimit: 250_002n, residualAllowanceOnSwapFailure: 1000n });
  });
  it('blocks overrides, a revert, changed outputs and unstable rebuilds', () => {
    expect(() => inspect({ ...result, stateOverrides: [{}] })).toThrow('SIMULATION_UNSUPPORTED');
    expect(() => inspect({ ...result, swap: { status: 'REVERTED', gasUsed: 200_001n, gasLimit: 250_002n, revertReason: 'too old' } })).toThrow('SIMULATION_REVERTED');
    expect(() => inspect({ ...result, ownerTransferAmountOut: 109n })).toThrow('SIMULATION_QUOTE_MISMATCH');
    expect(() => inspect(result, { ...result, swap: { ...result.swap, gasUsed: 200_002n } })).toThrow('SIMULATION_UNSTABLE');
    expect(() => inspect(result, { ...result, swap: { ...result.swap, gasLimit: 250_003n } })).toThrow('SIMULATION_UNSTABLE');
  });
});

import { buildModeAPair, decodeUnsignedPayload } from '../src/payload.js';
import { runScriptedExactSimulation } from '../src/simulation.js';
describe('scripted two-pass exact simulation', () => {
  const context = { owner: '0x' + '1'.repeat(40), tokenIn: '0x' + '2'.repeat(40), tokenOut: '0x' + '3'.repeat(40),
    amountIn: 1000n, amountOutMinimum: 100n, fee: 500 as const, deadline: 1790000180n, nonce: 7n };
  it('sends both exact payloads twice and rebuilds only their gas limits', async () => {
    const pair = buildModeAPair({ ...context, approveGasLimit: 60_000n, swapGasLimit: 300_000n, maxFeePerGas: 3_000_000n });
    const calls: readonly [Uint8Array, Uint8Array][] = [];
    const transport = async (request: { calls: readonly [Uint8Array, Uint8Array]; validation: true; stateOverrides: readonly [] }) => {
      (calls as [Uint8Array, Uint8Array][]).push(request.calls);
      const approve = decodeUnsignedPayload(request.calls[0]), swap = decodeUnsignedPayload(request.calls[1]);
      expect(request.validation).toBe(true);
      expect(request.stateOverrides).toEqual([]);
      return { ...result, approval: { ...result.approval, gasLimit: approve.gasLimit },
        swap: { ...result.swap, gasLimit: swap.gasLimit } };
    };
    const output = await runScriptedExactSimulation(transport, pair.approveBytes, pair.swapBytes, context, 110n);
    expect(calls).toHaveLength(2);
    expect(decodeUnsignedPayload(output.approveBytes).gasLimit).toBe(50_002n);
    expect(decodeUnsignedPayload(output.swapBytes).gasLimit).toBe(250_002n);
    expect(decodeUnsignedPayload(output.swapBytes).nonce).toBe(8n);
    expect(output.result.amountOut).toBe(110n);
  });
  it('never makes a second scripted request after the first pass reverts', async () => {
    const pair = buildModeAPair({ ...context, approveGasLimit: 60_000n, swapGasLimit: 300_000n, maxFeePerGas: 3_000_000n });
    let calls = 0;
    const transport = async (request: { calls: readonly [Uint8Array, Uint8Array]; validation: true; stateOverrides: readonly [] }) => {
      calls++;
      return { ...result, swap: { ...result.swap, status: 'REVERTED' as const,
        gasLimit: decodeUnsignedPayload(request.calls[1]).gasLimit } };
    };
    await expect(runScriptedExactSimulation(transport, pair.approveBytes, pair.swapBytes, context, 110n))
      .rejects.toThrow('SIMULATION_REVERTED');
    expect(calls).toBe(1);
  });
  it('blocks a changed quote on the second pass', async () => {
    const pair = buildModeAPair({ ...context, approveGasLimit: 60_000n, swapGasLimit: 300_000n, maxFeePerGas: 3_000_000n });
    let count = 0;
    const transport = async (request: { calls: readonly [Uint8Array, Uint8Array]; validation: true; stateOverrides: readonly [] }) => {
      count++;
      return { ...result, decodedAmountOut: count === 2 ? 111n : 110n,
        approval: { ...result.approval, gasLimit: decodeUnsignedPayload(request.calls[0]).gasLimit },
        swap: { ...result.swap, gasLimit: decodeUnsignedPayload(request.calls[1]).gasLimit } };
    };
    await expect(runScriptedExactSimulation(transport, pair.approveBytes, pair.swapBytes, context, 110n)).rejects.toThrow('SIMULATION_UNSTABLE');
  });
});
