// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generic infrastructure configuration from the environment. Names describe concepts (DATABASE_URL,
 * OBJECT_STORE_*, API_AUTH_TOKEN), never a vendor, so a provider change is a configuration change.
 * Secrets are read once here and never logged.
 */
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createFilesystemEvidenceStore, createS3EvidenceStore, type EvidenceStore } from './evidence-store.js';

export type Environment = Readonly<Record<string, string | undefined>>;
export type RuntimeConfig = {
  readonly databaseUrl: string; readonly migrationDatabaseUrl: string; readonly databasePoolMax: number;
  readonly tenantId: string; readonly apiAuthToken: string | null; readonly port: number; readonly host: string;
  readonly workerId: string; readonly workerConcurrency: number; readonly production: boolean;
};
const TENANT = /^[a-z0-9][a-z0-9_-]{0,62}$/;
function integer(value: string | undefined, fallback: number, min: number, max: number, code: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(code);
  return n;
}
export function readRuntimeConfig(env: Environment, role: 'api' | 'worker' | 'migrate'): RuntimeConfig {
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error('DATABASE_URL_REQUIRED');
  const migrationDatabaseUrl = env.DATABASE_MIGRATION_URL || databaseUrl;
  if (!/^postgres(ql)?:\/\//.test(migrationDatabaseUrl)) throw new Error('DATABASE_MIGRATION_URL_INVALID');
  const tenantId = env.TENANT_ID || 'default';
  if (!TENANT.test(tenantId)) throw new Error('TENANT_ID_INVALID');
  const production = env.NODE_ENV === 'production';
  const apiAuthToken = env.API_AUTH_TOKEN || null;
  // The API never runs unauthenticated in production; a short token is treated as absent.
  if (role === 'api' && production && (!apiAuthToken || apiAuthToken.length < 32)) throw new Error('API_AUTH_TOKEN_REQUIRED');
  return {
    databaseUrl, migrationDatabaseUrl, databasePoolMax: integer(env.DATABASE_POOL_MAX, 10, 1, 100, 'DATABASE_POOL_MAX_INVALID'),
    tenantId, apiAuthToken, port: integer(env.PORT, 8080, 1, 65_535, 'PORT_INVALID'), host: env.HOST || '0.0.0.0',
    workerId: env.WORKER_ID || `${hostname().replace(/[^A-Za-z0-9.-]/g, '').slice(0, 40)}-${process.pid}-${randomBytes(4).toString('hex')}`,
    workerConcurrency: integer(env.WORKER_CONCURRENCY, 4, 1, 32, 'WORKER_CONCURRENCY_INVALID'), production,
  };
}
/** OBJECT_STORE_* selects an S3-compatible store; EVIDENCE_DIRECTORY a local one; otherwise none is configured. */
export function readEvidenceStore(env: Environment): EvidenceStore | null {
  if (env.OBJECT_STORE_ENDPOINT || env.OBJECT_STORE_BUCKET) {
    return createS3EvidenceStore({ endpoint: env.OBJECT_STORE_ENDPOINT ?? '', bucket: env.OBJECT_STORE_BUCKET ?? '', region: env.OBJECT_STORE_REGION || 'auto',
      accessKeyId: env.OBJECT_STORE_ACCESS_KEY_ID ?? '', secretAccessKey: env.OBJECT_STORE_SECRET_ACCESS_KEY ?? '',
      forcePathStyle: env.OBJECT_STORE_FORCE_PATH_STYLE !== 'false', ...env.OBJECT_STORE_PREFIX ? { prefix: env.OBJECT_STORE_PREFIX } : {} });
  }
  return env.EVIDENCE_DIRECTORY ? createFilesystemEvidenceStore(env.EVIDENCE_DIRECTORY) : null;
}
