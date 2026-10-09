// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { DocsShell } from '../../components/docs/docs-shell';
import { articles, searchIndex } from '../../components/docs/content';

export const metadata: Metadata = { title: { default: 'FloFi Docs · Build with confidence', template: '%s · FloFi Docs' }, description: 'Guides for building, simulating, authorizing and verifying FloFi workflows, plus the Developer API, TypeScript SDK and MCP integrations.' };
export default function DocsLayout({ children }: { children: ReactNode }) {
  return <DocsShell navigation={articles.map(({ title, slug, group }) => ({ title, slug, group }))} index={searchIndex}>{children}</DocsShell>;
}
