// SPDX-License-Identifier: AGPL-3.0-only
/** Scoped exception to the financial feature gate; dependency admission is still mandatory. */
import { CLOAK_RUNTIME } from './cloak-adapter';
import type { OwnerDepositPreparation } from './owner-proof-deposit';

export const OWNER_PROOF_LABEL = 'MAINNET PROOF / REAL EXECUTION — OWNER CONTROLLED';
export type OwnerProofConfiguration = {
  enabled: boolean; owner: string; expiresAt: number;
  admission: { audit: boolean; sbom: boolean; inventory: boolean; license: boolean };
};
export const disabledOwnerProof = (owner: string): OwnerProofConfiguration => ({ enabled: false, owner, expiresAt: 0,
  admission: { audit: false, sbom: false, inventory: false, license: false } });
export type OwnerDepositPermit = Readonly<{ reviewDigest: string; manifestHash: string; owner: string; expiresAt: number }>;
const depositPermits = new WeakMap<OwnerDepositPermit, { prepared: string; configuration: OwnerProofConfiguration; configurationSnapshot: string }>();
export function authorizeOwnerDeposit(configuration: OwnerProofConfiguration, prepared: OwnerDepositPreparation,
  acknowledgedDigest: string, ownerEnabled: boolean): OwnerDepositPermit {
  if (!configuration.enabled || ownerEnabled !== true) throw new Error('CLOAK_OWNER_PROOF_DISABLED');
  if (Object.keys(configuration.admission).sort().join() !== 'audit,inventory,license,sbom' || Object.values(configuration.admission).some(v => v !== true))
    throw new Error('CLOAK_DEPENDENCY_ACCEPTANCE_REQUIRED');
  if (!Number.isSafeInteger(configuration.expiresAt) || Date.now() >= configuration.expiresAt) throw new Error('CLOAK_OWNER_PROOF_ADMISSION_EXPIRED');
  if (configuration.owner !== prepared.manifest.owner || prepared.manifest.provider !== 'cloak' ||
      prepared.manifest.programId !== CLOAK_RUNTIME.programId || prepared.manifest.genesisHash !== CLOAK_RUNTIME.genesisHash ||
      prepared.manifest.depositLamports !== '10000000' || prepared.manifest.mint !== CLOAK_RUNTIME.nativeMint ||
      acknowledgedDigest !== prepared.reviewDigest || Date.now() >= prepared.expiresAt || prepared.simulation !== 'PASSED')
    throw new Error('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
  const permit = Object.freeze({ reviewDigest: prepared.reviewDigest, manifestHash: prepared.manifestHash, owner: configuration.owner,
    expiresAt: Math.min(prepared.expiresAt, configuration.expiresAt) });
  depositPermits.set(permit, { prepared: JSON.stringify(prepared), configuration, configurationSnapshot: JSON.stringify(configuration) }); return permit;
}
export function assertOwnerDepositPermit(permit: OwnerDepositPermit, prepared: OwnerDepositPreparation, owner: string, digest: string): void {
  const record = depositPermits.get(permit);
  if (!record || record.prepared !== JSON.stringify(prepared) || record.configurationSnapshot !== JSON.stringify(record.configuration) ||
      permit.owner !== owner || permit.reviewDigest !== digest || Date.now() >= permit.expiresAt)
    throw new Error('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
}
