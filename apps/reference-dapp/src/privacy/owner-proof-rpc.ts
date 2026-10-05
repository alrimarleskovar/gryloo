// SPDX-License-Identifier: AGPL-3.0-only
import { createCloakRpc, type CloakRpc } from '@cloak.dev/sdk';
import { readOwnerProofRpc } from '../app/privacy-owner-proof-actions';
import { CLOAK_READ_RPC } from './live-proof';
/** Endpoint identifies the genuine fixed upstream. Browser requests traverse a public-data-only Server Action. */
export function ownerDepositReadRpc(): CloakRpc {
  const upstream = createCloakRpc(CLOAK_READ_RPC);
  if (typeof window === 'undefined') return upstream;
  return new Proxy(upstream, { get(target, key) {
    if (key === 'endpoint') return CLOAK_READ_RPC;
    if (key === 'rpcEndpoint' || key === '_rpcEndpoint') return undefined;
    if (typeof key !== 'string') return Reflect.get(target, key);
    return (...args: unknown[]) => ({ send: () => readOwnerProofRpc(key, args) });
  } });
}
