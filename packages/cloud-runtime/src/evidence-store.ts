// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EvidenceStore: content-addressed storage for Evidence Bundle exports and other large artifacts. Objects are
 * keyed by the SHA-256 of their bytes (`sha256/<hex>.json`), so writes are idempotent and a reader can verify
 * integrity independently of the store. PostgreSQL keeps only the hash, size and key (`evidence_objects`).
 *
 * Implementations: a local filesystem store for development/tests, and an S3-compatible store (AWS S3,
 * Cloudflare R2, MinIO, Railway buckets, …) that signs requests with AWS Signature V4 over `fetch` — no
 * vendor SDK. Swapping providers changes configuration only.
 */
import { createHash, createHmac } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export interface EvidenceStore {
  readonly id: string;
  readonly put: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  readonly get: (key: string) => Promise<Uint8Array | null>;
}
export type StoredEvidence = { readonly key: string; readonly sha256: string; readonly byteLength: number };
const KEY = /^sha256\/[0-9a-f]{64}\.json$/;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;

export async function archiveEvidence(store: EvidenceStore, bytes: Uint8Array): Promise<StoredEvidence> {
  if (!bytes.length || bytes.length > MAX_EVIDENCE_BYTES) throw new Error('EVIDENCE_SIZE_INVALID');
  const digest = sha256(bytes), key = `sha256/${digest}.json`;
  const existing = await store.get(key);
  if (existing) { if (sha256(existing) !== digest) throw new Error('EVIDENCE_INTEGRITY_FAILED'); }
  else await store.put(key, bytes, 'application/json');
  return { key, sha256: digest, byteLength: bytes.length };
}
/** Returns the object only when its size and SHA-256 equal the committed metadata. */
export async function readVerifiedEvidence(store: EvidenceStore, expected: StoredEvidence): Promise<Uint8Array> {
  if (!KEY.test(expected.key) || expected.key !== `sha256/${expected.sha256}.json`) throw new Error('EVIDENCE_REFERENCE_INVALID');
  const bytes = await store.get(expected.key);
  if (!bytes) throw new Error('EVIDENCE_OBJECT_MISSING');
  if (bytes.length !== expected.byteLength || sha256(bytes) !== expected.sha256) throw new Error('EVIDENCE_INTEGRITY_FAILED');
  return bytes;
}

export function createFilesystemEvidenceStore(directory: string): EvidenceStore {
  if (!isAbsolute(directory) || directory.includes('/.git/')) throw new Error('EVIDENCE_STORE_DIRECTORY_INVALID');
  const path = (key: string) => { if (!KEY.test(key)) throw new Error('EVIDENCE_REFERENCE_INVALID'); return join(directory, key); };
  return {
    id: 'filesystem',
    async put(key, bytes) {
      const target = path(key), temp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await mkdir(join(directory, 'sha256'), { recursive: true, mode: 0o700 });
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      try { await rename(temp, target); } catch (error) { await unlink(temp).catch(() => undefined); throw error; }
    },
    async get(key) {
      try { return new Uint8Array(await readFile(path(key))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
  };
}

export type S3Config = { readonly endpoint: string; readonly bucket: string; readonly region: string; readonly accessKeyId: string;
  readonly secretAccessKey: string; readonly forcePathStyle?: boolean; readonly prefix?: string };
const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest();
const encodeSegment = (segment: string) => encodeURIComponent(segment).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** AWS Signature Version 4 for one S3 request (exported for the published test vector). */
export function signS3Request(input: { method: string; url: URL; headers: Record<string, string>; payloadSha256: string;
  region: string; accessKeyId: string; secretAccessKey: string; amzDate: string }): string {
  const date = input.amzDate.slice(0, 8), scope = `${date}/${input.region}/s3/aws4_request`;
  const headers = Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const signedHeaders = headers.map(([k]) => k).join(';');
  const query = [...input.url.searchParams.entries()].map(([k, v]) => [encodeSegment(k), encodeSegment(v)] as const)
    .sort(([a, x], [b, y]) => a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [input.method, input.url.pathname, query, headers.map(([k, v]) => `${k}:${v}\n`).join(''), signedHeaders, input.payloadSha256].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const key = hmac(hmac(hmac(hmac('AWS4' + input.secretAccessKey, date), input.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export function createS3EvidenceStore(config: S3Config, transport: typeof fetch = fetch): EvidenceStore {
  // An unparseable endpoint (empty, no scheme, quoted) is a configuration error, not an unclassified TypeError.
  if (!URL.canParse(config.endpoint)) throw new Error('OBJECT_STORE_ENDPOINT_INVALID');
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('OBJECT_STORE_ENDPOINT_INSECURE');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket) || !config.accessKeyId || !config.secretAccessKey) throw new Error('OBJECT_STORE_CONFIGURATION_INVALID');
  const prefix = (config.prefix ?? '').replace(/^\/+|\/+$/g, '');
  if (prefix && !/^[a-z0-9._/-]{1,100}$/.test(prefix)) throw new Error('OBJECT_STORE_CONFIGURATION_INVALID');
  const url = (key: string) => {
    if (!KEY.test(key)) throw new Error('EVIDENCE_REFERENCE_INVALID');
    const objectPath = [prefix, key].filter(Boolean).join('/').split('/').map(encodeSegment).join('/');
    const base = config.forcePathStyle ?? true ? new URL(`${endpoint.origin}/${config.bucket}/`) : new URL(`${endpoint.protocol}//${config.bucket}.${endpoint.host}/`);
    return new URL(objectPath, base);
  };
  async function request(method: 'GET' | 'PUT', key: string, body?: Uint8Array, contentType?: string): Promise<Response> {
    const target = url(key), payload = body ?? new Uint8Array(), amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
    const headers: Record<string, string> = { host: target.host, 'x-amz-content-sha256': sha256(payload), 'x-amz-date': amzDate,
      ...contentType ? { 'content-type': contentType } : {} };
    const authorization = signS3Request({ method, url: target, headers, payloadSha256: headers['x-amz-content-sha256']!, region: config.region,
      accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, amzDate });
    // `host` is signed but set by the transport itself.
    const sent = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'host'));
    return transport(target, { method, headers: { ...sent, authorization }, ...body ? { body: Buffer.from(body) } : {}, redirect: 'error',
      signal: AbortSignal.timeout(30_000) });
  }
  return {
    id: 's3',
    async put(key, bytes, contentType) {
      const response = await request('PUT', key, bytes, contentType);
      if (!response.ok) throw new Error('EVIDENCE_STORE_WRITE_FAILED');
    },
    async get(key) {
      const response = await request('GET', key);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('EVIDENCE_STORE_READ_FAILED');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_EVIDENCE_BYTES) throw new Error('EVIDENCE_SIZE_INVALID');
      return bytes;
    },
  };
}
