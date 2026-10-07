// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the committed OpenAPI document (`docs/developer/openapi.json`) is exactly what the server's own schemas generate,
 * describes exactly the routes the server serves (and their scopes), and every reference in it resolves. Regenerate after a contract
 * change with `UPDATE_DEVELOPER_OPENAPI=1 pnpm exec vitest run apps/reference-dapp/src/developer/openapi.test.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEVELOPER_ROUTE_TABLE } from './http.ts';
import { developerOpenApi } from './openapi.ts';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/developer/openapi.json');
const generated = JSON.stringify(developerOpenApi(), null, 2) + '\n';
if (process.env.UPDATE_DEVELOPER_OPENAPI === '1') writeFileSync(file, generated);
type Doc = { paths: Record<string, Record<string, { security?: unknown; parameters?: { name: string }[] }>>; components: { schemas: Record<string, unknown> } };

describe('BUILD-DEVELOPER-001 OpenAPI document', () => {
  it('is committed exactly as generated from the server schemas', () => {
    expect(readFileSync(file, 'utf8')).toBe(generated);
  });
  it('describes exactly the served routes', () => {
    const doc = developerOpenApi() as Doc;
    const documented = Object.entries(doc.paths).flatMap(([path, ops]) => Object.keys(ops).map(method => `${method.toUpperCase()} ${path.replace('{id}', '{id}')}`))
      .filter(route => route !== 'GET /internal/dispatch').sort();
    expect(documented).toEqual(DEVELOPER_ROUTE_TABLE.map(r => `${r.method} ${r.template}`).sort());
    expect(DEVELOPER_ROUTE_TABLE).toHaveLength(10);
    // Creating POSTs document their Idempotency-Key; nothing else does.
    for (const [path, ops] of Object.entries(doc.paths)) for (const [method, op] of Object.entries(ops))
      expect((op.parameters ?? []).some(p => p.name === 'Idempotency-Key'), `${method} ${path}`).toBe(['/strategies', '/approvals', '/webhook-endpoints'].includes(path));
  });
  it('resolves every reference and carries no secret-shaped example', () => {
    const doc = developerOpenApi() as Doc, refs: string[] = [];
    const walk = (value: unknown) => { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { if (k === '$ref') refs.push(String(v)); walk(v); } };
    walk(doc);
    expect(refs.length).toBeGreaterThan(20);
    for (const ref of refs) expect(doc.components.schemas[ref.replace('#/components/schemas/', '')], ref).toBeDefined();
    expect(generated).not.toMatch(/flofi_sk_test_[A-Za-z0-9_-]{43}|whsec_[A-Za-z0-9+/]{20}|flofi_dhs_[A-Za-z0-9_-]{43}/);
  });
});
