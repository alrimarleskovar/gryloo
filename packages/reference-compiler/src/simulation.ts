// SPDX-License-Identifier: AGPL-3.0-only
/** Pure interpretation of two eth_simulateV1 calls. The transport is supplied by a later phase. */
export type SimulatedCall = {
  readonly status: 'SUCCESS' | 'REVERTED'; readonly gasUsed: bigint; readonly gasLimit: bigint;
  readonly revertReason: string | null;
};
export type ExactSimulation = {
  readonly approval: SimulatedCall; readonly swap: SimulatedCall;
  readonly decodedAmountOut: bigint; readonly ownerTransferAmountOut: bigint;
  readonly inputDebited: bigint; readonly allowanceAfterSwap: bigint;
  readonly residualAllowanceIfSwapFails: bigint;
  readonly stateOverrides: readonly unknown[]; readonly validation: boolean;
};
export type SimulationResult = {
  readonly amountOut: bigint; readonly approveGasLimit: bigint;
  readonly swapGasLimit: bigint; readonly residualAllowanceOnSwapFailure: bigint;
};
const gasLimit = (used: bigint): bigint => {
  if (used <= 0n) throw new Error('SIMULATION_UNSTABLE');
  return (used * 5n + 3n) / 4n;
};
export function interpretExactSimulation(first: ExactSimulation, rebuilt: ExactSimulation,
  amountIn: bigint, quotedOut: bigint, minimumOut: bigint): SimulationResult {
  if (!first.validation || !rebuilt.validation || first.stateOverrides.length || rebuilt.stateOverrides.length) {
    throw new Error('SIMULATION_UNSUPPORTED');
  }
  if (first.approval.status !== 'SUCCESS' || first.swap.status !== 'SUCCESS') {
    throw new Error('SIMULATION_REVERTED');
  }
  if (amountIn <= 0n || quotedOut <= 0n || minimumOut <= 0n || minimumOut > quotedOut
    || first.decodedAmountOut !== quotedOut || first.ownerTransferAmountOut !== quotedOut
    || first.inputDebited !== amountIn || first.allowanceAfterSwap !== 0n
    || first.residualAllowanceIfSwapFails !== amountIn) throw new Error('SIMULATION_QUOTE_MISMATCH');
  if (rebuilt.approval.gasLimit !== gasLimit(first.approval.gasUsed)
    || rebuilt.swap.gasLimit !== gasLimit(first.swap.gasUsed)
    || rebuilt.approval.status !== 'SUCCESS' || rebuilt.swap.status !== 'SUCCESS'
    || rebuilt.decodedAmountOut !== first.decodedAmountOut
    || rebuilt.ownerTransferAmountOut !== first.ownerTransferAmountOut
    || rebuilt.inputDebited !== first.inputDebited
    || rebuilt.allowanceAfterSwap !== first.allowanceAfterSwap
    || rebuilt.residualAllowanceIfSwapFails !== first.residualAllowanceIfSwapFails
    || rebuilt.approval.gasUsed !== first.approval.gasUsed
    || rebuilt.swap.gasUsed !== first.swap.gasUsed) throw new Error('SIMULATION_UNSTABLE');
  return { amountOut: quotedOut, approveGasLimit: gasLimit(first.approval.gasUsed),
    swapGasLimit: gasLimit(first.swap.gasUsed), residualAllowanceOnSwapFailure: amountIn };
}

import { decodeUnsignedPayload, encodeUnsignedPayload, verifyModeAPair, type PairContext } from './payload.js';
export type SimulationTransport = (request: {
  readonly calls: readonly [Uint8Array, Uint8Array];
  readonly validation: true; readonly stateOverrides: readonly [];
}) => Promise<ExactSimulation>;
/** A scripted transport proves the same call pair is rebuilt with final gas limits. */
export async function runScriptedExactSimulation(transport: SimulationTransport,
  approveBytes: Uint8Array, swapBytes: Uint8Array, context: PairContext,
  quotedOut: bigint): Promise<{ readonly result: SimulationResult; readonly approveBytes: Uint8Array; readonly swapBytes: Uint8Array }> {
  verifyModeAPair(approveBytes, swapBytes, context);
  const request = (approve: Uint8Array, swap: Uint8Array) => ({ calls: [approve, swap] as [Uint8Array, Uint8Array],
    validation: true as const, stateOverrides: [] as [] });
  const first = await transport(request(approveBytes, swapBytes));
  if (!first.validation || first.stateOverrides.length) throw new Error('SIMULATION_UNSUPPORTED');
  if (first.approval.status !== 'SUCCESS' || first.swap.status !== 'SUCCESS') throw new Error('SIMULATION_REVERTED');
  if (first.decodedAmountOut !== quotedOut || first.ownerTransferAmountOut !== quotedOut
    || first.inputDebited !== context.amountIn || first.allowanceAfterSwap !== 0n
    || first.residualAllowanceIfSwapFails !== context.amountIn) throw new Error('SIMULATION_QUOTE_MISMATCH');
  const approve = decodeUnsignedPayload(approveBytes), swap = decodeUnsignedPayload(swapBytes);
  if (first.approval.gasLimit !== approve.gasLimit || first.swap.gasLimit !== swap.gasLimit
    || first.approval.gasUsed <= 0n || first.swap.gasUsed <= 0n) throw new Error('SIMULATION_UNSTABLE');
  const nextApprove = encodeUnsignedPayload({ ...approve, gasLimit: (first.approval.gasUsed * 5n + 3n) / 4n });
  const nextSwap = encodeUnsignedPayload({ ...swap, gasLimit: (first.swap.gasUsed * 5n + 3n) / 4n });
  verifyModeAPair(nextApprove, nextSwap, context);
  const rebuilt = await transport(request(nextApprove, nextSwap));
  const result = interpretExactSimulation(first, rebuilt, context.amountIn, quotedOut, context.amountOutMinimum);
  return { result, approveBytes: nextApprove, swapBytes: nextSwap };
}
