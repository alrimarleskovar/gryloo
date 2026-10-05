// SPDX-License-Identifier: AGPL-3.0-only
/** Synthetic gate outputs shaped like the unchanged verifier, pnpm audit and SBOM. Never an admission or a live run. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MIN_DEPOSIT_LAMPORTS } from '@cloak.dev/sdk';
import { CLOAK_RUNTIME } from './cloak-adapter';
import { OWNER_PROOF_FORBIDDEN_CLAIMS, OWNER_PROOF_RESIDUAL_FINDINGS, OWNER_PROOF_RESIDUALS, evaluateOwnerProofGates,
  ownerProofAcceptancePhrase, ownerProofResidualRegisterJson, type OwnerProofGateRun } from './owner-proof-residuals';

const scope = OWNER_PROOF_RESIDUALS.scope, reviewedLines = [...OWNER_PROOF_RESIDUALS.verifier.inventory, ...OWNER_PROOF_RESIDUALS.verifier.license];
const repository = resolve(import.meta.dirname, '../../../..');
const verifier = (lines: string[] = reviewedLines, count = lines.length): OwnerProofGateRun => ({ status: 1, stdout: lines.join('\n') + '\n',
  stderr: `Traceback (most recent call last):\nRuntimeError: BUILD-002 dependency verification failed with ${count} violation(s)\n` });
type Advisory = { github_advisory_id: string; module_name: string; severity: string; findings: { version: string; paths: string[] }[] };
const elliptic = (): Advisory => ({ github_advisory_id: 'GHSA-848j-6mx2-7j84', module_name: 'elliptic', severity: 'low', findings: [{ version: '6.6.1',
  paths: ['apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/signing-key>elliptic'] }] });
const audit = (advisories: Record<string, Advisory> = { 1112030: elliptic() }, counts: Record<string, number> = {}): OwnerProofGateRun => ({ status: 1, stderr: '',
  stdout: JSON.stringify({ advisories, metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 0, ...counts } } }) });
const sbom: OwnerProofGateRun = { status: 0, stdout: JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'x' }] }), stderr: '' };
const passed: OwnerProofGateRun = { status: 0, stdout: '', stderr: '' };
const input = (change: Partial<Parameters<typeof evaluateOwnerProofGates>[0]> = {}) => ({ owner: scope.owner, lockHash: scope.lockHash,
  now: Date.parse('2026-10-06T12:00:00.000Z'), verifier: verifier(), audit: audit(), sbom, ...change });

describe('reviewed residual register', () => {
  it('binds exactly 22 findings to one owner, mainnet Cloak program, 0.01 SOL and the current lockfile', () => {
    expect(OWNER_PROOF_RESIDUAL_FINDINGS).toHaveLength(22); expect(new Set(OWNER_PROOF_RESIDUAL_FINDINGS).size).toBe(22);
    expect(OWNER_PROOF_RESIDUALS.verifier.inventory).toHaveLength(6); expect(OWNER_PROOF_RESIDUALS.verifier.license).toHaveLength(15);
    expect(scope).toEqual({ name: 'one-shot-owner-cloak-deposit', operation: 'cloak-shield-deposit', swap: false,
      owner: '6NTyfs83wzEo7WkkhTuNSxXiyYM9x73icbdtQWVbhaRy', network: 'solana:mainnet', genesisHash: CLOAK_RUNTIME.genesisHash,
      programId: CLOAK_RUNTIME.programId, mint: CLOAK_RUNTIME.nativeMint, depositLamports: String(MIN_DEPOSIT_LAMPORTS), lockHash: scope.lockHash,
      maxWalletSignatureRequests: 1, maxSubmissions: 1 });
    expect(scope.programId).toBe('zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW'); expect(scope.depositLamports).toBe('10000000');
    // A lockfile change invalidates the acceptance and must be re-reviewed; this fails rather than silently re-binding.
    expect(createHash('sha256').update(readFileSync(resolve(repository, 'pnpm-lock.yaml'))).digest('hex')).toBe(scope.lockHash);
    expect(Date.parse(OWNER_PROOF_RESIDUALS.validUntil) - Date.parse(OWNER_PROOF_RESIDUALS.reviewedAt)).toBe(14 * 86_400_000);
  });
  it('is deeply frozen and its canonical bytes carry no pass or readiness claim', () => {
    for (const value of [OWNER_PROOF_RESIDUALS, scope, OWNER_PROOF_RESIDUALS.audit, OWNER_PROOF_RESIDUALS.verifier,
      OWNER_PROOF_RESIDUALS.verifier.inventory, OWNER_PROOF_RESIDUALS.verifier.license, OWNER_PROOF_RESIDUAL_FINDINGS]) expect(Object.isFrozen(value)).toBe(true);
    for (const claim of OWNER_PROOF_FORBIDDEN_CLAIMS) expect(ownerProofResidualRegisterJson().toUpperCase()).not.toContain(claim);
    expect(ownerProofAcceptancePhrase('0805fa20513c73e3')).toBe('ACCEPT ONE CLOAK DEPOSIT 0805fa20');
  });
  it('owner-proof UI, gate, server, evidence and launcher sources never make a pass or readiness claim', () => {
    for (const file of ['apps/reference-dapp/src/components/cloak-owner-deposit-panel.tsx', 'apps/reference-dapp/src/privacy/owner-proof-gate.ts',
      'apps/reference-dapp/src/privacy/owner-proof-deposit.ts', 'apps/reference-dapp/src/privacy/owner-proof-configuration.ts',
      'apps/reference-dapp/src/app/privacy-owner-proof-actions.ts', 'scripts/privacy-owner-proof.mjs']) {
      const text = readFileSync(resolve(repository, file), 'utf8').toUpperCase();
      for (const claim of OWNER_PROOF_FORBIDDEN_CLAIMS) expect(text, file).not.toContain(claim);
    }
  });
});

describe('unchanged gate outputs: only the exact reviewed residual is admissible', () => {
  it('classifies the exact 22 reviewed findings as an owner-accepted residual; SBOM must still pass', () => {
    expect(evaluateOwnerProofGates(input())).toEqual({ residual: true,
      admission: { audit: 'owner-accepted-residual', sbom: 'passed', inventory: 'owner-accepted-residual', license: 'owner-accepted-residual' } });
  });
  it('passing unchanged gates need no acceptance', () => {
    expect(evaluateOwnerProofGates(input({ verifier: passed, audit: passed, owner: CLOAK_RUNTIME.nativeMint, lockHash: '00'.repeat(32) })))
      .toEqual({ residual: false, admission: { audit: 'passed', sbom: 'passed', inventory: 'passed', license: 'passed' } });
  });
  it.each([
    ['an added integrity failure', [...reviewedLines, 'Registry integrity changed: elliptic@6.6.1']],
    ['a release-age failure', [...reviewedLines.slice(1), 'Minimum release age failed: @cloak.dev/sdk@0.2.5']],
    ['a registry read failure', [...reviewedLines, 'Registry metadata unavailable: snarkjs@0.7.6: timeout']],
    ['a new license finding', [...reviewedLines, 'Unreviewed dependency license: example@1.0.0: AGPL-1.0']],
    ['a missing finding', reviewedLines.slice(1)], ['a repeated finding', [...reviewedLines.slice(1), reviewedLines[2]!]], ['no output (crash)', []],
  ])('rejects the verifier with %s', (_name, lines) => {
    expect(() => evaluateOwnerProofGates(input({ verifier: verifier(lines) }))).toThrow('OWNER_PROOF_VERIFIER_FINDINGS_CHANGED');
  });
  it('rejects a verifier whose reported violation count differs from its printed findings', () => {
    expect(() => evaluateOwnerProofGates(input({ verifier: verifier(reviewedLines, 22) }))).toThrow('OWNER_PROOF_VERIFIER_FINDINGS_CHANGED');
    expect(() => evaluateOwnerProofGates(input({ verifier: { ...verifier(), stderr: '' } }))).toThrow('OWNER_PROOF_VERIFIER_FINDINGS_CHANGED');
  });
  it.each([
    ['a moderate advisory', audit(undefined, { moderate: 1 })], ['a high advisory', audit(undefined, { high: 1 })],
    ['a critical advisory', audit(undefined, { critical: 1 })], ['an info advisory', audit(undefined, { info: 1 })],
    ['a second low advisory', audit({ 1112030: elliptic(), 2: { ...elliptic(), github_advisory_id: 'GHSA-xxxx-yyyy-zzzz' } }, { low: 2 })],
    ['another advisory id', audit({ 1: { ...elliptic(), github_advisory_id: 'GHSA-xxxx-yyyy-zzzz' } })],
    ['another elliptic version', audit({ 1: { ...elliptic(), findings: [{ version: '6.6.0', paths: elliptic().findings[0]!.paths }] } })],
    ['a path outside Cloak/circomlibjs', audit({ 1: { ...elliptic(), findings: [{ version: '6.6.1', paths: ['apps__reference-dapp>other>elliptic'] }] } })],
    ['a non-JSON report', { status: 1, stdout: 'ERR_PNPM_AUDIT_BAD_RESPONSE', stderr: '' }],
  ])('rejects the audit with %s', (_name, run) => {
    expect(() => evaluateOwnerProofGates(input({ audit: run }))).toThrow('OWNER_PROOF_AUDIT_FINDINGS_CHANGED');
  });
  it('accepts a CycloneDX object with a non-empty components array', () => {
    expect(evaluateOwnerProofGates(input({ verifier: passed, audit: passed, sbom })).admission.sbom).toBe('passed');
  });
  it.each([
    ['failed', { status: 1, stdout: '', stderr: 'boom' }], ['not JSON', { status: 0, stdout: 'x', stderr: '' }],
    ['not CycloneDX', { status: 0, stdout: JSON.stringify({ components: [{}] }), stderr: '' }],
    ['empty', { status: 0, stdout: JSON.stringify({ bomFormat: 'CycloneDX', components: [] }), stderr: '' }],
    ['missing components', { status: 0, stdout: JSON.stringify({ bomFormat: 'CycloneDX' }), stderr: '' }],
    ['string components', { status: 0, stdout: JSON.stringify({ bomFormat: 'CycloneDX', components: 'invalid-components' }), stderr: '' }],
    ['array-like components', { status: 0, stdout: JSON.stringify({ bomFormat: 'CycloneDX', components: { length: 1 } }), stderr: '' }],
    ['null', { status: 0, stdout: 'null', stderr: '' }],
    ['an array document', { status: 0, stdout: '[]', stderr: '' }],
    ['a string document', { status: 0, stdout: '"CycloneDX"', stderr: '' }],
    ['a numeric document', { status: 0, stdout: '42', stderr: '' }],
  ])('never accepts an SBOM that %s', (_name, run) => {
    expect(() => evaluateOwnerProofGates(input({ sbom: run }))).toThrow('OWNER_PROOF_SBOM_REQUIRED');
  });
  it('cannot be reused for another owner, lockfile or after the two-week window', () => {
    expect(() => evaluateOwnerProofGates(input({ owner: CLOAK_RUNTIME.nativeMint }))).toThrow('OWNER_PROOF_RESIDUAL_OWNER_MISMATCH');
    expect(() => evaluateOwnerProofGates(input({ lockHash: '00'.repeat(32) }))).toThrow('OWNER_PROOF_RESIDUAL_LOCKFILE_CHANGED');
    expect(() => evaluateOwnerProofGates(input({ now: Date.parse(OWNER_PROOF_RESIDUALS.validUntil) }))).toThrow('OWNER_PROOF_RESIDUAL_REGISTER_EXPIRED');
  });
  it('a partially changed finding set needs a new review', () => {
    expect(() => evaluateOwnerProofGates(input({ audit: passed }))).toThrow('OWNER_PROOF_RESIDUAL_FINDINGS_CHANGED');
    expect(() => evaluateOwnerProofGates(input({ verifier: passed }))).toThrow('OWNER_PROOF_RESIDUAL_FINDINGS_CHANGED');
  });
});
