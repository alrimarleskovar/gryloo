// SPDX-License-Identifier: AGPL-3.0-only
import { hashArtifactBytes, type EnforcementMatrix } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { decodeApprove, decodeSwap } from './abi.js';
import { decodeUnsignedPayload, payloadIdentity, toHex, verifyModeAPair } from './payload.js';
import { type CompileContext } from './policy.js';
import { FORK_CHAIN_REF, SOURCE_CHAIN_REF } from './profile.js';
export type MatrixEnvironment = { readonly sourceBlock: { readonly height: number; readonly hash: string };
  readonly stateSourceHash: string; readonly simulationRawHash: string };
export type MatrixHashes = { readonly policyHash: string; readonly manifestHash: string; readonly executionPlanHash: string };
export function compileEnforcementMatrix(context: CompileContext, environment: MatrixEnvironment, hashes: MatrixHashes,
  approveBytes: Uint8Array, swapBytes: Uint8Array): { readonly matrix: EnforcementMatrix; readonly enforcementMatrixHash: string } {
  verifyModeAPair(approveBytes, swapBytes, { owner: context.owner, tokenIn: context.tokenIn,
    tokenOut: context.tokenOut, amountIn: context.amountIn, amountOutMinimum: context.minimumOut,
    fee: context.fee, deadline: context.deadline, nonce: context.nonce });
  const approve = decodeUnsignedPayload(approveBytes), swap = decodeUnsignedPayload(swapBytes);
  const approval = decodeApprove(approve.data), argumentsSwap = decodeSwap(swap.data);
  const common = (payload: typeof approve, stepId: string) => ({ stepId, payloadHash: payloadIdentity(stepId === 'step-approve' ? approveBytes : swapBytes).payloadHash,
    payloadProfile: 'EVM_EIP1559_UNSIGNED_V1', chainId: 31337, from: context.owner,
    nonce: payload.nonce.toString(), to: payload.to, value: '0', functionId: toHex(payload.data.subarray(0, 4)),
    gasLimit: payload.gasLimit.toString(), maxFeePerGas: payload.maxFeePerGas.toString(),
    maxPriorityFeePerGas: payload.maxPriorityFeePerGas.toString() });
  const binding = (stepId: string, field: string) => ({ stepId, field });
  const matrix = validateArtifact('enforcement-matrix', {
    schemaVersion: '1.0.0', enforcementMatrixId: `FORK.matrix.r${context.revision}.b${context.forkBlock}`,
    semanticWorkflowHash: context.semanticWorkflowHash, artifactSetHash: context.artifactSetHash,
    simulationHash: context.simulationHash, policyHash: hashes.policyHash,
    manifestHash: hashes.manifestHash, executionPlanHash: hashes.executionPlanHash, authorizationMode: 'MODE_A',
    environment: { evidenceEnvironment: 'FORK_REPRODUCED', executionChainId: FORK_CHAIN_REF,
      sourceChainId: SOURCE_CHAIN_REF, sourceBlock: environment.sourceBlock,
      stateSourceHash: environment.stateSourceHash, simulationRawHash: environment.simulationRawHash },
    payloads: [
      { ...common(approve, 'step-approve'), arguments: { kind: 'APPROVE', spender: approval.spender, amount: approval.amount.toString() } },
      { ...common(swap, 'step-swap'), arguments: { kind: 'EXACT_INPUT_SINGLE', tokenIn: argumentsSwap.tokenIn,
        tokenOut: argumentsSwap.tokenOut, fee: argumentsSwap.fee, recipient: argumentsSwap.recipient,
        amountIn: argumentsSwap.amountIn.toString(), amountOutMinimum: argumentsSwap.amountOutMinimum.toString(),
        sqrtPriceLimitX96: '0', deadline: argumentsSwap.deadline.toString() } },
    ],
    limits: [
      { limitId: 'exact-signed-fields', description: 'Chain, target, nonce, selector, value, gas and fee caps are signed', value: '31337',
        locations: ['EXACT_SIGNED_PAYLOAD'], payloadBindings: [binding('step-approve', 'chainId'), binding('step-swap', 'chainId')] },
      { limitId: 'finite-approval', description: 'Router allowance is exactly the input amount', value: context.amountIn.toString(),
        locations: ['EXACT_SIGNED_PAYLOAD'], payloadBindings: [binding('step-approve', 'arguments.amount')] },
      { limitId: 'swap-inputs', description: 'Token pair, fee tier, owner recipient and amount are signed', value: context.amountIn.toString(),
        locations: ['EXACT_SIGNED_PAYLOAD'], payloadBindings: [binding('step-swap', 'arguments.amountIn'), binding('step-swap', 'arguments.recipient')] },
      { limitId: 'minimum-output', description: 'Minimum output is checked by the router', value: context.minimumOut.toString(),
        locations: ['EXACT_SIGNED_PAYLOAD'], payloadBindings: [binding('step-swap', 'arguments.amountOutMinimum')] },
      { limitId: 'deadline', description: 'Router checks the signed multicall deadline', value: context.deadline.toString(),
        locations: ['EXACT_SIGNED_PAYLOAD'], payloadBindings: [binding('step-swap', 'arguments.deadline')] },
      { limitId: 'slippage-bps', description: 'Gateway derives signed minimum output from slippage', value: String(context.slippageBps),
        locations: ['APPLICATION_GATEWAY'], payloadBindings: [binding('step-swap', 'arguments.amountOutMinimum')] },
      { limitId: 'quote-and-order', description: 'Fresh quote, simulation, zero preexisting allowance, balances and step order', value: 'review-required',
        locations: ['APPLICATION_GATEWAY'], payloadBindings: [] },
      { limitId: 'residual-authority', description: 'Residual allowance and fund location are monitored', value: 'reconcile',
        locations: ['MONITOR_ONLY'], payloadBindings: [] },
      { limitId: 'cumulative-reservation', description: 'No independent cumulative reservation in Mode A', value: 'not-enforced',
        locations: ['NOT_ENFORCED'], payloadBindings: [] },
      { limitId: 'revocation-epoch', description: 'No independent revocation epoch enforcement in Mode A', value: 'not-enforced',
        locations: ['NOT_ENFORCED'], payloadBindings: [] },
    ],
    limitations: ['FORK_REPRODUCED_NOT_MAINNET', 'NOT_CURRENT_MARKET', 'SINGLE_PROVIDER_STATE_SOURCE',
      'CODE_PINS_TRUST_ON_FIRST_USE', 'FORK_SETUP_BALANCE_OVERRIDE', 'V1_POLICY_MANIFEST_PLAN_NOT_ENFORCEMENT'],
  });
  return { matrix, enforcementMatrixHash: hashArtifactBytes('enforcement-matrix', new TextEncoder().encode(JSON.stringify(matrix))) };
}
