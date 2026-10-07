// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useEffect, useRef } from 'react';

/** Ambient light beneath React Flow's interaction layers; no application state updates. */
export function DarkSpotlight() {
  const light = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = light.current;
    const canvas = element?.parentElement;
    if (!element || !canvas) return;
    const preference = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) and (forced-colors: none)');
    let enabled = false, frame = 0, x = 0, y = 0, targetX = 0, targetY = 0, lastTime = 0;
    let visible = false;
    function hide() {
      cancelAnimationFrame(frame); frame = 0;
      visible = false; lastTime = 0;
      element!.removeAttribute('data-visible');
    }
    function render(time: number) {
      const blend = lastTime ? 1 - Math.exp(-Math.min(time - lastTime, 64) / 45) : 1;
      lastTime = time;
      x += (targetX - x) * blend; y += (targetY - y) * blend;
      element!.style.transform = `translate3d(${x - 240}px, ${y - 240}px, 0)`;
      if (Math.abs(targetX - x) + Math.abs(targetY - y) > .5) frame = requestAnimationFrame(render);
      else { frame = 0; lastTime = 0; }
    }
    function move(event: PointerEvent) {
      if (event.pointerType !== 'mouse' || document.hidden) { hide(); return; }
      const bounds = canvas!.getBoundingClientRect();
      targetX = event.clientX - bounds.left; targetY = event.clientY - bounds.top;
      if (!visible) {
        visible = true; x = targetX; y = targetY;
        element!.setAttribute('data-visible', 'true');
      }
      if (frame) return;
      lastTime = performance.now();
      frame = requestAnimationFrame(render);
    }
    function sync() {
      const next = preference.matches;
      if (next === enabled) return;
      enabled = next;
      if (enabled) canvas!.addEventListener('pointermove', move, { passive: true });
      else { canvas!.removeEventListener('pointermove', move); hide(); }
    }
    preference.addEventListener('change', sync);
    canvas.addEventListener('pointerleave', hide);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', hide, { passive: true });
    sync();
    return () => {
      preference.removeEventListener('change', sync);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', hide);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('blur', hide); window.removeEventListener('scroll', hide);
      hide();
    };
  }, []);
  return <div ref={light} className="dark-spotlight" aria-hidden="true"/>;
}
