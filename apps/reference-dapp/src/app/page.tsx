// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from 'next';
import LandingPage from '../components/marketing/page';
import { landingText } from '../components/marketing/landing-copy';

export const metadata: Metadata = {
  title: landingText.en.pageTitle,
  description: landingText.en.pageDescription,
  openGraph: { title: landingText.en.pageTitle, description: landingText.en.pageDescription, type: 'website' },
};
export default function Page() { return <LandingPage/>; }
