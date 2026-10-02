// SPDX-License-Identifier: AGPL-3.0-only
/** Types for the BUILD-015 read-only post-execution verifier (solana-devnet-liquidity-execution-verification.mjs). */
export type ReadOnlyRpc = (method: string, params: readonly unknown[]) => Promise<unknown>;
export function readOnlyRpc(endpoint: string): ReadOnlyRpc;
export function verifyOrcaLiquidityLifecycle(input: { journalDir: string; owner: string; rpc: ReadOnlyRpc; provenance?: 'PUBLIC_DEVNET' | 'MOCKED' }): Promise<{
  evidence: string; broadcast: false; owner: string; checkedAt: string; positions: { positionMint: string; operations: string[] }[];
  operations: { id: string; operation: string; verdict: string; verified: boolean; signature?: string; slot?: number; effects?: Record<string, string> | null; feeLamports?: string | null }[];
  checks: string[]; verified: number }>;
