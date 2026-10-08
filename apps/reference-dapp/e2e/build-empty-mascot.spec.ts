// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { selectSettingsTheme } from './settings-fixtures';
import type { Locator } from '@playwright/test';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
async function geometry(canvas: Locator) {
  return canvas.evaluate(element => {
    const rect = (el: Element) => { const { x, y, width, height } = el.getBoundingClientRect(); return { x, y, width, height }; };
    return {
      canvas: rect(element), header: rect(element.querySelector('.canvas-head')!),
      surface: rect(element.querySelector('.flow-surface')!), footer: rect(element.querySelector('.canvas-foot')!),
      cta: rect(element.querySelector('.canvas-primary-action button')!), controls: rect(element.querySelector('.canvas-navigator')!),
    };
  });
}

for (const theme of ['Light', 'Dark'] as const) {
  test(`${theme} empty Build shows decorative Aceno above copy without overflow or workspace changes`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await installSupplyWallet(page); await page.goto('/');
    await expect(page.locator('.build009-wallet-info')).toBeVisible();
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await settings.click(); await selectSettingsTheme(page, theme); await settings.press('Escape');
    const canvas = page.locator('.build-grid>.canvas'), empty = canvas.locator('.canvas-empty');
    const mascot = empty.locator('.canvas-empty-mascot');
    const image = mascot.locator(`.flofi-droplet-wave-${theme.toLowerCase()}`);
    await expect(mascot).toHaveAttribute('aria-hidden', 'true');
    await expect(image).toHaveAttribute('alt', ''); await expect(image).toHaveAttribute('draggable', 'false');
    await expect(image).toHaveAttribute('src', `/brand/flofi-droplet-wave${theme === 'Dark' ? '-dark' : ''}.svg`);
    await expect(image).toBeVisible(); await expect(mascot.getByRole('img')).toHaveCount(0);
    await expect(canvas.locator('.react-flow__node')).toHaveCount(0);
    await expect(empty.locator('.react-flow,button,input,[tabindex]')).toHaveCount(0);
    await expect(image).toHaveCSS('filter', 'none'); await expect(image).toHaveCSS('object-fit', 'contain');
    await expect(empty).toHaveCSS('pointer-events', 'none'); await expect(image).toHaveCSS('pointer-events', 'none');
    await page.evaluate(() => document.fonts.ready);
    expect(await empty.evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/^Outfit/);
    await expect(canvas.locator('.flow-surface')).toHaveCSS('background-image', theme === 'Dark'
      ? 'linear-gradient(135deg, rgb(28, 32, 41), rgb(28, 32, 41))'
      : 'linear-gradient(135deg, rgb(251, 253, 255), rgb(244, 248, 255))');
    const measurements = [];
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => window.scrollTo(0, 0));
      await image.evaluate(element => (element as HTMLImageElement).decode());
      const before = await geometry(canvas), box = (await image.boundingBox())!;
      const title = (await empty.locator('strong').boundingBox())!, helper = (await empty.locator('p').boundingBox())!;
      const illustrationHeight = width <= 480 ? 120 : 140;
      expect(box.width).toBe(illustrationHeight); expect(box.height).toBe(illustrationHeight);
      expect(box.x + box.width / 2).toBeCloseTo(before.surface.x + before.surface.width / 2, 1);
      expect(title.y).toBeGreaterThanOrEqual(box.y + box.height);
      // Source artwork ends at y=363 (including the foot stroke); the viewBox supplies the visual gap.
      const visualGap = title.y - (box.y + box.height * 363 / 400);
      expect(visualGap).toBeGreaterThanOrEqual(8); expect(visualGap).toBeLessThanOrEqual(16);
      expect(helper.y).toBeGreaterThan(title.y + title.height);
      for (const part of [box, title, helper]) {
        expect(part.x).toBeGreaterThanOrEqual(before.surface.x); expect(part.x + part.width).toBeLessThanOrEqual(before.surface.x + before.surface.width);
        expect(part.y).toBeGreaterThanOrEqual(before.surface.y); expect(part.y + part.height).toBeLessThanOrEqual(before.surface.y + before.surface.height);
        expect(overlap(part, before.controls)).toBe(false); expect(overlap(part, before.cta)).toBe(false);
      }
      expect(before.canvas.height).toBe(590);
      expect(before.surface.x + before.surface.width - before.cta.x - before.cta.width).toBeCloseTo(12, 1);
      expect(before.surface.y + before.surface.height - before.cta.y - before.cta.height).toBeCloseTo(24, 1);
      await empty.evaluate(element => (element as HTMLElement).style.display = 'none');
      expect(await geometry(canvas)).toEqual(before);
      await empty.evaluate(element => (element as HTMLElement).style.removeProperty('display'));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const target = await image.evaluate(element => {
        const rect = element.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.classList.contains('react-flow__pane');
      });
      expect(target).toBe(true);
      measurements.push({ width, ...before });
      await canvas.screenshot({ path: `.tmp/ux007-team4-empty-build-${theme.toLowerCase()}-${width}.png` });
    }
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
    expect(errors).toEqual([]);
    await testInfo.attach('empty-workspace-geometry', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  });

  test(`${theme} Aceno leaves canvas input intact and disappears from authored lifecycle previews`, async ({ page }) => {
    await installSupplyWallet(page); await page.goto('/'); await expect(page.locator('.build009-wallet-info')).toBeVisible();
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await settings.click(); await selectSettingsTheme(page, theme); await settings.press('Escape');
    const graph = page.getByRole('region', { name: 'Workflow graph', exact: true });
    const viewport = graph.locator('.react-flow__viewport'), transform = () => viewport.getAttribute('style');
    const mascotBox = (await graph.locator('.canvas-empty-mascot').boundingBox())!;
    const before = await transform();
    await page.mouse.move(mascotBox.x + mascotBox.width / 2, mascotBox.y + mascotBox.height / 2);
    await page.mouse.down({ button: 'middle' }); await page.mouse.move(mascotBox.x + mascotBox.width / 2 + 35, mascotBox.y + mascotBox.height / 2 + 20, { steps: 4 }); await page.mouse.up({ button: 'middle' });
    await expect.poll(transform).not.toBe(before);
    await expect(graph.locator('.react-flow__node')).toHaveCount(0);
    await expect(graph.locator('.canvas-empty-mascot')).toBeVisible();
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
    const panned = await transform(); await graph.getByRole('slider', { name: 'Canvas zoom' }).press('ArrowLeft'); await expect.poll(transform).not.toBe(panned);
    await page.getByRole('button', { name: 'Add supply', exact: true }).press('Enter');
    await expect(graph.locator('.canvas-empty')).toHaveCount(0); await expect(graph.locator('.canvas-empty-mascot')).toHaveCount(0);
    await expect(graph.locator('.react-flow__node')).toHaveCount(1);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(graph.locator('.canvas-empty-mascot')).toBeVisible();
    await page.getByRole('button', { name: 'Add supply', exact: true }).click(); await configureCanvasAction(page, '1');
    await expect(graph.locator('.canvas-empty')).toHaveCount(0); await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    await graph.getByRole('button', { name: 'Simulate fees', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.canvas-empty-mascot,img[src*="flofi-droplet-wave"]')).toHaveCount(0);
    await expect(page.locator('.simulate-flow-surface')).toHaveAttribute('data-viewport', 'fitted');
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(page.locator('.execute-workspace-grid')).toBeVisible();
    await expect(page.locator('.canvas-empty-mascot,img[src*="flofi-droplet-wave"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Back to Build', exact: true }).click();
    await expect(page.locator('.build-flow-surface .composer-card input').first()).toHaveValue('1');
    await expect(page.locator('.canvas-empty')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
  });

  test(`${theme} floating empty Build keeps the welcome group clear of toolbar and controls`, async ({ page }) => {
    await installSupplyWallet(page); await page.goto('/'); await expect(page.locator('.build009-wallet-info')).toBeVisible();
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await settings.click(); await selectSettingsTheme(page, theme); await settings.press('Escape');
    await page.getByRole('button', { name: 'Undock toolbar', exact: true }).click();
    const canvas = page.locator('.build-grid>.canvas');
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const toolbar = (await canvas.locator('.floating-toolbox').boundingBox())!, layout = await geometry(canvas);
      for (const item of ['.canvas-empty-mascot', '.canvas-empty strong', '.canvas-empty p']) {
        const box = (await canvas.locator(item).boundingBox())!;
        expect(overlap(box, toolbar)).toBe(false); expect(overlap(box, layout.controls)).toBe(false); expect(overlap(box, layout.cta)).toBe(false);
      }
      expect(layout.canvas.height).toBe(760);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 320 || width === 1440) await canvas.screenshot({ path: `.tmp/ux007-team4-empty-floating-${theme.toLowerCase()}-${width}.png` });
    }
  });
}
