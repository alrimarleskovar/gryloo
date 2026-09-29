// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function addFromToolbox(page: Page, action: string) {
  const before = await page.locator('.react-flow__node').count();
  await page.getByRole('button', { name: `Add ${action}` }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1);
  return page.locator('.react-flow__node').last();
}
async function connect(page: Page, source: string, target: string) {
  const from = await page.locator(`.react-flow__node[data-id="${source}"] .react-flow__handle-right`).boundingBox();
  const to = await page.locator(`.react-flow__node[data-id="${target}"] .react-flow__handle-left`).boundingBox();
  if (!from || !to) throw new Error('Connection handles missing');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
}
test('toolbox creates six typed actions, selects them, and keeps setup below the canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Workflow graph' })).toBeVisible();
  await expect(page.getByText('Advanced action setup', { exact: true })).toBeVisible();
  const grid = page.locator('.build-grid');
  await expect(grid.locator('.library')).toHaveCount(0);
  for (const action of ['swap', 'bridge', 'pool', 'supply', 'lending', 'borrow']) {
    const node = await addFromToolbox(page, action);
    await expect(node.locator('.flow-card')).toHaveClass(/active/);
    await expect(node).toContainText(action, { ignoreCase: true });
    if (action !== 'swap') await expect(node).toContainText('Template · no execution');
  }
  await expect(page.getByRole('button', { name: 'Connect Wallet' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Workflow graph' })).not.toContainText('BUILD /');
  await expect(page.locator('.top-bar')).not.toContainText('Base authoring · mock examples');
});
test('dragging updates stored layout, survives editor changes and Build navigation', async ({ page }) => {
  await page.goto('/');
  const node = await addFromToolbox(page, 'pool');
  const id = await node.getAttribute('data-id');
  const before = await node.boundingBox();
  if (!before || !id) throw new Error('New node missing');
  await page.mouse.move(before.x + 60, before.y + 55);
  await page.mouse.down();
  await page.mouse.move(before.x + 190, before.y + 130, { steps: 14 });
  await page.mouse.up();
  const after = await node.boundingBox();
  expect(after!.x).toBeGreaterThan(before.x + 80);
  const saved = await page.evaluate(id => JSON.parse(localStorage.getItem('gryloo:canvas:workflow-local') ?? '{}')[id], id);
  expect(saved.x).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Add supply' }).click();
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  const returned = page.locator(`.react-flow__node[data-id="${id}"]`);
  await expect(returned).toBeVisible();
  const position = await returned.evaluate(element => getComputedStyle(element).transform);
  expect(Number(position.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+, ([^,]+)/)?.[1])).toBeCloseTo(saved.x, 2);
});
test('node and edge selection, deletion, text entry and composition guards', async ({ page }) => {
  await page.goto('/');
  await addFromToolbox(page, 'pool');
  const second = page.locator('.react-flow__node[data-id="node-002"]');
  await second.locator('.flow-card').click();
  await expect(second.locator('.flow-card')).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(second.locator('.flow-card')).not.toHaveClass(/active/);
  await second.locator('.flow-card').click();
  const chat = page.locator('#mock-prompt');
  await chat.focus(); await page.keyboard.press('Delete');
  await expect(second).toBeVisible();
  await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, isComposing: true })); });
  await expect(second).toBeVisible();
  await second.locator('.flow-card').click(); await page.keyboard.press('Backspace');
  await expect(second).toHaveCount(0);
  await page.locator('.react-flow__node[data-id="node-001"] .flow-card').click(); await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.getByText('This step is required by another step or is protected.')).toBeVisible();
  const replacement = await addFromToolbox(page, 'pool');
  const targetId = await replacement.getAttribute('data-id');
  if (!targetId) throw new Error('Replacement node missing');
  await connect(page, 'node-001', targetId);
  const edge = page.locator('.react-flow__edge').first();
  await edge.locator('.react-flow__edge-interaction').click({ force: true });
  await expect(edge).toHaveClass(/selected/);
  await page.keyboard.press('Delete');
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
});
test('selected template parameters edit shared IR', async ({ page }) => {
  await page.goto('/');
  await addFromToolbox(page, 'supply');
  await page.getByLabel('Sample amount').fill('2500000');
  await page.getByRole('button', { name: 'Save parameter' }).click();
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('2500000 sample units');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="node-002"]')).toContainText('2500000 sample units');
});
