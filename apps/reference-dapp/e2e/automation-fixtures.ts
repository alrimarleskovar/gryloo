// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001 browser suite: the fixture price file, the bearer-only scheduler call (with the deterministic test clock) and
 * reads of this spec's own rows. Nothing here contacts a price provider, a chat or a chain; the token is generated per run by
 * playwright.config.ts and never committed.
 */
import { writeFile } from 'node:fs/promises';
import { createDatabase } from '@defi-workflow-engine/cloud-runtime';
import { E2E_APP_ORIGIN } from './app-origin';

export function assertAutomationHarness(): void {
  if (process.env.GRYLOO_AUTOMATION_E2E !== 'FIXTURE_LOOPBACK_ONLY' || !process.env.FLOFI_E2E_AUTOMATION_PRICES?.startsWith('/tmp/flofi-automation-e2e-'))
    throw new Error('AUTOMATION_HARNESS_REQUIRED');
}
/** The fixture source's prices (observed at the scheduler's own clock). */
export const setPrices = (prices: Readonly<Record<string, string>>) => writeFile(process.env.FLOFI_E2E_AUTOMATION_PRICES!,
  JSON.stringify(Object.fromEntries(Object.entries(prices).map(([asset, priceUsd]) => [asset, { priceUsd }]))));
/** One scheduler pass at `at` (the test clock), as Vercel Cron would trigger it. */
export async function dispatch(at?: Date, token = process.env.FLOFI_E2E_AUTOMATION_DISPATCH_TOKEN!): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${E2E_APP_ORIGIN}/api/automations/dispatch`, { method: 'POST', headers: { authorization: `Bearer ${token}`,
    ...at ? { 'x-flofi-automation-now': at.toISOString() } : {} } });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = createDatabase({ connectionString: process.env.FLOFI_E2E_DATABASE_URL!, maxConnections: 1 });
  try { return (await db.query(sql, params)).rows as T[]; } finally { await db.close(); }
}
/** This owner's rule by name (rules and owners are fresh per test). */
export const ruleOf = async (owner: string, name: string) => (await query<{ rule_id: string; next_evaluation_at: Date; state: string }>(
  'SELECT rule_id, next_evaluation_at, state FROM automation_rules WHERE owner_account = $1 AND display_name = $2', [owner.toLowerCase(), name]))[0]!;
export const occurrencesOf = (ruleId: string) => query<{ occurrence_id: string; state: string; trigger_key: string; handoff_id: string | null }>(
  'SELECT occurrence_id, state, trigger_key, handoff_id FROM automation_occurrences WHERE rule_id = $1 ORDER BY created_at', [ruleId]);
