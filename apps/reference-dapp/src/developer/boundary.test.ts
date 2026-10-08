// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the Developer API's layering. It is a surface over the shared platform (`src/platform`), never over another
 * surface: no MCP code, no React or Next.js in its logic, no model client. It never reaches a flow method that could prepare,
 * authorize, hand off, report or submit — only discovery, previews and owner-scoped reads through the platform's runtime port.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url)), app = resolve(here, '..', '..');
const sources = readdirSync(here).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.test-harness.ts')).map(f => join(here, f));
const route = join(app, 'src/app/api/developer/v1/[...path]/route.ts');
const importsOf = (file: string) => {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/^(?:import|export)\b[^;]*?\sfrom\s+'([^']+)';/gms), ...text.matchAll(/^import\s+'([^']+)';/gm), ...text.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)]
    .map(m => m[1]!);
};
// Durable state is server composition. The surface no longer imports the executable flow runtime directly.
const ALLOWED_APP = [/^src\/developer\//, /^src\/platform\//, /^src\/engine\//, /^src\/server\/deployment\.ts$/, /^src\/server\/platform-state-host\.ts$/];
const PACKAGES = /^(node:|@defi-workflow-engine\/(cloud-runtime|workflow-contracts)|@sinclair\/typebox$)/;

describe('BUILD-DEVELOPER-001 developer surface boundary', () => {
  it('imports only the platform, the engine, the deployment runtime and packages — never MCP, a UI framework or a model client', () => {
    expect(sources.length).toBeGreaterThanOrEqual(12);
    const violations = sources.flatMap(file => importsOf(file).filter(specifier => {
      if (PACKAGES.test(specifier)) return false;
      if (!specifier.startsWith('.')) return true;
      const target = relative(app, resolve(dirname(file), specifier)).replace(/\\/g, '/');
      return !ALLOWED_APP.some(rule => rule.test(target.endsWith('.ts') ? target : `${target}.ts`));
    }).map(specifier => `${relative(app, file)} → ${specifier}`));
    expect(violations).toEqual([]);
    // The route is a pass-through: Next.js `after()` and the handler, nothing else.
    expect(importsOf(route).sort()).toEqual(['../../../../../developer/http', '@defi-workflow-engine/cloud-runtime', 'next/server']);
  });

  it('never reaches a mutating flow method: no flow calls, only the read-only runtime port through the platform', () => {
    const text = sources.map(file => readFileSync(file, 'utf8')).join('\n');
    for (const forbidden of [/callFlow\(/, /cloudFlow\(/, /\.backend\b/, /runtime\.(preview|run|journal|evidence|runs|record)\(/, /['"](begin|authorize|report|prepare|submit|sign)['"]/,
      /from ['"](openai|@anthropic-ai\/[a-z-]+|@ai-sdk\/[a-z-]+)['"]|api\.openai\.com|api\.anthropic\.com|OPENAI_API_KEY|ANTHROPIC_API_KEY/i])
      expect(text, String(forbidden)).not.toMatch(forbidden);
  });

  it('keeps every credential out of storage, logs and responses by construction', () => {
    const text = sources.map(file => readFileSync(file, 'utf8')).join('\n');
    // Keys are only ever digested; webhook secrets are derived, never written to a table.
    expect(text).not.toMatch(/INSERT INTO developer_api_keys[^`]*\bkey\b[^_]/);
    expect(text).not.toMatch(/INSERT INTO developer_webhook_endpoints[^`]*secret/);
    // Log fields are ids, the route template, status, code and duration.
    const logged = [...text.matchAll(/logger\?\.(?:info|warn)\(([^)]*)\)/g)].map(m => m[1]!).join('\n');
    expect(logged).not.toMatch(/authorization|approvalUrl|url:|secret|body|query|address/i);
  });
});
