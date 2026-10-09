// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useEffect, useRef } from 'react';
import styles from './landing.module.css';

/** The original flattened horizon gets apparent orbital drift, not spherical rotation. */
export function EarthAtmosphere() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const section = element.closest('section')!;
    let inView = false;
    const update = () => { element.dataset.earthActive = String(inView && !document.hidden); };
    const observer = new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting);
      update();
    });
    observer.observe(section);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  return <div ref={ref} className={styles.horizon} data-earth data-earth-active="false" aria-hidden="true">
    <div className={styles.earthSurface} data-earth-surface/>
    <div className={styles.earthAtmosphere} data-earth-atmosphere/>
  </div>;
}
