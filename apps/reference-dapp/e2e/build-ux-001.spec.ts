// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`.build-flow-surface .react-flow__node[data-id="${id}"]`);
async function addThree(page: Page) {
  for (const action of ['pool', 'borrow', 'lending']) await page.getByRole('button', { name: `Add ${action}` }).click();
  await expect(page.locator('.build-flow-surface .react-flow__node')).toHaveCount(4);
}
async function marquee(page: Page) {
  const first = await node(page, 'node-002').boundingBox();
  const second = await node(page, 'node-003').boundingBox();
  if (!first || !second) throw new Error('Nodes missing for marquee');
  await page.mouse.move(Math.min(first.x, second.x) - 8, Math.min(first.y, second.y) - 8);
  await page.mouse.down();
  await page.mouse.move(Math.max(first.x + first.width, second.x + second.width) + 8,
    Math.max(first.y + first.height, second.y + second.height) + 8, { steps: 12 });
  await expect(page.locator('.canvas-marquee')).toBeVisible();
  await page.mouse.up();
  await expect(node(page, 'node-002').locator('.flow-card')).toHaveClass(/active/);
  await expect(node(page, 'node-003').locator('.flow-card')).toHaveClass(/active/);
  await expect(node(page, 'node-001').locator('.flow-card')).not.toHaveClass(/active/);
}

test('marquee, group drag, multi-delete, undo and redo work as one edit per action', async ({ page }) => {
  await page.goto('/');
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await addThree(page);
  await expect(undo).toBeEnabled();
  await marquee(page);
  const a = await node(page, 'node-002').boundingBox();
  const b = await node(page, 'node-003').boundingBox();
  if (!a || !b) throw new Error('Selected nodes missing');
  await page.mouse.move(a.x + 70, a.y + 60);
  await page.mouse.down();
  await page.mouse.move(a.x + 125, a.y + 95, { steps: 12 });
  await page.mouse.up();
  const movedA = await node(page, 'node-002').boundingBox();
  const movedB = await node(page, 'node-003').boundingBox();
  expect(movedA!.x - a.x).toBeGreaterThan(40);
  expect(movedB!.x - b.x).toBeCloseTo(movedA!.x - a.x, 0);
  expect(movedB!.y - b.y).toBeCloseTo(movedA!.y - a.y, 0);
  await page.keyboard.press('Control+z');
  expect((await node(page, 'node-002').boundingBox())!.x).toBeCloseTo(a.x, 0);
  expect((await node(page, 'node-003').boundingBox())!.x).toBeCloseTo(b.x, 0);
  await page.keyboard.press('Control+Shift+z');
  expect((await node(page, 'node-002').boundingBox())!.x).toBeCloseTo(movedA!.x, 0);
  await page.keyboard.press('Delete');
  await expect(node(page, 'node-002')).toHaveCount(0);
  await expect(node(page, 'node-003')).toHaveCount(0);
  await undo.click();
  await expect(node(page, 'node-002')).toBeVisible();
  await expect(node(page, 'node-003')).toBeVisible();
  await redo.click();
  await expect(node(page, 'node-002')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(node(page, 'node-002')).toBeVisible();
  await page.getByRole('button', { name: 'Add borrow' }).click();
  await expect(redo).toBeDisabled();
});

test('Shift+click toggles membership, empty click and Escape clear, and Ctrl+Y redoes', async ({ page }) => {
  await page.goto('/');
  await addThree(page);
  await node(page, 'node-002').locator('.flow-card').click();
  await node(page, 'node-003').locator('.flow-card').click({ modifiers: ['Shift'] });
  await expect(node(page, 'node-002').locator('.flow-card')).toHaveClass(/active/);
  await expect(node(page, 'node-003').locator('.flow-card')).toHaveClass(/active/);
  await node(page, 'node-002').locator('.flow-card').click({ modifiers: ['Shift'] });
  await expect(node(page, 'node-002').locator('.flow-card')).not.toHaveClass(/active/);
  await page.locator('#mock-prompt').focus();
  await page.keyboard.press('Escape');
  await expect(node(page, 'node-003').locator('.flow-card')).not.toHaveClass(/active/);
  await node(page, 'node-002').locator('.flow-card').click();
  await page.locator('.build-flow-surface .react-flow__pane').click({ position: { x: 10, y: 10 } });
  await expect(node(page, 'node-002').locator('.flow-card')).not.toHaveClass(/active/);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  await expect(node(page, 'node-004')).toBeVisible();
});

test('Flofi logo replaces the letter mark and history controls work in floating toolbox', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Flofi logo' })).toBeVisible();
  await expect(page.locator('.brand-mark')).not.toHaveText('G');
  await page.getByLabel('Toolbox position').selectOption('floating');
  const toolbox = page.locator('.floating-toolbox');
  const undo = toolbox.getByRole('button', { name: 'Undo' });
  const redo = toolbox.getByRole('button', { name: 'Redo' });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await toolbox.getByRole('button', { name: 'Add pool' }).click();
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(node(page, 'node-002')).toHaveCount(0);
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(node(page, 'node-002')).toBeVisible();
  await expect(redo).toBeDisabled();
});
