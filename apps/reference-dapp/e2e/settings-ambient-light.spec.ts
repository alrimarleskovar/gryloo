// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';

test('Settings switches toggle from either segment, the middle and edges with one keyboard stop each', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  await settings.click();
  const language = page.getByRole('switch', { name: 'Language', exact: true });
  const theme = page.getByRole('switch', { name: 'Theme', exact: true });
  for (const [control, initial] of [[language, true], [theme, false]] as const) {
    await expect(control).toHaveAttribute('aria-checked', String(initial));
    let selected = initial;
    for (const x of [3, 17, 34, 49, 65, 34]) {
      await control.click({ position: { x, y: 17 } }); selected = !selected;
      await expect(control).toHaveAttribute('aria-checked', String(selected));
      await expect(control.locator('span[data-selected=true]')).toHaveCount(1);
    }
    await control.focus(); await control.press('Space');
    await expect(control).toHaveAttribute('aria-checked', String(!initial));
    await control.press('Enter'); await expect(control).toHaveAttribute('aria-checked', String(initial));
    await expect(control).toHaveCSS('outline-style', 'solid');
  }
  await expect(language).toHaveAccessibleDescription('Current language: English');
  await expect(theme).toHaveAccessibleDescription('Current theme: Light');
  await page.screenshot({ path: '.tmp/ux007-settings-switches-light-1440.png' });
  await language.click(); await theme.click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition');
  await page.screenshot({ path: '.tmp/ux007-settings-switches-dark-1440.png' });
  await settings.press('Escape'); await settings.press('Enter');
  await expect(language).not.toBeChecked(); await expect(theme).toBeChecked();
  await settings.press('Tab'); await expect(language).toBeFocused();
  await language.press('Tab'); await expect(theme).toBeFocused();
  await theme.press('Tab'); await expect(page.getByRole('button', { name: 'Support', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('flofi.theme'))).toBe('dark');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settings.click(); await expect(theme).toBeChecked();
  // Language is the existing session preference, not a translation or persisted setting.
  await expect(language).toBeChecked();
  await theme.click(); await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /sign|send|switch|addEthereumChain/i.test(request.method)))).toEqual([]);
});

