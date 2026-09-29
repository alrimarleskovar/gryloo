// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@xyflow/react/dist/style.css';
import './globals.css';

export const metadata: Metadata = { title: 'Gryloo · workflow builder', description: 'Build and review DeFi workflows. An explicitly enabled Base Sepolia path supports a wallet-confirmed Uniswap testnet swap; Mainnet execution is unavailable.' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
