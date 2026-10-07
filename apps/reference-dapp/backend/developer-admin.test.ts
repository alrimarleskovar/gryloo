// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the developer operator CLI runs on plain Node (no bundler) and refuses to run unconfigured: no command, no
 * tenant, no database URL or no developer secret is a fixed error code on stderr and exit code 1 — never a stack or a secret.
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const cli = (args: string[], env: Record<string, string> = {}) => promisify(execFile)(process.execPath, ['backend/developer-admin.ts', ...args],
  { cwd, timeout: 60_000, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env } })
  .then(r => ({ code: 0, stdout: r.stdout, stderr: r.stderr }), (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));

describe('BUILD-DEVELOPER-001 developer operator CLI', () => {
  it('loads under plain Node and refuses to run unconfigured', async () => {
    expect(await cli([])).toMatchObject({ code: 1, stdout: '', stderr: expect.stringMatching(/^COMMAND_INVALID: /) });
    expect(await cli(['create-key', '--project', 'prj_x'])).toMatchObject({ code: 1, stderr: expect.stringMatching(/^TENANT_REQUIRED: /) });
    expect(await cli(['create-key', '--tenant', 'default', '--preview-branch', 'b'])).toMatchObject({ code: 1, stderr: expect.stringMatching(/^TENANT_REQUIRED: /) });
    expect(await cli(['create-key', '--tenant', 'Bad Tenant'])).toMatchObject({ code: 1, stderr: 'TENANT_ID_INVALID\n' });
    expect(await cli(['create-key', '--tenant', 'default', '--environment', 'production'])).toMatchObject({ code: 1, stderr: 'ARGUMENTS_INVALID\n' });
    expect(await cli(['list-keys', '--tenant', 'default', '--project', 'prj_x'])).toMatchObject({ code: 1, stderr: 'DATABASE_URL_REQUIRED\n' });
    expect(await cli(['list-keys', '--tenant', 'default', '--project', 'prj_x'], { DATABASE_URL: 'postgres://127.0.0.1:1/none', FLOFI_DEVELOPER_SECRET: 'short' }))
      .toMatchObject({ code: 1, stderr: 'FLOFI_DEVELOPER_SECRET_INVALID\n' });
  });
});
