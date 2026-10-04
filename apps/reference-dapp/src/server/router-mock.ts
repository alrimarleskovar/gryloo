// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001: synthetic runtime code of the MOCKED Base/Arbitrum router chains (unit, PostgreSQL and loopback
 * browser suites) and its SHA-256 pins. Accepted only with MOCKED provenance; a public run always checks the profile's
 * verified pins. Loopback endpoints are used only by the browser harness.
 * BUILD-JOURNEY-001: the same synthetic code at the testnet profile's addresses, served under `/testnet/*`.
 */
import { createHash } from 'node:crypto';
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as MAINNET, CROSSCHAIN_ROUTER_BASE_SEPOLIA_ARBITRUM_SEPOLIA as TESTNET, type RouterProfile } from '@defi-workflow-engine/action-registry';

/** Synthetic code keyed by address (destination-chain addresses prefixed `dst:`). */
export function routerMockCode(profile: RouterProfile): Readonly<Record<string, string>> {
  return Object.freeze({
    [profile.source.spokePool]: '0x60106010', [profile.source.lifiDiamond]: '0x60116011', [profile.source.lifiFeeForwarder]: '0x60126012',
    [profile.source.usdc]: '0x60136013', ['dst:' + profile.destination.spokePool]: '0x60206020', ['dst:' + profile.destination.usdc]: '0x60216021' });
}
const sha = (code: string) => createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');
export function routerMockCodePins(profile: RouterProfile) {
  const code = routerMockCode(profile);
  return Object.freeze({
    baseSpokePool: sha(code[profile.source.spokePool]!), baseLifiDiamond: sha(code[profile.source.lifiDiamond]!),
    baseLifiFeeForwarder: sha(code[profile.source.lifiFeeForwarder]!), baseUsdc: sha(code[profile.source.usdc]!),
    arbitrumSpokePool: sha(code['dst:' + profile.destination.spokePool]!), arbitrumUsdc: sha(code['dst:' + profile.destination.usdc]!),
  });
}
export const ROUTER_MOCK_CODE = routerMockCode(MAINNET);
export const ROUTER_MOCK_CODE_PINS = routerMockCodePins(MAINNET);
/** Loopback endpoints of the MOCKED browser harness (never a public network). */
export const ROUTER_MOCK_BASE_RPC_URL = 'http://127.0.0.1:8557/base';
export const ROUTER_MOCK_ARBITRUM_RPC_URL = 'http://127.0.0.1:8557/arbitrum';
export const ROUTER_MOCK_LIFI_API = 'http://127.0.0.1:8557/lifi/v1';
export const ROUTER_MOCK_ACROSS_API = 'http://127.0.0.1:8557/across/api';
/** BUILD-JOURNEY-001: loopback endpoints of the MOCKED testnet harness (same server, separate chains). */
export const ROUTER_TESTNET_MOCK = Object.freeze({ baseRpc: 'http://127.0.0.1:8557/testnet/base', arbitrumRpc: 'http://127.0.0.1:8557/testnet/arbitrum',
  lifiApi: 'http://127.0.0.1:8557/testnet/lifi/v1', acrossApi: 'http://127.0.0.1:8557/testnet/across/api', codePins: routerMockCodePins(TESTNET) });
