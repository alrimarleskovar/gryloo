// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, applyPendingProposal } from './fixtures';
import { selectSettingsTheme } from './settings-fixtures';
import type { Locator } from '@playwright/test';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';

type Box = { x: number; y: number; width: number; height: number };
const right = (box: Box) => box.x + box.width;
const bottom = (box: Box) => box.y + box.height;
function sameBox(actual: Box, reference: Box) {
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(actual[key], JSON.stringify({ key, actual, reference })).toBeCloseTo(reference[key], 1);
}
async function geometry(canvas: Locator) {
  return canvas.evaluate(element => {
    const rect = (el: Element) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    };
    const action = element.querySelector('.canvas-primary-action')!;
    const buttons = [...action.querySelectorAll('button')];
    return {
      canvas: rect(element), header: rect(element.querySelector('.canvas-head')!),
      surface: rect(element.querySelector('.flow-surface')!), footer: rect(element.querySelector('.canvas-foot')!),
      controls: rect(element.querySelector('.canvas-navigator')!),
      primary: rect(buttons.at(-1)!), secondary: buttons.length > 1 ? rect(buttons[0]!) : null,
      radius: getComputedStyle(element).borderRadius,
    };
  });
}

for (const theme of ['Light', 'Dark'] as const) for (const layout of ['standard', 'floating', 'lending'] as const) {
  test(`${theme} ${layout} workspace keeps Build geometry, CTA anchors and controls through lifecycle stages`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await installSupplyWallet(page); await page.goto('/app');
    await expect(page.locator('.build009-wallet-info')).toBeVisible();
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await settings.click();
    await selectSettingsTheme(page, theme);
    await settings.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
    if (layout === 'lending') {
      await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
      await applyPendingProposal(page);
    } else {
      await page.getByRole('button', { name: 'Add supply', exact: true }).click();
      await configureCanvasAction(page, '1');
    }
    if (layout === 'floating') {
      await page.getByRole('button', { name: 'Undock toolbar', exact: true }).click();
      await expect(page.locator('main')).toHaveAttribute('data-workspace-toolbox', 'floating');
    }
    const nav = page.getByRole('navigation', { name: 'Workflow stages' });
    const canvas = page.locator('main :is(.build-grid,.simulate-workspace-grid,.execute-workspace-grid) > .canvas').first();
    const graph = canvas.locator('.flow-surface');
    const wallet = page.getByRole('group', { name: 'Wallet connection', exact: true });
    const walletText = await wallet.innerText();
    const environment = page.getByRole('combobox', { name: 'Environment', exact: true });
    const environmentValue = await environment.innerText();
    const measurements = [];
    for (const width of [1440, 1024, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await nav.getByRole('button', { name: 'Build', exact: true }).click();
      await expect(canvas).toBeVisible();
      const expectedHeight = layout === 'floating' ? 760 : layout === 'lending' || width <= 800 ? 820 : 590;
      await expect(canvas).toHaveCSS('height', `${expectedHeight}px`);
      await page.evaluate(() => window.scrollTo(0, 0));
      const reference = await geometry(canvas);
      expect(reference.canvas.height).toBe(expectedHeight);
      await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
      const buildAmounts = await graph.locator('.composer-card input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
      for (const stage of ['Build', 'Simulate', 'Execute'] as const) {
        if (stage === 'Simulate') await graph.getByRole('button', { name: 'Simulate fees', exact: true }).click();
        if (stage === 'Execute') await nav.getByRole('button', { name: stage, exact: true }).click();
        await expect(nav.getByRole('button', { name: stage, exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(canvas).toBeVisible();
        if (stage !== 'Build') {
          await expect(graph).toHaveAttribute('data-viewport', 'fitted');
          await expect(graph.locator('.composer-card input, .composer-card select, .composer-card button')).toHaveCount(0);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        const actual = await geometry(canvas);
        for (const part of ['canvas', 'header', 'surface', 'footer', 'controls'] as const) sameBox(actual[part], reference[part]);
        expect(actual.radius).toBe(reference.radius);
        expect(right(actual.primary)).toBeCloseTo(right(reference.primary), 1);
        expect(bottom(actual.primary)).toBeCloseTo(bottom(reference.primary), 1);
        expect(actual.primary.height).toBe(reference.primary.height);
        expect(right(actual.surface) - right(actual.primary)).toBeCloseTo(12, 1);
        expect(bottom(actual.surface) - bottom(actual.primary)).toBeCloseTo(24, 1);
        expect(right(actual.controls) <= actual.primary.x || bottom(actual.controls) <= actual.primary.y).toBe(true);
        expect(actual.controls.x + actual.controls.width / 2).toBeCloseTo(actual.surface.x + actual.surface.width / 2, 1);
        expect(actual.controls.y).toBeGreaterThan(actual.surface.y);
        expect(actual.primary.x).toBeGreaterThanOrEqual(actual.surface.x);
        if (stage !== 'Build') {
          expect(actual.secondary).not.toBeNull();
          expect(actual.primary.x - right(actual.secondary!)).toBeCloseTo(8, 1);
          expect(actual.secondary!.y).toBe(actual.primary.y);
          await expect(graph.getByRole('button', { name: stage === 'Execute' ? 'Execute workflow' : 'Simulate workflow', exact: true })).toBeVisible();
          if (stage === 'Execute') await expect(graph.getByRole('button', { name: 'Execute workflow', exact: true })).toBeDisabled();
        }
        expect(await wallet.innerText()).toBe(walletText);
        await expect(environment).toHaveText(environmentValue);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const controls = graph.locator('.canvas-navigator');
        const transform = () => graph.locator('.react-flow__viewport').getAttribute('style');
        const before = await transform();
        await controls.getByRole('slider', { name: 'Canvas zoom' }).press('ArrowLeft');
        await expect.poll(transform).not.toBe(before);
        const zoomedOut = await transform();
        await controls.getByRole('slider', { name: 'Canvas zoom' }).press('ArrowRight');
        await expect.poll(transform).not.toBe(zoomedOut);
        await controls.getByRole('button', { name: 'Fit workflow', exact: true }).click();
        await expect(graph.locator('.composer-card').first()).toBeInViewport();
        measurements.push({ width, stage, ...actual });
        if (layout === 'standard' && (width === 1440 || width === 320)) {
          await canvas.screenshot({ path: `.tmp/ux007-team1-${stage.toLowerCase()}-${theme.toLowerCase()}-${width}.png` });
        }
      }
      await graph.getByRole('button', { name: 'Back to Build', exact: true }).click();
      await expect(nav.getByRole('button', { name: 'Build', exact: true })).toHaveAttribute('aria-current', 'page');
      expect(await graph.locator('.composer-card input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))).toEqual(buildAmounts);
      await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
      if (layout === 'floating') await expect(graph.locator('.floating-toolbox')).toBeVisible();
    }
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign/i.test(request.method)))).toEqual([]);
    await testInfo.attach('workspace-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  });
}
