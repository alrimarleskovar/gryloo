// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-MCP-002: `/approve#<secret>` — where a proposal made in an MCP client (Claude, ChatGPT) meets its owner. The page runs the
 * whole FloFi app (same stores, same flow panels, same Review and signature path); the handoff panel on top only shows the
 * external proposal and, after the owner proves a wallet, loads it into FloFi's existing proposal card. Headers (next.config.ts):
 * no framing, no referrer, no indexing, no caching.
 */
import type { Metadata } from 'next';
import { AppProviders } from '../../components/app-providers';
import { AppShell } from '../../components/app-shell';
import { ApprovalHandoff } from '../../components/approval-handoff';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const metadata: Metadata = { title: 'FloFi · Review a proposal', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function ApprovePage() {
  return <AppProviders><div className="approval-page"><ApprovalHandoff/></div><AppShell/></AppProviders>;
}
