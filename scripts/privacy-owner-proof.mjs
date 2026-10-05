// SPDX-License-Identifier: AGPL-3.0-only
/** Explicit local owner-proof launch. Never connects a wallet, signs, funds or submits. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const checked = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.status !== 0) { process.stderr.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? ''); throw new Error('OWNER_PROOF_ADMISSION_FAILED: ' + args.join(' ')); }
  return result.stdout.trim();
};
if (checked('git', ['branch', '--show-current']) !== 'codex/build-privacy-001-cloak') throw new Error('PRIVACY_BRANCH_REQUIRED');
const owner = process.env.FLOFI_CLOAK_PROOF_OWNER;
if (!owner || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) throw new Error('PUBLIC_OWNER_ADDRESS_REQUIRED');
if (checked('git', ['status', '--porcelain', '--untracked-files=no'])) throw new Error('REVIEWED_CLEAN_CHECKOUT_REQUIRED');
const directory = resolve(root, '.turbo/privacy-owner-proof-admission'); mkdirSync(directory, { recursive: true });
const admissionPath = resolve(root, '.turbo/privacy-owner-proof-admission.json');
if (existsSync(admissionPath)) unlinkSync(admissionPath);
if (checked('pnpm', ['--version']) !== '11.22.0') throw new Error('PINNED_PNPM_11_22_0_REQUIRED');
// Preserve the existing verifier, advisory threshold, and exact inventory/license admission. No exceptions added.
checked('python3', ['scripts/bootstrap-ci.py', '--verify-dependencies'], { env: { ...process.env, RUNNER_TEMP: directory } });
checked('pnpm', ['audit', '--audit-level', 'low', '--json']);
const sbom = checked('pnpm', ['sbom', '--sbom-format', 'cyclonedx', '--lockfile-only']);
JSON.parse(sbom); writeFileSync(resolve(directory, 'sbom.json'), sbom + '\n');
writeFileSync(admissionPath, JSON.stringify({ format: 'flofi.cloak-owner-proof-admission.v1', owner,
  head: checked('git', ['rev-parse', 'HEAD']), lockHash: createHash('sha256').update(readFileSync(resolve(root, 'pnpm-lock.yaml'))).digest('hex'),
  expiresAt: Date.now() + 60 * 60 * 1000, admission: { audit: true, sbom: true, inventory: true, license: true } }));
const result = spawnSync(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3019'], {
  cwd: resolve(root, 'apps/reference-dapp'), stdio: 'inherit', env: { ...process.env, FLOFI_CLOAK_OWNER_PROOF: '1', FLOFI_CLOAK_PROOF_OWNER: owner } });
process.exitCode = result.status ?? 1;
