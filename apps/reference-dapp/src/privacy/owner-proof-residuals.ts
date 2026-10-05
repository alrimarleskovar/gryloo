// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Owner-accepted residual dependency risk for ONE local 0.01 SOL Cloak mainnet shield deposit (owner decision 2026-10-05).
 * This is not release admission: CI, the dependency verifier, the audit threshold, the lockfile and the ordinary
 * production financial gate are unchanged and still fail. Any finding outside this exact register, including any
 * registry integrity, release-age or metadata failure, fails closed. Dependency-free, erasable-only TypeScript so the
 * Node launcher can import it with native type stripping.
 */
export const OWNER_PROOF_RESIDUAL_LABEL = 'OWNER-ACCEPTED RESIDUAL RISK';
/** Claims the owner-proof UI and evidence must never make about this acceptance. */
export const OWNER_PROOF_FORBIDDEN_CLAIMS = Object.freeze(['SECURITY PASS', 'DEPENDENCY PASS', 'PRODUCTION READY']);
export const OWNER_PROOF_RESIDUALS = Object.freeze({
  format: 'flofi.cloak-owner-proof-residuals.v1',
  scope: Object.freeze({
    name: 'one-shot-owner-cloak-deposit', operation: 'cloak-shield-deposit', swap: false,
    owner: '6NTyfs83wzEo7WkkhTuNSxXiyYM9x73icbdtQWVbhaRy', network: 'solana:mainnet',
    genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', programId: 'zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW',
    mint: 'So11111111111111111111111111111111111111112', depositLamports: '10000000',
    lockHash: '183f41fce7495413d6d2b990f6f947b110d1d777ed144c37dbe6800d777e1760',
    maxWalletSignatureRequests: 1, maxSubmissions: 1,
  }),
  reviewedAt: '2026-10-05',
  // Two weeks from the owner decision. A signature request or submission consumes it earlier.
  validUntil: '2026-10-19T00:00:00.000Z',
  audit: Object.freeze({
    // GHSA-848j-6mx2-7j84 / CVE-2025-14505: elliptic ECDSA signing truncates some RFC 6979 k values. No patched
    // release exists. Reachable only through circomlibjs, which uses ethers 5 hashing/byte utilities, never a signer.
    ghsa: 'GHSA-848j-6mx2-7j84', module: 'elliptic', version: '6.6.1', severity: 'low',
    pathPrefix: 'apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>',
  }),
  verifier: Object.freeze({
    // Exact unchanged `bootstrap-ci.py --verify-dependencies` lines for the pinned lockfile above.
    inventory: Object.freeze([
      'Baseline registry packages/snapshots or peer resolutions changed',
      'BUILD-CLOUD-001 lock count drift: packages=411, registry=411, snapshots=411',
      'BUILD-002 direct manifest versions or workspace links differ',
      'Unapproved direct pin: @cloak.dev/sdk@0.2.5',
      'Unapproved direct pin: snarkjs@0.7.6',
      'Incomplete registry review: 411 of 262',
    ]),
    license: Object.freeze([
      'Unreviewed dependency license: @iden3/bigarray@0.0.2: GPL-3.0',
      'Unreviewed dependency license: @iden3/binfileutils@0.0.12: GPL-3.0',
      'Unreviewed dependency license: circomlibjs@0.1.7: GPL-3.0',
      'Unreviewed dependency license: esprima@1.2.5: None',
      'Unreviewed dependency license: fastfile@0.0.20: GPL-3.0',
      'Unreviewed dependency license: ffjavascript@0.2.63: GPL-3.0',
      'Unreviewed dependency license: ffjavascript@0.3.0: GPL-3.0',
      'Unreviewed dependency license: ffjavascript@0.3.1: GPL-3.0',
      'Unreviewed dependency license: r1csfile@0.0.48: GPL-3.0',
      'Unreviewed dependency license: snarkjs@0.7.6: GPL-3.0',
      'Unreviewed dependency license: tweetnacl-util@0.15.1: Unlicense',
      'Unreviewed dependency license: tweetnacl@1.0.3: Unlicense',
      'Unreviewed dependency license: wasmbuilder@0.0.16: GPL-3.0',
      'Unreviewed dependency license: wasmcurves@0.2.2: GPL-3.0',
      "Full rejected set drift: missing=[], new=['@iden3/bigarray@0.0.2', '@iden3/binfileutils@0.0.12', 'circomlibjs@0.1.7', " +
        "'esprima@1.2.5', 'fastfile@0.0.20', 'ffjavascript@0.2.63', 'ffjavascript@0.3.0', 'ffjavascript@0.3.1', 'r1csfile@0.0.48', " +
        "'snarkjs@0.7.6', 'tweetnacl-util@0.15.1', 'tweetnacl@1.0.3', 'wasmbuilder@0.0.16', 'wasmcurves@0.2.2']",
    ]),
  }),
});
export type OwnerProofScope = typeof OWNER_PROOF_RESIDUALS.scope;
const auditFinding = `${OWNER_PROOF_RESIDUALS.audit.ghsa} ${OWNER_PROOF_RESIDUALS.audit.module}@${OWNER_PROOF_RESIDUALS.audit.version} (low)`;
/** The exact 22 reviewed findings, in register order: one audit advisory, then the 21 verifier lines. */
export const OWNER_PROOF_RESIDUAL_FINDINGS: readonly string[] = Object.freeze([auditFinding,
  ...OWNER_PROOF_RESIDUALS.verifier.inventory, ...OWNER_PROOF_RESIDUALS.verifier.license]);
