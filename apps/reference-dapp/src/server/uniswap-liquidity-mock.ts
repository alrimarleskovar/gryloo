// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Synthetic runtime code of the MOCKED Base Sepolia Uniswap chain (tests and the loopback browser harness) and its
 * SHA-256 pins. Accepted only with MOCKED provenance; a public run always checks the profile's verified pins.
 */
import { createHash } from 'node:crypto';
import { UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY as profile } from '@defi-workflow-engine/action-registry';

export const UNI_MOCK_CODE: Readonly<Record<string, string>> = Object.freeze({ [profile.factory]: '0x60016001', [profile.positionManager]: '0x60026002',
  [profile.pool]: '0x60036003', [profile.token0.address]: '0x60046004', [profile.token1.address]: '0x60056005', [profile.gasPriceOracle]: '0x60066006' });
const sha = (code: string) => createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');
export const UNI_MOCK_CODE_PINS = Object.freeze({ factory: sha(UNI_MOCK_CODE[profile.factory]!), positionManager: sha(UNI_MOCK_CODE[profile.positionManager]!),
  pool: sha(UNI_MOCK_CODE[profile.pool]!) });
/** Loopback JSON-RPC of the MOCKED harness (browser suites only). */
export const UNI_MOCK_RPC_URL = 'http://127.0.0.1:8556/rpc';
