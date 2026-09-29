// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { hashArtifactBytes } from '@defi-workflow-engine/workflow-contracts';

const prompt = (page: Page) => page.getByLabel('Describe a mock edit');
const send = async (page: Page, text: string) => {
  await prompt(page).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
};
const apply = async (page: Page) => {
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
};
const selectSwap = async (page: Page) => {
  await page.locator('.flow-card').nth(1).click();
  await expect(page.locator('.inspector pre')).toContainText('asset.swap.exact-input');
};
const workflow = async (page: Page) => {
  await selectSwap(page);
  const raw = await page.locator('.inspector pre').textContent();
  if (!raw) throw new Error('Semantic Workflow IR is missing');
  return JSON.parse(raw) as { revision: number; nodes: unknown[] };
};
const hash = (value: unknown) => hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(value)));
const createCanvas = async (page: Page, direction: 'USDC_TO_WETH' | 'WETH_TO_USDC', amount: string, slippage: string) => {
  await page.getByText('Advanced action setup', { exact: true }).click();
  await page.getByLabel('Direction').selectOption(direction);
  await page.getByLabel('Input amount (required)').fill(amount);
  await page.getByLabel('Slippage in bps (required)').fill(slippage);
  await page.getByRole('button', { name: 'Review swap proposal' }).click();
  await apply(page);
};

for (const [direction, from, to, amount] of [
  ['USDC_TO_WETH', 'USDC', 'WETH', '2.25'],
  ['WETH_TO_USDC', 'WETH', 'USDC', '0.125'],
] as const) {
  test(`${from} to ${to}: actual chat and canvas inputs yield equal semantic hashes`, async ({ page }) => {
    await page.goto('/');
    await send(page, `swap ${amount} ${from} to ${to} on Base slippage 50 bps`);
    await expect(page.locator('.proposal')).toContainText(`${from} → ${to}`);
    await expect(page.locator('.proposal')).toContainText('Slippage: none → 50 bps');
    await apply(page);
    const chat = await workflow(page);
    expect(chat.revision).toBe(1);
    await expect(page.getByRole('region', { name: 'Deterministic review findings' })).toContainText('EXECUTION_UNAVAILABLE');
    await page.reload();
    await createCanvas(page, direction, amount, '50');
    const canvas = await workflow(page);
    expect(canvas.revision).toBe(1);
    expect(canvas).toEqual(chat);
    expect(hash(canvas)).toBe(hash(chat));
  });
}

test('mixed surface edits, dismissal, locks and stale proposals preserve revisions', async ({ page }) => {
  await page.goto('/');
  await send(page, 'swap 2 USDC to WETH on Base slippage 50 bps');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="0"]')).toBeVisible();
  await send(page, 'swap 2 USDC to WETH on Base slippage 50 bps');
  await apply(page);
  await selectSwap(page);
  await page.getByLabel('Input amount (USDC)').fill('3');
  await page.getByRole('button', { name: 'Review amount change' }).click();
  await apply(page);
  await send(page, 'set node-002 slippage 100 bps');
  await apply(page);
  const chatCanvasChat = await workflow(page);
  expect(chatCanvasChat.revision).toBe(3);

  await page.reload();
  await createCanvas(page, 'USDC_TO_WETH', '2', '50');
  await send(page, 'set node-002 amount 3');
  await apply(page);
  await selectSwap(page);
  await page.locator('.inspector').getByLabel('Slippage (bps)', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Review slippage change' }).click();
  await apply(page);
  const canvasChatCanvas = await workflow(page);
  expect(canvasChatCanvas).toEqual(chatCanvasChat);
  expect(hash(canvasChatCanvas)).toBe(hash(chatCanvasChat));

  await send(page, 'set node-002 amount 4');
  await page.getByRole('button', { name: 'Lock amount' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="4"]')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="4"]')).toBeVisible();
  await send(page, 'set node-002 amount 4');
  await expect(page.locator('.proposal')).toContainText('LOCKED_PARAMETER');
  await page.getByRole('button', { name: 'Unlock amount' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="5"]')).toBeVisible();
});

test('proposal and blocked review snapshots show unquoted unavailable state', async ({ page }) => {
  await page.goto('/');
  await send(page, 'swap 0.125 WETH to USDC on Base slippage 301 bps');
  await expect(page.locator('.proposal')).toContainText('WETH → USDC');
  await expect(page.locator('.proposal')).toContainText('execution unavailable');
  await expect(page).toHaveScreenshot('proposal.png', { fullPage: true, maxDiffPixels: 0 });
  await apply(page);
  await selectSwap(page);
  await expect(page.getByRole('region', { name: 'Deterministic review findings' })).toContainText('BLOCK');
  await expect(page.locator('.flow-card').nth(1)).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Open mocked simulation' })).toBeEnabled();
  await expect(page).toHaveScreenshot('review-blocked.png', { fullPage: true, maxDiffPixels: 0 });
});

test('Base authoring and review fit mobile, tablet and desktop widths', async ({ page }) => {
  await page.goto('/');
  await createCanvas(page, 'USDC_TO_WETH', '2', '50');
  await selectSwap(page);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('region', { name: 'Deterministic review findings' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
  }
});
