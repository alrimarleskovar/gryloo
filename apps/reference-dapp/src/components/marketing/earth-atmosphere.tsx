// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useEffect, useId, useRef } from 'react';
import styles from './landing.module.css';

/** Fixed silhouette + masked, overlapping surface passes from the original flat artwork. */
export function EarthAtmosphere() {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const region = element.closest('footer, section') ?? element;
    let inView = false;
    const update = () => { element.dataset.earthActive = String(inView && !document.hidden); };
    document.addEventListener('visibilitychange', update);
    if (!('IntersectionObserver' in window)) { inView = true; update(); return () => document.removeEventListener('visibilitychange', update); }
    const observer = new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting);
      update();
    });
    observer.observe(region);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  return <div ref={ref} className={styles.horizon} data-earth data-earth-active="false" aria-hidden="true">
    <svg className={styles.earthArtwork} viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        {/* Feathered inset follows the real asset's curve; sky and illuminated rim stay fixed. */}
        <mask id={`${id}-surface`} maskUnits="userSpaceOnUse" x="0" y="0" width="1672" height="941">
          <path d="M430 890 Q1000 360 1672 299 V941H430Z" fill="white" opacity=".12"/>
          <path d="M430 905 Q1000 375 1672 314 V941H430Z" fill="white" opacity=".3"/>
          <path d="M430 920 Q1000 390 1672 329 V941H430Z" fill="white" opacity=".5"/>
          <path d="M430 935 Q1000 405 1672 344 V941H430Z" fill="white"/>
        </mask>
        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="1" y2=".5"><stop stopColor="#020a18" stopOpacity=".75"/><stop offset=".55" stopColor="#7bccff" stopOpacity=".04"/><stop offset="1" stopColor="#7bccff" stopOpacity=".35"/></linearGradient>
      </defs>
      <image href="/flofi/closing-horizon-v2.png" width="1672" height="941" data-earth-original/>
      <g mask={`url(#${id}-surface)`}>
        {/* Static overscan preserves aspect ratio and contains both complete travelling passes. */}
        <image className={styles.earthSurface} data-earth-surface href="/flofi/closing-horizon-v2.png" x="-167" y="-94" width="2006" height="1129"/>
        <image className={`${styles.earthSurface} ${styles.earthSurfaceSecond}`} data-earth-surface-secondary href="/flofi/closing-horizon-v2.png" x="-167" y="-94" width="2006" height="1129"/>
        <rect className={styles.earthLighting} data-earth-lighting x="-160" width="1992" height="941" fill={`url(#${id}-light)`}/>
      </g>
    </svg>
    <div className={styles.earthAtmosphere} data-earth-atmosphere/>
  </div>;
}
