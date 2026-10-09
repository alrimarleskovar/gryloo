// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-001: the authority boundary, checked on the sources (as BUILD-CHANNELS-001 checks its own).
 *
 *   1. Nothing reachable from the scheduler (dispatch route, work handlers, evaluator, notifier) can sign, hold or derive a key,
 *      submit a transaction, run an execution flow, or claim/apply/share an approval (those are the owner's, on /approve).
 *   2. The scheduler reaches no execution service: from `src/server` it uses only deployment facts, the runtime host and the saved
 *      workflow store (read). The price transport is the only network access, and it is read-only by construction.
 *   3. The automation approval contributor and the owner's server actions never execute anything either.
 *   4. No automation module writes the generic handoff table: approvals go through the platform's handoff store.
 *   5. Nothing exposes an execution mode other than CONFIRM_EACH_TIME, and no automation variable is public.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url)), src = resolve(here, '..'), app = resolve(src, '..');
const rel = (file: string) => relative(app, file).replace(/\\/g, '/');
/** Runtime imports only: `import type` / `export type` carry no code. */
const importsOf = (file: string) => {
  const text = readFileSync(file, 'utf8');
  return [...[...text.matchAll(/^(?:import|export)\b[^;]*?\sfrom\s+'([^']+)';/gms)].filter(m => !/^(?:import|export)\s+type\b/.test(m[0])),
    ...text.matchAll(/^import\s+'([^']+)';/gm), ...text.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)].map(m => m[1]!);
};
function resolveFile(file: string, specifier: string): string | null {
  const base = resolve(dirname(file), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (existsSync(candidate)) { try { readFileSync(candidate); return candidate; } catch { /* dir */ } }
  return null;
}
function closure(entry: string) {
  const files = new Set<string>(), queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of importsOf(file)) {
      if (!specifier.startsWith('.')) continue;
      const next = resolveFile(file, specifier);
      if (next && /\.(?:ts|tsx)$/.test(next)) queue.push(next);
    }
  }
  return [...files].map(rel);
}
const code = (file: string) => readFileSync(join(app, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SOURCES = readdirSync(here).filter(f => /\.ts$/.test(f) && !/\.test\.ts$|\.test-harness\.ts$/.test(f)).map(f => rel(join(here, f)));
const SIGNING = /eth_sendTransaction|eth_signTypedData|personal_sign|sendRawTransaction|signTransaction|signMessage|privateKeyToAccount|mnemonicToAccount|fromSecretKey|Keypair\b|createWalletClient|\bprivateKey\b/;
/** Key custody and local signing primitives: nothing reachable from the scheduler may contain them. */
const KEY_HOLDING = /privateKeyToAccount|mnemonicToAccount|fromSecretKey|Keypair\.(?:generate|fromSecret)|createWalletClient|signTransaction\(|signTypedData\(|hdkey/;
const OWNER_DECISIONS = /\b(?:claimApproval|applyApproval|shareApproval)\(|runtime\.(?:run|journal)\(|callFlow\(|previewFlow\(/;

describe('BUILD-AUTOMATION-001 authority boundary', () => {
  it('gives the scheduler no way to sign, hold a key, submit, execute or approve', () => {
    const entries = ['src/app/api/automations/dispatch/route.ts', 'src/automations/dispatch.ts', 'src/automations/runtime.ts', 'src/automations/evaluator.ts', 'src/automations/notify.ts'];
    const reached = new Set(entries.flatMap(e => closure(join(app, e))));
    const own = [...reached].filter(f => f.startsWith('src/automations/') || f.startsWith('src/app/api/automations/'));
    expect(own.length).toBeGreaterThan(12);
    for (const file of own) {
      expect(code(file), file).not.toMatch(SIGNING);
      expect(code(file), file).not.toMatch(OWNER_DECISIONS);
    }
    // The scheduler also reaches the shared engine and platform (gates read flow modes), as MCP, the Developer API and Channels do; none
    // of what it reaches can hold or use a key, and no browser state, component or server action is reachable at all.
    for (const file of reached) expect(code(file), file).not.toMatch(KEY_HOLDING);
    expect([...reached].filter(f => /^src\/(?:state|components)\/|-action\.ts$|owner-submission/.test(f))).toEqual([]);
    // Scheduler code itself reaches into `src/server` only for deployment facts and the runtime host (saved workflows are read by its own query).
    const servers = own.flatMap(file => importsOf(join(app, file)).filter(s => s.startsWith('.')).map(s => rel(resolve(dirname(join(app, file)), s)).replace(/\.ts$/, '') + '.ts'))
      .filter(f => f.startsWith('src/server/'));
    expect([...new Set(servers)].sort()).toEqual(['src/server/deployment.ts', 'src/server/flow-runtime.ts']);
  });

  it('gives the Railway worker’s automation entry the same zero authority, and no approval key or engine runtime', () => {
    const entries = ['backend/automation-worker.ts', 'src/automations/worker.ts'];
    const reached = new Set(entries.flatMap(e => closure(join(app, e))));
    const own = [...reached].filter(f => f.startsWith('src/automations/') || f === 'backend/automation-worker.ts' || f === 'backend/source-resolution.ts');
    expect(own).toEqual(expect.arrayContaining(['backend/automation-worker.ts', 'backend/source-resolution.ts', 'src/automations/worker.ts', 'src/automations/evaluator.ts']));
    for (const file of own) {
      expect(code(file), file).not.toMatch(SIGNING);
      expect(code(file), file).not.toMatch(OWNER_DECISIONS);
    }
    for (const file of reached) expect(code(file), file).not.toMatch(KEY_HOLDING);
    // (The worker process already runs the backend's observe-only flow services; this entry adds no browser code and no server action.)
    expect([...reached].filter(f => /^src\/(?:state|components)\/|-action\.ts$|owner-submission|^backend\/main\.ts$/.test(f))).toEqual([]);
    // It builds the work runtime only: no automation keys (no approval or link-code minting), no engine runtime, no owner service.
    for (const file of entries) expect(code(file), file).not.toMatch(/automationRuntime\(|deploymentEngineRuntime|automationKeys|createAutomationService|requestApproval|FLOFI_AUTOMATION_SECRET/);
    expect(code('src/automations/worker.ts')).toMatch(/readAutomationWorkerConfig\(env\)/);
  });

  it('gives the Railway API’s automation routes and the BFF boundary no way to sign, hold a key, submit or run a flow', () => {
    const entries = ['backend/automation-api.ts', 'src/automations/api.ts', 'src/automations/operations.ts', 'src/server/automation-operation.ts'];
    const reached = new Set(entries.flatMap(e => closure(join(app, e))));
    for (const file of reached) expect(code(file), file).not.toMatch(KEY_HOLDING);
    expect([...reached].filter(f => /^src\/(?:state|components)\/|-action\.ts$|owner-submission|^backend\/main\.ts$/.test(f))).toEqual([]);
    for (const file of entries) {
      expect(code(file), file).not.toMatch(SIGNING);
      // CRUD/state and the shared approval model only: no flow call, preview, run or journal is made by these modules.
      expect(code(file), file).not.toMatch(/\bcallFlow\(|previewFlow\(|runtime\.(?:run|journal|record|preview)\(|\.call\(|callCloudFlow|cloudFlow\(/);
    }
    // The API adds exactly two POST routes (owner operations, automation approval links); the closed operation list has no execution verb.
    expect(code('src/automations/api.ts').match(/pattern: \/\^.*?\$\//g)).toEqual(['pattern: /^\\/v1\\/automations\\/([A-Za-z]{1,40})$/', 'pattern: /^\\/v1\\/approvals\\/(view|claim|apply|share|resume)$/']);
    expect(code('src/automations/operations.ts')).toMatch(/AUTOMATION_OPERATIONS = Object\.freeze\(\['overview', 'create', 'setState', 'rebind', 'history', 'open', 'dismiss', 'prepareWatch', 'telegramLinkCode',\s+'telegramUnlink'\]/);
  });

  it('reaches the network only through the read-only price transport, which refuses every non-read method', () => {
    for (const file of SOURCES.filter(f => !f.endsWith('price-source.ts'))) expect(code(file), file).not.toMatch(/\bfetch\(|node:https?|undici/);
    const transport = code('src/automations/price-source.ts');
    expect(transport).toMatch(/PRICE_RPC_METHODS: ReadonlySet<string> = new Set\(\['eth_chainId', 'eth_call'\]\)/);
    expect(transport).toMatch(/if \(!PRICE_RPC_METHODS\.has\(method\)\) throw new Error\('AUTOMATION_RPC_METHOD_FORBIDDEN'\)/);
  });

  it('keeps the owner actions and the /approve contributor free of execution and signing', () => {
    for (const entry of ['src/app/automation-action.ts', 'src/automations/approval.ts', 'src/automations/service.ts']) {
      if (!existsSync(join(app, entry))) continue;
      for (const file of closure(join(app, entry)).filter(f => f.startsWith('src/automations/') || f === entry)) {
        expect(code(file), file).not.toMatch(SIGNING);
        expect(code(file), file).not.toMatch(/\b(?:claimApproval|applyApproval|shareApproval)\(|callFlow\(/);
      }
    }
  });

  it('never writes the generic handoff table and never offers another execution mode', () => {
    for (const file of SOURCES) {
      expect(code(file), file).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM) mcp_handoffs\b/);
      expect(code(file), file).not.toMatch(/AUTOMATIC_EXECUTION|DELEGATED|SESSION_KEY|executionMode:\s*'(?!CONFIRM_EACH_TIME)/);
      expect(code(file), file).not.toMatch(/NEXT_PUBLIC_/);
    }
    const migration = readFileSync(join(app, '..', '..', 'packages/cloud-runtime/migrations/0010_automations.sql'), 'utf8');
    expect(migration).toMatch(/execution_mode text NOT NULL DEFAULT 'CONFIRM_EACH_TIME' CHECK \(execution_mode = 'CONFIRM_EACH_TIME'\)/);
    expect(migration.replace(/--.*$/gm, '')).not.toMatch(/\b(?:private_key|signature|seed|mnemonic|calldata)\b/i);
  });
});
