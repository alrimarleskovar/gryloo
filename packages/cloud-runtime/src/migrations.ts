// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Version-controlled schema migrations. Files `migrations/NNNN_name.sql` apply in numeric order, each in its
 * own transaction, serialized across concurrent runners by a transaction-scoped advisory lock. The SHA-256 of
 * every applied file is recorded; an edited, missing or reordered migration fails closed. Application
 * processes never migrate implicitly: they call `assertSchemaCurrent` and refuse to start when behind.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Database } from './db.js';

export type Migration = { readonly version: number; readonly name: string; readonly sql: string; readonly sha256: string };
export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../migrations/', import.meta.url));
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
function verifyPrefix(applied: readonly Applied[], migrations: readonly Migration[]): void {
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
export async function assertSchemaCurrent(db: Database, migrations?: readonly Migration[]): Promise<number> {
  const all = migrations ?? await loadMigrations();
  let applied: Applied[];
  try { applied = (await db.query<Applied>('SELECT version, name, sha256 FROM schema_migrations ORDER BY version')).rows; }
  catch (cause) { throw new Error('SCHEMA_NOT_MIGRATED', { cause }); }
  verifyPrefix(applied, all);
  if (applied.length !== all.length) throw new Error('SCHEMA_NOT_MIGRATED');
  return applied.length;
}
