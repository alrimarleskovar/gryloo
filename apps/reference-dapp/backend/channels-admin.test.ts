// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the channels operator CLI runs on plain Node (no bundler), refuses to run unconfigured with fixed error codes on
 * stderr (never a stack or a secret), and drives the Bot API — here a loopback double that records every call — exactly as the owner's
 * setup needs: the bot check, the owner's own user id and allowlist digest, the webhook registration (https origin, secret token, only
 * the update kinds FloFi reads), its status, and the scheduler token in a new mode-0600 file whose value is never printed.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const TOKEN = '7000000001:AAEhBP0av28fGkHMxdkpHfaW7ZvBm9Ozf6s', SECRET = 'S'.repeat(40);
const cli = (args: string[], env: Record<string, string> = {}) => promisify(execFile)(process.execPath, ['backend/channels-admin.ts', ...args],
  { cwd, timeout: 60_000, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env } })
  .then(r => ({ code: 0, stdout: r.stdout, stderr: r.stderr }), (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
const withStdin = (args: string[], input: string) => new Promise<{ code: number | null; stdout: string }>(resolve => {
  const child = spawn(process.execPath, ['backend/channels-admin.ts', ...args], { cwd, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' } });
  let stdout = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
  child.on('close', (code: number | null) => resolve({ code, stdout }));
  child.stdin.end(input);
});

let server: Server, base = '';
const calls: { path: string; body: Record<string, unknown> }[] = [];
let webhookSet = false;
beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += String(c); });
    req.on('end', () => {
      const path = req.url ?? '', method = path.split('/').at(-1), body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      calls.push({ path, body });
      const reply = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (!path.startsWith(`/bot${TOKEN}/`)) return reply(401, { ok: false, error_code: 401, description: 'Unauthorized' });
      if (method === 'getMe') return reply(200, { ok: true, result: { id: 7000000001, is_bot: true, first_name: 'FloFi', username: 'FloFiTestBot', can_join_groups: false } });
      if (method === 'getUpdates') return webhookSet ? reply(409, { ok: false, error_code: 409, description: "Conflict: can't use getUpdates method while webhook is active" })
        : reply(200, { ok: true, result: [{ update_id: 1, message: { message_id: 1, date: 1, text: 'hello bot', from: { id: 900000001, is_bot: false }, chat: { id: 900000001, type: 'private' } } },
          { update_id: 2, message: { message_id: 2, date: 1, text: 'group', from: { id: 900000002, is_bot: false }, chat: { id: -100, type: 'supergroup' } } }] });
      if (method === 'setWebhook') { webhookSet = true; return reply(200, { ok: true, result: true, description: 'Webhook was set' }); }
      if (method === 'getWebhookInfo') return reply(200, { ok: true, result: { url: webhookSet ? 'https://flofi.example/api/channels/telegram' : '', has_custom_certificate: false,
        pending_update_count: 0, last_error_date: 1_790_000_000, last_error_message: 'Wrong response from the webhook: 503 Service Unavailable', max_connections: 10,
        allowed_updates: ['message', 'callback_query', 'my_chat_member'] } });
      if (method === 'deleteWebhook') { webhookSet = false; return reply(200, { ok: true, result: true }); }
      return reply(404, { ok: false, error_code: 404, description: 'Not Found' });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); });

describe('BUILD-CHANNELS-001 channels operator CLI', () => {
  it('loads under plain Node and refuses to run unconfigured', async () => {
    expect(await cli([])).toMatchObject({ code: 1, stdout: '', stderr: expect.stringMatching(/^COMMAND_INVALID: /) });
    expect(await cli(['telegram-me'])).toMatchObject({ code: 1, stderr: expect.stringMatching(/^TELEGRAM_BOT_TOKEN_INVALID: /) });
    expect(await cli(['telegram-me'], { TELEGRAM_BOT_TOKEN: TOKEN, FLOFI_TELEGRAM_API_BASE: 'https://api.example.com' }))
      .toMatchObject({ code: 1, stderr: expect.stringMatching(/^FLOFI_TELEGRAM_API_BASE_INVALID: /) });
    expect(await cli(['telegram-set-webhook'], { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: 'short' }))
      .toMatchObject({ code: 1, stderr: expect.stringMatching(/^TELEGRAM_WEBHOOK_SECRET_INVALID: /) });
    expect(await cli(['dispatch-token'])).toMatchObject({ code: 1, stderr: expect.stringMatching(/^ARGUMENT_REQUIRED: /) });
  });

  it('prints allowlist digests of sender ids read from stdin', async () => {
    const result = await withStdin(['allowlist-digest'], '900000001\nBR.FLOFITESTUSER0001\n');
    const digest = (id: string) => createHash('sha256').update(id).digest('hex');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, digests: [digest('900000001'), digest('BR.FLOFITESTUSER0001')],
      allowlist: `${digest('900000001')},${digest('BR.FLOFITESTUSER0001')}` });
  });

  it('writes the scheduler token to a new mode-0600 file and prints only its digest', async () => {
    const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'flofi-channels-cli-')), file = join(dir, 'cron-secret');
    try {
      const result = await cli(['dispatch-token', '--token-file', file]);
      expect(result.code).toBe(0);
      const token = (await readFile(file, 'utf8')).trim();
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(result.stdout)).toEqual({ ok: true, tokenFile: file, FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256: createHash('sha256').update(token).digest('hex') });
      expect(result.stdout).not.toContain(token);
      // Never overwrites an existing file.
      expect(await cli(['dispatch-token', '--token-file', file])).toMatchObject({ code: 1 });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('drives the owner\'s Telegram setup against the Bot API, never printing the token or the webhook secret', async () => {
    const env = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, FLOFI_TELEGRAM_API_BASE: base, FLOFI_PUBLIC_ORIGIN: 'https://flofi.example' };
    const me = await cli(['telegram-me'], env);
    expect(JSON.parse(me.stdout)).toEqual({ ok: true, value: { id: 7000000001, username: 'FloFiTestBot', canJoinGroups: false } });
    const whoami = await cli(['telegram-whoami'], env);
    expect(JSON.parse(whoami.stdout)).toEqual({ ok: true, value: [{ userId: '900000001', digest: createHash('sha256').update('900000001').digest('hex') }] });
    expect(whoami.stdout).not.toContain('hello bot');
    expect(await cli(['telegram-set-webhook'], { ...env, FLOFI_PUBLIC_ORIGIN: 'http://127.0.0.1:3100' }))
      .toMatchObject({ code: 1, stderr: expect.stringMatching(/^TELEGRAM_WEBHOOK_REQUIRES_HTTPS: /) });
    expect(JSON.parse((await cli(['telegram-set-webhook'], env)).stdout)).toEqual({ ok: true, value: true });
    expect(calls.find(c => c.path.endsWith('/setWebhook'))!.body).toEqual({ url: 'https://flofi.example/api/channels/telegram', secret_token: SECRET,
      allowed_updates: ['message', 'callback_query', 'my_chat_member'], drop_pending_updates: true, max_connections: 10 });
    expect(JSON.parse((await cli(['telegram-webhook-info'], env)).stdout)).toEqual({ ok: true, value: { url: 'https://flofi.example/api/channels/telegram', pendingUpdates: 0,
      lastErrorAt: new Date(1_790_000_000_000).toISOString(), lastError: 'Wrong response from the webhook: 503 Service Unavailable', maxConnections: 10,
      allowedUpdates: ['message', 'callback_query', 'my_chat_member'] } });
    // getUpdates is refused while a webhook is set: the CLI says so (Telegram's words), exit 1.
    const conflict = await cli(['telegram-whoami'], env);
    expect(conflict.code).toBe(1);
    expect(JSON.parse(conflict.stdout)).toMatchObject({ ok: false, code: 'TELEGRAM_409' });
    expect(JSON.parse((await cli(['telegram-delete-webhook'], env)).stdout)).toEqual({ ok: true, value: true });
    const wrong = await cli(['telegram-me'], { ...env, TELEGRAM_BOT_TOKEN: '7000000001:BBEhBP0av28fGkHMxdkpHfaW7ZvBm9Ozf6s' });
    expect(JSON.parse(wrong.stdout)).toEqual({ ok: false, code: 'TELEGRAM_401', description: 'Unauthorized' });
    for (const result of [me, whoami, conflict, wrong]) for (const secret of [TOKEN, SECRET, TOKEN.split(':')[1]!]) expect(result.stdout + result.stderr).not.toContain(secret);
  });
});
