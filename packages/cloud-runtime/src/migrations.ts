// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Version-controlled schema migrations. Files `migrations/NNNN_name.sql` apply in numeric order, each in its
 * own transaction, serialized across concurrent runners by a transaction-scoped advisory lock. The SHA-256 of
 * every applied file is recorded; an edited, missing or reordered migration fails closed. Application
 * processes never migrate implicitly: they call `assertSchemaCurrent` and refuse to start when behind.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './db.js';

export type Migration = { readonly version: number; readonly name: string; readonly sql: string; readonly sha256: string };
/** What the schema check compares: a migration's identity without its SQL. */
export type MigrationIdentity = Pick<Migration, 'version' | 'name' | 'sha256'>;
// A path computation, not a bundler asset reference: bundled serverless functions never read it (they use SHIPPED_MIGRATIONS).
export const MIGRATIONS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
/**
 * BUILD-CLOUD-PARITY-001: the identities of the migrations this package ships, so a bundled serverless function (where the
 * `migrations/` directory is not next to the code) can still verify the schema. A unit test proves it equals the SQL files;
 * migrating still reads the files.
 */
export const SHIPPED_MIGRATIONS: readonly MigrationIdentity[] = Object.freeze([
  { version: 1, name: 'execution_core', sha256: '66f8f10018153ea96209c6d83e16dc8fc85649792b64c69cdbb217a34ab3890e' },
  { version: 2, name: 'swap_attempt_states', sha256: 'ec0486c47f6ec6e1f24824e58eb92a1cf25f53457097c9e417da94a6a16733be' },
  { version: 3, name: 'solana_identities', sha256: 'a79ac40c257d6618762ec56ffbfb54d0d5e40771a569da74051805dfb3a2c365' },
  { version: 4, name: 'owner_run_history', sha256: 'be6edd07d29fd741a421c925a87f0bd0274904244e8a43c36be78e9d3b90bc9a' },
  { version: 5, name: 'mcp_oauth', sha256: '7130a683de4f7e7ec28158cfcf2022f1fdc9583b6f47b540f39f97b4803115da' },
].map(migration => Object.freeze(migration)));
const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const LOCK_ID = 7_340_032_001; // Constant advisory lock key for migration runners.

export async function loadMigrations(directory = MIGRATIONS_DIRECTORY): Promise<readonly Migration[]> {
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  const migrations = await Promise.all(files.map(async (file, index) => {
    const match = FILE.exec(file);
    if (!match || Number(match[1]) !== index + 1) throw new Error('MIGRATION_SEQUENCE_INVALID');
    const sql = await readFile(`${directory}/${file}`, 'utf8');
    return { version: Number(match[1]), name: match[2]!, sql, sha256: createHash('sha256').update(sql).digest('hex') };
  }));
  return Object.freeze(migrations);
}

const LEDGER = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY CHECK (version >= 1), name text NOT NULL, sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now())`;

type Applied = { version: number; name: string; sha256: string };
function verifyPrefix(applied: readonly Applied[], migrations: readonly MigrationIdentity[]): void {
  for (const [index, row] of applied.entries()) {
    const expected = migrations[index];
    if (!expected || row.version !== expected.version || row.name !== expected.name || row.sha256 !== expected.sha256)
      throw new Error('MIGRATION_HISTORY_MISMATCH');
  }
}

/** Applies every pending migration. Safe to run concurrently and repeatedly; returns the versions applied now. */
export async function migrate(db: Database, migrations?: readonly Migration[]): Promise<readonly number[]> {
  const all = migrations ?? await loadMigrations();
  const appliedNow: number[] = [];
  for (;;) {
    const done = await db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
      await tx.query(LEDGER);
      const applied = (await tx.query<Applied>('SELECT version, name, sha256 FROM schema_migrations ORDER BY version')).rows;
      verifyPrefix(applied, all);
      const next = all[applied.length];
      if (!next) return true;
      await tx.query(next.sql);
      await tx.query('INSERT INTO schema_migrations (version, name, sha256) VALUES ($1, $2, $3)', [next.version, next.name, next.sha256]);
      appliedNow.push(next.version);
      return false;
    });
    if (done) return appliedNow;
  }
}

/** Fails closed unless the database has exactly the migrations this build ships. */
export async function assertSchemaCurrent(db: Database, migrations?: readonly MigrationIdentity[]): Promise<number> {
  const all = migrations ?? await loadMigrations();
  let applied: Applied[];
  try { applied = (await db.query<Applied>('SELECT version, name, sha256 FROM schema_migrations ORDER BY version')).rows; }
  catch (cause) { throw new Error('SCHEMA_NOT_MIGRATED', { cause }); }
  verifyPrefix(applied, all);
  if (applied.length !== all.length) throw new Error('SCHEMA_NOT_MIGRATED');
  return applied.length;
}
