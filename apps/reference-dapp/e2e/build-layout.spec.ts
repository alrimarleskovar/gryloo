// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';

test('Build places the existing assistant beside the canvas and selected settings below', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/');
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
  await expect(page.locator('.technical-authoring .copilot')).toHaveCount(0);
  await assistant.locator('.chat-form input').fill('explain');
  await assistant.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(assistant.locator('.message.you')).toHaveText('YOUexplain');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  const form = inspector.getByRole('form', { name: 'Edit Supply' });
  await expect(form.getByLabel('Supply amount (USDC)')).toHaveValue('1');
  await form.getByLabel('Supply amount (USDC)').fill('2');
  await form.getByRole('button', { name: 'Review Supply change', exact: true }).click();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await expect(canvas.locator('.numeric')).toContainText('2 USDC');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '2');
});

test('Build keeps existing toolbar actions and zoom behavior at their new positions', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Undock toolbar', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Workflow graph', exact: true });
  const toolbar = graph.locator('.floating-toolbox');
  await expect(toolbar).toBeVisible();
  const graphBox = (await graph.boundingBox())!;
  const toolbarBox = (await toolbar.boundingBox())!;
  expect(toolbarBox.x - graphBox.x).toBe(8);
  await toolbar.getByRole('button', { name: 'Add supply', exact: true }).click();
  await expect(graph.locator('.flow-card')).toHaveCount(1);
  const controls = graph.locator('.react-flow__controls');
  const currentGraphBox = (await graph.boundingBox())!;
  const controlsBox = (await controls.boundingBox())!;
  expect(Math.abs(currentGraphBox.x + currentGraphBox.width - controlsBox.x - controlsBox.width - 12)).toBeLessThan(1);
  expect(Math.abs(currentGraphBox.y + currentGraphBox.height - controlsBox.y - controlsBox.height - 12)).toBeLessThan(1);
  const nodeBox = (await graph.locator('.flow-card').boundingBox())!;
  expect(controlsBox.x >= nodeBox.x + nodeBox.width || controlsBox.y >= nodeBox.y + nodeBox.height ||
    controlsBox.x + controlsBox.width <= nodeBox.x || controlsBox.y + controlsBox.height <= nodeBox.y).toBe(true);
  const transform = () => graph.locator('.react-flow__viewport').getAttribute('style');
  const before = await transform();
  await controls.locator('.react-flow__controls-zoomout').click();
  await expect.poll(transform).not.toBe(before);
  const zoomedOut = await transform();
  await controls.locator('.react-flow__controls-zoomin').click();
  await expect.poll(transform).not.toBe(zoomedOut);
  await controls.locator('.react-flow__controls-fitview').click();
  await expect(graph.locator('.flow-card')).toBeInViewport();
  await page.getByRole('button', { name: 'Dock toolbar', exact: true }).click();
  await expect(graph.locator('.floating-toolbox')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
