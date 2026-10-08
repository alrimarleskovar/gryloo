// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: the operator CLI for FloFi's conversational channels, run directly by Node 24's TypeScript support:
 *
 *   node apps/reference-dapp/backend/channels-admin.ts <command>
 *
 *   allowlist-digest          reads one sender id per stdin line (a Telegram user id; a WhatsApp BSUID or phone digits) and prints
 *                             the SHA-256 digests FLOFI_TELEGRAM_ALLOWED_USERS / FLOFI_WHATSAPP_ALLOWED_SENDERS list
 *   dispatch-token --token-file <path>
 *                             creates a scheduler token in a NEW mode-0600 file (for CRON_SECRET) and prints only its SHA-256
 *                             (for FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256)
 *   telegram-me               checks TELEGRAM_BOT_TOKEN: the bot's public id and username
 *   telegram-whoami           while no webhook is set: the user ids and allowlist digests of people who wrote to the bot privately
 *   telegram-set-webhook      registers <FLOFI_PUBLIC_ORIGIN>/api/channels/telegram with TELEGRAM_WEBHOOK_SECRET
 *   telegram-webhook-info     the registered webhook, pending updates and Telegram's last delivery error
 *   telegram-delete-webhook   unregisters the webhook
 *
 * Environment (only what a command needs): TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, FLOFI_PUBLIC_ORIGIN; FLOFI_TELEGRAM_API_BASE
 * only as a loopback test double. Secrets are read from the environment and never printed; nothing here touches the database, signs
 * or authorizes anything. Like `main.ts`, it runs on plain Node: every module it reaches imports with explicit extensions.
 */
import { createHash, randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { deleteWebhook, me, recentSenders, setWebhook, webhookInfo, type AdminResult } from '../src/channels/telegram/admin.ts';
import { telegramApi } from '../src/channels/telegram/transport.ts';

const COMMANDS = ['allowlist-digest', 'dispatch-token', 'telegram-me', 'telegram-whoami', 'telegram-set-webhook', 'telegram-webhook-info',
  'telegram-delete-webhook'] as const;
const TOKEN = /^[1-9][0-9]{4,15}:[A-Za-z0-9_-]{30,64}$/, SECRET = /^[A-Za-z0-9_-]{32,256}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const out = (value: unknown): void => { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); };

function api() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  if (!TOKEN.test(token)) throw new Error('TELEGRAM_BOT_TOKEN_INVALID: set it in the environment (from @BotFather), never on the command line');
  let apiBase = 'https://api.telegram.org';
  const override = process.env.FLOFI_TELEGRAM_API_BASE?.trim();
  if (override) {
    const url = new URL(override);
    if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) throw new Error('FLOFI_TELEGRAM_API_BASE_INVALID: loopback test doubles only');
    apiBase = url.origin;
  }
  return telegramApi({ token, apiBase });
}
async function report<T>(result: Promise<AdminResult<T>>) {
  const r = await result;
  out(r);
  if (!r.ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || !(COMMANDS as readonly string[]).includes(command)) throw new Error(`COMMAND_INVALID: one of ${COMMANDS.join(', ')}`);
  const { values } = parseArgs({ args: rest, strict: true, allowPositionals: false, options: { 'token-file': { type: 'string' } } });
  switch (command) {
    case 'allowlist-digest': {
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      const ids = input.split('\n').map(s => s.trim()).filter(Boolean);
      if (!ids.length || ids.length > 256) throw new Error('IDS_REQUIRED: one sender id per stdin line (at most 256)');
      const digests = ids.map(id => createHash('sha256').update(id, 'utf8').digest('hex'));
      out({ ok: true, digests, allowlist: digests.join(',') });
      return;
    }
    case 'dispatch-token': {
      const path = values['token-file'];
      if (!path) throw new Error('ARGUMENT_REQUIRED: --token-file <new file>');
      const token = randomBytes(32).toString('base64url'), file = await open(path, 'wx', 0o600);
      try { await file.writeFile(token + '\n'); } finally { await file.close(); }
      out({ ok: true, tokenFile: path, FLOFI_CHANNEL_DISPATCH_TOKEN_SHA256: createHash('sha256').update(token, 'utf8').digest('hex') });
      return;
    }
    case 'telegram-me': return report(me(api()));
    case 'telegram-whoami': return report(recentSenders(api()));
    case 'telegram-set-webhook': {
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? '', origin = process.env.FLOFI_PUBLIC_ORIGIN?.trim() ?? '';
      if (!SECRET.test(secret)) throw new Error('TELEGRAM_WEBHOOK_SECRET_INVALID: 32–256 characters of A-Z a-z 0-9 _ -');
      return report(setWebhook(api(), origin, secret));
    }
    case 'telegram-webhook-info': return report(webhookInfo(api()));
    case 'telegram-delete-webhook': return report(deleteWebhook(api()));
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'UNCLASSIFIED_ERROR';
  // Only our own closed messages (never a provider body or a secret).
  process.stderr.write(`${/^[A-Z][A-Z0-9_]{2,60}(?::[^\n]{0,200})?$/.test(message) ? message : 'UNCLASSIFIED_ERROR'}\n`);
  process.exit(1);
});
