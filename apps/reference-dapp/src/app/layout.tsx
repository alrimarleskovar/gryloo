// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@xyflow/react/dist/style.css';
import './globals.css';

export const metadata: Metadata = { title: 'Gryloo · BUILD-003F reference', description: 'Local Base swap authoring, deterministic review, a mocked artifact chain, a read-only Base quote observation and, only in an explicit local-fork acceptance environment, Mode A exact-payload execution on chain 31337; no Base or mainnet execution.' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
