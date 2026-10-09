// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: `/approve#<secret>` — where an external proposal (from an MCP client today) meets its owner. The page runs the
 * whole FloFi app (same stores, same flow panels, same Review and signature path); the handoff panel on top only shows the
 * external proposal and, after the owner proves a wallet, loads it into FloFi's existing proposal card. Headers (next.config.ts):
 * no framing, no referrer, no indexing, no caching.
 */
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const metadata: Metadata = { title: 'FloFi · Review a proposal', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function ApprovePage() {
  // The product layout mounts the handoff inside the current workspace's providers.
  return null;
}
