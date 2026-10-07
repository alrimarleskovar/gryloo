// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the shared platform's layering. `src/platform` is the engine service every surface calls, so it must never
 * depend on a surface: no MCP transport or OAuth code, no Next.js, React, MCP SDK or model client. The modules that still live under
 * `src/mcp/` but are not MCP-specific (gates, preview projection, runtime port, handoff store, credential crypto) are the only
 * exceptions until they move. The MCP surface delegates instead of re-implementing: its old engine code must not come back.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url)), src = resolve(here, '..'), app = resolve(src, '..');
const sources = readdirSync(here).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).map(f => join(here, f));
/** `[statement, specifier]` of every static import, re-export, side-effect import and dynamic import of a file. */
const importsOf = (file: string) => {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/^(?:import|export)\b[^;]*?\sfrom\s+'([^']+)';/gms), ...text.matchAll(/^import\s+'([^']+)';/gm), ...text.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)]
    .map(m => [m[0], m[1]!] as const);
};
const SHARED_UNDER_MCP = new Set(['src/mcp/execution.ts', 'src/mcp/simulation.ts', 'src/mcp/runtime.ts', 'src/mcp/oauth/crypto.ts']);
const TYPE_ONLY = new Set(['backend/flows.ts', 'src/server/flow-runtime.ts']);
const PACKAGES = /^(node:|@defi-workflow-engine\/)/;

function allowed(file: string, statement: string, specifier: string): boolean {
  if (PACKAGES.test(specifier)) return true;
  if (!specifier.startsWith('.')) return false;
  const target = relative(app, resolve(dirname(file), specifier)).replace(/\\/g, '/'), withTs = target.endsWith('.ts') ? target : `${target}.ts`;
  if (withTs.startsWith('src/platform/') || withTs.startsWith('src/engine/') || withTs.startsWith('src/domain/')) return true;
  if (SHARED_UNDER_MCP.has(withTs)) return true;
  return TYPE_ONLY.has(withTs) && /^(import|export) type\b/.test(statement);
}

describe('BUILD-DEVELOPER-001 shared platform boundary', () => {
  it('imports only the engine, the shared modules and packages — never a surface, a framework or a model client', () => {
    expect(sources.length).toBeGreaterThanOrEqual(7);
    const violations = sources.flatMap(file => importsOf(file).filter(([statement, specifier]) => !allowed(file, statement, specifier))
      .map(([, specifier]) => `${relative(app, file)} → ${specifier}`));
    expect(violations).toEqual([]);
  });

  it('keeps the historical handoff service and store as pure re-exports of the platform (compatibility surfaces for MCP, the UI and tests)', () => {
    const shim = (path: string) => readFileSync(join(src, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\/\/.*$/gm, '').trim();
    expect(shim('mcp/handoff/service.ts')).toBe(`export * from '../../platform/approvals.ts';`);
    expect(shim('mcp/handoff/store.ts')).toBe(`export * from '../../platform/handoff-store.ts';`);
  });

  it('leaves no engine implementation in the MCP tool surface: it delegates to the platform', () => {
    const tools = readFileSync(join(src, 'mcp/tools.ts'), 'utf8');
    for (const duplicate of [/activeSimulations/, /composeWorkflowBound\(/, /reviewComposition\(/, /codeCapabilities\(/, /evaluateGates\(/, /validateArtifact\(/,
      /projectSimulation\(/, /runtime\.preview\(/, /runtime\.journal\(/, /runtime\.evidence\(/, /newCredential\(/, /handoffs\.openSession\(/, /handoffs\.forAccount\(/])
      expect(tools, String(duplicate)).not.toMatch(duplicate);
    expect(tools).toMatch(/from '\.\.\/platform\/index\.ts'/);
  });
});
