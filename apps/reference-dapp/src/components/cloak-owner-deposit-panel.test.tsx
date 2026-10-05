// SPDX-License-Identifier: AGPL-3.0-only
/** Static first render only: no wallet, vault, provider or network interaction. */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CloakOwnerDepositPanel from './cloak-owner-deposit-panel';
import { disabledOwnerProof, type OwnerProofConfiguration } from '../privacy/owner-proof-gate';
import { OWNER_PROOF_FORBIDDEN_CLAIMS, OWNER_PROOF_RESIDUAL_FINDINGS, OWNER_PROOF_RESIDUAL_LABEL, OWNER_PROOF_RESIDUALS } from '../privacy/owner-proof-residuals';

const scope = OWNER_PROOF_RESIDUALS.scope;
const residual: OwnerProofConfiguration = { enabled: true, owner: scope.owner, expiresAt: Date.parse('2026-10-06T13:00:00.000Z'),
  admission: { audit: 'owner-accepted-residual', sbom: 'passed', inventory: 'owner-accepted-residual', license: 'owner-accepted-residual' },
  acceptance: { status: OWNER_PROOF_RESIDUAL_LABEL, scope, registerHash: 'ab'.repeat(32), acceptedAt: Date.parse('2026-10-06T12:00:00.000Z'),
    validUntil: OWNER_PROOF_RESIDUALS.validUntil, findings: [...OWNER_PROOF_RESIDUAL_FINDINGS], releaseAdmission: false, productionFinancialGate: 'DISABLED' } };
const text = (configuration: OwnerProofConfiguration) => renderToStaticMarkup(<CloakOwnerDepositPanel configuration={configuration}/>)
  .replace(/<[^>]+>/g, ' ').replaceAll('&#x27;', "'").replace(/\s+/g, ' ');

describe('owner-proof page dependency status', () => {
  it('shows OWNER-ACCEPTED RESIDUAL RISK with its exact one-deposit scope and every accepted finding', () => {
    const page = text(residual);
    expect(page).toContain('OWNER-ACCEPTED RESIDUAL RISK');
    for (const value of [scope.owner, scope.programId, scope.genesisHash, scope.lockHash, 'exactly 0.01 SOL (10,000,000 lamports)', 'no swap',
      'Wallet signature requests At most 1', 'Application submissions At most 1', 'Production financial gate DISABLED',
      `Acceptance expires ${OWNER_PROOF_RESIDUALS.validUntil}, or at the first wallet signature request`, ...OWNER_PROOF_RESIDUAL_FINDINGS]) expect(page).toContain(value);
    for (const claim of OWNER_PROOF_FORBIDDEN_CLAIMS) expect(page.toUpperCase()).not.toContain(claim);
  });
  it('without admission shows no residual acceptance and keeps financial actions disabled', () => {
    const page = text(disabledOwnerProof(scope.owner));
    expect(page).not.toContain(OWNER_PROOF_RESIDUAL_LABEL); expect(page).toContain('Financial actions disabled');
    for (const claim of OWNER_PROOF_FORBIDDEN_CLAIMS) expect(page.toUpperCase()).not.toContain(claim);
  });
});
