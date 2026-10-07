// SPDX-License-Identifier: AGPL-3.0-only
// Keep certification isolated from an owner's running development server.
const port = process.env.FLOFI_E2E_PORT ?? '3108';
if (!/^[1-9][0-9]{3,4}$/.test(port) || Number(port) > 65535) {
  throw new Error('FLOFI_E2E_PORT must be a loopback port between 1000 and 65535');
}
export const APP_PORT = port;
export const APP_ORIGIN = `http://127.0.0.1:${port}`;
