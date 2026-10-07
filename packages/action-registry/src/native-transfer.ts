// SPDX-License-Identifier: Apache-2.0
import { ROBINHOOD_TESTNET_TRANSFER } from './robinhood-chain.js';
import { ETHEREUM_SEPOLIA_TRANSFER } from './ethereum-sepolia.js';
/** The native test-ETH self-transfer profiles. Each one is a public testnet; none is a mainnet. */
export type NativeTransferProfile = typeof ROBINHOOD_TESTNET_TRANSFER | typeof ETHEREUM_SEPOLIA_TRANSFER;
export const NATIVE_TRANSFER_PROFILES: readonly NativeTransferProfile[] = Object.freeze([ROBINHOOD_TESTNET_TRANSFER, ETHEREUM_SEPOLIA_TRANSFER]);
export function nativeTransferProfile(chain: string): NativeTransferProfile {
  const profile = NATIVE_TRANSFER_PROFILES.find(item => item.chain === chain);
  if (!profile) throw new Error('TRANSFER_NETWORK_UNSUPPORTED');
  return profile;
}
