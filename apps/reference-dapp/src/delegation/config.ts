// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: delegated-execution configuration — server-only, fail closed. Any malformed value disables the feature; nothing
 * falls back to another mode, transport or signer.
 *
 *   FLOFI_DELEGATION                 enabled | disabled (default): passkeys, execution Credentials and DELEGATED_WITH_LIMITS automations
 *                                    (owner operations; they authorize nothing without an executor)
 *   FLOFI_DELEGATION_HARNESS         MOCKED_LOOPBACK_ONLY: every chain is the loopback chain double at FLOFI_DELEGATION_HARNESS_URL (tests and
 *                                    local rehearsals only; refused on a hosted deployment). Without it: production mode.
 *   FLOFI_DELEGATION_HARNESS_URL     http://127.0.0.1:<port> (loopback only)
 *   FLOFI_DELEGATION_RPC_<chainId>   per EVM chain read/submit JSON-RPC in production mode (https; e.g. FLOFI_DELEGATION_RPC_84532)
 *   FLOFI_PASSKEY_ORIGIN             the origin passkeys are registered for and assert (default FLOFI_PUBLIC_ORIGIN); its host is the RP id
 *   FLOFI_DELEGATED_SIGNER           none (default) | local-disposable | memory — the session-signer provider of this process. `memory` and
 *                                    `local-disposable` are refused on hosted deployments: production custody (KMS/HSM) is not available,
 *                                    so production delegated signing is BLOCKED (DELEGATED_SIGNER_UNAVAILABLE)
 *   FLOFI_DELEGATED_SIGNER_DIR       local-disposable only: an absolute directory below /tmp
 *   FLOFI_DELEGATED_EXECUTION        enabled: this process runs the delegated executor (needs a signer provider)
 */
import { isHostedDeployment, publicOrigin, deploymentTenant } from '../server/deployment.ts';
import type { CapabilityMode } from './capabilities.ts';

type Env = Readonly<Record<string, string | undefined>>;
export type SignerChoice = { readonly kind: 'none' } | { readonly kind: 'memory' } | { readonly kind: 'local-disposable'; readonly directory: string };
export type DelegationConfig = {
  readonly enabled: true; readonly tenantId: string; readonly mode: CapabilityMode; readonly harnessUrl: string | null;
  readonly rpc: Readonly<Record<string, string>>; readonly passkeyOrigin: string; readonly signer: SignerChoice; readonly executor: boolean; readonly hosted: boolean;
};
export type DelegationConfigResult = DelegationConfig | { readonly enabled: false; readonly code: 'DELEGATION_NOT_ENABLED' | 'DELEGATION_CONFIGURATION_INVALID'; readonly reason?: string };
const invalid = (reason: string) => ({ enabled: false, code: 'DELEGATION_CONFIGURATION_INVALID', reason } as const);
const LOOPBACK_URL = /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9][0-9]{3,4}$/;

export function readDelegationConfig(env: Env): DelegationConfigResult {
  const flag = env.FLOFI_DELEGATION ?? 'disabled';
  if (flag === 'disabled' || flag === '') return { enabled: false, code: 'DELEGATION_NOT_ENABLED' };
  if (flag !== 'enabled') return invalid('FLOFI_DELEGATION');
  const hosted = isHostedDeployment(env);
  const harness = env.FLOFI_DELEGATION_HARNESS;
  if (harness !== undefined && harness !== '' && harness !== 'MOCKED_LOOPBACK_ONLY') return invalid('FLOFI_DELEGATION_HARNESS');
  const mocked = harness === 'MOCKED_LOOPBACK_ONLY';
  if (mocked && hosted) return invalid('FLOFI_DELEGATION_HARNESS_HOSTED');
  const harnessUrl = mocked ? env.FLOFI_DELEGATION_HARNESS_URL ?? '' : null;
  if (mocked && !LOOPBACK_URL.test(harnessUrl!)) return invalid('FLOFI_DELEGATION_HARNESS_URL');
  const rpc: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const match = /^FLOFI_DELEGATION_RPC_([1-9][0-9]{0,18})$/.exec(key);
    if (!match || !value) continue;
    try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) return invalid(key); rpc[`eip155:${match[1]}`] = url.toString(); }
    catch { return invalid(key); }
  }
  let passkeyOrigin: string;
  try {
    passkeyOrigin = new URL(env.FLOFI_PASSKEY_ORIGIN || publicOrigin(env) || '').origin;
    if (hosted && !passkeyOrigin.startsWith('https://')) return invalid('FLOFI_PASSKEY_ORIGIN');
  } catch { return invalid('FLOFI_PASSKEY_ORIGIN'); }
  const signerKind = env.FLOFI_DELEGATED_SIGNER ?? 'none';
  let signer: SignerChoice;
  if (signerKind === 'none' || signerKind === '') signer = { kind: 'none' };
  else if (signerKind === 'memory' || signerKind === 'local-disposable') {
    // Neither is production custody: refused wherever real users could rely on it.
    if (hosted) return invalid('FLOFI_DELEGATED_SIGNER_HOSTED');
    if (signerKind === 'memory') signer = { kind: 'memory' };
    else {
      const directory = env.FLOFI_DELEGATED_SIGNER_DIR ?? '';
      if (!directory.startsWith('/tmp/') || directory.includes('..')) return invalid('FLOFI_DELEGATED_SIGNER_DIR');
      signer = { kind: 'local-disposable', directory };
    }
  } else return invalid('FLOFI_DELEGATED_SIGNER');
  const executor = env.FLOFI_DELEGATED_EXECUTION === 'enabled';
  if (env.FLOFI_DELEGATED_EXECUTION && !['enabled', 'disabled'].includes(env.FLOFI_DELEGATED_EXECUTION)) return invalid('FLOFI_DELEGATED_EXECUTION');
  if (executor && signer.kind === 'none') return invalid('FLOFI_DELEGATED_EXECUTION_WITHOUT_SIGNER');
  let tenantId: string;
  try { tenantId = deploymentTenant(env); } catch { return invalid('TENANT_ID'); }
  return { enabled: true, tenantId, mode: mocked ? 'MOCKED_HARNESS' : 'PRODUCTION', harnessUrl, rpc, passkeyOrigin, signer, executor, hosted };
}
/**
 * Why delegated execution cannot run on this deployment (null: it can). Hosted deployments can never configure a signer (no production
 * custody provider exists), so production delegated signing is always DELEGATED_SIGNER_UNAVAILABLE; a local deployment may rehearse with a
 * disposable signer, and each step still needs a step driver for its chain and mode.
 */
export function executionAvailability(config: DelegationConfig): string | null {
  return config.signer.kind === 'none' ? 'DELEGATED_SIGNER_UNAVAILABLE' : null;
}
