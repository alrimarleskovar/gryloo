// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

/** Focus shortcuts only: the canvas, stores and chat remain mounted. */
export function MobileBuildNavigation({ stage = 'Build' }: { stage?: 'Build' | 'Simulate' | 'Execute' }) {
  const { t: tr } = useLocale();
  function focus(selector: string) {
    const target = document.querySelector<HTMLElement>(selector);
    if (target && !target.hasAttribute('tabindex')) target.tabIndex = -1;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  const secondary = stage === 'Build' ? 'Copilot' : stage === 'Simulate' ? 'Review' : 'Execution Summary';
  return <nav className="mobile-build-navigation" aria-label={tr(stage === 'Build' ? 'Build workspace navigation' : stage === 'Simulate' ? 'Simulation workspace navigation' : 'Execution workspace navigation')}>
    <button type="button" onClick={() => focus('.workflow-workspace .canvas')}>{tr('Canvas')}</button>
    <button type="button" onClick={() => focus(stage === 'Build' ? '#mock-prompt' : stage === 'Simulate' ? '.simulation-summary' : '.execution-summary')}>{tr(secondary)}</button>
  </nav>;
}
