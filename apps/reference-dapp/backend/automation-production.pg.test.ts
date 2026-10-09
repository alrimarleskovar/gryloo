// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: production's own entry points, as production runs them — `node backend/main.ts api` and `node backend/main.ts
 * worker`, plain Node with no bundler — on a disposable loopback PostgreSQL, driven by the web deployment's BFF in REMOTE mode
 * (`API_BASE_URL`; the web process has no database and no automation variable). The fixture price source (MOCKED, a file under /tmp)
 * stands in for Chainlink; nothing reaches a price provider, a chat or a chain.
 *
 *   BFF → API process: create a price trigger → the worker process's own startup sweep evaluates it (armed above the threshold) →
 *   the price falls and the 15-minute cadence is compressed → a second worker sweep proposes ONCE → the owner sees it through the API
 *   and opens it on the API's shared approval model (no authority). No cron and no dispatch call anywhere.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../packages/cloud-runtime/test/pg-harness.ts';
import { ethDip, OWNER_A } from '../src/automations/automation.test-harness.ts';
import type { OverviewView, RuleView } from '../src/automations/views.ts';
import { automationAvailability, automationOperation, remoteApproval } from '../src/server/automation-operation.ts';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const TOKEN = 'production-api-token-'.padEnd(48, 'x');
const dir = mkdtempSync('/tmp/flofi-automation-production-'), PRICES = join(dir, 'prices.json');
let t: TestDatabase, api: ChildProcess | null = null, base = '';
const logs: Record<'api' | 'worker', string[]> = { api: [], worker: [] };

const freePort = () => new Promise<number>(resolve => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); }); });
const common = () => ({ PATH: process.env.PATH ?? '', NODE_ENV: 'test' as const, DATABASE_URL: t.url, TENANT_ID: 'default', FLOFI_AUTOMATIONS: 'enabled',
  FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3999', FLOFI_AUTOMATION_PRICE_SOURCE: 'fixture', FLOFI_AUTOMATION_PRICE_FIXTURE: PRICES });
function start(role: 'api' | 'worker', env: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, ['backend/main.ts', role], { cwd, env: { ...common(), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', (chunk: Buffer) => logs[role].push(...chunk.toString('utf8').split('\n').filter(Boolean)));
  return child;
}
const stop = (child: ChildProcess) => new Promise<void>(resolve => { if (child.exitCode !== null) { resolve(); return; } child.once('exit', () => resolve()); child.kill('SIGTERM'); });
async function until<T>(probe: () => Promise<T | null | undefined | false>, ms = 45_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error('TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
const web = { env: { API_BASE_URL: '', API_AUTH_TOKEN: TOKEN }, principals: async () => [OWNER_A] };
const prices = (eth: string) => writeFileSync(PRICES, JSON.stringify({ ETH: { priceUsd: eth } }));

beforeAll(async () => {
  t = await createTestDatabase();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`; web.env.API_BASE_URL = base;
  api = start('api', { PORT: String(port), HOST: '127.0.0.1', API_AUTH_TOKEN: TOKEN, FLOFI_AUTOMATION_SECRET: 'production-automation-secret-'.padEnd(64, 's'),
    GRYLOO_PUBLIC_TESTNET: 'record' });
  await until(async () => (await fetch(`${base}/readyz`)).ok);
}, 90_000);
afterAll(async () => { if (api) await stop(api); await t?.drop(); rmSync(dir, { recursive: true, force: true }); });

describe('BUILD-AUTOMATION-001 production entry points (main.ts api + main.ts worker, plain Node)', () => {
  it('BFF → Railway API → PostgreSQL, and the Railway worker’s own sweep proposes once — no cron, no dispatch', async () => {
    expect(await automationAvailability(web)).toEqual({ enabled: true, code: null });
    const rule = await automationOperation<RuleView>('create', [ethDip()], OWNER_A, web);
    if (!rule.ok) throw new Error(rule.code);
    const lastOutcome = () => t.db.query<{ last_outcome: string | null }>('SELECT last_outcome FROM automation_rules WHERE rule_id = $1', [rule.value.ruleId])
      .then(r => r.rows[0]!.last_outcome);
    const occurrences = () => t.db.query<{ trigger_key: string; state: string }>('SELECT trigger_key, state FROM automation_occurrences WHERE rule_id = $1', [rule.value.ruleId])
      .then(r => r.rows);

    // Worker #1 starts; its startup sweep discovers the due rule and evaluates it above the threshold: armed, nothing proposed.
    prices('3100');
    let worker = start('worker', { EVIDENCE_DIRECTORY: join(dir, 'evidence') });
    await until(async () => await lastOutcome() === 'ARMED');
    await stop(worker);
    expect(await occurrences()).toEqual([]);

    // The price falls; the 15-minute cadence is compressed. Worker #2's startup sweep sees the crossing: one proposal.
    prices('2900');
    await t.db.query('UPDATE automation_rules SET next_evaluation_at = now() WHERE rule_id = $1', [rule.value.ruleId]);
    worker = start('worker', { EVIDENCE_DIRECTORY: join(dir, 'evidence') });
    await until(async () => (await occurrences()).length > 0);
    await stop(worker);
    expect(await lastOutcome()).toBe('TRIGGERED');
    expect(await occurrences()).toEqual([{ trigger_key: 'price:1', state: 'PENDING_OWNER' }]);

    // The owner sees it through the API and opens it on the API's shared approval model: a link that authorizes nothing.
    const overview = await automationOperation<OverviewView>('overview', [], OWNER_A, web);
    if (!overview.ok) throw new Error(overview.code);
    expect(overview.value.pending).toHaveLength(1);
    const opened = await automationOperation<{ approvalUrl: string }>('open', [overview.value.pending[0]!.occurrenceId], OWNER_A, web);
    if (!opened.ok) throw new Error(opened.code);
    const view = await remoteApproval<{ authorized: boolean; authority: string }>('view', [decodeURIComponent(new URL(opened.value.approvalUrl).hash.slice(1))], web);
    expect(view).toMatchObject({ authorized: false, authority: 'NONE' });

    // Both processes loaded automations through the scoped rule; neither logged a load failure.
    const events = (role: 'api' | 'worker') => logs[role].map(line => { try { return (JSON.parse(line) as { event?: string }).event; } catch { return null; } });
    expect(events('api')).toContain('automation.api_enabled');
    expect(events('worker')).toContain('automation.worker_enabled');
    expect([...events('api'), ...events('worker')].filter(e => e === 'automation.api_disabled' || e === 'automation.worker_disabled')).toEqual([]);
  }, 120_000);
});
