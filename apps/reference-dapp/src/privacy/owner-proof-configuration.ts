// SPDX-License-Identifier: AGPL-3.0-only
/** Server-only launch admission. An environment flag alone cannot admit dependencies. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { disabledOwnerProof, type OwnerProofConfiguration } from './owner-proof-gate';
export async function ownerProofConfiguration(): Promise<OwnerProofConfiguration> {
  const owner = process.env.FLOFI_CLOAK_PROOF_OWNER ?? '6NTyfs83wzEo7WkkhTuNSxXiyYM9x73icbdtQWVbhaRy';
  const disabled = disabledOwnerProof(owner);
  if (process.env.FLOFI_CLOAK_OWNER_PROOF !== '1') return disabled;
  try {
    const root = resolve(process.cwd(), '../..');
    const record = JSON.parse(await readFile(resolve(root, '.turbo/privacy-owner-proof-admission.json'), 'utf8'));
    const hash = createHash('sha256').update(await readFile(resolve(root, 'pnpm-lock.yaml'))).digest('hex');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
    if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim()) return disabled;
    if (record.format !== 'flofi.cloak-owner-proof-admission.v1' || record.owner !== owner || record.lockHash !== hash || record.head !== head ||
        branch !== 'codex/build-privacy-001-cloak' || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= Date.now() ||
        JSON.stringify(record.admission) !== JSON.stringify({ audit: true, sbom: true, inventory: true, license: true })) return disabled;
    return { enabled: true, owner, expiresAt: record.expiresAt, admission: record.admission };
  } catch { return disabled; }
}
