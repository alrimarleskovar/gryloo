// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the channel layering, checked on the sources.
 *
 *   - Channel Core (`src/channels/core`) is provider-neutral and calls the engine only through the shared platform: no MCP surface, no
 *     provider adapter, no framework; the Copilot service is reached only by the interpreter module.
 *   - The WhatsApp adapter holds provider concerns only and reaches FloFi through Channel Core and the platform, never through MCP.
 *   - The approval-side paths (the /approve contributor, the status ping and its server action) are model-free, transitively.
 *   - The browser component holds no secret and no server code; it reads the approval secret where /approve's handoff keeps it.
 *   - No channel module writes the generic handoff table: approvals go through the platform's handoff store.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url)), src = resolve(here, '..'), app = resolve(src, '..');
const rel = (file: string) => relative(app, file).replace(/\\/g, '/');
const sourcesIn = (dir: string) => readdirSync(dir).filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\.test-harness\.ts$/.test(f)).map(f => join(dir, f));
/** `[statement, specifier]` of every static import, re-export, side-effect import and dynamic import of a file. */
const importsOf = (file: string) => {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/^(?:import|export)\b[^;]*?\sfrom\s+'([^']+)';/gms), ...text.matchAll(/^import\s+'([^']+)';/gm), ...text.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)]
    .map(m => [m[0], m[1]!] as const);
};
const target = (file: string, specifier: string) => rel(resolve(dirname(file), specifier));
function resolveFile(file: string, specifier: string): string | null {
  const base = resolve(dirname(file), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate) && !candidate.endsWith('/')) {
    try { readFileSync(candidate); return candidate; } catch { /* a directory */ }
  }
  return null;
}
/** Every module reachable from `entry` through relative imports, and every package specifier on the way. */
function closure(entry: string) {
  const files = new Set<string>(), packages = new Set<string>(), queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const [, specifier] of importsOf(file)) {
      if (!specifier.startsWith('.')) { packages.add(specifier); continue; }
      const next = resolveFile(file, specifier);
      if (next && /\.(?:ts|tsx)$/.test(next)) queue.push(next);
    }
  }
  return { files: [...files].map(rel), packages: [...packages] };
}

