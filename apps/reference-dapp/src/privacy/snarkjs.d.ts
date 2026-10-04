// SPDX-License-Identifier: AGPL-3.0-only
declare module 'snarkjs' {
  export const groth16: {
    fullProve(input: Record<string, unknown>, wasm: Uint8Array, zkey: Uint8Array, logger?: unknown,
      witnessOptions?: unknown, proverOptions?: { singleThread: boolean }): Promise<{
        proof: import('@cloak.dev/sdk').Groth16Proof; publicSignals: string[] }>;
    verify(key: unknown, signals: string[], proof: import('@cloak.dev/sdk').Groth16Proof): Promise<boolean>;
  };
  export const zKey: { exportVerificationKey(bytes: Uint8Array): Promise<unknown> };
}
