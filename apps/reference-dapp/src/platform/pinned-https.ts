// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: outbound HTTPS to a URL a stranger chose, for every surface (moved from BUILD-MCP-002's CIMD fetcher, which now
 * delegates here; same checks): the host is resolved once and EVERY address must be public (no private, loopback, link-local, CGNAT,
 * multicast, reserved, documentation, NAT64/6to4/Teredo or mapped address); the connection is pinned to the checked address, so DNS
 * rebinding cannot swap it; port 443, no redirects followed, no cookies, a hard deadline and a response size bound. Used for MCP
 * client metadata documents (GET) and Developer webhook deliveries (POST).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { LookupOptions } from 'node:dns';

// Separate lists: a BlockList also matches IPv4 addresses against IPv4-mapped IPv6 rules, which would block every IPv4 address.
const blocked4 = new BlockList(), blocked6 = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked4.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 127], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]] as const) blocked6.addSubnet(net, prefix, 'ipv6');

/** True only for a globally routable unicast address. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked4.check(address, 'ipv4');
  if (family === 6) return !blocked6.check(address, 'ipv6');
  return false;
}

export type PinnedResponse = { readonly status: number; readonly contentType: string; readonly body: Buffer };
export type PinnedRequest = {
  readonly url: URL; readonly method: 'GET' | 'POST'; readonly headers: Readonly<Record<string, string>>; readonly body?: string;
  /** Response bytes kept; beyond it the request fails (`<prefix>_TOO_LARGE`), or with `truncate` the rest is discarded unread. */
  readonly maxBytes: number; readonly truncate?: boolean; readonly timeoutMs: number;
  /** Prefix of the classified error codes: `<prefix>_ADDRESS_NOT_PUBLIC`, `<prefix>_TOO_LARGE`, `<prefix>_TIMEOUT`. */
  readonly errorPrefix: string;
};

/** One HTTPS request pinned to a pre-checked public address of the URL's host (port 443, no redirects, bounded in size and time). */
export async function pinnedHttpsRequest(input: PinnedRequest): Promise<PinnedResponse> {
  const { url, errorPrefix: prefix } = input;
  const addresses = await dnsLookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || !addresses.every(a => isPublicAddress(a.address))) throw new Error(`${prefix}_ADDRESS_NOT_PUBLIC`);
  const pinned = addresses[0]!;
  return new Promise<PinnedResponse>((resolve, reject) => {
    let settled = false;
    const done = (value: PinnedResponse) => { if (!settled) { settled = true; resolve(value); } };
    const failed = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    const req = request({ protocol: 'https:', hostname: url.hostname, port: 443, path: url.pathname + url.search, method: input.method, agent: false, headers: input.headers,
      // Connect only to the address that was checked above (DNS rebinding cannot swap it); SNI and the certificate use the host.
      lookup: ((_host: string, options: LookupOptions, callback: (...args: unknown[]) => void) =>
        options?.all ? callback(null, [{ address: pinned.address, family: pinned.family }]) : callback(null, pinned.address, pinned.family)) as LookupFunction }, response => {
      const chunks: Buffer[] = [], result = () => ({ status: response.statusCode ?? 0, contentType: String(response.headers['content-type'] ?? ''), body: Buffer.concat(chunks) });
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        if (size + chunk.length > input.maxBytes) {
          if (!input.truncate) { req.destroy(new Error(`${prefix}_TOO_LARGE`)); return; }
          chunks.push(chunk.subarray(0, input.maxBytes - size)); size = input.maxBytes;
          done(result()); req.destroy();
          return;
        }
        size += chunk.length; chunks.push(chunk);
      });
      response.on('end', () => done(result()));
      response.on('error', failed);
    });
    req.setTimeout(input.timeoutMs, () => req.destroy(new Error(`${prefix}_TIMEOUT`)));
    const deadline = setTimeout(() => req.destroy(new Error(`${prefix}_TIMEOUT`)), input.timeoutMs);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', failed);
    req.end(input.body);
  });
}
