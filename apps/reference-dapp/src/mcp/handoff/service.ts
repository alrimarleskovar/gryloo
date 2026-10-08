// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: the trusted approval handoff service. BUILD-DEVELOPER-001 moved it, unchanged in behaviour, to the shared
 * platform layer behind a requester-neutral boundary (`src/platform/approvals.ts`); this module stays as the compatibility
 * surface for `/approve`, the approval UI and the MCP tests. New code imports `src/platform` instead.
 */
export * from '../../platform/approvals.ts';
