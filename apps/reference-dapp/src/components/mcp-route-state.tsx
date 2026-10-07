// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { FloFiLogo } from './flofi-logo';
import { HeaderSettings } from './header-settings';

/** Dedicated MCP routes reuse the product's branding, preferences and surfaces. */
export function McpRoutePage({ children, label, centered = false }: { children: ReactNode; label: string; centered?: boolean }) {
  return <div className="app-shell">
    <header className="top-bar"><Link href="/" className="brand" aria-label="FloFi home"><FloFiLogo/></Link>
      <HeaderSettings onDisconnect={() => {}} disconnectDisabled/></header>
    <main className={`main secondary-workspace mcp-route-main${centered ? ' mcp-route-centered' : ''}`} aria-label={label}>{children}</main>
  </div>;
}

export function McpRouteState({ title, description, label, loading = false }: { title: string; description: string; label: string; loading?: boolean }) {
  return <McpRoutePage label={label} centered>
    <section className="workspace-empty mcp-route-state" aria-labelledby="mcp-route-title" aria-busy={loading}>
      <span className="workspace-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>
      </svg></span>
      <h1 id="mcp-route-title">{title}</h1><p role={loading ? 'status' : undefined}>{description}</p>
      {!loading && <Link href="/" className="workspace-action">Go to FloFi</Link>}
    </section>
  </McpRoutePage>;
}
