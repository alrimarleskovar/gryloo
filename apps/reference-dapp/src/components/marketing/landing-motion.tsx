// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useEffect } from 'react';

export function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.visible = 'true';
        observer.unobserve(entry.target);
      }
    }, { threshold: .16 });
    document.querySelectorAll<HTMLElement>('[data-landing-reveal]').forEach(element => observer.observe(element));

    return () => {
      observer.disconnect();
    };
  }, []);
  return null;
}
