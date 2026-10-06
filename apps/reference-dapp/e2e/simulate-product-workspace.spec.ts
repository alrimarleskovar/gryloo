// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { configureCanvasAction } from './composer-authoring-fixtures';

const graph = (page: Page) => page.getByRole('region', { name: 'Simulation workflow graph', exact: true });
const summary = (page: Page) => page.getByRole('complementary', { name: 'Simulation Summary', exact: true });
const row = (page: Page, name: string) => summary(page).locator('.simulation-summary-values > div').filter({ has: page.getByText(name, { exact: true }) }).locator('dd');
const cardStyle = (card: Locator) => card.evaluate(element => {
  const style = getComputedStyle(element);
  return [style.width, style.padding, style.borderRadius, style.backgroundColor, style.fontFamily];
});
const brandIcons = (surface: Locator) => surface.locator('img.brand-icon').evaluateAll(images => images.map(image => ({
  source: image.getAttribute('src'), filter: getComputedStyle(image).filter,
})));

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = []; browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(chain => {
    const requests: string[] = [];
    Object.assign(window, { simulationWalletRequests: requests, ethereum: {
      isMetaMask: true,
      async request({ method }: { method: string }) {
        requests.push(method);
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
        if (method === 'eth_chainId') return chain;
        throw new Error(`Unexpected wallet request: ${method}`);
      }, on() {}, removeListener() {},
    } });
  }, testInfo.title.includes('mocked diagnostics') ? '0x2105' : '0x14a34');
  await page.goto('/');
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { simulationWalletRequests: string[] }).simulationWalletRequests.filter(method => /sign|send/i.test(method)))).toEqual([]);
});

