// SPDX-License-Identifier: AGPL-3.0-only
/** Serverless PostgreSQL configuration shared by flow execution and durable platform state. */
import { deploymentTenant } from './deployment.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** A few connections per serverless process; use the provider's pooled endpoint. */
function poolMax(value: string | undefined): number {
  if (value === undefined || value === '') return 3;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 20) throw new Error('DATABASE_POOL_MAX_INVALID');
  return n;
}

export function serverlessPostgresConfig(env: Env) {
  const databaseUrl = env.DATABASE_URL ?? '';
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL_REQUIRED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) throw new Error('DATABASE_URL_REQUIRED');
  return { databaseUrl, tenantId: deploymentTenant(env), maxConnections: poolMax(env.DATABASE_POOL_MAX) };
}
