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
  const revisionBeforeDrag = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  const id = await node.getAttribute('data-id');
  const before = await node.boundingBox();
  if (!before || !id) throw new Error('New node missing');
  await page.mouse.move(before.x + 60, before.y + 55);
  await page.mouse.down();
  await page.mouse.move(before.x + 190, before.y + 130, { steps: 14 });
  await page.mouse.up();
  const after = await node.boundingBox();
  expect(after!.x).toBeGreaterThan(before.x + 80);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revisionBeforeDrag!);
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

test('toolbox mode is presentation-only and persists across Build navigation', async ({ page }) => {
  await page.goto('/');
  const graph = page.getByRole('region', { name: 'Workflow graph' });
  const original = await graph.locator('.react-flow__node').first().textContent();
  const revisionBeforeSwitch = await page.locator('.summary-bar').getAttribute('data-workflow-revision');
  await expect(page.getByLabel('Toolbox position')).toHaveValue('top');
  await page.getByLabel('Toolbox position').selectOption('floating');
  await expect(graph.locator('.floating-toolbox')).toBeVisible();
  await expect(graph.getByRole('button', { name: 'Add swap' })).toBeVisible();
  await expect(graph.locator('.react-flow__node').first()).toHaveText(original!);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', revisionBeforeSwitch!);
  await addFromToolbox(page, 'lending');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(page.getByLabel('Toolbox position')).toHaveValue('floating');
  await expect(graph.locator('.floating-toolbox')).toBeVisible();
  await page.getByLabel('Toolbox position').selectOption('top');
  await expect(graph.locator('.floating-toolbox')).toHaveCount(0);
  await expect(page.locator('.canvas-head').getByRole('button', { name: 'Add swap' })).toBeVisible();
  await expect(page.getByText('Technical workflow details')).toHaveCount(0);
  await expect(page.getByText('Demo assistant')).toHaveCount(0);
  await expect(page.getByText('Demo mode', { exact: true })).toHaveCount(0);
});
test('drag keeps node mounted and invalid connections leave semantic edges unchanged', async ({ page }) => {
  await page.goto('/');
  await addFromToolbox(page, 'pool');
  const node = page.locator('.react-flow__node[data-id="node-002"]');
  await node.evaluate(element => { (window as unknown as { draggedNode?: Element }).draggedNode = element; });
  const before = await node.boundingBox();
  if (!before) throw new Error('Node missing');
  await page.mouse.move(before.x + 70, before.y + 60);
  await page.mouse.down();
  await page.mouse.move(before.x + 5, before.y + 120, { steps: 25 });
  await page.mouse.up();
  expect(await node.evaluate(element => (window as unknown as { draggedNode?: Element }).draggedNode === element)).toBe(true);
  expect((await node.boundingBox())!.x).toBeLessThan(before.x - 40);
  await connect(page, 'node-001', 'node-002');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(page.getByRole('alert').filter({ hasText: 'INVALID_EDGE' })).toHaveCount(0);
  const edgePath = await page.locator('.react-flow__edge-path').first().getAttribute('d');
  const connectedBox = await node.boundingBox();
  if (!connectedBox) throw new Error('Connected node missing');
  await page.mouse.move(connectedBox.x + 70, connectedBox.y + 60);
  await page.mouse.down();
  await page.mouse.move(connectedBox.x + 70, connectedBox.y + 95, { steps: 10 });
  await page.mouse.up();
  expect(await page.locator('.react-flow__edge-path').first().getAttribute('d')).not.toBe(edgePath);
  const from = await page.locator('.react-flow__node[data-id="node-002"] .react-flow__handle-right').boundingBox();
  const to = await page.locator('.react-flow__node[data-id="node-001"] .react-flow__handle-left').boundingBox();
  if (!from || !to) throw new Error('Connection handles missing');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByText('This connection would create a loop.')).toBeVisible();
  await page.getByLabel('Toolbox position').selectOption('floating');
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});
test('text controls guard both deletion keys and edge selection clears on Escape', async ({ page }) => {
  await page.goto('/');
  await addFromToolbox(page, 'pool');
  await connect(page, 'node-001', 'node-002');
  const edge = page.locator('.react-flow__edge').first();
  await edge.locator('.react-flow__edge-interaction').click({ force: true });
  await expect(edge).toHaveClass(/selected/);
  await page.locator('#mock-prompt').focus();
  await page.keyboard.press('Backspace');
  await expect(edge).toHaveCount(1);
  await page.locator('.canvas-head h2').click();
  await page.keyboard.press('Escape');
  await expect(edge).not.toHaveClass(/selected/);
});


test('floating toolbox stays inside a narrow editor without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Toolbox position').selectOption('floating');
  const graph = page.getByRole('region', { name: 'Workflow graph' });
  await expect(graph.locator('.floating-toolbox')).toBeVisible();
  await expect(graph.locator('.floating-toolbox button')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});


test('dragging a swap preserves current mocked artifacts', async ({ page }) => {
  await page.goto('/');
  await addFromToolbox(page, 'swap');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  const artifacts = page.getByRole('region', { name: 'Mocked artifact chain' });
  await artifacts.getByRole('button', { name: /^Generate mocked artifacts for revision 1$/ }).click();
  await expect(artifacts.getByText('ARTIFACTS: CURRENT', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  const card = page.locator('.react-flow__node[data-id="node-002"]');
  const box = await card.boundingBox();
  if (!box) throw new Error('Swap node missing');
  await page.mouse.move(box.x + 65, box.y + 58);
  await page.mouse.down();
  await page.mouse.move(box.x + 95, box.y + 78, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await page.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(artifacts.getByText('ARTIFACTS: CURRENT', { exact: true })).toBeVisible();
});
