// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ROUTER-001: synthetic runtime code of the MOCKED Base/Arbitrum router chains (unit, PostgreSQL and loopback
 * browser suites) and its SHA-256 pins. Accepted only with MOCKED provenance; a public run always checks the profile's
 * verified pins. Loopback endpoints are used only by the browser harness.
 */
import { createHash } from 'node:crypto';
import { CROSSCHAIN_ROUTER_BASE_ARBITRUM as profile } from '@defi-workflow-engine/action-registry';

export const ROUTER_MOCK_CODE: Readonly<Record<string, string>> = Object.freeze({
  [profile.source.spokePool]: '0x60106010', [profile.source.lifiDiamond]: '0x60116011', [profile.source.lifiFeeForwarder]: '0x60126012',
  [profile.source.usdc]: '0x60136013', ['dst:' + profile.destination.spokePool]: '0x60206020', ['dst:' + profile.destination.usdc]: '0x60216021' });
const sha = (code: string) => createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');
export const ROUTER_MOCK_CODE_PINS = Object.freeze({
  baseSpokePool: sha(ROUTER_MOCK_CODE[profile.source.spokePool]!), baseLifiDiamond: sha(ROUTER_MOCK_CODE[profile.source.lifiDiamond]!),
  baseLifiFeeForwarder: sha(ROUTER_MOCK_CODE[profile.source.lifiFeeForwarder]!), baseUsdc: sha(ROUTER_MOCK_CODE[profile.source.usdc]!),
  arbitrumSpokePool: sha(ROUTER_MOCK_CODE['dst:' + profile.destination.spokePool]!), arbitrumUsdc: sha(ROUTER_MOCK_CODE['dst:' + profile.destination.usdc]!),
});
/** Loopback endpoints of the MOCKED browser harness (never a public network). */
export const ROUTER_MOCK_BASE_RPC_URL = 'http://127.0.0.1:8557/base';
export const ROUTER_MOCK_ARBITRUM_RPC_URL = 'http://127.0.0.1:8557/arbitrum';
export const ROUTER_MOCK_LIFI_API = 'http://127.0.0.1:8557/lifi/v1';
export const ROUTER_MOCK_ACROSS_API = 'http://127.0.0.1:8557/across/api';
