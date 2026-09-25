// SPDX-License-Identifier: AGPL-3.0-only
/** Browser-safe, independent implementation of the frozen payload hash framing. */
export async function browserPayloadHash(bytes: Uint8Array): Promise<string> {
  if (!(bytes instanceof Uint8Array) || bytes.length > 1_048_576) throw new Error('PAYLOAD_SIZE_INVALID');
  const domain = new TextEncoder().encode('defi-workflow-engine/payload');
  const preimage = new Uint8Array(20 + domain.length + bytes.length);
  preimage.set(new TextEncoder().encode('DWE-HASH'), 0);
  preimage[9] = 1;
  const view = new DataView(preimage.buffer);
  view.setUint16(10, domain.length, false);
  preimage.set(domain, 12);
  view.setBigUint64(12 + domain.length, BigInt(bytes.length), false);
  preimage.set(bytes, 20 + domain.length);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', preimage));
  return '0x' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