/** Canonical bytes hashed into the admission record; the launcher and server compare the same value. */
export const ownerProofResidualRegisterJson = (): string => JSON.stringify(OWNER_PROOF_RESIDUALS);
export const ownerProofAcceptancePhrase = (registerHash: string): string => `ACCEPT ONE CLOAK DEPOSIT ${registerHash.slice(0, 8)}`;
/** Public record of the owner's acceptance, carried into the permit, journals and exported evidence. Never a secret. */
export type OwnerProofAcceptance = {
  status: typeof OWNER_PROOF_RESIDUAL_LABEL; scope: OwnerProofScope; registerHash: string; acceptedAt: number;
  validUntil: string; findings: readonly string[]; releaseAdmission: false; productionFinancialGate: 'DISABLED';
};
export function sameOwnerProofScope(scope: unknown): boolean {
  return JSON.stringify(scope) === JSON.stringify(OWNER_PROOF_RESIDUALS.scope);
}
/** Structural check shared by browser and server. The server additionally recomputes registerHash from the register bytes. */
export function validOwnerProofAcceptance(value: unknown, now: number): value is OwnerProofAcceptance {
  if (!value || typeof value !== 'object') return false;
  const a = value as Partial<OwnerProofAcceptance>;
  return Object.keys(a).sort().join() === 'acceptedAt,findings,productionFinancialGate,registerHash,releaseAdmission,scope,status,validUntil' &&
    a.status === OWNER_PROOF_RESIDUAL_LABEL && sameOwnerProofScope(a.scope) && /^[a-f0-9]{64}$/.test(a.registerHash ?? '') &&
    a.validUntil === OWNER_PROOF_RESIDUALS.validUntil && now < Date.parse(OWNER_PROOF_RESIDUALS.validUntil) &&
    Number.isSafeInteger(a.acceptedAt) && a.acceptedAt! <= now && a.releaseAdmission === false && a.productionFinancialGate === 'DISABLED' &&
    JSON.stringify(a.findings) === JSON.stringify(OWNER_PROOF_RESIDUAL_FINDINGS);
}

export type OwnerProofGateRun = { status: number | null; stdout: string; stderr: string };
export type OwnerProofGateStatus = 'passed' | 'owner-accepted-residual';
export type OwnerProofGateEvaluation = {
  admission: { audit: OwnerProofGateStatus; sbom: 'passed'; inventory: OwnerProofGateStatus; license: OwnerProofGateStatus };
  residual: boolean;
};
const fail = (code: string): never => { throw new Error(code); };
const sameSet = (actual: readonly string[], expected: readonly string[]) =>
  actual.length === expected.length && new Set(actual).size === actual.length && expected.every(line => actual.includes(line));
