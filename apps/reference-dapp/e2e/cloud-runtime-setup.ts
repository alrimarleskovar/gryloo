// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-PARITY-001 Playwright global setup for the embedded-runtime suites: creates and migrates the disposable LOOPBACK database
 * the embedded runtime uses for this run, and drops it afterwards. It never connects to a non-loopback server.
 */
import { readFile } from 'node:fs/promises';
import { createDatabase, migrate } from '@defi-workflow-engine/cloud-runtime';

export default async function setup(): Promise<() => Promise<void>> {
  const target = new URL(process.env.FLOFI_E2E_DATABASE_URL ?? '');
  const name = target.pathname.slice(1);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || !/^flofi_e2e_[0-9a-z_]{1,40}$/.test(name)) throw new Error('CLOUD_RUNTIME_E2E_DATABASE_REFUSED');
  const admin = new URL(target.href); admin.pathname = '/postgres';
  const run = async (sql: string) => { const db = createDatabase({ connectionString: admin.href, maxConnections: 1 }); try { await db.query(sql); } finally { await db.close(); } };
  await run(`CREATE DATABASE ${name}`);
  const db = createDatabase({ connectionString: target.href, maxConnections: 1 });
  try {
    await migrate(db);
    // BUILD-CHANNELS-001: the staged channel migration (not yet in the shipped sequence), applied raw like the PostgreSQL tests do.
    if (process.env.GRYLOO_CHANNEL_E2E === 'FIXTURE_LOOPBACK_ONLY')
      await db.query(await readFile(new URL('../../../packages/cloud-runtime/migrations-pending/0008_channel_conversations.sql', import.meta.url), 'utf8'));
  } finally { await db.close(); }
  return async () => { await run(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); };
}
