// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: Channel Core's key material and at-rest protection. One dedicated secret (`FLOFI_CHANNEL_SECRET`) yields one
 * HKDF-SHA256 key per purpose, so a digest or ciphertext made for one purpose can never be replayed as another:
 *
 *   subject    keyed digest of a sender's provider id (lookup without storing the id)
 *   event      keyed digest of a provider message id (deduplication without storing the id)
 *   provider   keyed digest of a provider's outbound message id (status correlation)
 *   seal       AES-256-GCM for the few things that must be readable again for a short time: the send address, the bounded
 *              conversation state, a transient inbound payload, an unsent outbound body
 *   approval   the channel approval-link scheme's HMAC key (the shared platform digests link secrets with it)
 *
 * Every sealed value is bound to its row by additional authenticated data, so a ciphertext copied to another row, table or tenant
 * does not open.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

export type ChannelKeys = { readonly subject: Buffer; readonly event: Buffer; readonly provider: Buffer; readonly seal: Buffer; readonly approval: Buffer };
const derive = (secret: string, label: string) => Buffer.from(hkdfSync('sha256', secret, 'flofi', `flofi/channels/${label}/v1`, 32));
export function channelKeys(secret: string): ChannelKeys {
  return Object.freeze({ subject: derive(secret, 'subject'), event: derive(secret, 'event'), provider: derive(secret, 'provider'), seal: derive(secret, 'seal'),
    approval: derive(secret, 'approval-link') });
}
/** HMAC-SHA-256 under a purpose key: the only form in which provider ids are stored. */
export const keyedDigest = (key: Buffer, value: string): Buffer => createHmac('sha256', key).update(value, 'utf8').digest();

const IV = 12, TAG = 16;
/** AES-256-GCM: `iv ‖ tag ‖ ciphertext`, bound to `aad`. */
export function seal(key: Buffer, plaintext: string, aad: string): Buffer {
  const iv = randomBytes(IV), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
/** The plaintext of a sealed value, or null when it was altered, sealed for another row or under another key. */
export function open(key: Buffer, sealed: Buffer | null | undefined, aad: string): string | null {
  if (!sealed || sealed.length < IV + TAG + 1) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(sealed.subarray(IV, IV + TAG));
    return Buffer.concat([decipher.update(sealed.subarray(IV + TAG)), decipher.final()]).toString('utf8');
  } catch { return null; }
}
/** The additional authenticated data of a sealed column: tenant, table, row and column. */
export const sealContext = (tenantId: string, table: string, row: string, column: string) => `${tenantId}|${table}|${row}|${column}`;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
/** `prefix_` + 26 lower-case base32 characters (128 random bits): conversation (`chc`) and outbox (`cho`) ids. */
export function channelRowId(prefix: 'chc' | 'cho'): string {
  let out = '', buffer = 0, bits = 0;
  for (const byte of randomBytes(17)) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5 && out.length < 26) { out += ALPHABET[(buffer >>> (bits - 5)) & 31]; bits -= 5; }
    buffer &= (1 << bits) - 1;
  }
  return `${prefix}_${out}`;
}
/** A lease's fencing token (128 random bits, base64url). */
export const leaseToken = () => randomBytes(16).toString('base64url');
