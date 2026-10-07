// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';
import type { Page, Locator } from '@playwright/test';

async function prepare(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
  await installSupplyWallet(page); await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
async function zoom(graph: Locator) {
  return graph.locator('.react-flow__viewport').evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
}
async function viewport(graph: Locator) {
  return graph.locator('.react-flow__viewport').evaluate(element => { const m = new DOMMatrixReadOnly(getComputedStyle(element).transform); return { x: m.e, y: m.f, zoom: m.a }; });
}
/** A laptop trackpad pinch: the browser reports a ctrl+wheel event without any key being pressed. */
async function pinch(graph: Locator, deltaY: number) {
  await graph.locator('.react-flow__pane').evaluate((pane, delta) => {
    const box = pane.getBoundingClientRect();
    pane.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, ctrlKey: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true, cancelable: true }));
  }, deltaY);
}
async function synchronized(graph: Locator) {
  const slider = graph.getByRole('slider', { name: 'Canvas zoom' });
  await expect.poll(async () => Math.abs(Number(await slider.inputValue()) - await zoom(graph))).toBeLessThanOrEqual(.0051);
  await expect.poll(async () => graph.locator('.canvas-navigator-percentage').textContent()).toBe(`${Math.round(await zoom(graph) * 100)}%`);
  await expect(slider).toHaveAttribute('aria-valuetext', `${Math.round(await zoom(graph) * 100)}%`);
}
async function geometry(page: Page) {
  return page.evaluate(() => Object.fromEntries(['.top-bar', 'main', '.canvas', '.canvas-head', '.flow-surface', '.canvas-foot', '.canvas-primary-action', '.copilot', '.simulation-summary', '.execution-plan', '.summary-bar'].map(selector => {
    const element = document.querySelector(`main ${selector}`) ?? document.querySelector(selector);
    if (!element) return [selector, null];
    const { x, y, width, height } = element.getBoundingClientRect();
    return [selector, { x, y, width, height }];
  })));
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} navigator follows React Flow zoom, gestures and fit in every stage`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await prepare(page, theme);
    await page.getByRole('button', { name: 'Add supply', exact: true }).click();
    await configureCanvasAction(page, '1');
    const stages = page.getByRole('navigation', { name: 'Workflow stages' });
    const graph = page.locator('main .flow-surface').first();
    for (const stage of ['Build', 'Simulate', 'Execute'] as const) {
      await stages.getByRole('button', { name: stage, exact: true }).click();
      const navigator = graph.getByRole('group', { name: 'Canvas navigator' });
      const slider = navigator.getByRole('slider', { name: 'Canvas zoom' });
      const positions = await graph.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform));
      await expect(navigator).toBeVisible();
      await expect(graph.locator('.react-flow__controls')).toHaveCount(0);
      await expect(slider).toHaveAttribute('min', '0.35'); await expect(slider).toHaveAttribute('max', '1.4');
      await synchronized(graph);
      await navigator.locator('.canvas-navigator-percentage').click();
      await expect.poll(() => zoom(graph)).toBe(1); await synchronized(graph);
      await slider.press('Home'); await expect.poll(() => zoom(graph)).toBe(.35);
      await slider.press('End'); await expect.poll(() => zoom(graph)).toBe(1.4);
      await slider.press('ArrowLeft'); await expect.poll(() => zoom(graph)).toBe(1.39);
      await expect(slider).toHaveCSS('outline-style', 'solid');
      await slider.press('ArrowRight'); await expect.poll(() => zoom(graph)).toBe(1.4);
      const sliderBox = (await slider.boundingBox())!;
      await page.mouse.move(sliderBox.x + sliderBox.width - 6, sliderBox.y + sliderBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(sliderBox.x + sliderBox.width * .3, sliderBox.y + sliderBox.height / 2, { steps: 8 });
      await page.mouse.up();
      expect(await zoom(graph)).toBeLessThan(1); expect(await zoom(graph)).toBeGreaterThan(.35);
      await synchronized(graph);
      const graphBox = (await graph.boundingBox())!;
      // Two-finger trackpad movement (a plain wheel) pans the real viewport 1:1 on both axes and never zooms.
      const panBefore = await viewport(graph);
      await page.mouse.move(graphBox.x + graphBox.width - 80, graphBox.y + 65);
      await page.mouse.wheel(40, 60);
      await expect.poll(async () => (await viewport(graph)).y).toBeCloseTo(panBefore.y - 60, 0);
      expect((await viewport(graph)).x).toBeCloseTo(panBefore.x - 40, 0);
      expect((await viewport(graph)).zoom).toBe(panBefore.zoom); await synchronized(graph);
      // A trackpad pinch zooms the real viewport and the slider and percentage follow.
      const pinchIn = await zoom(graph);
      await pinch(graph, -25);
      await expect.poll(() => zoom(graph)).toBeGreaterThan(pinchIn); await synchronized(graph);
      // Ctrl/⌘ + mouse wheel zooms as well.
      const pinchBefore = await zoom(graph);
      await page.keyboard.down('Control'); await page.mouse.wheel(0, 30); await page.keyboard.up('Control');
      await expect.poll(() => zoom(graph)).toBeLessThan(pinchBefore); await synchronized(graph);
      // Existing middle-button pan remains available and never changes workflow coordinates.
      const beforePan = await graph.locator('.react-flow__viewport').getAttribute('style');
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(graphBox.x + graphBox.width - 120, graphBox.y + 95, { steps: 5 });
      await page.mouse.up({ button: 'middle' });
      await expect(graph.locator('.react-flow__viewport')).not.toHaveAttribute('style', beforePan!);
      await navigator.getByRole('button', { name: 'Fit workflow', exact: true }).click();
      await synchronized(graph); await expect(graph.locator('.composer-card')).toBeInViewport();
      expect(await graph.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform))).toEqual(positions);
      if (stage !== 'Execute') await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    }
    await stages.getByRole('button', { name: 'Build', exact: true }).click();
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    expect(errors).toEqual([]);
  });

  test(`${theme} navigator stays centered with identical stage geometry and clear CTA spacing at every width`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await prepare(page, theme);
    await page.getByRole('button', { name: 'Add supply', exact: true }).click();
    await configureCanvasAction(page, '1');
    const stages = page.getByRole('navigation', { name: 'Workflow stages' });
    const graph = page.locator('main .flow-surface').first();
    const measurements: Record<string, Awaited<ReturnType<typeof geometry>>> = {};
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      let reference: Awaited<ReturnType<Locator['boundingBox']>> = null;
      for (const stage of ['Build', 'Simulate', 'Execute'] as const) {
        await stages.getByRole('button', { name: stage, exact: true }).click();
        await expect(stages.getByRole('button', { name: stage, exact: true })).toHaveAttribute('aria-current', 'page');
        await page.evaluate(() => window.scrollTo(0, 0));
        measurements[`${width}-${stage}`] = await geometry(page);
        const graphBox = (await graph.boundingBox())!;
        const navigator = graph.locator('.canvas-navigator');
        const box = (await navigator.boundingBox())!;
        if (stage === 'Build') reference = box; else expect(box).toEqual(reference);
        expect(box.x + box.width / 2).toBeCloseTo(graphBox.x + graphBox.width / 2, 1);
        expect(box.height).toBe(38);
        expect(graphBox.y + graphBox.height - box.y - box.height).toBe(graphBox.width < 800 ? 82 : 24);
        expect(box.x).toBeGreaterThan(graphBox.x); expect(box.x + box.width).toBeLessThan(graphBox.x + graphBox.width);
        const cta = (await graph.locator('.canvas-primary-action').boundingBox())!;
        expect(box.x + box.width <= cta.x || box.y + box.height <= cta.y || box.x >= cta.x + cta.width || box.y >= cta.y + cta.height).toBe(true);
        if (graphBox.width < 800) expect(cta.y - box.y - box.height).toBeGreaterThanOrEqual(14);
        await expect(navigator.getByRole('button', { name: 'Fit workflow', exact: true })).toBeVisible();
        await expect(navigator.locator('.canvas-navigator-percentage')).toBeVisible();
        await expect(navigator).toHaveCSS('background-color', theme === 'dark' ? 'rgb(28, 32, 41)' : 'rgb(255, 255, 255)');
        await expect(page.locator('.react-flow__pane')).toHaveCSS('cursor', new RegExp(`flofi-mascot-cursor${theme === 'dark' ? '-dark' : ''}\\.png.*29 3, default`));
        await expect(page.locator('.dark-spotlight')).toHaveCSS('pointer-events', 'none');
        const beforeDrawer = await geometry(page);
        await page.locator('.navigation-trigger').click(); await expect(page.locator('.navigation-drawer')).toBeVisible();
        expect(await geometry(page)).toEqual(beforeDrawer);
        await page.keyboard.press('Escape'); await expect(page.locator('.navigation-drawer')).toBeHidden();
        expect(await geometry(page)).toEqual(beforeDrawer);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if ((width === 1440 || width === 320) && stage === 'Build') await page.locator('main .canvas').first().screenshot({ path: `.tmp/flofi-canvas-navigator-${theme}-${width}.png` });
      }
    }
    await testInfo.attach('canvas-navigator-workspace-geometry', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
    expect(errors).toEqual([]);
  });

  test(`${theme} navigator preserves the waving empty state, floating tools, lending fit and node drag`, async ({ page }) => {
    await prepare(page, theme);
    const graph = page.locator('main .flow-surface').first();
    await expect(graph.locator('.canvas-empty-mascot')).toBeVisible();
    await expect(graph.locator(`.flofi-droplet-wave-${theme}`)).toHaveAttribute('src', `/brand/flofi-droplet-wave${theme === 'dark' ? '-dark' : ''}.svg`);
    await page.getByRole('button', { name: 'Undock toolbar', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 900 });
    const toolbar = (await graph.locator('.floating-toolbox').boundingBox())!;
    const navigator = (await graph.locator('.canvas-navigator').boundingBox())!;
    expect(navigator.x - toolbar.x - toolbar.width).toBeGreaterThanOrEqual(8);
    await graph.getByRole('slider', { name: 'Canvas zoom' }).press('Home'); await synchronized(graph);
    await page.getByRole('button', { name: 'Dock toolbar', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
    await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
    await expect(graph.locator('.canvas-empty-mascot')).toHaveCount(0);
    await expect(graph.locator('.composer-card')).toHaveCount(3);
    await graph.getByRole('slider', { name: 'Canvas zoom' }).press('Home');
    await graph.getByRole('button', { name: 'Fit workflow', exact: true }).click(); await synchronized(graph);
    for (const card of await graph.locator('.composer-card').all()) await expect(card).toBeInViewport();
    const node = graph.locator('.react-flow__node').first();
    const before = await node.getAttribute('style');
    const card = (await node.locator('.composer-card').boundingBox())!;
    await page.mouse.move(card.x + 50, card.y + 20); await page.mouse.down();
    await page.mouse.move(card.x + 80, card.y + 30, { steps: 5 }); await page.mouse.up();
    await expect(node).not.toHaveAttribute('style', before!);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  });
}

test('node drag moves only the node, pane drag moves neither nodes nor viewport, and the page keeps scrolling outside the canvas', async ({ page }) => {
  await prepare(page, 'light');
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  await configureCanvasAction(page, '1');
  const graph = page.locator('main .flow-surface').first(), node = graph.locator('.react-flow__node').first();
  const position = () => node.evaluate(element => (element as HTMLElement).style.transform);
  const before = await viewport(graph), start = await position();
  const card = (await node.locator('.composer-card').boundingBox())!;
  await page.mouse.move(card.x + 60, card.y + 18); await page.mouse.down();
  await page.mouse.move(card.x + 110, card.y + 48, { steps: 6 }); await page.mouse.up();
  await expect.poll(position).not.toBe(start);
  expect(await viewport(graph)).toEqual(before);
  // A left drag on the empty pane is marquee selection: the viewport and every node stay where they are.
  const moved = await position(), box = (await graph.boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + 12); await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 60, { steps: 5 }); await page.mouse.up();
  expect(await viewport(graph)).toEqual(before);
  expect(await position()).toBe(moved);
  // Wheel outside the canvas scrolls the page; wheel over the canvas pans it and leaves the page where it is.
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const header = (await page.locator('.top-bar').boundingBox())!;
  await page.mouse.move(header.x + 40, header.y + header.height / 2);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const scrolled = await page.evaluate(() => window.scrollY), canvas = (await graph.boundingBox())!, panBefore = await viewport(graph);
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + Math.min(canvas.height / 2, 120));
  await page.mouse.wheel(0, 80);
  await expect.poll(async () => (await viewport(graph)).y).toBeCloseTo(panBefore.y - 80, 0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
});

test('narrow canvas keeps trackpad pan, pinch, slider and Fit usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await prepare(page, 'dark');
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  await configureCanvasAction(page, '1');
  const graph = page.locator('main .flow-surface').first();
  const box = (await graph.boundingBox())!, before = await viewport(graph);
  await page.mouse.move(box.x + box.width / 2, box.y + 60);
  await page.mouse.wheel(-30, 25);
  await expect.poll(async () => (await viewport(graph)).x).toBeCloseTo(before.x + 30, 0);
  await pinch(graph, 30);
  await expect.poll(() => zoom(graph)).toBeLessThan(before.zoom); await synchronized(graph);
  await graph.getByRole('slider', { name: 'Canvas zoom' }).press('PageUp');
  await synchronized(graph);
  await graph.getByRole('button', { name: 'Fit workflow', exact: true }).click(); await synchronized(graph);
  await expect(graph.locator('.composer-card')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
