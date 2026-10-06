// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-001: read-only previews of a flow's simulation, for callers that may not create runs (the MCP gateway).
 *
 * A preview runs the flow's UNCHANGED `simulate` (the EVM swap's `prepare`) — the same validators, provider routing, chain
 * reads, transaction simulation, artifact compilation and Manifest as the DApp — on an observe-only transport and on a run
 * log that exists only for that one call. Nothing is persisted: there is no durable run, so nothing is bound to the account
 * argument, no wallet session principal is involved, and the Review commitment it computes can never be authorized (the
 * flow's `review` needs a durable run). The owner re-simulates in the DApp under their wallet session before any Review.
 */
import { assertLogName, reentrantLeases, utf8, type ExecutionStorage } from '@defi-workflow-engine/reference-executor';
import type { FlowName } from './flows.ts';

/** The one preview method per flow. A flow missing here has no preview (e.g. Orca liquidity needs a browser-generated key). */
export const PREVIEW_METHODS: Readonly<Partial<Record<FlowName, 'simulate' | 'prepare'>>> = Object.freeze({
  'crosschain-router': 'simulate', 'crosschain-router-testnet': 'simulate', 'aave-supply': 'simulate', 'base-sepolia-swap': 'prepare',
  'uniswap-liquidity': 'simulate', 'jupiter-swap': 'simulate', 'solana-devnet-swap': 'simulate', 'lending-composition': 'simulate',
});

/**
 * A run log scoped to one preview call and discarded with it. It keeps the durable store's contract (strict extension, the
 * service's own validator, exclusive create), so the service behaves exactly as it does on PostgreSQL; it is never shared
 * between calls and holds no state anything else reads.
 */
export function previewStorage(): ExecutionStorage {
  const logs = new Map<string, Uint8Array>();
  return {
    log: {
      read: async name => logs.get(assertLogName(name)) ?? null,
      async extend(name, next, validate) {
        const prior = logs.get(assertLogName(name));
        if (prior && (next.length <= prior.length || utf8(next.subarray(0, prior.length)) !== utf8(prior))) throw new Error('JOURNAL_CORRUPT');
        validate(next);
        logs.set(name, next.slice());
      },
      async create(name, bytes) {
        if (logs.has(assertLogName(name))) return false;
        logs.set(name, bytes.slice());
        return true;
      },
      list: async (prefix, limit) => [...logs.keys()].filter(name => name.startsWith(prefix)).sort().slice(0, limit),
    },
    // One call, one store: there is no other holder to exclude.
    leases: reentrantLeases({ hold: (_key, action) => action() }),
  };
}