test('current workflow, read-only cards, honest summary and Back to Build', async ({ page }) => {
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '2.5');
  await page.getByRole('button', { name: 'Rename workflow', exact: true }).click();
  await page.getByRole('textbox', { name: 'Workflow name' }).fill('Carry Strategy');
  await page.getByRole('textbox', { name: 'Workflow name' }).press('Enter');
  const buildCard = page.locator('.build-flow-surface .composer-card');
  const style = await cardStyle(buildCard);
  const icons = await brandIcons(buildCard);
  const revision = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
  await expect(graph(page)).toHaveAttribute('data-viewport', 'fitted');
  await expect(page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);
  const review = page.getByRole('region', { name: 'Review & Authorization', exact: true });
  await expect(page.getByRole('region', { name: 'Workflow simulation workspace', exact: true }).locator('#simulation-review')).toHaveCount(1);
  await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toHaveCount(0);
  await expect(review.getByText(/Run a valid simulation/).first()).toBeVisible();

  await expect(page.locator('.simulation-workflow-canvas h2')).toHaveText('Carry Strategy');
  const card = graph(page).locator('.composer-card');
  expect(await cardStyle(card)).toEqual(style);
  expect(await brandIcons(card)).toEqual(icons);
  await expect(card.locator('.composer-amount')).toHaveText('2.5 USDC');
  await expect(card.locator('.composer-destination-box')).toHaveText('— WETH');
  await expect(card.locator('button, input, select, textarea, form')).toHaveCount(0);
  await expect(page.locator('.simulate-workspace-grid .canvas-toolbox')).toHaveCount(0);
  expect(await page.getByRole('main').innerText()).not.toMatch(/mock|synthetic|debug|read-only observation|technical output|artifact empty|canonical revision/i);
  await expect(summary(page).getByRole('region', { name: 'Fees', exact: true }).locator('.simulation-empty-value')).toHaveText('—');
  await expect(summary(page).locator('.simulation-route strong')).toHaveText('—');
  await expect(row(page, 'Price impact')).toHaveText('—');
  await expect(row(page, 'Slippage')).toContainText('Configured limit');
  await expect(row(page, 'Workflow network')).toHaveText('Base Sepolia');
  await expect(summary(page).getByRole('button', { name: 'Review swap', exact: true })).toHaveCount(0);
  const canvasBox = (await graph(page).boundingBox())!;
  expect((await summary(page).boundingBox())!.x).toBeGreaterThan(canvasBox.x + canvasBox.width);
  const position = await graph(page).locator('.react-flow__node').getAttribute('style');
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 25); await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 60, { steps: 6 }); await page.mouse.up();
  await page.keyboard.press('Delete'); await page.keyboard.press('Control+z');
  await expect(graph(page).locator('.react-flow__node')).toHaveAttribute('style', position!);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revision!);
  await graph(page).getByRole('button', { name: 'Back to Build', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Build', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(buildCard.getByRole('button', { name: 'Advanced Settings', exact: true })).toBeVisible();
  expect(await cardStyle(buildCard)).toEqual(style);
  await expect(buildCard.getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('2.5');
});

test('light/dark reuse Build surfaces and preserve token/network brand colors', async ({ page }) => {
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '1');
  const backgrounds: string[] = [];
  for (const theme of ['Dark', 'Light']) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: `${theme} theme`, exact: true }).click();
    await page.keyboard.press('Escape');
    const buildCard = page.locator('.build-flow-surface .composer-card');
    const style = await cardStyle(buildCard), icons = await brandIcons(buildCard);
    await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
    await expect(graph(page)).toHaveAttribute('data-viewport', 'fitted');
    expect(await cardStyle(graph(page).locator('.composer-card'))).toEqual(style);
    expect(await brandIcons(graph(page))).toEqual(icons);
    expect(icons.every(icon => icon.filter === 'none')).toBe(true);
    const review = page.getByRole('region', { name: 'Review & Authorization', exact: true });
    await expect(review).toBeVisible();
    await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toHaveCount(0);
    expect(await review.evaluate(element => getComputedStyle(element).color)).toBe(await summary(page).evaluate(element => getComputedStyle(element).color));
    await expect(page.getByRole('main').locator('.simulate-workspace > details')).toHaveCount(1);
    await expect(page.getByRole('main').getByText('View technical details', { exact: true })).toHaveCount(1);
    await expect(graph(page).getByRole('button', { name: 'Simulate workflow', exact: true })).toBeVisible();
    for (const width of [1280, 1024, 820]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(graph(page)).toHaveAttribute('data-viewport', 'fitted');
      const canvasBox = (await graph(page).boundingBox())!;
      const actionsBox = (await graph(page).locator('.simulation-canvas-actions').boundingBox())!;
      const controlsBox = (await graph(page).locator('.react-flow__controls').boundingBox())!;
      const cardBox = (await graph(page).locator('.composer-card').boundingBox())!;
      await expect(graph(page).locator('.simulation-workspace-actions button')).toHaveText(['Back to Build', 'Simulate workflow']);
      const backBox = (await graph(page).getByRole('button', { name: 'Back to Build', exact: true }).boundingBox())!;
      const simulateBox = (await graph(page).getByRole('button', { name: 'Simulate workflow', exact: true }).boundingBox())!;
      expect(backBox.x + backBox.width + 7).toBeLessThanOrEqual(simulateBox.x);
      expect(backBox.y).toBeCloseTo(simulateBox.y);
      await expect(summary(page).getByRole('button', { name: 'Back to Build', exact: true })).toHaveCount(0);
      expect(actionsBox.x).toBeGreaterThan(canvasBox.x);
      expect(actionsBox.y).toBeGreaterThan(canvasBox.y);
      expect(canvasBox.x + canvasBox.width - actionsBox.x - actionsBox.width).toBeGreaterThanOrEqual(60);
      expect(canvasBox.y + canvasBox.height - actionsBox.y - actionsBox.height).toBeGreaterThanOrEqual(16);
      expect(actionsBox.x + actionsBox.width + 8).toBeLessThanOrEqual(controlsBox.x);
      expect(cardBox.y + cardBox.height + 8).toBeLessThanOrEqual(actionsBox.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await summary(page).locator('.simulation-summary-content').evaluate(element => getComputedStyle(element).overflowY)).toBe('visible');
      for (const container of [summary(page), review]) expect(await container.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    backgrounds.push(await summary(page).evaluate(element => getComputedStyle(element).backgroundColor));
    await page.screenshot({ path: `.tmp/ux004d-${theme.toLowerCase()}.png`, fullPage: true });
    await graph(page).getByRole('button', { name: 'Back to Build', exact: true }).click();
  }
  expect(backgrounds[0]).not.toBe(backgrounds[1]);
});

