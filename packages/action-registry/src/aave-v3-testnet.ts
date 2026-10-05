// SPDX-License-Identifier: Apache-2.0
/** Verified from Aave's current DAO address book and interface; only this runtime profile. */
export const AAVE_V3_BASE_SEPOLIA = Object.freeze({
  network: 'Base Sepolia', chainId: 84532, chain: 'eip155:84532', chainHex: '0x14a34', protocol: 'aave-v3',
  pool: '0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27',
  provider: '0xe4c23309117aa30342bfaae6c95c6478e0a4ad00',
  asset: '0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f', decimals: 6, symbol: 'USDC',
  /** Pool reserve id: user-configuration bits 2·id (borrowing) and 2·id+1 (collateral). Read on chain 2026-10-05. */
  reserveId: 0,
  aToken: '0x10f1a9d11cdf50041f3f8cb7191cbe2f31750acc',
  variableDebtToken: '0xfb3e85601b7feb3691bbb8779ef0e1069e347204',
  oracle: '0x943b0de18d4abf4ef02a85912f8fc07684c141df',
  faucet: '0xd9145b5f45ad4519c7accd6e0a4a82e83bb8a6dc',
  explorer: 'https://sepolia.basescan.org', rpc: 'https://base-sepolia.gateway.tenderly.co',
  officialSource: 'https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3BaseSepolia.sol',
  /** OP Stack: receipts carry a separate L1 data fee (`l1Fee`) that is part of the owner's network cost. */
  l1DataFee: true,
});
/**
 * BUILD-ETHEREUM-001: Aave V3 on Ethereum Sepolia, WBTC reserve only. From the Aave DAO address book (`AaveV3Sepolia`,
 * `AaveV3SepoliaAssets`) and verified read-only on 2026-10-05 (head ≈ 11,846,500): Provider `getPool()` and
 * `getPriceOracle()` equal the Pool and Oracle below; Pool `ADDRESSES_PROVIDER()` equals the Provider; reserve id 3,
 * 8 decimals, active, not frozen or paused, borrowing enabled, no caps; the aToken and variable-debt token report this
 * underlying and Pool. USDC is not used here: its Sepolia supply cap is exceeded (Supply reverts with Aave error 51).
 * This deployment is Aave v3.0 (Pool revision 1), older than Base Sepolia's v3.4.
 */
export const AAVE_V3_ETHEREUM_SEPOLIA = Object.freeze({
  network: 'Ethereum Sepolia', chainId: 11155111, chain: 'eip155:11155111', chainHex: '0xaa36a7', protocol: 'aave-v3',
  pool: '0x6ae43d3271ff6888e7fc43fd7321a503ff738951',
  provider: '0x012bac54348c0e635dcac9d5fb99f06f24136c9a',
  asset: '0x29f2d40b0605204364af54ec677bd022da425d03', decimals: 8, symbol: 'WBTC',
  reserveId: 3,
  aToken: '0x1804bf30507dc2eb3bdebbbdd859991eaef6eeff',
  variableDebtToken: '0xeb016dfd303f19fbddfb6300eb4aeb2da7ceac37',
  oracle: '0x2da88497588bf89281816106c7259e31af45a663',
  faucet: '0xc959483dba39aa9e78757139af0e9a2edeb3f42d',
  explorer: 'https://sepolia.etherscan.io', rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
  officialSource: 'https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Sepolia.sol',
  /** Ethereum L1: the network cost is gasUsed × effectiveGasPrice; a receipt `l1Fee` would be unexplained. */
  l1DataFee: false,
});
export type AaveLendingProfile = typeof AAVE_V3_BASE_SEPOLIA | typeof AAVE_V3_ETHEREUM_SEPOLIA;
/** One verified asset per network. Profiles are chosen by the authored or reviewed chain, never by symbol. */
export const AAVE_V3_LENDING_PROFILES: readonly AaveLendingProfile[] = Object.freeze([AAVE_V3_BASE_SEPOLIA, AAVE_V3_ETHEREUM_SEPOLIA]);
export function aaveLendingProfile(chain: string): AaveLendingProfile {
  const profile = AAVE_V3_LENDING_PROFILES.find(item => item.chain === chain);
  if (!profile) throw new Error('AAVE_PROFILE_UNSUPPORTED');
  return profile;
}
/** Rejects anything other than one of the frozen registered profiles (for example an object built by a caller). */
export function assertAaveLendingProfile(value: unknown): AaveLendingProfile {
  if (!AAVE_V3_LENDING_PROFILES.some(profile => profile === value)) throw new Error('AAVE_PROFILE_UNSUPPORTED');
  return value as AaveLendingProfile;
}
