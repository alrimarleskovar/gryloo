// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001 loopback Telegram Bot API double (127.0.0.1:8558) for the browser suite. The app server's Telegram adapter talks to
 * it through FLOFI_TELEGRAM_API_BASE (a loopback-only, never-hosted test seam): `POST /bot<token>/<method>` answers like the Bot API
 * (`sendMessage` with an increasing message id, `answerCallbackQuery` with true) and records the call; the spec reads the recorded calls
 * from `GET /__flofi/calls` the way the user's phone would show the messages. Never a public network; nothing reaches Telegram.
 */
import { createServer } from 'node:http';

type Call = { readonly at: string; readonly method: string; readonly params: Record<string, unknown> };
const calls: Call[] = [];
let messageId = 1_000;
createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:8558');
  const json = (status: number, value: unknown) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  if (request.method === 'GET' && url.pathname === '/__flofi/calls') return json(200, calls);
  if (request.method === 'POST' && url.pathname === '/__flofi/reset') { calls.length = 0; return json(200, { ok: true }); }
  const match = /^\/bot[0-9]{5,16}:[A-Za-z0-9_-]{30,64}\/([A-Za-z]{3,40})$/.exec(url.pathname);
  if (request.method !== 'POST' || !match) return json(404, { ok: false, error_code: 404, description: 'Not Found' });
  let body = '';
  for await (const chunk of request) body += chunk;
  const params = JSON.parse(body || '{}') as Record<string, unknown>, method = match[1]!;
  calls.push({ at: new Date().toISOString(), method, params });
  if (method === 'sendMessage') return json(200, { ok: true, result: { message_id: ++messageId, date: Math.floor(Date.now() / 1000),
    chat: { id: Number(params.chat_id), type: 'private' }, text: params.text } });
  return json(200, { ok: true, result: true });
}).listen(8558, '127.0.0.1');
