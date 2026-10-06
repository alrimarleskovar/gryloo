// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-MCP-002: `/connections` — the FloFi account behind an MCP connection: wallet links and approval requests (see connections-action.ts). */
import type { Metadata } from 'next';
import { ConnectionsPanel } from '../../components/connections-panel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'FloFi · Connections', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function ConnectionsPage() { return <main className="approval-page"><ConnectionsPanel/></main>; }
