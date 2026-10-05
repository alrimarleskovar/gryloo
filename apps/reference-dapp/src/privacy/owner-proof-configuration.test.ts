// SPDX-License-Identifier: AGPL-3.0-only
/** Synthetic admission records only. No admission file is read or written. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { OWNER_PROOF_ADMISSION_FORMAT, OWNER_PROOF_BRANCH, ownerProofConfiguration, ownerProofConfigurationFromRecord,
  ownerProofJournalPaths, ownerProofResidualRegisterHash, type OwnerProofLaunchContext } from './owner-proof-configuration';
import { OWNER_PROOF_RESIDUAL_FINDINGS, OWNER_PROOF_RESIDUAL_LABEL, OWNER_PROOF_RESIDUALS, ownerProofResidualRegisterJson } from './owner-proof-residuals';

const scope = OWNER_PROOF_RESIDUALS.scope, now = Date.parse('2026-10-06T12:00:00.000Z'), head = 'a'.repeat(40), registerHash = ownerProofResidualRegisterHash();
const context = (change: Partial<OwnerProofLaunchContext> = {}): OwnerProofLaunchContext => ({ owner: scope.owner, head, branch: OWNER_PROOF_BRANCH,
  clean: true, lockHash: scope.lockHash, consumed: false, hosted: false, now, registerHash, ...change });
const acceptance = (change: object = {}) => ({ status: OWNER_PROOF_RESIDUAL_LABEL, scope, registerHash, acceptedAt: now - 60_000,
  validUntil: OWNER_PROOF_RESIDUALS.validUntil, findings: [...OWNER_PROOF_RESIDUAL_FINDINGS], releaseAdmission: false, productionFinancialGate: 'DISABLED', ...change });
const residualAdmission = { audit: 'owner-accepted-residual', sbom: 'passed', inventory: 'owner-accepted-residual', license: 'owner-accepted-residual' };
const record = (change: object = {}) => ({ format: OWNER_PROOF_ADMISSION_FORMAT, owner: scope.owner, head, lockHash: scope.lockHash,
  expiresAt: now + 3_600_000, admission: residualAdmission, acceptance: acceptance(), ...change });

describe('server admission record for the one owner proof', () => {
  it('enables the owner proof only for the exact accepted residual register', () => {
    expect(registerHash).toBe(createHash('sha256').update(ownerProofResidualRegisterJson()).digest('hex'));
    const configuration = ownerProofConfigurationFromRecord(record(), context());
    expect(configuration).toEqual({ enabled: true, owner: scope.owner, expiresAt: now + 3_600_000, admission: residualAdmission, acceptance: acceptance() });
  });
  it('keeps the unchanged all-pass path without any residual acceptance', () => {
    const admission = { audit: 'passed', sbom: 'passed', inventory: 'passed', license: 'passed' };
    expect(ownerProofConfigurationFromRecord(record({ admission, acceptance: null, lockHash: '11'.repeat(32) }), context({ lockHash: '11'.repeat(32) })).enabled).toBe(true);
  });
  it.each([
    ['hosted deployment', record(), context({ hosted: true })], ['consumed proof', record(), context({ consumed: true })],
    ['dirty checkout', record(), context({ clean: false })], ['another branch', record(), context({ branch: 'main' })],
    ['another owner', record({ owner: 'Ab' }), context({ owner: 'Ab' })], ['another HEAD', record(), context({ head: 'b'.repeat(40) })],
    ['another lockfile', record({ lockHash: '00'.repeat(32) }), context({ lockHash: '00'.repeat(32) })],
    ['an expired launch session', record({ expiresAt: now }), context()], ['a session past the register window', record({ expiresAt: Date.parse(OWNER_PROOF_RESIDUALS.validUntil) + 1 }), context()],
    ['a register past its window', record(), context({ now: Date.parse(OWNER_PROOF_RESIDUALS.validUntil) })],
    ['a changed register', record(), context({ registerHash: 'cd'.repeat(32) })], ['the v1 format', record({ format: 'flofi.cloak-owner-proof-admission.v1' }), context()],
    ['an extra field', record({ waiver: true }), context()], ['SBOM as residual', record({ admission: { ...residualAdmission, sbom: 'owner-accepted-residual' } }), context()],
    ['a partial residual', record({ admission: { ...residualAdmission, audit: 'passed' } }), context()],
    ['boolean admission', record({ admission: { audit: true, sbom: true, inventory: true, license: true } }), context()],
    ['no acceptance for residual gates', record({ acceptance: null }), context()],
    ['an acceptance on passing gates', record({ admission: { audit: 'passed', sbom: 'passed', inventory: 'passed', license: 'passed' } }), context()],
    ['an acceptance for a larger amount', record({ acceptance: acceptance({ scope: { ...scope, depositLamports: '20000000' } }) }), context()],
    ['an acceptance for two signatures', record({ acceptance: acceptance({ scope: { ...scope, maxWalletSignatureRequests: 2 } }) }), context()],
    ['an acceptance with a missing finding', record({ acceptance: acceptance({ findings: OWNER_PROOF_RESIDUAL_FINDINGS.slice(1) }) }), context()],
    ['an acceptance claiming release admission', record({ acceptance: acceptance({ releaseAdmission: true }) }), context()],
    ['an acceptance from the future', record({ acceptance: acceptance({ acceptedAt: now + 1 }) }), context()], ['no record', null, context()],
  ])('stays disabled for %s', (_name, value, launch) => {
    expect(ownerProofConfigurationFromRecord(value, launch)).toEqual({ enabled: false, owner: launch.owner, expiresAt: 0,
      admission: { audit: 'blocked', sbom: 'blocked', inventory: 'blocked', license: 'blocked' }, acceptance: null });
  });
  it('is disabled without the explicit launcher environment', async () => {
    const previous = process.env.FLOFI_CLOAK_OWNER_PROOF; delete process.env.FLOFI_CLOAK_OWNER_PROOF;
    try { expect((await ownerProofConfiguration()).enabled).toBe(false); }
    finally { if (previous !== undefined) process.env.FLOFI_CLOAK_OWNER_PROOF = previous; }
  });
  it('keeps both one-shot journals in the ignored public journal directory', () => {
    expect(ownerProofJournalPaths('/repo', scope.owner)).toEqual({ directory: '/repo/.turbo/privacy-owner-proof-broadcast',
      signatureRequest: `/repo/.turbo/privacy-owner-proof-broadcast/${scope.owner}.signature-request.json`,
      broadcast: `/repo/.turbo/privacy-owner-proof-broadcast/${scope.owner}.json` });
  });
});
