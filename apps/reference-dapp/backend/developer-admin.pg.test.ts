// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: the developer operator CLI against a disposable loopback PostgreSQL, as the operator runs it (plain Node). A
 * project and a SANDBOX key are created; with --key-file the key goes only into a new mode-0600 file (never stdout); the key
 * authenticates under the same developer secret only; listing never shows a key; revocation and disabling take effect at once.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../../packages/cloud-runtime/test/pg-harness.ts';
import { developerKey } from '../src/developer/config.ts';
import { apiKeyDigest } from '../src/developer/keys.ts';
import { createPgDeveloperStore } from '../src/developer/pg-store.ts';

let t: TestDatabase, dir: string;
beforeAll(async () => { t = await createTestDatabase(); dir = await mkdtemp(join(tmpdir(), 'flofi-developer-admin-')); });
afterAll(async () => { await t?.drop(); if (dir) await rm(dir, { recursive: true, force: true }); });
const SECRET = 's'.repeat(40);
const cwd = fileURLToPath(new URL('..', import.meta.url));
async function cli(args: string[]) {
  const result = await promisify(execFile)(process.execPath, ['backend/developer-admin.ts', ...args], { cwd, timeout: 60_000,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', DATABASE_URL: t.url, FLOFI_DEVELOPER_SECRET: SECRET } })
    .then(r => ({ code: 0, stdout: r.stdout, stderr: r.stderr }), (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
  return { ...result, json: result.code === 0 ? JSON.parse(result.stdout) as Record<string, unknown> : null };
}

describe('BUILD-DEVELOPER-001 developer operator CLI on PostgreSQL', () => {
  it('creates a project and a sandbox key shown once; lists, revokes and disables', async () => {
    const created = await cli(['create-project', '--tenant', 'default', '--name', 'Acme Wallet']);
    expect(created.json).toEqual({ tenantId: 'default', projectId: expect.stringMatching(/^prj_[a-z2-7]{26}$/) });
    const projectId = String(created.json!.projectId), keyFile = join(dir, 'key');

    const issued = await cli(['create-key', '--tenant', 'default', '--project', projectId, '--key-file', keyFile]);
    expect(issued.json).toEqual({ tenantId: 'default', keyId: expect.stringMatching(/^key_[a-z2-7]{26}$/), hint: expect.stringMatching(/^[A-Za-z0-9_-]{4}$/),
      environment: 'sandbox', scopes: ['strategies', 'approvals', 'executions', 'webhooks'], keyFile });
    const key = (await readFile(keyFile, 'utf8')).trim();
    expect(key).toMatch(/^flofi_sk_test_[A-Za-z0-9_-]{43}$/);
    expect(key.endsWith(String(issued.json!.hint))).toBe(true);
    expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
    expect(issued.stdout + issued.stderr).not.toContain(key.slice(14));
    // Never overwrites an existing key file.
    expect(await cli(['create-key', '--tenant', 'default', '--project', projectId, '--key-file', keyFile])).toMatchObject({ code: 1, stderr: 'KEY_FILE_EXISTS\n' });
    expect(await cli(['create-key', '--tenant', 'default', '--project', 'prj_' + 'a'.repeat(26), '--key-file', join(dir, 'unused')])).toMatchObject({ code: 1,
      stderr: 'PROJECT_NOT_ACTIVE\n' });
    await expect(stat(join(dir, 'unused'))).rejects.toThrow('ENOENT');

    const store = createPgDeveloperStore(t.db, 'default'), digest = apiKeyDigest({ keys: { apiKey: developerKey(SECRET, 'api-key') } }, key);
    expect(await store.authenticate(digest, new Date())).toMatchObject({ projectId, projectName: 'Acme Wallet', environment: 'sandbox', keyId: issued.json!.keyId });
    expect(await store.authenticate(apiKeyDigest({ keys: { apiKey: developerKey('o'.repeat(40), 'api-key') } }, key), new Date())).toBeNull();

    const narrow = await cli(['create-key', '--tenant', 'default', '--project', projectId, '--scopes', 'strategies,approvals']);
    expect(narrow.json).toMatchObject({ scopes: ['strategies', 'approvals'], key: expect.stringMatching(/^flofi_sk_test_/) });
    expect(narrow.stderr).toContain('shown once');
    expect(await cli(['create-key', '--tenant', 'default', '--project', projectId, '--scopes', 'execute'])).toMatchObject({ code: 1, stderr: 'SCOPES_INVALID\n' });

    const listed = await cli(['list-keys', '--tenant', 'default', '--project', projectId]);
    expect((listed.json!.keys as unknown[]).length).toBe(2); // the refused attempts issued nothing
    expect(listed.stdout).not.toContain('flofi_sk_');
    expect((await cli(['revoke-key', '--tenant', 'default', '--key', String(issued.json!.keyId)])).json).toEqual({ tenantId: 'default', revoked: true });
    expect(await store.authenticate(digest, new Date())).toBeNull();
    expect((await cli(['deliveries', '--tenant', 'default', '--project', projectId])).json).toEqual({ tenantId: 'default', deliveries: [] });
    expect((await cli(['disable-project', '--tenant', 'default', '--project', projectId])).json).toEqual({ tenantId: 'default', disabled: true, revokedApprovals: 0 });
    expect(await cli(['create-key', '--tenant', 'default', '--project', projectId])).toMatchObject({ code: 1, stderr: 'PROJECT_NOT_ACTIVE\n' });

    // A Preview branch is its own tenant: the project above does not exist there.
    const preview = await cli(['create-key', '--preview-branch', 'claude/build-developer-001', '--project', projectId]);
    expect(preview).toMatchObject({ code: 1, stderr: 'PROJECT_NOT_ACTIVE\n' });
  });
});
