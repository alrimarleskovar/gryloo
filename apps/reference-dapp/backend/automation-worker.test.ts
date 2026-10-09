// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the Railway worker evaluates automations — and the Railway API serves the Automations workspace — by loading the
 * SAME shared modules the web deployment runs, on plain Node, through one scoped resolution rule (`source-resolution.ts`). This proves the rule's scope, that the worker's automation module
 * loads only with it, that plain Node computes the same workflow hash as the bundled code (no second engine), and that the worker's
 * entry points stay unchanged when automations are not enabled.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { bindStrategy } from '../src/automations/binding.ts';
import { SOURCE_ROOT, sourceFallback } from './source-resolution.ts';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const run = (code: string, env: Record<string, string> = {}) => promisify(execFile)(process.execPath, ['--input-type=module', '-e', code],
  { cwd, timeout: 60_000, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env } })
  .then(({ stdout }) => ({ code: 0, stdout }), (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout + error.stderr }));
const STRATEGY = { action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '50' };

describe('BUILD-AUTOMATION-001 worker-side source resolution', () => {
  const inSource = (path: string) => pathToFileURL(join(SOURCE_ROOT, path)).href;
  it('applies the bundler rule only to extensionless relative imports between files under src/', () => {
    expect(sourceFallback('../domain/commands', inSource('automations/binding.ts'))).toBe(inSource('domain/commands.ts'));
    expect(sourceFallback('./schedule', inSource('automations/evaluator.ts'))).toBe(inSource('automations/schedule.ts'));
    // Outside its scope nothing changes: packages, explicit extensions, absolute or escaping paths, missing files, parents outside src/.
    for (const [specifier, parent] of [
      ['zod', inSource('automations/binding.ts')],
      ['node:fs', inSource('automations/binding.ts')],
      ['../domain/commands.ts', inSource('automations/binding.ts')],
      ['../domain/commands.js', inSource('automations/binding.ts')],
      ['/etc/passwd', inSource('automations/binding.ts')],
      ['../../backend/main', inSource('automations/binding.ts')],
      ['../../../../package', inSource('automations/binding.ts')],
      ['./does-not-exist', inSource('automations/binding.ts')],
      ['../components/automations-workspace', inSource('automations/binding.ts')],
      ['../src/domain/commands', pathToFileURL(join(cwd, 'backend', 'main.ts')).href],
      ['./commands', 'node:internal'],
      ['./commands', undefined],
    ] as const) expect([specifier, sourceFallback(specifier, parent)]).toEqual([specifier, null]);
  });

  it('plain Node cannot load the automation module without the rule', async () => {
    const result = await run("await import('./src/automations/worker.ts');");
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('with the rule, plain Node loads the worker module and computes the same workflow hash as the bundled code', async () => {
    const expected = bindStrategy(STRATEGY);
    if (!expected.ok) throw new Error('fixture strategy refused');
    const result = await run(`
      const { installSourceResolution } = await import('./backend/source-resolution.ts');
      installSourceResolution();
      const worker = await import('./src/automations/worker.ts');
      const { bindStrategy, verifyBinding } = await import('./src/automations/binding.ts');
      const b = bindStrategy(${JSON.stringify(STRATEGY)});
      console.log(JSON.stringify({ exports: Object.keys(worker), hash: b.ok && b.binding.workflowHash, verified: b.ok && verifyBinding(b.binding).ok,
        disabled: worker.automationWorkerParts({}, {}, 'default', {}) }));`);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ exports: ['automationWorkerParts'], hash: expected.binding.workflowHash, verified: true,
      disabled: { disabled: 'AUTOMATIONS_NOT_ENABLED', reason: null } });
  });

  it('the Railway API loads its automation routes on plain Node through the same rule: two POST routes, no flow route', async () => {
    const result = await run(`
      const { loadAutomationApi } = await import('./backend/automation-api.ts');
      const routes = await loadAutomationApi({ FLOFI_AUTOMATIONS: 'enabled' }, { db: {}, tenantId: 'default', backend: {}, logger: { info() {}, warn() {}, error() {} } });
      console.log(JSON.stringify(routes.map(r => [r.method, r.name, r.pattern.source])));`);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual([['POST', 'automations', '^\\/v1\\/automations\\/([A-Za-z]{1,40})$'],
      ['POST', 'approvals', '^\\/v1\\/approvals\\/(view|claim|apply|share)$']]);
  });

  it('a misconfigured or foreign-tenant worker disables automations only, with a closed code and no secret required', async () => {
    const result = await run(`
      const { loadAutomationWorker } = await import('./backend/automation-worker.ts');
      const base = { FLOFI_AUTOMATIONS: 'enabled', FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3000', FLOFI_AUTOMATION_PRICE_SOURCE: 'off' };
      const out = [];
      const railwayFixture = { ...base, RAILWAY_PROJECT_ID: 'p', FLOFI_PUBLIC_ORIGIN: 'https://flofi.example', FLOFI_AUTOMATION_PRICE_SOURCE: 'fixture',
        FLOFI_AUTOMATION_PRICE_FIXTURE: '/tmp/prices.json' };
      for (const env of [{ FLOFI_AUTOMATIONS: 'enabled' }, { ...base, FLOFI_AUTOMATION_PRICE_SOURCE: 'chainlink' }, railwayFixture, base]) {
        const parts = await loadAutomationWorker(env, {}, 'another-tenant', {});
        out.push('disabled' in parts ? parts.disabled : 'enabled');
        if ('disabled' in parts && env === railwayFixture && parts.reason !== 'FLOFI_AUTOMATION_PRICE_FIXTURE') out.push('WRONG_REASON:' + parts.reason);
      }
      console.log(JSON.stringify(out));`);
    expect(result.code).toBe(0);
    // (A hosted worker — Railway — never accepts the fixture price source.)
    expect(JSON.parse(result.stdout.trim())).toEqual(['AUTOMATION_CONFIGURATION_INVALID', 'AUTOMATION_CONFIGURATION_INVALID', 'AUTOMATION_CONFIGURATION_INVALID',
      'AUTOMATION_TENANT_MISMATCH']);
  });
});
