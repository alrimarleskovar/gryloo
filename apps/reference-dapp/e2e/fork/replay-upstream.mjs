// SPDX-License-Identifier: AGPL-3.0-only
import { Buffer } from 'node:buffer';
/** Closed, loopback-only replay of a BUILD-003D source-state transcript. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forkUpstreamCall } from '../../../../packages/reference-compiler/dist/profile.js';

/** Printed once, only after the loopback bind succeeded; the harness waits for it before starting Anvil. */
export const REPLAY_READY_LINE = 'REPLAY_UPSTREAM_READY 127.0.0.1:8546';

export function canonical(value) {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!value || typeof value !== 'object') throw new Error('NON_JSON_REQUEST');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export function replayTable(transcript) {
  if (transcript?.format !== 'gryloo.base-fork-state-transcript.v1' || !Array.isArray(transcript.exchanges)
    || transcript.sourceChainId !== 8453 || !/^0x[0-9a-f]{64}$/.test(transcript.sourceBlockHash)) throw new Error('TRANSCRIPT_INVALID');
  const table = new Map();
  for (const entry of transcript.exchanges) {
    if (typeof entry.anvilRequest !== 'string') throw new Error('TRANSCRIPT_INVALID');
    const request = JSON.parse(entry.anvilRequest);
    if (canonical(request) !== entry.anvilRequest || typeof request.method !== 'string' || !Array.isArray(request.params)) throw new Error('TRANSCRIPT_NON_CANONICAL');
    const response = entry.providerResponse ?? entry.localResponse;
    if (typeof response !== 'string' || (entry.providerResponse && entry.localResponse)) throw new Error('TRANSCRIPT_INVALID');
    const parsed = JSON.parse(response);
    if (parsed?.jsonrpc !== '2.0' || !('result' in parsed || 'error' in parsed)) throw new Error('TRANSCRIPT_INVALID');
    const previous = table.get(entry.anvilRequest);
    if (previous !== undefined) {
      const old = JSON.parse(previous);
      if (canonical({ result: old.result ?? null, error: old.error ?? null })
        !== canonical({ result: parsed.result ?? null, error: parsed.error ?? null })) throw new Error('TRANSCRIPT_AMBIGUOUS');
    } else table.set(entry.anvilRequest, response);
  }
  return table;
}
export function createReplayServer(transcript) {
  const table = replayTable(transcript);
  return createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/' || request.headers.host !== '127.0.0.1:8546') { response.writeHead(400); response.end(); return; }
    const chunks = []; let size = 0;
    request.on('data', chunk => { size += chunk.length; if (size > 1048576) request.destroy(); else chunks.push(chunk); });
    request.on('end', () => {
      let id = null;
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!input || Array.isArray(input) || input.jsonrpc !== '2.0' || !Number.isSafeInteger(input.id)) throw new Error('INVALID_RPC');
        id = input.id;
        // Same wire normalization as the recording proxy, so a recorded key always matches its replay.
        const call = forkUpstreamCall(input);
        if (call === null) throw new Error('INVALID_RPC');
        const key = canonical({ method: call.method, params: call.params });
        const recorded = table.get(key);
        if (recorded === undefined) throw new Error('FORK_STATE_UNRECORDED');
        const parsed = JSON.parse(recorded);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(parsed.id === id ? recorded : JSON.stringify({ ...parsed, id }));
      } catch {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: 'FORK_STATE_UNRECORDED' } }));
      }
    });
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('TRANSCRIPT_PATH_REQUIRED');
  const transcript = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
  const server = createReplayServer(transcript);
  server.once('error', error => {
    process.stderr.write(`REPLAY_UPSTREAM_BIND_FAILED:${error?.code ?? 'UNKNOWN'}\n`);
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); process.exit(0); });
  server.listen(8546, '127.0.0.1', () => { process.stdout.write(`${REPLAY_READY_LINE}\n`); });
}
