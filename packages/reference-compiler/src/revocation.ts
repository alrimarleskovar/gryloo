// SPDX-License-Identifier: AGPL-3.0-only
import { decodeApprove, encodeApprove, SWAP_ROUTER_02, address } from './abi.js';
import { decodeUnsignedPayload, encodeUnsignedPayload, payloadIdentity } from './payload.js';
import { FORK_CHAIN_ID } from './profile.js';

export type RevocationContext = {
  readonly owner: string; readonly tokenIn: string; readonly nonce: bigint;
  readonly residualAllowance: bigint; readonly gasLimit: bigint; readonly maxFeePerGas: bigint;
  readonly simulatedAllowanceAfter: bigint; readonly simulationSucceeded: boolean;
};
/** One separate Mode A action. The caller supplies fresh account and simulation facts. */
export function buildRevocationPayload(c: RevocationContext): { readonly bytes: Uint8Array; readonly payloadHash: string } {
  address(c.owner); address(c.tokenIn);
  if (c.residualAllowance <= 0n || c.nonce < 0n || c.gasLimit <= 0n
    || c.maxFeePerGas < 1_000_000n || !c.simulationSucceeded || c.simulatedAllowanceAfter !== 0n) {
    throw new Error('REVOCATION_NOT_READY');
  }
  const bytes = encodeUnsignedPayload({ chainId: FORK_CHAIN_ID, nonce: c.nonce,
    maxPriorityFeePerGas: 1_000_000n, maxFeePerGas: c.maxFeePerGas,
    gasLimit: c.gasLimit, to: c.tokenIn, value: 0n, accessList: [],
    data: encodeApprove(SWAP_ROUTER_02, 0n) });
  verifyRevocationPayload(bytes, c);
  return { bytes, payloadHash: payloadIdentity(bytes).payloadHash };
}
export function verifyRevocationPayload(bytes: Uint8Array, c: RevocationContext): void {
  const payload = decodeUnsignedPayload(bytes);
  const approval = decodeApprove(payload.data);
  if (payload.to !== address(c.tokenIn) || payload.nonce !== c.nonce
    || payload.gasLimit !== c.gasLimit || payload.maxFeePerGas !== c.maxFeePerGas
    || payload.maxPriorityFeePerGas !== 1_000_000n || approval.spender !== SWAP_ROUTER_02
    || approval.amount !== 0n) throw new Error('REVOCATION_PAYLOAD_MISMATCH');
}
