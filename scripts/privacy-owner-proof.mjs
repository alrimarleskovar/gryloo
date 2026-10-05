// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Explicit local owner-proof launch. Never connects a wallet, signs, funds or submits.
 * Runs the unchanged dependency verifier, low-threshold audit and SBOM. If the verifier/audit fail with exactly the
 * reviewed residual register, only the owner can accept it by typing the phrase in a real terminal. `--check` evaluates
 * the gates and writes no admission.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { OWNER_PROOF_RESIDUALS, OWNER_PROOF_RESIDUAL_FINDINGS, OWNER_PROOF_RESIDUAL_LABEL, evaluateOwnerProofGates,
  ownerProofAcceptancePhrase, ownerProofResidualRegisterJson } from '../apps/reference-dapp/src/privacy/owner-proof-residuals.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), check = args.length === 1 && args[0] === '--check';
if (args.length && !check) throw new Error('USAGE: node scripts/privacy-owner-proof.mjs [--check]');
const run = (cmd, argv, options = {}) => {
  const result = spawnSync(cmd, argv, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};
const checked = (cmd, argv) => {
  const result = run(cmd, argv);
  if (result.status !== 0) { process.stderr.write(result.stdout + result.stderr); throw new Error('OWNER_PROOF_ADMISSION_FAILED: ' + argv.join(' ')); }
  return result.stdout.trim();
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const lockPath = resolve(root, 'pnpm-lock.yaml');
const assertReviewedCheckout = () => {
  if (checked('git', ['branch', '--show-current']) !== 'codex/build-privacy-001-cloak') throw new Error('PRIVACY_BRANCH_REQUIRED');
  if (checked('git', ['status', '--porcelain', '--untracked-files=no'])) throw new Error('REVIEWED_CLEAN_CHECKOUT_REQUIRED');
  return { head: checked('git', ['rev-parse', 'HEAD']), lockHash: sha256(readFileSync(lockPath)) };
};
const owner = process.env.FLOFI_CLOAK_PROOF_OWNER;
if (!owner || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) throw new Error('PUBLIC_OWNER_ADDRESS_REQUIRED');
const reviewed = assertReviewedCheckout();
const admissionPath = resolve(root, '.turbo/privacy-owner-proof-admission.json');
if (!check && existsSync(admissionPath)) unlinkSync(admissionPath);
// One wallet signature request and one submission per owner proof: any prior journal consumes it permanently.
const journals = resolve(root, '.turbo/privacy-owner-proof-broadcast');
if (['.signature-request.json', '.json'].some(suffix => existsSync(resolve(journals, owner + suffix)))) throw new Error('OWNER_PROOF_ALREADY_CONSUMED');
if (checked('pnpm', ['--version']) !== '11.22.0') throw new Error('PINNED_PNPM_11_22_0_REQUIRED');
const portInUse = await new Promise(done => {
  const socket = createConnection({ host: '127.0.0.1', port: 3019 }, () => { socket.destroy(); done(true); });
  socket.on('error', () => done(false));
});
if (!check && portInUse) throw new Error('PORT_3019_IN_USE: stop the existing server on 127.0.0.1:3019 first');
const directory = resolve(root, '.turbo/privacy-owner-proof-admission'); mkdirSync(directory, { recursive: true });
// The unchanged verifier, low-severity audit threshold and CycloneDX SBOM. Nothing is suppressed or waived.
const sbom = run('pnpm', ['sbom', '--sbom-format', 'cyclonedx', '--lockfile-only']);
const evaluation = evaluateOwnerProofGates({ owner, lockHash: reviewed.lockHash, now: Date.now(), sbom,
  verifier: run('python3', ['scripts/bootstrap-ci.py', '--verify-dependencies'], { env: { ...process.env, RUNNER_TEMP: directory } }),
  audit: run('pnpm', ['audit', '--audit-level', 'low', '--json']) });
writeFileSync(resolve(directory, 'sbom.json'), sbom.stdout.trim() + '\n');
const registerHash = sha256(ownerProofResidualRegisterJson()), phrase = ownerProofAcceptancePhrase(registerHash);
const scope = OWNER_PROOF_RESIDUALS.scope;
if (evaluation.residual) process.stdout.write([
  '', `==== ${OWNER_PROOF_RESIDUAL_LABEL}: ONE Cloak mainnet shield deposit ====`,
  'Unchanged gates: audit FAILS (1 low), dependency verifier FAILS (21), SBOM generated. These findings are not resolved or waived for release.',
  `Owner:      ${scope.owner}`, `Network:    Solana MAINNET, genesis ${scope.genesisHash}`, `Program:    ${scope.programId}`,
  'Operation:  ONE Cloak shield deposit of exactly 0.01 SOL (10,000,000 lamports); no swap, no public fallback',
  `Lockfile:   ${scope.lockHash}`, 'Limits:     at most 1 wallet signature request and 1 application submission; no automatic or blind retry',
  `Expires:    ${OWNER_PROOF_RESIDUALS.validUntil}, or at the first wallet signature request`, `Register:   ${registerHash}`,
  `Accepted findings (${OWNER_PROOF_RESIDUAL_FINDINGS.length}):`, ...OWNER_PROOF_RESIDUAL_FINDINGS.map(f => '  - ' + f),
  'Production financial execution remains DISABLED. CI and the normal dependency/SBOM gate remain failing.', ''].join('\n') + '\n');
else process.stdout.write('All unchanged dependency gates passed; no residual acceptance is needed.\n');
if (check) {
  process.stdout.write(`CHECK ONLY: acceptance phrase would be "${phrase}". No admission written; no server started.\n`);
  process.exit(0);
}
let acceptance = null;
if (evaluation.residual) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('OWNER_PROOF_INTERACTIVE_ACCEPTANCE_REQUIRED');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await prompt.question(`Type exactly "${phrase}" to accept this residual risk; anything else aborts: `)).trim();
  prompt.close();
  if (answer !== phrase) throw new Error('OWNER_PROOF_RESIDUAL_NOT_ACCEPTED');
  acceptance = { status: OWNER_PROOF_RESIDUAL_LABEL, scope, registerHash, acceptedAt: Date.now(), validUntil: OWNER_PROOF_RESIDUALS.validUntil,
    findings: [...OWNER_PROOF_RESIDUAL_FINDINGS], releaseAdmission: false, productionFinancialGate: 'DISABLED' };
}
// The gates ran against this exact checkout; refuse if it moved while they ran.
const current = assertReviewedCheckout();
if (current.head !== reviewed.head || current.lockHash !== reviewed.lockHash) throw new Error('REVIEWED_CLEAN_CHECKOUT_REQUIRED');
const sessionExpiry = Date.now() + 60 * 60 * 1000;
writeFileSync(admissionPath, JSON.stringify({ format: 'flofi.cloak-owner-proof-admission.v2', owner, head: reviewed.head, lockHash: reviewed.lockHash,
  expiresAt: acceptance ? Math.min(sessionExpiry, Date.parse(OWNER_PROOF_RESIDUALS.validUntil)) : sessionExpiry,
  admission: evaluation.admission, acceptance }), { mode: 0o600 });
const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3019'], {
  cwd: resolve(root, 'apps/reference-dapp'), stdio: 'inherit', env: { ...process.env, FLOFI_CLOAK_OWNER_PROOF: '1', FLOFI_CLOAK_PROOF_OWNER: owner } });
process.exitCode = result.status ?? 1;
