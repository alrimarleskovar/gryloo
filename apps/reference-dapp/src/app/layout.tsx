// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Mono, Outfit } from 'next/font/google';
import { product } from '../config/product';
import { LocaleProvider } from '../i18n/locale';
import './base.css';

const outfit = Outfit({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-outfit' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--font-ibm-plex-mono' });

export const metadata: Metadata = { title: `${product.name} · Build, Simulate, Execute`, description: 'Compose multichain DeFi workflows, simulate and review the Strategy Manifest, then authorize with your own wallet and follow execution, reconciliation and evidence.' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" className={`${outfit.variable} ${plexMono.variable}`}><body><LocaleProvider>{children}</LocaleProvider></body></html>;
}
