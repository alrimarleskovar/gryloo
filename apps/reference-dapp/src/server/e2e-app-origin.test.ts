// SPDX-License-Identifier: AGPL-3.0-only
/** The browser suites' app origin: one validated port drives baseURL, webServer.url and the Next.js PORT. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { E2E_DEFAULT_APP_PORT, E2E_RESERVED_PORTS, e2eAppOrigin, e2eAppPort } from '../../e2e/app-origin';

const app = join(__dirname, '..', '..'), repo = join(app, '..', '..');
const read = (path: string) => readFileSync(path, 'utf8');

describe('FLOFI_E2E_APP_PORT', () => {
  it('keeps 3000 when unset and accepts an isolated unprivileged port', () => {
    expect(e2eAppPort(undefined)).toBe(E2E_DEFAULT_APP_PORT);
    expect(E2E_DEFAULT_APP_PORT).toBe(3000);
    expect(e2eAppPort('3100')).toBe(3100);
    expect(e2eAppPort('1024')).toBe(1024);
    expect(e2eAppPort('65535')).toBe(65535);
    expect(e2eAppOrigin(3100)).toBe('http://127.0.0.1:3100');
  });
  it('rejects anything that is not a plain unprivileged port, and the suites\' own harness ports', () => {
    for (const value of ['', ' ', '3100 ', ' 3100', '+3100', '-3100', '03100', '3100.0', '3e3', '0x0c1c', 'abc', '0', '80', '1023', '65536', '99999', '123456',
      'http://127.0.0.1:3100', '3100\n', ...E2E_RESERVED_PORTS.map(String)])
      expect(() => e2eAppPort(value), JSON.stringify(value)).toThrow('FLOFI_E2E_APP_PORT_INVALID');
  });
  it('drives Playwright baseURL, webServer.url and the Next.js PORT from one origin, with no reused server', () => {
    const config = read(join(app, 'playwright.config.ts'));
    expect(config).toContain("import { E2E_APP_ORIGIN, E2E_APP_PORT } from './e2e/app-origin';");
    expect(config).toContain('baseURL: E2E_APP_ORIGIN,');
    expect(config).toContain('url: E2E_APP_ORIGIN,');
    expect(config).toContain('PORT: String(E2E_APP_PORT),');
    expect(config).not.toMatch(/:3000\b/);
    expect(config).not.toMatch(/reuseExistingServer:\s*true/);
  });
  it('leaves no browser fixture or spec bound to a literal app origin', () => {
    const files = readdirSync(join(app, 'e2e')).filter(name => /\.(ts|mts|mjs)$/.test(name) && name !== 'app-origin.ts');
    for (const name of files) expect(read(join(app, 'e2e', name)), name).not.toMatch(/(127\.0\.0\.1|localhost):3000\b/);
  });
  it('runs browser CI on a valid isolated port', () => {
    const workflow = read(join(repo, '.github', 'workflows', 'contracts.yml'));
    const ports = [...workflow.matchAll(/FLOFI_E2E_APP_PORT:\s*'([^']*)'/g)].map(match => match[1]!);
    expect(ports).toHaveLength(1);
    expect(e2eAppPort(ports[0])).not.toBe(E2E_DEFAULT_APP_PORT);
  });
});
