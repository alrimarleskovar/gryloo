// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { openCanvasSettings } from './composer-authoring-fixtures';

test('Build places the existing assistant beside the canvas and selected settings below', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/app');
  const canvas = page.getByRole('region', { name: 'Workflow canvas', exact: true });
  const assistant = page.getByRole('complementary', { name: 'Workflow assistant' });
  const inspector = page.getByRole('region', { name: 'Action inspector' });
  await expect(assistant).toBeVisible();
  const canvasBox = (await canvas.boundingBox())!;
  const assistantBox = (await assistant.boundingBox())!;
  const inspectorBox = (await inspector.boundingBox())!;
  expect(assistantBox.x).toBeGreaterThanOrEqual(canvasBox.x + canvasBox.width);
  expect(assistantBox.y).toBe(canvasBox.y);
  expect(assistantBox.width).toBeLessThan(canvasBox.width);
  expect(inspectorBox.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height);
  expect(inspectorBox.width).toBeGreaterThan(canvasBox.width);
  await expect(page.locator('.library .copilot')).toHaveCount(0);
  await expect(page.getByText('Technical authoring tools', { exact: true })).toHaveCount(0);
  await assistant.locator('.chat-form input').fill('explain');
  await assistant.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(assistant.locator('.message.you')).toHaveText('YOUexplain');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  await expect(inspector.locator('.inspector-body')).toBeHidden();
  await openCanvasSettings(page);
  const form = inspector.getByRole('form', { name: 'Configure Supply' });
  await expect(form.getByLabel('Source amount (USDC)')).toHaveValue('0');
  await form.getByLabel('Source amount (USDC)').fill('2');
  await canvas.getByRole('button', { name: 'Review Supply change', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await expect(canvas.getByRole('textbox', { name: 'Source amount (USDC)', exact: true })).toHaveValue('2');
  await expect(canvas.locator('.composer-amount-token')).toHaveText('USDC');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
});

test('Build keeps existing toolbar actions and zoom behavior at their new positions', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/app');
  await page.getByRole('button', { name: 'Undock toolbar', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Workflow graph', exact: true });
  const toolbar = graph.locator('.floating-toolbox');
  await expect(toolbar).toBeVisible();
  const buttonLabels = ['Add swap', 'Add bridge', 'Add pool', 'Add supply', 'Add Supply → Borrow → Swap', 'Add borrow', 'Add repay', 'Add withdraw', 'Stocks', 'Privacy', 'Duplicate selection', 'Undo', 'Redo', 'Delete'];
  expect(await toolbar.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(buttonLabels);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual((await graph.boundingBox())!.height - 16);
    expect((await toolbar.boundingBox())!.width).toBe(52);
    expect(await toolbar.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
    expect((await page.getByRole('region', { name: 'Workflow canvas', exact: true }).boundingBox())!.height).toBe(760);
    for (const button of await toolbar.getByRole('button').all()) {
      const buttonBox = (await button.boundingBox())!;
      const iconBox = (await button.locator('svg').boundingBox())!;
      expect(Math.abs(buttonBox.x + buttonBox.width / 2 - iconBox.x - iconBox.width / 2)).toBeLessThan(1);
    }
    const lastButton = (await toolbar.getByRole('button', { name: 'Delete', exact: true }).boundingBox())!;
    const toolboxBox = (await toolbar.boundingBox())!;
    expect(lastButton.y + lastButton.height).toBeLessThanOrEqual(toolboxBox.y + toolboxBox.height);
    if (width === 1440) {
      expect((await page.getByRole('complementary', { name: 'Workflow assistant' }).boundingBox())!.height).toBe(760);
      const canvasBox = (await page.getByRole('region', { name: 'Workflow canvas', exact: true }).boundingBox())!;
      for (const section of [page.getByRole('region', { name: 'Action inspector', exact: true }), page.locator('details.library')])
        expect((await section.boundingBox())!.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const graphBox = (await graph.boundingBox())!;
  const toolbarBox = (await toolbar.boundingBox())!;
  expect(toolbarBox.x - graphBox.x).toBe(8);
  await toolbar.getByRole('button', { name: 'Add supply', exact: true }).click();
  await expect(graph.locator('.flow-card')).toHaveCount(1);
  const controls = graph.locator('.canvas-navigator');
  const currentGraphBox = (await graph.boundingBox())!;
  const controlsBox = (await controls.boundingBox())!;
  expect(controlsBox.x + controlsBox.width / 2).toBeCloseTo(currentGraphBox.x + currentGraphBox.width / 2, 1);
  expect(currentGraphBox.y + currentGraphBox.height - controlsBox.y - controlsBox.height).toBe(currentGraphBox.width < 800 ? 82 : 24);
  const nodeBox = (await graph.locator('.flow-card').boundingBox())!;
  expect(controlsBox.x >= nodeBox.x + nodeBox.width || controlsBox.y >= nodeBox.y + nodeBox.height ||
    controlsBox.x + controlsBox.width <= nodeBox.x || controlsBox.y + controlsBox.height <= nodeBox.y).toBe(true);
  const transform = () => graph.locator('.react-flow__viewport').getAttribute('style');
  const before = await transform();
  await controls.getByRole('slider', { name: 'Canvas zoom' }).press('ArrowLeft');
  await expect.poll(transform).not.toBe(before);
  const zoomedOut = await transform();
  await controls.getByRole('slider', { name: 'Canvas zoom' }).press('ArrowRight');
  await expect.poll(transform).not.toBe(zoomedOut);
  await controls.getByRole('button', { name: 'Fit workflow', exact: true }).click();
  await expect(graph.locator('.flow-card')).toBeInViewport();
  await page.getByRole('button', { name: 'Dock toolbar', exact: true }).click();
  await expect(graph.locator('.floating-toolbox')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
