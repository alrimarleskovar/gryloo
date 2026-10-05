// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scoped exception to the financial feature gate for ONE owner deposit. Dependency admission is mandatory: either every
 * unchanged gate passes, or the owner accepted the exact residual register at launch. The production gate is untouched.
 */
import { CLOAK_RUNTIME } from './cloak-adapter';
import type { OwnerDepositPreparation } from './owner-proof-deposit';
import { OWNER_PROOF_RESIDUALS, validOwnerProofAcceptance, type OwnerProofAcceptance } from './owner-proof-residuals';

export const OWNER_PROOF_LABEL = 'MAINNET PROOF / REAL EXECUTION — OWNER CONTROLLED';
/** "owner-accepted-residual" is only the exact launcher register for this one deposit, never release admission. */
export type OwnerProofAdmissionStatus = 'passed' | 'owner-accepted-residual' | 'blocked';
export type OwnerProofConfiguration = {
  enabled: boolean; owner: string; expiresAt: number;
  admission: { audit: OwnerProofAdmissionStatus; sbom: OwnerProofAdmissionStatus; inventory: OwnerProofAdmissionStatus; license: OwnerProofAdmissionStatus };
  /** Present exactly when a gate is "owner-accepted-residual". */
  acceptance: OwnerProofAcceptance | null;
};
export const disabledOwnerProof = (owner: string): OwnerProofConfiguration => ({ enabled: false, owner, expiresAt: 0,
  admission: { audit: 'blocked', sbom: 'blocked', inventory: 'blocked', license: 'blocked' }, acceptance: null });
/** SBOM is never a residual. A residual needs the accepted register, whose scope must name this configured owner. */
export function ownerProofAdmitted(configuration: OwnerProofConfiguration, now = Date.now()): boolean {
  const { admission, acceptance } = configuration, statuses = Object.values(admission);
  if (configuration.enabled !== true || Object.keys(admission).sort().join() !== 'audit,inventory,license,sbom' || admission.sbom !== 'passed' ||
      statuses.some(v => v !== 'passed' && v !== 'owner-accepted-residual')) return false;
  if (!statuses.includes('owner-accepted-residual')) return acceptance === null;
  // The acceptance covers the exact reviewed finding set as a whole: audit, inventory and license together.
  return validOwnerProofAcceptance(acceptance, now) && acceptance.scope.owner === configuration.owner &&
    [admission.audit, admission.inventory, admission.license].every(v => v === 'owner-accepted-residual');
}
export type OwnerDepositPermit = Readonly<{ reviewDigest: string; manifestHash: string; owner: string; expiresAt: number;
  dependencyAdmission: Readonly<OwnerProofAcceptance> | null }>;
const depositPermits = new WeakMap<OwnerDepositPermit, { prepared: string; configuration: OwnerProofConfiguration; configurationSnapshot: string }>();
export function authorizeOwnerDeposit(configuration: OwnerProofConfiguration, prepared: OwnerDepositPreparation,
  acknowledgedDigest: string, ownerEnabled: boolean, residualRiskAccepted = false): OwnerDepositPermit {
  if (!configuration.enabled || ownerEnabled !== true) throw new Error('CLOAK_OWNER_PROOF_DISABLED');
  if (!ownerProofAdmitted(configuration)) throw new Error('CLOAK_DEPENDENCY_ACCEPTANCE_REQUIRED');
  if (configuration.acceptance && residualRiskAccepted !== true) throw new Error('CLOAK_OWNER_RESIDUAL_RISK_ACCEPTANCE_REQUIRED');
  if (!Number.isSafeInteger(configuration.expiresAt) || Date.now() >= configuration.expiresAt) throw new Error('CLOAK_OWNER_PROOF_ADMISSION_EXPIRED');
  const scope = OWNER_PROOF_RESIDUALS.scope;
  if (configuration.owner !== prepared.manifest.owner || prepared.manifest.provider !== 'cloak' ||
      prepared.manifest.programId !== CLOAK_RUNTIME.programId || prepared.manifest.genesisHash !== CLOAK_RUNTIME.genesisHash ||
      prepared.manifest.depositLamports !== '10000000' || prepared.manifest.mint !== CLOAK_RUNTIME.nativeMint ||
      acknowledgedDigest !== prepared.reviewDigest || Date.now() >= prepared.expiresAt || prepared.simulation !== 'PASSED')
    throw new Error('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
  // An accepted residual never extends to another owner, network, program, mint or amount.
  if (configuration.acceptance && (prepared.manifest.owner !== scope.owner || prepared.manifest.genesisHash !== scope.genesisHash ||
      prepared.manifest.programId !== scope.programId || prepared.manifest.mint !== scope.mint || prepared.manifest.depositLamports !== scope.depositLamports))
    throw new Error('CLOAK_OWNER_RESIDUAL_SCOPE_EXCEEDED');
  const dependencyAdmission = configuration.acceptance && Object.freeze(structuredClone(configuration.acceptance));
  const permit = Object.freeze({ reviewDigest: prepared.reviewDigest, manifestHash: prepared.manifestHash, owner: configuration.owner,
    expiresAt: Math.min(prepared.expiresAt, configuration.expiresAt), dependencyAdmission });
  depositPermits.set(permit, { prepared: JSON.stringify(prepared), configuration, configurationSnapshot: JSON.stringify(configuration) }); return permit;
}
export function assertOwnerDepositPermit(permit: OwnerDepositPermit, prepared: OwnerDepositPreparation, owner: string, digest: string): void {
  const record = depositPermits.get(permit);
  if (!record || record.prepared !== JSON.stringify(prepared) || record.configurationSnapshot !== JSON.stringify(record.configuration) ||
      permit.owner !== owner || permit.reviewDigest !== digest || Date.now() >= permit.expiresAt ||
      JSON.stringify(permit.dependencyAdmission) !== JSON.stringify(record.configuration.acceptance))
    throw new Error('CLOAK_OWNER_PROOF_REVIEW_CHANGED');
}
