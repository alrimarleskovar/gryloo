// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useRef } from 'react';

/** A single composited light layer; pointer movement never updates app state. */
export function DarkSpotlight() {
  const light = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = light.current;
    if (!element) return;
    const preference = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) and (forced-colors: none)');
    let enabled = false, frame = 0, x = 0, y = 0;
    function hide() {
      cancelAnimationFrame(frame); frame = 0;
      element!.removeAttribute('data-visible');
    }
    function move(event: PointerEvent) {
      if (event.pointerType !== 'mouse' || document.hidden) { hide(); return; }
      x = event.clientX; y = event.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        element!.style.transform = `translate3d(${x - 240}px, ${y - 240}px, 0)`;
        if (!element!.hasAttribute('data-visible')) element!.setAttribute('data-visible', 'true');
      });
    }
    function sync() {
      const next = preference.matches && document.documentElement.dataset.theme === 'dark';
      if (next === enabled) return;
      enabled = next;
      if (enabled) document.addEventListener('pointermove', move, { passive: true });
      else { document.removeEventListener('pointermove', move); hide(); }
    }
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    preference.addEventListener('change', sync);
    document.addEventListener('pointerleave', hide);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', hide, { passive: true });
    sync();
    return () => {
      observer.disconnect(); preference.removeEventListener('change', sync);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', hide);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('blur', hide); window.removeEventListener('scroll', hide);
      hide();
    };
  }, []);
  return <div ref={light} className="dark-spotlight" aria-hidden="true"/>;
}
