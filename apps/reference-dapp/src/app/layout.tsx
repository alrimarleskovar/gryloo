// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@xyflow/react/dist/style.css';
import './globals.css';

export const metadata: Metadata = { title: 'Gryloo · BUILD-002 reference', description: 'Local mocked visual workflow authoring reference.' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
