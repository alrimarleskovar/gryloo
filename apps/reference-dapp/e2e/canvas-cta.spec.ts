// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';

test('Build CTA floats inside the wider canvas without colliding with existing controls', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  const canvas = page.getByRole('region', { name: 'Workflow canvas', exact: true });
  const graph = page.getByRole('region', { name: 'Workflow graph', exact: true });
  const cta = graph.getByRole('button', { name: 'Simular Fees', exact: true });
  await expect(page.getByRole('button', { name: 'Continue to Simulate', exact: true })).toHaveCount(0);
  await expect(page.locator('.summary-bar button')).toHaveCount(0);
  for (const floating of [false, true]) {
    if (floating) await page.getByRole('button', { name: 'Undock toolbar', exact: true }).click();
    for (const width of [1920, 1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(cta).toBeVisible();
      const graphBox = (await graph.boundingBox())!;
      const ctaBox = (await cta.boundingBox())!;
      const controlsBox = (await graph.locator('.canvas-navigator').boundingBox())!;
      expect(Math.abs(graphBox.y + graphBox.height - ctaBox.y - ctaBox.height - 24)).toBeLessThan(1);
      expect(Math.abs(graphBox.x + graphBox.width - ctaBox.x - ctaBox.width - 12)).toBeLessThan(1);
      expect(ctaBox.x).toBeGreaterThanOrEqual(graphBox.x);
      expect(controlsBox.x + controlsBox.width <= ctaBox.x || controlsBox.y + controlsBox.height <= ctaBox.y).toBe(true);
      expect(controlsBox.y).toBeGreaterThan(graphBox.y);
      expect((await canvas.boundingBox())!.height).toBe(floating ? 680 : 590);
      const nodeBox = (await graph.locator('.flow-card').boundingBox())!;
      expect(ctaBox.x >= nodeBox.x + nodeBox.width || ctaBox.y >= nodeBox.y + nodeBox.height ||
        ctaBox.x + ctaBox.width <= nodeBox.x || ctaBox.y + ctaBox.height <= nodeBox.y).toBe(true);
      if (floating) {
        const toolboxBox = (await graph.locator('.floating-toolbox').boundingBox())!;
        expect(ctaBox.x).toBeGreaterThanOrEqual(toolboxBox.x + toolboxBox.width);
      }
      if (width > 800) {
        expect(await page.locator('main').evaluate(element => getComputedStyle(element).paddingLeft)).toBe('20px');
        const assistantBox = (await page.getByRole('complementary', { name: 'Workflow assistant' }).boundingBox())!;
        expect(assistantBox.width).toBe(340);
        expect(assistantBox.x).toBeGreaterThanOrEqual((await canvas.boundingBox())!.x + (await canvas.boundingBox())!.width);
      }
      if (width === 1920) expect((await page.locator('main').boundingBox())!.width).toBe(1720);
      const inspectorBox = (await page.getByRole('region', { name: 'Action inspector' }).boundingBox())!;
      expect(inspectorBox.y).toBeGreaterThanOrEqual((await canvas.boundingBox())!.y + (await canvas.boundingBox())!.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => cta.evaluate(element => getComputedStyle(element).animationName)).toBe('build-cta-pulse');
  const pulse = await cta.evaluate(element => {
    const style = getComputedStyle(element);
    return { duration: parseFloat(style.animationDuration), timing: style.animationTimingFunction,
      opacity: style.opacity, transform: style.transform };
  });
  expect(pulse.duration).toBeGreaterThanOrEqual(3);
  expect(pulse.timing).toBe('ease-in-out');
  expect(pulse.opacity).toBe('1'); expect(pulse.transform).toBe('none');
  await cta.focus();
  await expect.poll(() => cta.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await cta.evaluate(element => element.blur());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => cta.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});

test('Simular Fees keeps the same navigation-only action and guarded Supply review', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  await configureCanvasAction(page, '1');
  await page.getByRole('region', { name: 'Workflow graph', exact: true }).getByRole('button', { name: 'Simular Fees', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Workflow stages' });
  await expect(nav.getByRole('button', { name: 'Simulate', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: 'Simulate Supply', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Simulation workflow graph', exact: true }).getByRole('button', { name: 'Review Supply', exact: true })).toBeDisabled();
  await expect(page.locator('.summary-bar button')).toHaveCount(0);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await expect(page.getByRole('button', { name: 'Simular Fees', exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Simular Fees', exact: true })).toBeVisible();
  await expect(page.locator('.flow-card.active')).toHaveCount(1);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
});
