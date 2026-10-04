// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Minimal stateless HTTP boundary on node:http (no framework). Any instance can serve any request; nothing
 * is kept between requests except in PostgreSQL. Bearer-token authentication (constant-time comparison),
 * JSON-only bodies with a size limit, no-store responses, W3C trace propagation and structured access logs.
 * Errors never echo internal messages: only allowlisted upper-case codes leave the process.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { parseTraceparent, withSpan, type Logger } from './telemetry.js';

export type HttpRequest = { readonly method: string; readonly path: string; readonly query: URLSearchParams;
  readonly headers: IncomingMessage['headers']; readonly body: unknown; readonly requestId: string };
export type HttpResponse = { readonly status: number; readonly body: unknown };
export type Route = { readonly method: 'GET' | 'POST'; readonly pattern: RegExp; readonly name: string;
  readonly handler: (request: HttpRequest, match: RegExpExecArray) => Promise<HttpResponse> };
export class HttpError extends Error {
  constructor(readonly status: number, code: string) { super(code); }
}
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
const digest = (value: string) => createHash('sha256').update(value).digest();

async function readBody(request: IncomingMessage, limit: number): Promise<unknown> {
  if (request.method !== 'POST') return null;
  if (!/^application\/json(\s*;.*)?$/i.test(request.headers['content-type'] ?? '')) throw new HttpError(415, 'CONTENT_TYPE_UNSUPPORTED');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'BODY_TOO_LARGE');
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'BODY_INVALID'); }
}
function send(response: ServerResponse, status: number, body: unknown, requestId: string): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'x-request-id': requestId, 'content-length': Buffer.byteLength(text) });
  response.end(text);
}

export type HttpServerOptions = { readonly routes: readonly Route[]; readonly logger: Logger; readonly authToken: string | null;
  readonly maxBodyBytes?: number; readonly ready?: () => Promise<boolean> };
export function createHttpServer(options: HttpServerOptions): Server {
  const limit = options.maxBodyBytes ?? 1_048_576, expected = options.authToken ? digest(options.authToken) : null;
  return createServer((request, response) => {
    const requestId = randomUUID(), url = new URL(request.url ?? '/', 'http://internal'), method = request.method ?? 'GET';
    if (method === 'GET' && url.pathname === '/healthz') { send(response, 200, { ok: true }, requestId); return; }
    if (method === 'GET' && url.pathname === '/readyz') {
      (options.ready?.() ?? Promise.resolve(true)).then(ok => send(response, ok ? 200 : 503, { ok }, requestId), () => send(response, 503, { ok: false }, requestId));
      return;
    }
    const route = options.routes.find(r => r.method === method && r.pattern.test(url.pathname));
    const match = route ? route.pattern.exec(url.pathname)! : null;
    void withSpan(options.logger, 'http.request', { http_method: method, http_route: route?.name ?? 'unmatched', request_id: requestId }, async () => {
      try {
        if (expected) {
          const header = request.headers.authorization ?? '';
          const supplied = header.startsWith('Bearer ') ? digest(header.slice(7)) : null;
          if (!supplied || !timingSafeEqual(supplied, expected)) throw new HttpError(401, 'UNAUTHORIZED');
        }
        if (!route || !match) throw new HttpError(404, 'NOT_FOUND');
        const body = await readBody(request, limit);
        const result = await route.handler({ method, path: url.pathname, query: url.searchParams, headers: request.headers, body, requestId }, match);
        send(response, result.status, result.body, requestId);
      } catch (error) {
        if (error instanceof HttpError) { send(response, error.status, { ok: false, code: CODE.test(error.message) ? error.message : 'REQUEST_INVALID' }, requestId); throw error; }
        send(response, 500, { ok: false, code: 'INTERNAL_ERROR' }, requestId);
        throw error;
      }
    }, parseTraceparent(typeof request.headers.traceparent === 'string' ? request.headers.traceparent : null)).catch(() => undefined);
  });
}
