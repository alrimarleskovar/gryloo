// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useEffect, useRef } from 'react';
import { FloFiMascot } from '../marketing/flofi-mascot';
import { characterMotion } from '../marketing/mascot-animations';
import styles from './docs-mascot.module.css';

/** A homepage-only scene. No landing traveler, scroll timeline or per-frame React state. */
export function DocsMascot() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scene = ref.current;
    const root = scene?.closest<HTMLElement>('[data-docs-theme]');
    const body = scene?.querySelector<HTMLElement>('[data-mascot-body]');
    if (!scene || !root || !body) return;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let readyAt = 0;
    let lastReaction = 0;
    let reaction: Animation | undefined;
    const update = () => {
      const active = visible && !document.hidden && !preference.matches;
      scene.dataset.docsMascotActive = String(active);
      if (active && !scene.dataset.docsMascotStarted) {
        scene.dataset.docsMascotStarted = 'true';
        readyAt = performance.now() + 1800;
      }
      if (!active) reaction?.cancel();
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
      update();
    }, { threshold: .15 });
    observer.observe(scene);
    const react = (kind: 'jump' | 'look') => {
      const now = performance.now();
      if (scene.dataset.docsMascotActive !== 'true' || now < readyAt || now - lastReaction < 1600) return;
      if (body.getAnimations().some(animation => animation instanceof CSSAnimation && animation.playState !== 'finished')) return;
      lastReaction = now;
      reaction?.cancel();
      const motion = characterMotion(kind, matchMedia('(max-width: 600px)').matches);
      reaction = body.animate(motion.frames, { duration: motion.duration, easing: 'cubic-bezier(.22,.7,.25,1)' });
    };
    const onLink = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!link) return;
      if (event instanceof PointerEvent && event.relatedTarget instanceof Node && link.contains(event.relatedTarget)) return;
      const href = link.getAttribute('href');
      if (href === '/docs/getting-started' || href === '/docs/your-first-workflow') react('jump');
      if (href === '/docs/developer-api' || href === '/docs/typescript-sdk' || href === '/docs/mcp-integrations') react('look');
    };
    // Observe only search state on the persistent shell, not the article DOM.
    const search = new MutationObserver(() => { if (root.dataset.docsSearchOpen === 'true') react('look'); });
    search.observe(root, { attributes: true, attributeFilter: ['data-docs-search-open'] });
    root.addEventListener('pointerover', onLink);
    root.addEventListener('focusin', onLink);
    preference.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect(); search.disconnect(); reaction?.cancel();
      root.removeEventListener('pointerover', onLink); root.removeEventListener('focusin', onLink);
      preference.removeEventListener('change', update); document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return <div ref={ref} className={styles.mascot} data-docs-mascot aria-hidden="true">
    <div className={styles.scene}>
      <span className={styles.halo}/>
      <span className={styles.orbit}><i/><i/></span>
      <div className={styles.frame}><div className={styles.float}><FloFiMascot/></div></div>
    </div>
    <small>YOUR INTENT. YOUR CONTROL.</small>
  </div>;
}
