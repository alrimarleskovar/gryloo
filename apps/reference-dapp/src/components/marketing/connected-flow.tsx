// SPDX-License-Identifier: AGPL-3.0-only
'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import styles from './landing.module.css';

type Point = { x: number; y: number };

/** Cards own their edge anchors; one SVG owns the complete routing geometry. */
export function ConnectedFlow({ children, className, label, variant = 'light' }: {
  children: ReactNode; className: string | undefined; label: string; variant?: 'light' | 'dark';
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const svg = svgRef.current;
    if (!root || !svg) return;
    let frame = 0;
    let disposed = false;
    const sources = [...root.querySelectorAll<HTMLElement>('[data-flow-source] [data-flow-port]')];
    const destinations = [...root.querySelectorAll<HTMLElement>('[data-flow-destination] [data-flow-port]')];
    const input = root.querySelector<HTMLElement>('[data-flow-port="input"]')!;
    const output = root.querySelector<HTMLElement>('[data-flow-port="output"]')!;
    const paths = [...svg.querySelectorAll<SVGPathElement>('[data-flow-path]')];
    const junctions = [...svg.querySelectorAll<SVGCircleElement>('[data-flow-junction]')];

    const measure = () => {
      frame = 0;
      const matrix = svg.getScreenCTM()?.inverse();
      if (!matrix) return;
      // Includes ancestor translations/scales: viewport rectangles become SVG user units.
      const center = (element: Element): Point => {
        const box = element.getBoundingClientRect();
        return new DOMPoint(box.left + box.width / 2, box.top + box.height / 2).matrixTransform(matrix);
      };
      const start = sources.map(center);
      const end = destinations.map(center);
      const incoming = center(input);
      const outgoing = center(output);
      const vertical = getComputedStyle(root).getPropertyValue('--flow-direction').trim() === 'vertical';
      const join: Point = vertical
        ? { x: incoming.x, y: Math.max(...start.map(p => p.y)) + (incoming.y - Math.max(...start.map(p => p.y))) * .65 }
        : { x: Math.max(...start.map(p => p.x)) + (incoming.x - Math.max(...start.map(p => p.x))) * .65, y: incoming.y };
      const fork: Point = vertical
        ? { x: outgoing.x, y: outgoing.y + (Math.min(...end.map(p => p.y)) - outgoing.y) * .35 }
        : { x: outgoing.x + (Math.min(...end.map(p => p.x)) - outgoing.x) * .35, y: outgoing.y };
      const move = (p: Point) => `M${p.x},${p.y}`;
      const line = (p: Point) => `L${p.x},${p.y}`;
      const curve = (a: Point, b: Point) => {
        const distance = vertical ? (b.y - a.y) * .5 : (b.x - a.x) * .5;
        return vertical
          ? `C${a.x},${a.y + distance} ${b.x},${b.y - distance} ${b.x},${b.y}`
          : `C${a.x + distance},${a.y} ${b.x - distance},${b.y} ${b.x},${b.y}`;
      };
      const routes = [
        ...start.map(p => move(p) + curve(p, join)), move(join) + line(incoming),
        move(outgoing) + line(fork), ...end.map(p => move(fork) + curve(fork, p)),
      ];
      paths.forEach((path, index) => path.setAttribute('d', routes[index]!));
      [join, fork].forEach((p, index) => {
        junctions[index]!.setAttribute('cx', String(p.x));
        junctions[index]!.setAttribute('cy', String(p.y));
      });
      // One quiet, finite illustrative signal when the diagram enters the viewport.
      svg.querySelector('[data-flow-signal="input"]')!.setAttribute('d', move(start[1]!) + curve(start[1]!, join) + line(incoming));
      svg.querySelector('[data-flow-signal="output"]')!.setAttribute('d', move(outgoing) + line(fork) + curve(fork, end[0]!));
      root.dataset.flowReady = 'true';
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    // Groups catch grid reflow; cards catch copy and font changes without polling layout.
    [root, ...root.querySelectorAll<HTMLElement>('[data-flow-source], [data-flow-core], [data-flow-destination], [data-flow-nodes]')].forEach(element => resize.observe(element));
    void document.fonts.ready.then(schedule);
    window.addEventListener('resize', schedule, { passive: true });
    const visible = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        root.dataset.flowVisible = 'true';
        visible.disconnect();
      }
    }, { threshold: .5 });
    visible.observe(root);
    schedule();
    return () => {
      disposed = true;
      resize.disconnect();
      visible.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    };
  }, [variant]);

  return <div ref={rootRef} className={className} role="group" aria-label={label} data-flow-diagram={variant}>
    <svg ref={svgRef} className={styles.flowConnections} aria-hidden="true">
      {Array.from({ length: variant === 'light' ? 7 : 6 }, (_, index) => <path key={index} data-flow-path/>)}
      <circle r="3" data-flow-junction/><circle r="2.5" data-flow-junction/>
      <path className={styles.flowSignal} pathLength="1000" data-flow-signal="input"/>
      <path className={styles.flowSignal} pathLength="1000" data-flow-signal="output"/>
    </svg>
    {children}
  </div>;
}
