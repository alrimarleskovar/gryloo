// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CanvasNavigator } from './canvas-navigator';

const viewport = vi.hoisted(() => ({ transform: [0, 0, 1], minZoom: .35, maxZoom: 1.4, width: 1044 }));
vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    Panel: ({ position, ...props }: { position: string }) => React.createElement('div', { ...props, 'data-position': position }),
    useStore: (select: (state: typeof viewport) => unknown) => select(viewport),
    useReactFlow: () => ({ fitView: vi.fn(), zoomTo: vi.fn() }),
  };
});
beforeEach(() => { Object.assign(viewport, { transform: [0, 0, 1], minZoom: .35, maxZoom: 1.4, width: 1044 }); });

describe('shared canvas navigator', () => {
  it('exposes an accessible native slider, fit icon and compact percentage without separate zoom buttons', () => {
    const html = renderToStaticMarkup(createElement(CanvasNavigator));
    expect(html).toContain('role="group" aria-label="Canvas navigator"');
    expect(html).toContain('aria-label="Fit workflow" title="Fit workflow"');
    expect(html).toContain('type="range" aria-label="Canvas zoom" aria-valuetext="100%" min="0.35" max="1.4" step="0.01"');
    expect(html).toContain('>100%</button>');
    expect(html).not.toMatch(/Zoom in|Zoom out|react-flow__controls/);
  });

  it('reads updated zoom and constraints directly from the React Flow store', () => {
    Object.assign(viewport, { transform: [23, -40, .7542], minZoom: .2, maxZoom: 2 });
    const html = renderToStaticMarkup(createElement(CanvasNavigator));
    expect(html).toContain('aria-valuetext="75%" min="0.2" max="2"');
    expect(html).toContain('value="0.7542"');
    expect(html).toContain('>75%</button>');
    viewport.transform[2] = 1.2542;
    expect(renderToStaticMarkup(createElement(CanvasNavigator))).toContain('>125%</button>');
  });

  it.each([[1044, false, false], [734, true, false], [286, true, true]])('adapts to canvas width %s while retaining all controls', (width, compact, narrow) => {
    viewport.width = width as number;
    const html = renderToStaticMarkup(createElement(CanvasNavigator));
    expect(html).toContain(`data-compact="${compact}" data-narrow="${narrow}"`);
    expect(html).toContain('aria-label="Canvas zoom"');
    expect(html).toContain('aria-label="Fit workflow"');
    expect(html).toContain('>100%</button>');
  });
});