test('lending links, zoom in/out and fit remain usable on desktop and mobile', async ({ page }) => {
  await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  const positions = await page.locator('.build-flow-surface .react-flow__node').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform));
  await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
  await expect(graph(page).locator('.react-flow__edge')).toHaveCount(2);
  await expect(summary(page).getByRole('button', { name: 'Review lending composition', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Simulate lending composition', exact: true })).toBeHidden();
  await page.locator('.simulation-technical > summary').click();
  await expect(page.getByRole('button', { name: 'Simulate lending composition', exact: true })).toBeVisible();
  await page.locator('.simulation-technical > summary').click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(graph(page)).toHaveAttribute('data-viewport', 'fitted');
    const viewport = graph(page).locator('.react-flow__viewport');
    const original = await viewport.getAttribute('style');
    await graph(page).locator('.react-flow__controls-zoomin').click();
    await expect(viewport).not.toHaveAttribute('style', original!);
    const zoomed = await viewport.getAttribute('style');
    await graph(page).locator('.react-flow__controls-zoomout').click();
    await expect(viewport).not.toHaveAttribute('style', zoomed!);
    await graph(page).locator('.react-flow__controls-fitview').click();
    expect(await graph(page).locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).style.transform))).toEqual(positions);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('empty workflow stays empty and mocked diagnostics never fill the primary summary', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(graph(page).locator('.react-flow__node')).toHaveCount(0);
  for (const name of ['Slippage', 'Price impact', 'Workflow network']) await expect(row(page, name)).toHaveText('—');
  for (const name of ['Fees', 'Route', 'Expected result']) await expect(summary(page).getByRole('region', { name, exact: true }).locator('.simulation-empty-value')).toHaveText('—');
  await graph(page).getByRole('button', { name: 'Back to Build', exact: true }).click();
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '1');
  await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
  await page.locator('.simulation-technical > summary').click();
  await page.getByRole('button', { name: 'Generate mocked artifacts for revision 1', exact: true }).click();
  await expect(page.locator('.simulate-swap')).toBeVisible();
  await page.locator('.simulation-technical > summary').click();
  await expect(summary(page).getByRole('region', { name: 'Fees', exact: true }).locator('.simulation-empty-value')).toHaveText('—');
  await expect(summary(page).locator('.simulation-route strong')).toHaveText('—');
  await expect(row(page, 'Price impact')).toHaveText('—');
  await expect(graph(page).locator('[data-mocked-value]')).toHaveCount(0);
  await expect(summary(page).getByRole('button', { name: 'Review swap', exact: true })).toHaveCount(0);
});


test('simulation failures remain blocking and readable in both themes', async ({ page }) => {
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  await configureCanvasAction(page, '1');
  await page.getByRole('button', { name: 'Simular Fees', exact: true }).click();
  await graph(page).getByRole('button', { name: 'Simulate workflow', exact: true }).click();
  await expect(summary(page).getByRole('status')).toContainText(/Simulation failed|Simulation unavailable|Cannot proceed/);
  for (const theme of ['Dark', 'Light']) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: `${theme} theme`, exact: true }).click();
    await page.keyboard.press('Escape');
    const attention = summary(page).getByRole('region', { name: 'Risk and attention', exact: true });
    await expect(attention).toContainText('Blocking');
    expect(await summary(page).innerText()).not.toMatch(/_[A-Z]+|stack|canonical|artifact|undefined|null|mock|not implemented|unsupported/i);
    await expect(summary(page).getByRole('button', { name: 'Review Supply', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Review & Authorization', exact: true }).getByRole('button', { name: 'Approve & Continue', exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(await summary(page).locator('img.brand-icon').evaluateAll(images => images.every(image => getComputedStyle(image).filter === 'none'))).toBe(true);
  }
});
