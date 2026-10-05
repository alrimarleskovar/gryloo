// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-PARITY-001: what kind of host this server runs on and which deployment scope its durable state belongs to.
 *
 * A hosted deployment (Vercel sets `VERCEL=1`; Railway sets its project/environment ids; any other host can declare
 * `FLOFI_DEPLOYMENT=hosted`) may start a new instance for any request and loses its filesystem and memory at any time. It
 * therefore never keeps product state in a local journal, `/tmp` or process memory, never talks to a loopback MOCKED harness
 * and never invents a per-process session key. Local development and the deterministic test suites are not hosted.
 */
import { createHash } from 'node:crypto';

type Env = Readonly<Record<string, string | undefined>>;
export type DeploymentEnvironment = 'production' | 'preview' | 'development' | 'local';

export function isHostedDeployment(env: Env): boolean {
  return env.VERCEL === '1' || Boolean(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID) || env.FLOFI_DEPLOYMENT === 'hosted';
}
/** Vercel's own environment name when present; other hosted deployments are production; everything else is local. */
export function deploymentEnvironment(env: Env): DeploymentEnvironment {
  const vercel = env.VERCEL_ENV;
  if (vercel === 'production' || vercel === 'preview' || vercel === 'development') return vercel;
  return isHostedDeployment(env) ? 'production' : 'local';
}

const TENANT = /^[a-z0-9][a-z0-9_-]{0,62}$/;
/**
 * The tenant that scopes every durable row this deployment writes. Production and local keep `TENANT_ID` (default `default`).
 * A Vercel Preview always gets its own tenant derived from its Git branch, `pv-<slug>-<sha256(branch)[0..8]>`: redeploys of
 * the same branch share state (restart survival), different branches never see each other's runs, leases or idempotency keys.
 */
export function deploymentTenant(env: Env): string {
  if (deploymentEnvironment(env) === 'preview') {
    const branch = env.VERCEL_GIT_COMMIT_REF;
    if (!branch) throw new Error('PREVIEW_BRANCH_UNKNOWN');
    const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'branch';
    return `pv-${slug}-${createHash('sha256').update(branch).digest('hex').slice(0, 8)}`;
  }
  const tenant = env.TENANT_ID || 'default';
  if (!TENANT.test(tenant)) throw new Error('TENANT_ID_INVALID');
  return tenant;
}
