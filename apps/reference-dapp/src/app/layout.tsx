// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@xyflow/react/dist/style.css';
import './globals.css';

export const metadata: Metadata = { title: 'Gryloo · BUILD-003C reference', description: 'Local Base swap authoring, deterministic review, a mocked artifact chain and a read-only Base quote observation for local development; execution unavailable.' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
