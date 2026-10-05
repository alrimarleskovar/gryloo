// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test support only. Wraps the exact npm elliptic instance that Cloak → circomlibjs → ethers 5 → signing-key loads in
 * Node, recording any secp256k1 private-key use (the GHSA-848j-6mx2-7j84 signing path). Nothing is replaced or patched
 * for the application; tests restore the originals.
 */
import { createRequire } from 'node:module';

type Elliptic = { ec: { prototype: Record<string, (...args: unknown[]) => unknown> } };
export function ellipticPrivateKeyTripwire() {
  const app = createRequire(import.meta.url), next = (from: string, id: string) => createRequire(from).resolve(id);
  const signingKey = next(next(next(app.resolve('@cloak.dev/sdk'), 'circomlibjs'), 'ethers'), '@ethersproject/signing-key');
  const elliptic = createRequire(signingKey)('elliptic') as Elliptic, calls: string[] = [];
  const restore = ['sign', 'keyFromPrivate', 'genKeyPair'].map(method => {
    const original = elliptic.ec.prototype[method]!;
    elliptic.ec.prototype[method] = function (this: unknown, ...args: unknown[]) { calls.push(method); return original.apply(this, args); };
    return () => { elliptic.ec.prototype[method] = original; };
  });
  return { calls, signingKeyLoaded: () => signingKey in app.cache, restore: () => restore.forEach(undo => undo()) };
}
