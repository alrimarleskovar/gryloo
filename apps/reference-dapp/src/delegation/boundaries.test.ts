// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002: the authority boundary of delegated execution, checked on the sources.
 *
 *   1. Only the executor signs: the session-signer SIGNING half is reached from `executor-runtime.ts` → `executor.ts` → `drivers.ts` and nowhere
 *      else; owner operations (service, operations, API routes, BFF, server actions) never import the executor, the drivers or the executor
 *      runtime, and never call a signing method.
 *   2. The automation scheduler, evaluator and their worker entry never reach any delegation module that can sign.
 *   3. The network is reached only through `chains.ts`, whose read/owner purposes cannot broadcast a session-signed EVM transaction.
 *   4. The MOCKED chain doubles are never instantiated by product code; product code only names their fixed identities.
 *   5. No view carries a session-key reference; the signer providers here are not production custody (hosted deployments refuse them).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allowedMethods } from './chains.ts';
import { executionAvailability, readDelegationConfig } from './config.ts';

const here = dirname(fileURLToPath(import.meta.url)), src = resolve(here, '..'), app = resolve(src, '..');
const rel = (file: string) => relative(app, file).replace(/\\/g, '/');
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
const SIGNS = /\.signEvmDigest\(|\.signSolanaMessage\(|signerUser\(/;
const EXECUTOR = /^src\/delegation\/(?:executor|drivers|executor-runtime|worker|http)\.ts$/;

describe('BUILD-AUTOMATION-002 delegated-authority boundary', () => {
  it('only the executor can sign; owner operations, API routes, the BFF and server actions never reach it', () => {
    const signing = SOURCES.filter(f => SIGNS.test(code(f)));
    expect(signing.sort()).toEqual(['src/delegation/drivers.ts', 'src/delegation/executor-runtime.ts']);
    const owner = ['src/delegation/service.ts', 'src/delegation/operations.ts', 'src/delegation/api.ts', 'src/server/delegation-operation.ts', 'src/app/delegation-action.ts',
      'backend/delegation-api.ts'];
    const reached = new Set(owner.flatMap(e => closure(join(app, e))));
    expect([...reached].filter(f => EXECUTOR.test(f))).toEqual([]);
    for (const file of reached) expect(code(file), file).not.toMatch(SIGNS);
    expect([...reached].filter(f => /^src\/(?:state|components)\/|owner-submission|harness\/(?:evm|solana)-double/.test(f))).toEqual([]);
  });

  it('keeps the automation scheduler, evaluator and their worker entry free of every delegation signing path', () => {
    const entries = ['src/app/api/automations/dispatch/route.ts', 'src/automations/dispatch.ts', 'src/automations/runtime.ts', 'src/automations/evaluator.ts',
      'src/automations/worker.ts', 'backend/automation-worker.ts', 'src/automations/api.ts', 'src/automations/operations.ts'];
    const reached = new Set(entries.flatMap(e => closure(join(app, e))));
    expect([...reached].filter(f => EXECUTOR.test(f) || /^src\/delegation\/(?:adapters|service|runtime)\.ts$/.test(f))).toEqual([]);
    for (const file of reached) expect(code(file), file).not.toMatch(SIGNS);
  });

  it('reaches chains only through the guarded transports; read and owner purposes cannot broadcast a session-signed EVM transaction', () => {
    for (const file of SOURCES.filter(f => !f.endsWith('chains.ts'))) expect(code(file), file).not.toMatch(/\bfetch\(/);
    expect(allowedMethods('eip155:84532', 'read').has('eth_sendRawTransaction')).toBe(false);
    expect(allowedMethods('eip155:84532', 'owner').has('eth_sendRawTransaction')).toBe(false);
    expect(allowedMethods('eip155:84532', 'executor').has('eth_sendRawTransaction')).toBe(true);
    expect(allowedMethods('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'read').has('sendTransaction')).toBe(false);
    // Solana `owner` broadcasts transactions the OWNER signed (enrollment, revocation); session-signed ones go only through `executor`.
    expect(allowedMethods('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'owner').has('sendTransaction')).toBe(true);
    for (const purpose of ['read', 'owner', 'executor'] as const) for (const forbidden of ['eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData_v4', 'debug_traceCall'])
      expect(allowedMethods('eip155:84532', purpose).has(forbidden)).toBe(false);
    expect(code('src/delegation/service.ts')).not.toMatch(/'executor'/);
    expect(code('src/delegation/operations.ts')).not.toMatch(/'executor'/);
  });

  it('never instantiates the MOCKED chain doubles in product code, and never exposes a session-key reference in a view', () => {
    for (const file of SOURCES) expect(code(file), file).not.toMatch(/createEvmDouble|createSolanaDouble/);
    for (const file of [...SOURCES, 'src/delegation/harness/constants.ts']) expect(code(file), file).not.toMatch(/import[^;]*harness\/(?:evm|solana)-double/);
    expect(code('src/delegation/views.ts')).not.toMatch(/sessionKeyRef|privateKey|secret/i);
    expect(code('src/delegation/service.ts').match(/sessionKeyRef/g)?.length ?? 0).toBeLessThanOrEqual(4);
  });
});

describe('BUILD-AUTOMATION-002 configuration fails closed', () => {
  const base = { FLOFI_DELEGATION: 'enabled', FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3108' };
  it('is off by default and refuses anything malformed', () => {
    expect(readDelegationConfig({})).toEqual({ enabled: false, code: 'DELEGATION_NOT_ENABLED' });
    expect(readDelegationConfig({ ...base, FLOFI_DELEGATION: 'yes' })).toMatchObject({ enabled: false, code: 'DELEGATION_CONFIGURATION_INVALID' });
    expect(readDelegationConfig({ ...base, FLOFI_DELEGATED_SIGNER: 'kms' })).toMatchObject({ enabled: false, reason: 'FLOFI_DELEGATED_SIGNER' });
    expect(readDelegationConfig({ ...base, FLOFI_DELEGATED_EXECUTION: 'enabled' })).toMatchObject({ enabled: false, reason: 'FLOFI_DELEGATED_EXECUTION_WITHOUT_SIGNER' });
    expect(readDelegationConfig({ ...base, FLOFI_DELEGATED_SIGNER: 'local-disposable', FLOFI_DELEGATED_SIGNER_DIR: '/home/x' })).toMatchObject({ reason: 'FLOFI_DELEGATED_SIGNER_DIR' });
    expect(readDelegationConfig({ ...base, FLOFI_DELEGATION_RPC_84532: 'http://rpc.example' })).toMatchObject({ reason: 'FLOFI_DELEGATION_RPC_84532' });
  });
  it('a hosted deployment can configure neither the MOCKED harness nor a non-production signer: production delegated signing is unavailable', () => {
    const hosted = { ...base, VERCEL: '1', FLOFI_PUBLIC_ORIGIN: 'https://app.flofi.test' };
    expect(readDelegationConfig({ ...hosted, FLOFI_DELEGATION_HARNESS: 'MOCKED_LOOPBACK_ONLY', FLOFI_DELEGATION_HARNESS_URL: 'http://127.0.0.1:8560' }))
      .toMatchObject({ enabled: false, reason: 'FLOFI_DELEGATION_HARNESS_HOSTED' });
    expect(readDelegationConfig({ ...hosted, FLOFI_DELEGATED_SIGNER: 'memory' })).toMatchObject({ enabled: false, reason: 'FLOFI_DELEGATED_SIGNER_HOSTED' });
    const production = readDelegationConfig(hosted);
    expect(production).toMatchObject({ enabled: true, mode: 'PRODUCTION', signer: { kind: 'none' }, executor: false });
    expect(production.enabled && executionAvailability(production)).toBe('DELEGATED_SIGNER_UNAVAILABLE');
  });
  it('the MOCKED harness is loopback only and local', () => {
    expect(readDelegationConfig({ ...base, FLOFI_DELEGATION_HARNESS: 'MOCKED_LOOPBACK_ONLY', FLOFI_DELEGATION_HARNESS_URL: 'http://evil.example:8560' }))
      .toMatchObject({ reason: 'FLOFI_DELEGATION_HARNESS_URL' });
    expect(readDelegationConfig({ ...base, FLOFI_DELEGATION_HARNESS: 'MOCKED_LOOPBACK_ONLY', FLOFI_DELEGATION_HARNESS_URL: 'http://127.0.0.1:8560', FLOFI_DELEGATED_SIGNER: 'memory',
      FLOFI_DELEGATED_EXECUTION: 'enabled' })).toMatchObject({ enabled: true, mode: 'MOCKED_HARNESS', executor: true });
  });
});
