// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: durable approval handoffs. BUILD-DEVELOPER-001 moved the store to the shared platform layer and generalized it over
 * requester kinds (`src/platform/handoff-store.ts`, migration 0006); this module stays as the compatibility surface for MCP's state,
 * wallet links and tests. New code imports `src/platform` instead.
 */
export * from '../../platform/handoff-store.ts';
