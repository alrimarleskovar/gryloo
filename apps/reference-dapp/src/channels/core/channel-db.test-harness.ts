// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test-only: a disposable loopback PostgreSQL with the shipped migrations plus the staged channel migration 0008. The staged SQL is
 * applied raw (no ledger row), so the embedded runtime's exact schema check still sees exactly the shipped migrations.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, type TestDatabase } from '../../../../../packages/cloud-runtime/test/pg-harness.ts';

export const STAGED_CHANNEL_MIGRATION = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', 'packages', 'cloud-runtime',
  'migrations-pending', '0008_channel_conversations.sql');
export async function createChannelTestDatabase(): Promise<TestDatabase> {
  const t = await createTestDatabase();
  await t.db.query(await readFile(STAGED_CHANNEL_MIGRATION, 'utf8'));
  return t;
}
