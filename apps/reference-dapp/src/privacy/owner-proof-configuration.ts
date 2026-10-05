// SPDX-License-Identifier: AGPL-3.0-only
/** Server-only launch admission. An environment flag alone cannot admit dependencies or accept residual risk. */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { disabledOwnerProof, ownerProofAdmitted, type OwnerProofConfiguration } from './owner-proof-gate';
import { OWNER_PROOF_RESIDUALS, ownerProofResidualRegisterJson } from './owner-proof-residuals';

export const OWNER_PROOF_ADMISSION_FORMAT = 'flofi.cloak-owner-proof-admission.v2';
export const OWNER_PROOF_BRANCH = 'codex/build-privacy-001-cloak';
/** Public one-shot journals. Their existence is the reservation; nothing in the application deletes or rewrites them. */
export function ownerProofJournalPaths(root: string, owner: string) {
  const directory = resolve(root, '.turbo/privacy-owner-proof-broadcast');
  return { directory, signatureRequest: resolve(directory, owner + '.signature-request.json'), broadcast: resolve(directory, owner + '.json') };
}
export const ownerProofResidualRegisterHash = (): string => createHash('sha256').update(ownerProofResidualRegisterJson()).digest('hex');
export type OwnerProofLaunchContext = { owner: string; head: string; branch: string; clean: boolean; lockHash: string;
  consumed: boolean; hosted: boolean; now: number; registerHash: string };
/** Validate the launcher's record against the current checkout. Anything unexpected, consumed or hosted is disabled. */
export function ownerProofConfigurationFromRecord(record: unknown, context: OwnerProofLaunchContext): OwnerProofConfiguration {
  const disabled = disabledOwnerProof(context.owner);
  if (context.hosted || context.consumed || !context.clean || context.branch !== OWNER_PROOF_BRANCH || !record || typeof record !== 'object') return disabled;
  const r = record as Record<string, unknown>;
  if (Object.keys(r).sort().join() !== 'acceptance,admission,expiresAt,format,head,lockHash,owner' || r.format !== OWNER_PROOF_ADMISSION_FORMAT ||
      r.owner !== context.owner || r.head !== context.head || r.lockHash !== context.lockHash || !r.admission || typeof r.admission !== 'object' ||
      !Number.isSafeInteger(r.expiresAt) || (r.expiresAt as number) <= context.now) return disabled;
  const configuration = structuredClone({ enabled: true, owner: context.owner, expiresAt: r.expiresAt as number,
    admission: r.admission as OwnerProofConfiguration['admission'], acceptance: r.acceptance as OwnerProofConfiguration['acceptance'] });
  if (!ownerProofAdmitted(configuration, context.now)) return disabled;
  // The accepted register must be byte-identical to this checkout's register, for its pinned lockfile, within its window.
  if (configuration.acceptance && (configuration.acceptance.registerHash !== context.registerHash ||
      context.lockHash !== OWNER_PROOF_RESIDUALS.scope.lockHash || configuration.expiresAt > Date.parse(OWNER_PROOF_RESIDUALS.validUntil))) return disabled;
  return configuration;
}
export async function ownerProofConfiguration(): Promise<OwnerProofConfiguration> {
  const owner = process.env.FLOFI_CLOAK_PROOF_OWNER ?? OWNER_PROOF_RESIDUALS.scope.owner;
  if (process.env.FLOFI_CLOAK_OWNER_PROOF !== '1') return disabledOwnerProof(owner);
  try {
    const root = resolve(process.cwd(), '../..');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    const record: unknown = JSON.parse(await readFile(resolve(root, '.turbo/privacy-owner-proof-admission.json'), 'utf8'));
    return ownerProofConfigurationFromRecord(record, { owner, head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
      clean: git('status', '--porcelain', '--untracked-files=no') === '',
      lockHash: createHash('sha256').update(await readFile(resolve(root, 'pnpm-lock.yaml'))).digest('hex'),
      // A submission consumes the proof; it can never be re-enabled for this owner from this checkout.
      consumed: existsSync(ownerProofJournalPaths(root, owner).broadcast),
      hosted: Boolean(process.env.VERCEL), now: Date.now(), registerHash: ownerProofResidualRegisterHash() });
  } catch { return disabledOwnerProof(owner); }
}