test('pill and page colors transition smoothly, rapid theme toggles settle and reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/app');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const theme = page.getByRole('switch', { name: 'Theme', exact: true });
  const language = page.getByRole('switch', { name: 'Language', exact: true });
  const before = await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor);
  const motion = await theme.evaluate(async element => {
    const changed = new Promise<void>(resolve => {
      const observer = new MutationObserver(() => {
        if (element.getAttribute('aria-checked') === 'true') { observer.disconnect(); resolve(); }
      });
      observer.observe(element, { attributes: true, attributeFilter: ['aria-checked'] });
    });
    void getComputedStyle(element, '::before').transform;
    (element as HTMLButtonElement).click();
    await changed;
    void getComputedStyle(element, '::before').transform;
    const pill = getComputedStyle(element, '::before');
    const duration = pill.transitionDuration;
    const pageDuration = getComputedStyle(document.body).transitionDuration;
    const canvasDuration = getComputedStyle(document.documentElement).transitionDuration;
    const samples: { x: number; background: string }[] = [];
    for (let frame = 0; frame < 20; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      samples.push({ x: new DOMMatrix(getComputedStyle(element, '::before').transform).m41,
        background: getComputedStyle(document.body).backgroundColor });
    }
    return { duration, samples,
      pageDuration, canvasDuration };
  });
  expect(motion.duration).toContain('0.24s'); expect(motion.pageDuration).toBe('0.24s');
  expect(motion.canvasDuration).toContain('0.24s');
  expect(motion.samples.some(sample => sample.x > 0 && sample.x < 32)).toBe(true);
  expect(motion.samples.some(sample => sample.background !== before && sample.background !== 'rgb(11, 13, 18)')).toBe(true);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 13, 18)');
  await expect.poll(() => theme.evaluate(element => new DOMMatrix(getComputedStyle(element, '::before').transform).m41)).toBe(32);
  await expect(page.locator('.flow-surface')).toHaveCSS('background-image', 'linear-gradient(135deg, rgb(28, 32, 41), rgb(28, 32, 41))');
  await theme.click(); await theme.click();
  await expect(theme).toBeChecked(); await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 13, 18)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await language.click();
  expect(await language.evaluate(element => getComputedStyle(element, '::before').transitionDuration)).toBe('0s');
  await theme.click();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(248, 250, 253)');
  await expect(page.locator('body')).toHaveCSS('transition-duration', '0s');
  await expect(page.locator('.dark-spotlight')).toHaveCSS('display', 'none');
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} ambient light follows the pointer, stays clipped below controls and fits responsive canvases`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('/app');
    const graph = page.getByRole('region', { name: 'Workflow graph', exact: true });
    const light = graph.locator('.dark-spotlight');
    await expect(light).toHaveAttribute('aria-hidden', 'true');
    await expect(light).toHaveCSS('pointer-events', 'none');
    await expect(light).toHaveCSS('z-index', '0');
    for (const width of [1440, 1024, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 900 }); await graph.scrollIntoViewIfNeeded();
      const box = (await graph.boundingBox())!;
      const destination = { x: box.x + box.width * .7, y: box.y + 110 };
      await page.mouse.move(box.x + box.width * .3, box.y + 90);
      await page.mouse.move(destination.x, destination.y, { steps: 8 });
      await expect(light).toHaveAttribute('data-visible', 'true');
      await expect(light).toHaveCSS('opacity', theme === 'dark' ? '1' : '0.2');
      await expect.poll(async () => light.evaluate((element, point) => {
        const box = element.getBoundingClientRect();
        return Math.abs(box.x + box.width / 2 - point.x) + Math.abs(box.y + box.height / 2 - point.y);
      }, destination)).toBeLessThan(1);
      expect(await light.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('255, 255, 255');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(await graph.evaluate(element => getComputedStyle(element.querySelector('.react-flow')!).overflow)).toBe('hidden');
      await expect(graph.locator('.canvas-navigator')).toBeVisible();
      await expect(graph.locator('.canvas-primary-action')).toBeVisible();
      if (width === 1440 || width === 320) await page.screenshot({ path: `.tmp/ux007-settings-spotlight-${theme}-${width}.png`, fullPage: true });
    }
    await page.mouse.move(0, 0); await expect(light).not.toHaveAttribute('data-visible');
    await page.emulateMedia({ forcedColors: 'active' }); await expect(light).toHaveCSS('display', 'none');
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' }); await expect(light).toHaveCSS('display', 'none');
  });

  test(`${theme} spotlight preserves canvas cursors, editing, dragging and lifecycle geometry`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installSupplyWallet(page); await page.goto('/app');
    await page.getByRole('button', { name: 'Add supply', exact: true }).click(); await configureCanvasAction(page, '1');
    const graph = page.getByRole('region', { name: 'Workflow graph', exact: true });
    const canvas = page.getByRole('region', { name: 'Workflow canvas', exact: true });
    const cursorStyles = () => graph.evaluate(element => ['.react-flow__pane', '.react-flow__node', 'input', 'button', '.react-flow__handle']
      .map(selector => { const target = element.querySelector(selector); return target ? getComputedStyle(target).cursor : null; }));
    const cursors = await cursorStyles(); const geometry = await canvas.boundingBox();
    expect(cursors[0]).toContain(`/brand/flofi-mascot-cursor${theme === 'dark' ? '-dark' : ''}.png`);
    expect(cursors[0]).toContain('29 3, default');
    const cursorAsset = await page.evaluate(async value => {
      const image = new Image(); image.src = `/brand/flofi-mascot-cursor${value === 'dark' ? '-dark' : ''}.png`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      const alpha = Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data).filter((_, index) => index % 4 === 3);
      return { width: image.naturalWidth, height: image.naturalHeight, transparent: alpha.includes(0), visible: alpha.includes(255) };
    }, theme);
    expect(cursorAsset).toEqual({ width: 32, height: 32, transparent: true, visible: true });
    const primary = await graph.locator('.canvas-primary-action').boundingBox();
    const revision = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
    const viewport = await graph.locator('.react-flow__viewport').getAttribute('style');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const box = (await graph.boundingBox())!;
    await page.mouse.move(box.x + box.width - 80, box.y + 100, { steps: 8 });
    await expect(graph.locator('.dark-spotlight')).toHaveAttribute('data-visible', 'true');
    expect(await cursorStyles()).toEqual(cursors);
    expect(cursors[2]).toBe('text'); expect(cursors[3]).toBe('pointer');
    expect(await graph.locator('.react-flow__viewport').getAttribute('style')).toBe(viewport);
    // The idle symbol yields to the existing middle-button canvas pan cursor.
    await page.mouse.down({ button: 'middle' }); await page.mouse.move(box.x + box.width - 65, box.y + 112, { steps: 3 });
    await expect(graph.locator('.react-flow__pane')).toHaveCSS('cursor', 'grabbing'); await page.mouse.up({ button: 'middle' });
    await expect(graph.locator('.react-flow__pane')).toHaveCSS('cursor', cursors[0]!);
    const amount = graph.getByRole('textbox').first(); await amount.click(); await expect(amount).toBeFocused(); await expect(amount).toHaveValue('1');
    const drag = graph.locator('.composer-action-title').first();
    const node = graph.locator('.react-flow__node').first(); const oldPosition = (await node.boundingBox())!;
    const dragBox = (await drag.boundingBox())!;
    await page.mouse.move(dragBox.x + 12, dragBox.y + 12); await page.mouse.down();
    await page.mouse.move(dragBox.x + 42, dragBox.y + 27, { steps: 5 });
    await expect(node).toHaveCSS('cursor', 'grabbing'); await page.mouse.up();
    await expect.poll(async () => (await node.boundingBox())!.x - oldPosition.x).toBeGreaterThan(15);
    await expect(node).toHaveCSS('cursor', 'grab');
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
    expect(await canvas.boundingBox()).toEqual(geometry); expect(await graph.locator('.canvas-primary-action').boundingBox()).toEqual(primary);
    for (const stage of ['Simulate', 'Execute'] as const) {
      await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: stage, exact: true }).click();
      const preview = page.locator('main .canvas').first();
      expect(await preview.boundingBox()).toEqual(geometry);
      await expect(preview.locator('.dark-spotlight')).toHaveCount(1);
      await expect(preview.locator('.react-flow__pane')).toHaveCSS('cursor', cursors[0]!);
      await expect(preview.locator('.canvas-empty-mascot')).toHaveCount(0);
    }
  });
}
