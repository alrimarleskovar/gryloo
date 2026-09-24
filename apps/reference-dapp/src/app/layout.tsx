// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@xyflow/react/dist/style.css';
import './globals.css';

export const metadata: Metadata = { title: 'Gryloo · BUILD-003B reference', description: 'Local Base swap authoring, deterministic review and a mocked artifact chain; execution unavailable.' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
