// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { archiveEvidence, createFilesystemEvidenceStore, createLogger, createS3EvidenceStore, formatTraceparent, parseTraceparent,
  readVerifiedEvidence, redactFields, signS3Request, withSpan } from '../src/index.js';

describe('BUILD-CLOUD-001 EvidenceStore', () => {
  it('signs S3 requests exactly as the AWS Signature V4 documentation example (GET Object)', () => {
    // Public example credentials from the AWS S3 SigV4 documentation, split so they are not mistaken for live keys.
    const accessKeyId = ['AKIA', 'IOSFODNN7', 'EXAMPLE'].join(''), secretAccessKey = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/');
    const authorization = signS3Request({ method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z' }, payloadSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1', accessKeyId, secretAccessKey, amzDate: '20130524T000000Z' });
    expect(authorization).toBe(`AWS4-HMAC-SHA256 Credential=${accessKeyId}/20130524/us-east-1/s3/aws4_request, ` +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
  it('filesystem store: content-addressed, idempotent and integrity-checked on read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flofi-evidence-')), store = createFilesystemEvidenceStore(directory);
    const payload = new TextEncoder().encode('{"bundle":"x"}');
    const stored = await archiveEvidence(store, payload);
    expect(stored).toMatchObject({ key: `sha256/${stored.sha256}.json`, byteLength: payload.length });
    expect(await archiveEvidence(store, payload)).toEqual(stored);
    expect(new TextDecoder().decode(await readVerifiedEvidence(store, stored))).toBe('{"bundle":"x"}');
    await writeFile(join(directory, stored.key), '{"bundle":"y"}');
    await expect(readVerifiedEvidence(store, stored)).rejects.toThrow('EVIDENCE_INTEGRITY_FAILED');
    await expect(archiveEvidence(store, payload)).rejects.toThrow('EVIDENCE_INTEGRITY_FAILED');
    await expect(readVerifiedEvidence(store, { ...stored, key: 'sha256/../../etc/passwd' })).rejects.toThrow('EVIDENCE_REFERENCE_INVALID');
    await expect(readVerifiedEvidence(store, { key: `sha256/${'0'.repeat(64)}.json`, sha256: '0'.repeat(64), byteLength: 1 })).rejects.toThrow('EVIDENCE_OBJECT_MISSING');
    expect(JSON.parse(await readFile(join(directory, stored.key), 'utf8'))).toEqual({ bundle: 'y' });
  });
  it('S3-compatible store talks signed path-style HTTP and verifies what it reads back', async () => {
    const objects = new Map<string, Buffer>(), seen: string[] = [];
    const server = createServer((request, response) => {
      seen.push(`${request.method} ${request.url} ${String(request.headers.authorization).split(' ')[0]}`);
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(chunk)).on('end', () => {
        if (request.method === 'PUT') { objects.set(request.url!, Buffer.concat(chunks)); response.writeHead(200).end(); return; }
        const body = objects.get(request.url!);
        if (!body) { response.writeHead(404).end(); return; }
        response.writeHead(200).end(body);
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const store = createS3EvidenceStore({ endpoint: `http://127.0.0.1:${port}`, bucket: 'flofi-evidence', region: 'auto', accessKeyId: 'test-access',
        secretAccessKey: 'test-only-not-a-credential', prefix: 'tenant-default' });
      const stored = await archiveEvidence(store, new TextEncoder().encode('{"a":1}'));
      expect(new TextDecoder().decode(await readVerifiedEvidence(store, stored))).toBe('{"a":1}');
      expect(seen[0]).toBe(`GET /flofi-evidence/tenant-default/${stored.key} AWS4-HMAC-SHA256`);
      expect(seen[1]).toBe(`PUT /flofi-evidence/tenant-default/${stored.key} AWS4-HMAC-SHA256`);
      objects.set(`/flofi-evidence/tenant-default/${stored.key}`, Buffer.from('{"a":2}'));
      await expect(readVerifiedEvidence(store, stored)).rejects.toThrow('EVIDENCE_INTEGRITY_FAILED');
      expect(() => createS3EvidenceStore({ endpoint: 'http://objects.example.com', bucket: 'b-1', region: 'r', accessKeyId: 'a', secretAccessKey: 's' }))
        .toThrow('OBJECT_STORE_ENDPOINT_INSECURE');
      for (const endpoint of ['', 'objects.example.com', '"https://objects.example.com"'])
        expect(() => createS3EvidenceStore({ endpoint, bucket: 'b-1', region: 'r', accessKeyId: 'a', secretAccessKey: 's' }))
          .toThrow('OBJECT_STORE_ENDPOINT_INVALID');
    } finally { server.close(); }
  });
});

describe('BUILD-CLOUD-001 telemetry', () => {
  it('redacts secrets by key and by shape', () => {
    expect(redactFields({ api_auth_token: 'abc', authorization: 'Bearer x', rpc: 'https://rpc.example/v2?key=secretvalue', db: 'postgres://user:pass@host/db',
      signature: '0x' + 'a'.repeat(130), run_id: 'rhx-1', blob: '0x' + 'b'.repeat(200) })).toEqual({
      api_auth_token: '[REDACTED]', authorization: '[REDACTED]', rpc: 'https://rpc.example/v2?[REDACTED]', db: 'postgres://[REDACTED]@host/db',
      signature: '[REDACTED]', run_id: 'rhx-1', blob: '0x[REDACTED]' });
  });
  it('propagates W3C trace context through nested spans with structured identifiers', async () => {
    const lines: Record<string, unknown>[] = [];
    const logger = createLogger({ service: 'api', sink: line => lines.push(JSON.parse(line) as Record<string, unknown>) });
    const remote = parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')!;
    await withSpan(logger, 'http.request', { run_id: 'rhx-1' }, () => withSpan(logger, 'flow.call', { attempt_id: 'rhx-1.TRANSFER' }, async () => 'ok'), remote);
    expect(lines.map(l => [l.event, l.trace_id])).toEqual([['flow.call', remote.traceId], ['http.request', remote.traceId]]);
    expect(lines[0]!.parent_span_id).toBe(lines[1]!.span_id);
    expect(lines[1]!.parent_span_id).toBe(remote.spanId);
    expect(parseTraceparent('garbage')).toBeNull();
    expect(formatTraceparent(remote)).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  });
});
