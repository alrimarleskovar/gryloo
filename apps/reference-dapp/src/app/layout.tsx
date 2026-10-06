// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ProductWorkspace } from '../components/product-workspace';
import { product } from '../config/product';
import '@xyflow/react/dist/style.css';
import './globals.css';

export const metadata: Metadata = { title: `${product.name} · Build, Simulate, Execute`, description: 'Compose multichain DeFi workflows, simulate and review the Strategy Manifest, then authorize with your own wallet and follow execution, reconciliation and evidence.' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><ProductWorkspace/>{children}</body></html>;
}
