// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one loopback origin the browser suites serve and visit the reference app on. Playwright's `baseURL`, its
 * `webServer.url`, the Next.js `PORT` and every fixture's same-origin check derive from it.
 *
 * `FLOFI_E2E_APP_PORT` lets CI use an isolated port when another server already holds 3000 on a shared runner; unset
 * keeps 3000. The value is strict: decimal digits without sign, spaces or leading zeros, an unprivileged port
 * (1024–65535), and never one of the suites' own loopback harness or fork ports.
 */
export const E2E_DEFAULT_APP_PORT = 3000;
/** Loopback ports the browser suites already bind (MOCKED harnesses, synthetic and replayed forks). */
export const E2E_RESERVED_PORTS: readonly number[] = Object.freeze([8545, 8546, 8547, 8549, 8551, 8552, 8553, 8554, 8556, 8557]);

export function e2eAppPort(value: string | undefined): number {
  if (value === undefined) return E2E_DEFAULT_APP_PORT;
  if (!/^[1-9][0-9]{3,4}$/.test(value)) throw new Error('FLOFI_E2E_APP_PORT_INVALID');
  const port = Number(value);
  if (port < 1024 || port > 65535 || E2E_RESERVED_PORTS.includes(port)) throw new Error('FLOFI_E2E_APP_PORT_INVALID');
  return port;
}
export const e2eAppOrigin = (port: number) => `http://127.0.0.1:${port}`;

export const E2E_APP_PORT = e2eAppPort(process.env.FLOFI_E2E_APP_PORT);
export const E2E_APP_ORIGIN = e2eAppOrigin(E2E_APP_PORT);