const CORE = sourcesIn(join(here, 'core')), WHATSAPP = sourcesIn(join(here, 'whatsapp'));
const PACKAGES = /^(?:node:|@defi-workflow-engine\/)/;
const code = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('BUILD-CHANNELS-001 channel boundaries', () => {
  it('keeps Channel Core provider-neutral and on the shared platform: no MCP surface, no adapter, no framework', () => {
    expect(CORE.length).toBeGreaterThanOrEqual(14);
    const violations = CORE.flatMap(file => importsOf(file).filter(([, specifier]) => {
      if (PACKAGES.test(specifier)) return false;
      if (!specifier.startsWith('.')) return true;
      const to = target(file, specifier);
      if (/^src\/(?:platform|engine|domain|channels\/core)\//.test(to) || to === 'src/server/deployment.ts') return false;
      return !(to === 'src/server/copilot-service.ts' && rel(file) === 'src/channels/core/interpreter.ts');
    }).map(([, specifier]) => `${rel(file)} → ${specifier}`));
    expect(violations).toEqual([]);
  });

  it('keeps the WhatsApp adapter to provider concerns: FloFi only through Channel Core, the registry and the platform, never MCP', () => {
    const violations = WHATSAPP.flatMap(file => importsOf(file).filter(([statement, specifier]) => {
      if (PACKAGES.test(specifier)) return false;
      if (!specifier.startsWith('.')) return true;
      const to = target(file, specifier);
      if (/^src\/(?:platform|channels)\//.test(to) || to === 'src/server/deployment.ts') return false;
      return !(to === 'src/server/flow-runtime.ts' && rel(file) === 'src/channels/whatsapp/handler.ts' && /embeddedRuntime, flowRuntimeKind/.test(statement));
    }).map(([, specifier]) => `${rel(file)} → ${specifier}`));
    expect(violations).toEqual([]);
    for (const file of [...CORE, ...WHATSAPP]) expect(importsOf(file).some(([, s]) => s.startsWith('.') && target(file, s).startsWith('src/mcp/')), rel(file)).toBe(false);
  });

  it('keeps the approval-side paths model-free, transitively (contributor, status ping, its server action)', () => {
    const MODEL = new Set(['src/server/copilot-service.ts', 'src/channels/core/interpreter.ts', 'src/channels/core/conversation.ts', 'src/app/copilot-action.ts']);
    for (const entry of ['src/channels/approval-profile.ts', 'src/channels/approval-ping.ts', 'src/app/channel-approve-action.ts', 'src/channels/core/notify.ts']) {
      const reach = closure(join(app, entry));
      expect(reach.files.length, entry).toBeGreaterThan(3);
      expect(reach.files.filter(f => MODEL.has(f)), entry).toEqual([]);
      expect(reach.packages.filter(p => /openai|anthropic|@ai-sdk|langchain/i.test(p)), entry).toEqual([]);
    }
  });

  it('keeps the browser ping free of secrets and server code, reading the secret where /approve keeps it', () => {
    const component = readFileSync(join(src, 'components/channel-progress-ping.tsx'), 'utf8'), action = readFileSync(join(src, 'app/channel-approve-action.ts'), 'utf8');
    expect(component).toMatch(/^(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\n)*'use client';/);
    expect(action).toMatch(/^(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\n)*'use server';/);
    expect(importsOf(join(src, 'components/channel-progress-ping.tsx')).map(([, s]) => s).sort()).toEqual(['../app/channel-approve-action', 'react']);
    expect(component).not.toMatch(/process\.env|node:|FLOFI_CHANNEL_SECRET|WHATSAPP_/);
    // The ping reads the very key /approve's handoff component stores the secret under after clearing it from the address bar.
    const handoff = readFileSync(join(src, 'components/approval-handoff.tsx'), 'utf8');
    expect(handoff).toMatch(/const STORAGE_KEY = 'flofi\.approval\.secret';/);
    expect(component).toMatch(/export const APPROVAL_SECRET_STORAGE_KEY = 'flofi\.approval\.secret';/);
    // No client module anywhere names a channel or provider secret, and no channel variable is public.
    const client = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? client(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && /^(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\n)*'use client';/.test(readFileSync(join(dir, e.name), 'utf8')) ? [join(dir, e.name)] : []);
    const clients = client(src);
    expect(clients.length).toBeGreaterThan(5);
    for (const file of clients) expect(readFileSync(file, 'utf8'), rel(file)).not.toMatch(/FLOFI_CHANNEL_|WHATSAPP_|FLOFI_WHATSAPP/);
    for (const file of [...CORE, ...WHATSAPP]) expect(code(file), rel(file)).not.toMatch(/NEXT_PUBLIC_/);
  });

  it('never writes the generic handoff table directly, and migration 0008 leaves the handoff schema alone', () => {
    for (const file of [...CORE, ...WHATSAPP, ...sourcesIn(here)]) expect(code(file), rel(file)).not.toMatch(/mcp_handoffs|mcp_accounts|mcp_grants/);
    const migration = readFileSync(join(app, '..', '..', 'packages/cloud-runtime/migrations/0009_channel_conversations.sql'), 'utf8').replace(/--.*$/gm, '');
    expect(migration).not.toMatch(/\bmcp_|\bALTER\s+TABLE\b|\bDROP\s+(?:TABLE|COLUMN|INDEX|CONSTRAINT)\b/i);
    expect([...migration.matchAll(/CREATE TABLE (\w+)/g)].map(m => m[1])).toEqual(['channel_conversations', 'channel_events', 'channel_outbox']);
  });
});
