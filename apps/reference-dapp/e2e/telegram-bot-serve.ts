// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001 loopback Telegram Bot API double (127.0.0.1:8559) for the browser suite. The app server's Telegram adapter talks to
 * it through FLOFI_TELEGRAM_API_BASE (a loopback-only, never-hosted test seam): `POST /bot<token>/<method>` answers like the Bot API
 * (`sendMessage` with an increasing message id, `answerCallbackQuery` with true) and records the call; the spec reads the recorded calls
 * from `GET /__flofi/calls` the way the user's phone would show the messages. Never a public network; nothing reaches Telegram.
 *
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: `sendPhoto` arrives as multipart/form-data (the workflow PNG uploaded as bytes); the double
 * records its fields like JSON params (`reply_markup` parsed back) and the photo as its type, size and whether it is a PNG.
 */
import { createServer } from 'node:http';

type Call = { readonly at: string; readonly method: string; readonly params: Record<string, unknown> };
/** A multipart body's fields; a file part becomes `{ filename, mimeType, size, png }` (its bytes are not kept). */
function multipart(body: Buffer, contentType: string): Record<string, unknown> {
  const boundary = /boundary=([A-Za-z0-9_-]+)/.exec(contentType)?.[1], params: Record<string, unknown> = {};
  if (!boundary) return params;
  for (const part of body.toString('latin1').split(`--${boundary}`).slice(1, -1)) {
    const split = part.indexOf('\r\n\r\n'), head = part.slice(2, split), value = Buffer.from(part.slice(split + 4, -2), 'latin1');
    const name = /name="([^"]+)"/.exec(head)?.[1], filename = /filename="([^"]+)"/.exec(head)?.[1], type = /content-type: ([^\r\n]+)/i.exec(head)?.[1] ?? '';
    if (!name) continue;
    params[name] = filename ? { filename, mimeType: type, size: value.length, png: value.subarray(1, 4).toString() === 'PNG' }
      : name === 'reply_markup' ? JSON.parse(value.toString('utf8')) : value.toString('utf8');
  }
  return params;
}
const calls: Call[] = [];
let messageId = 1_000;
createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:8559');
  const json = (status: number, value: unknown) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  if (request.method === 'GET' && url.pathname === '/__flofi/calls') return json(200, calls);
  if (request.method === 'POST' && url.pathname === '/__flofi/reset') { calls.length = 0; return json(200, { ok: true }); }
  const match = /^\/bot[0-9]{5,16}:[A-Za-z0-9_-]{30,64}\/([A-Za-z]{3,40})$/.exec(url.pathname);
  if (request.method !== 'POST' || !match) return json(404, { ok: false, error_code: 404, description: 'Not Found' });
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks), contentType = request.headers['content-type'] ?? '', method = match[1]!;
  let params: Record<string, unknown>;
  try { params = contentType.startsWith('multipart/form-data') ? multipart(body, contentType) : JSON.parse(body.toString('utf8') || '{}') as Record<string, unknown>; }
  catch { return json(400, { ok: false, error_code: 400, description: 'Bad Request: invalid body' }); }
  calls.push({ at: new Date().toISOString(), method, params });
  if (method === 'sendMessage') return json(200, { ok: true, result: { message_id: ++messageId, date: Math.floor(Date.now() / 1000),
    chat: { id: Number(params.chat_id), type: 'private' }, text: params.text } });
  if (method === 'sendPhoto') return json(200, { ok: true, result: { message_id: ++messageId, date: Math.floor(Date.now() / 1000),
    chat: { id: Number(params.chat_id), type: 'private' }, caption: params.caption, photo: [{ file_id: `photo-${messageId}`, width: 1080, height: 1 }] } });
  return json(200, { ok: true, result: true });
}).listen(8559, '127.0.0.1');