function verifierStatus(run: OwnerProofGateRun): OwnerProofGateStatus {
  if (run.status === 0) return 'passed';
  const lines = run.stdout.split('\n').map(line => line.trim()).filter(Boolean);
  const expected = [...OWNER_PROOF_RESIDUALS.verifier.inventory, ...OWNER_PROOF_RESIDUALS.verifier.license];
  // The verifier prints every violation, then raises with their count. Only the exact reviewed set is admissible.
  if (!sameSet(lines, expected) || !run.stderr.includes(`dependency verification failed with ${expected.length} violation(s)`))
    fail('OWNER_PROOF_VERIFIER_FINDINGS_CHANGED');
  return 'owner-accepted-residual';
}
function auditStatus(run: OwnerProofGateRun): OwnerProofGateStatus {
  if (run.status === 0) return 'passed';
  let report: { metadata?: { vulnerabilities?: Record<string, number> }; advisories?: Record<string, {
    github_advisory_id?: string; module_name?: string; severity?: string; findings?: { version?: string; paths?: string[] }[] }> };
  try { report = JSON.parse(run.stdout); } catch { return fail('OWNER_PROOF_AUDIT_FINDINGS_CHANGED'); }
  const counts = report.metadata?.vulnerabilities ?? {}, advisories = Object.values(report.advisories ?? {});
  const expected = OWNER_PROOF_RESIDUALS.audit;
  if (advisories.length !== 1 || counts.low !== 1 || ['info', 'moderate', 'high', 'critical'].some(level => counts[level] !== 0))
    fail('OWNER_PROOF_AUDIT_FINDINGS_CHANGED');
  const advisory = advisories[0]!;
  if (advisory.github_advisory_id !== expected.ghsa || advisory.module_name !== expected.module || advisory.severity !== expected.severity ||
      !advisory.findings?.length || advisory.findings.some(f => f.version !== expected.version || !f.paths?.length ||
        f.paths.some(path => !path.startsWith(expected.pathPrefix) || !path.endsWith('>elliptic'))))
    fail('OWNER_PROOF_AUDIT_FINDINGS_CHANGED');
  return 'owner-accepted-residual';
}
/**
 * Classify the unchanged gate outputs. A gate that passes stays "passed"; a failing verifier/audit is admissible only
 * as its exact registered finding set, for the registered owner and lockfile, before validUntil. SBOM must pass.
 */
export function evaluateOwnerProofGates(input: { owner: string; lockHash: string; now: number;
  verifier: OwnerProofGateRun; audit: OwnerProofGateRun; sbom: OwnerProofGateRun }): OwnerProofGateEvaluation {
  let bom: unknown;
  try { bom = input.sbom.status === 0 ? JSON.parse(input.sbom.stdout) : null; } catch { bom = null; }
  if (!bom || typeof bom !== 'object' || Array.isArray(bom)) fail('OWNER_PROOF_SBOM_REQUIRED');
  const document = bom as Record<string, unknown>;
  if (document.bomFormat !== 'CycloneDX' || !Array.isArray(document.components) || document.components.length === 0)
    fail('OWNER_PROOF_SBOM_REQUIRED');
  const verifier = verifierStatus(input.verifier), audit = auditStatus(input.audit);
  const residual = verifier === 'owner-accepted-residual' || audit === 'owner-accepted-residual';
  if (residual) {
    if (input.owner !== OWNER_PROOF_RESIDUALS.scope.owner) fail('OWNER_PROOF_RESIDUAL_OWNER_MISMATCH');
    if (input.lockHash !== OWNER_PROOF_RESIDUALS.scope.lockHash) fail('OWNER_PROOF_RESIDUAL_LOCKFILE_CHANGED');
    if (!(input.now < Date.parse(OWNER_PROOF_RESIDUALS.validUntil))) fail('OWNER_PROOF_RESIDUAL_REGISTER_EXPIRED');
    // The acceptance covers the reviewed finding set as a whole; a partially changed gate needs a new review.
    if (verifier !== 'owner-accepted-residual' || audit !== 'owner-accepted-residual') fail('OWNER_PROOF_RESIDUAL_FINDINGS_CHANGED');
  }
  return { admission: { audit, sbom: 'passed', inventory: verifier, license: verifier }, residual };
}
