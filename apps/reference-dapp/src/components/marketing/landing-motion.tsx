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

    const depthElements = window.matchMedia('(pointer: fine)').matches
      ? Array.from(document.querySelectorAll<HTMLElement>('[data-landing-depth]'))
      : [];
    const depthHandlers = depthElements.map(element => {
      const move = (event: PointerEvent) => {
        const rect = element.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width - .5) * 3;
        const y = ((event.clientY - rect.top) / rect.height - .5) * -2;
        element.style.setProperty('--tilt-x', `${x.toFixed(2)}deg`);
        element.style.setProperty('--tilt-y', `${y.toFixed(2)}deg`);
        if (element.parentElement?.hasAttribute('data-hero-stage')) {
          element.parentElement.style.setProperty('--halo-x', `${(x * 4).toFixed(1)}px`);
          element.parentElement.style.setProperty('--halo-y', `${(y * 4).toFixed(1)}px`);
        }
      };
      const leave = () => {
        element.style.removeProperty('--tilt-x');
        element.style.removeProperty('--tilt-y');
        element.parentElement?.style.removeProperty('--halo-x');
        element.parentElement?.style.removeProperty('--halo-y');
      };
      element.addEventListener('pointermove', move);
      element.addEventListener('pointerleave', leave);
      return () => {
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerleave', leave);
      };
    });

    const halo = document.querySelector<HTMLElement>('[data-landing-halo]');
    let frame = 0;
    const updateHalo = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => halo?.style.setProperty('--halo-shift', `${Math.min(84, window.scrollY * .12)}px`));
    };
    window.addEventListener('scroll', updateHalo, { passive: true });
    return () => {
      observer.disconnect();
      depthHandlers.forEach(dispose => dispose());
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', updateHalo);
    };
  }, []);
  return null;
}
