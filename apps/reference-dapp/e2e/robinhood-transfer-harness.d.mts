// SPDX-License-Identifier: AGPL-3.0-only
export declare const TRANSFER_OWNER: string;
export declare const CHAIN_HEX: '0xb626';
export declare const CHAIN_ID: bigint;
export declare const GAS_USED: bigint;
export declare const BASE_FEE: bigint;
export type TransferFault = 'wrongRecipient' | 'wrongValue' | 'highFee' | 'revert' | 'logs' | 'extraDebit' | null;
export type TransferNetworkKey = 'robinhood' | 'ethereum-sepolia';
export declare const NETWORKS: Readonly<Record<TransferNetworkKey, { readonly hex: string; readonly id: bigint; readonly l2: boolean }>>;
export type TransferChainOptions = { network?: TransferNetworkKey; owner?: string; balance?: bigint | string; nonce?: number; queued?: number; code?: string; chain?: string;
  staleSeconds?: number; finalizedLag?: number; safeLag?: number; fault?: TransferFault };
export type TransferChain = {
  state: { owner: string; chain: string; block: number; balance: bigint; nonce: number; queued: number; code: string; staleSeconds: number;
    finalizedLag: number; safeLag: number; fault: TransferFault };
  rpc(method: string, params?: readonly unknown[]): Promise<unknown>;
  transactions: Record<string, unknown>[];
  receipts: Map<string, Record<string, unknown>>;
  history: Map<number, { balance: bigint; nonce: number }>;
};
export declare function createRobinhoodTransferChain(options?: TransferChainOptions): TransferChain;
export declare function signFixtureTransfer(tx: Record<string, string | number>, network?: { readonly hex: string; readonly id: bigint }): Record<string, unknown> & { hash: string };
