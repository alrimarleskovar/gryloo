// SPDX-License-Identifier: AGPL-3.0-only
import { hashArtifactBytes, type AuthorizationPolicy } from '@defi-workflow-engine/workflow-contracts';
import { validateArtifact } from '@defi-workflow-engine/workflow-contracts/schemas';
import { APPROVE_SELECTOR, MULTICALL_SELECTOR, SWAP_ROUTER_02 } from './abi.js';
import { FORK_CHAIN_REF } from './profile.js';
export type CompileContext = {
  readonly nodeId: string; readonly revision: number; readonly forkBlock: number;
  readonly semanticWorkflowHash: string; readonly artifactSetHash: string; readonly simulationHash: string;
  readonly owner: string; readonly tokenIn: string; readonly tokenOut: string;
  readonly tokenInDecimals: number; readonly tokenOutDecimals: number;
  readonly amountIn: bigint; readonly quotedOut: bigint; readonly minimumOut: bigint;
  readonly slippageBps: number; readonly fee: 100 | 500 | 3000 | 10000;
  readonly nonce: bigint; readonly deadline: bigint; readonly approveGasLimit: bigint;
  readonly swapGasLimit: bigint; readonly maxFeePerGas: bigint;
};
export const MODE_A_ADAPTER = { id: 'uniswap-v3.swap-router-02', version: '1.0.0' } as const;
const chain = FORK_CHAIN_REF;
export function forkTimestamp(unixSeconds: bigint): string {
  if (unixSeconds < 0n || unixSeconds > 8_640_000_000_000n) throw new Error('FORK_TIMESTAMP_INVALID');
  return new Date(Number(unixSeconds) * 1000).toISOString();
}
export function validateCompileContext(c: CompileContext): void {
  if (!/^0x[0-9a-f]{40}$/.test(c.owner) || !/^0x[0-9a-f]{40}$/.test(c.tokenIn) || !/^0x[0-9a-f]{40}$/.test(c.tokenOut)
    || c.tokenIn === c.tokenOut || c.amountIn <= 0n || c.quotedOut <= 0n || c.minimumOut <= 0n
    || c.minimumOut > c.quotedOut || !Number.isInteger(c.slippageBps) || c.slippageBps < 0 || c.slippageBps > 300
    || c.minimumOut !== c.quotedOut * BigInt(10_000 - c.slippageBps) / 10_000n
    || ![100, 500, 3000, 10000].includes(c.fee) || c.nonce < 0n || c.deadline <= 0n
    || c.approveGasLimit <= 0n || c.swapGasLimit <= 0n || c.maxFeePerGas < 1_000_000n
    || !Number.isSafeInteger(c.revision) || !Number.isSafeInteger(c.forkBlock)) throw new Error('COMPILER_INPUT_INVALID');
}
export function compilePolicy(c: CompileContext): { readonly policy: AuthorizationPolicy; readonly policyHash: string } {
  validateCompileContext(c);
  const owner = { chainId: chain, address: c.owner };
  const token = { chainId: chain, address: c.tokenIn, decimals: c.tokenInDecimals };
  const native = { chainId: chain, nativeId: 'ETH', decimals: 18 };
  const router = { chainId: chain, address: SWAP_ROUTER_02, version: 'reviewed-code-pin' };
  const feeAmount = (c.amountIn * BigInt(c.fee) + 999_999n) / 1_000_000n;
  const policy = validateArtifact('authorization-policy', {
    schemaVersion: '1.0.0', policyId: `FORK.policy.r${c.revision}.b${c.forkBlock}`,
    semanticWorkflowHash: c.semanticWorkflowHash, artifactSetHash: c.artifactSetHash,
    simulationHash: c.simulationHash, requiredAuthorizationClass: 'MODE_A',
    allowlists: { owners: [owner], accounts: [owner], recipients: [owner], chains: [chain],
      adapters: [MODE_A_ADAPTER], protocols: ['uniswap'],
      contracts: [{ chainId: chain, address: c.tokenIn, version: 'reviewed-code-pin' }, router],
      functions: [{ chainId: chain, contract: c.tokenIn, functionId: APPROVE_SELECTOR },
        { chainId: chain, contract: SWAP_ROUTER_02, functionId: MULTICALL_SELECTOR }] },
    budgetReservation: { rule: 'RESERVE_BEFORE_SUBMISSION', concurrentConsumption: 'CUMULATIVE_ACROSS_BRANCHES', implementation: 'NOT_IMPLEMENTED' },
    spendLimits: [{ asset: token, maximumAmount: c.amountIn.toString(), maximumPerStepAmount: c.amountIn.toString(), maximumCumulativeAmount: c.amountIn.toString() }],
    maximumSlippageBps: c.slippageBps,
    gasBudgets: [{ asset: native, maximumAmount: ((c.approveGasLimit + c.swapGasLimit) * c.maxFeePerGas).toString() }],
    feeBudgets: [{ asset: token, maximumAmount: feeAmount.toString() }],
    oracleRules: [], accountRiskRules: [], checkpointRules: [{ checkpointId: 'swap-minimum-output', beforeNodeId: c.nodeId,
      maximumSlippageBps: c.slippageBps, minimumOutputs: [{ asset: { chainId: chain, address: c.tokenOut, decimals: c.tokenOutDecimals }, amount: c.minimumOut.toString() }] }],
    providers: { kind: 'FIXED', providerId: MODE_A_ADAPTER.id }, nonce: c.nonce.toString(),
    deadline: forkTimestamp(c.deadline), revocationEpoch: 0,
    recovery: { failurePolicy: 'ABORT', residualAssetRecipient: owner, maximumAttemptsPerStep: 2, requiresHumanReview: true },
    enforcement: 'NOT_ENFORCED',
  });
  return { policy, policyHash: hashArtifactBytes('authorization-policy', new TextEncoder().encode(JSON.stringify(policy))) };
}
