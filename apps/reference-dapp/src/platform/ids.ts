// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEVELOPER-001: typed random identifiers, `prefix_` + 26 lower-case base32 characters (128 random bits), for every surface (the
 * BUILD-MCP-002 generator, generalized; MCP's `newId` delegates here). An identifier is a lookup key, never an access grant.
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const PREFIX = /^[a-z]{2,8}$/;
export function typedId(prefix: string): string {
  if (!PREFIX.test(prefix)) throw new Error('ID_PREFIX_INVALID');
  const bytes = randomBytes(17);
  let out = '', buffer = 0, bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5 && out.length < 26) { out += ALPHABET[(buffer >>> (bits - 5)) & 31]; bits -= 5; }
    buffer &= (1 << bits) - 1;
  }
  return `${prefix}_${out}`;
}
