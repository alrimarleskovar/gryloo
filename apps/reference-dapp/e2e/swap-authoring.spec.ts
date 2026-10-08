// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, applyPendingProposal, openProposalReview, readWorkflowIr, openFirstActionSettings, installPassiveWallet, assertPassiveWallet } from './fixtures';
import type { Page } from '@playwright/test';
import { hashArtifactBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { readyForVisualCapture } from './mode-a-fixtures';

test.beforeEach(async ({ page }) => { await installPassiveWallet(page); });
test.afterEach(async ({ page }) => { await assertPassiveWallet(page); });

const prompt = (page: Page) => page.getByLabel('Describe your flow');
const send = async (page: Page, text: string) => {
  await prompt(page).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
};
const apply = applyPendingProposal;
const selectSwap = openFirstActionSettings;
const workflow = async (page: Page) => JSON.parse(await readWorkflowIr(page)) as SemanticWorkflow;
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
    await openProposalReview(page);
    await expect(page.getByRole('dialog', { name: 'Proposed change' })).toContainText(`${from}`);
    await expect(page.getByRole('dialog', { name: 'Proposed change' })).toContainText(`${to}`);
    await page.keyboard.press('Escape');
    await apply(page);
    const chat = await workflow(page);
    expect(chat.revision).toBe(1);
    await expect(page.getByRole('region', { name: 'Deterministic review findings' })).toContainText('EXECUTION_UNAVAILABLE');
    await page.reload();
    await createCanvas(page, direction, amount, '50');
    const canvas = await workflow(page);
    expect(canvas.revision).toBe(1);
    expect(canvas.workflowId).not.toBe(chat.workflowId);
    const reconstructed = { ...canvas, workflowId: chat.workflowId };
    expect(reconstructed).toEqual(chat);
    expect(hash(reconstructed)).toBe(hash(chat));
  });
}

test('mixed surface edits, dismissal, locks and stale proposals preserve revisions', async ({ page }) => {
  await page.goto('/');
  await send(page, 'swap 2 USDC to WETH on Base slippage 50 bps');
  await openProposalReview(page);
  await page.getByRole('button', { name: 'Dismiss proposal' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="0"]')).toBeVisible();
  await send(page, 'swap 2 USDC to WETH on Base slippage 50 bps');
  await apply(page);
  await selectSwap(page);
  const card = page.locator('.build-flow-surface .composer-card').first();
  await card.getByRole('textbox', { name: 'Source amount (USDC)' }).fill('3');
  await card.getByRole('button', { name: 'Review amount', exact: true }).click();
  await card.getByRole('button', { name: 'Apply amount', exact: true }).click();
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
  await page.getByRole('button', { name: 'Review Swap settings' }).click();
  await expect(card.getByRole('button', { name: 'Apply amount', exact: true })).toBeEnabled();
  await card.getByRole('button', { name: 'Apply amount', exact: true }).click();
  const canvasChatCanvas = await workflow(page);
  expect(canvasChatCanvas.workflowId).not.toBe(chatCanvasChat.workflowId);
  const reconstructed = { ...canvasChatCanvas, workflowId: chatCanvasChat.workflowId };
  expect(reconstructed).toEqual(chatCanvasChat);
  expect(hash(reconstructed)).toBe(hash(chatCanvasChat));

  await send(page, 'set node-002 amount 4');
  await page.getByRole('button', { name: 'Lock amount' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="4"]')).toBeVisible();
  await openProposalReview(page);
  await expect(page.getByRole('button', { name: 'Apply proposal' })).toBeDisabled();
  await expect(page.locator('.summary-bar[data-workflow-revision="4"]')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss proposal' }).click();
  await send(page, 'set node-002 amount 4');
  await openProposalReview(page);
  await expect(page.getByRole('button', { name: 'Apply proposal' })).toBeDisabled();
  await page.getByRole('button', { name: 'Dismiss proposal' }).click();
  await page.getByRole('button', { name: 'Unlock amount' }).click();
  await expect(page.locator('.summary-bar[data-workflow-revision="5"]')).toBeVisible();
});

test('proposal and blocked review snapshots show unquoted unavailable state', async ({ page }) => {
  await page.goto('/');
  await send(page, 'swap 0.125 WETH to USDC on Base slippage 301 bps');
  await openProposalReview(page);
  await expect(page.getByRole('dialog', { name: 'Proposed change' })).toContainText('WETH');
  await expect(page.getByRole('dialog', { name: 'Proposed change' })).toContainText('USDC');
  await expect(page.getByRole('button', { name: 'Apply proposal' })).toBeEnabled();
  await readyForVisualCapture(page);
  await expect(page).toHaveScreenshot('proposal.png', { fullPage: true, maxDiffPixels: 0 });
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await selectSwap(page);
  // The displayed IR carries this visit's own draft identity, so it is checked as text and masked in the screenshot below.
  expect((JSON.parse(await readWorkflowIr(page)) as SemanticWorkflow).workflowId).toMatch(/^workflow-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  await expect(page.getByRole('region', { name: 'Deterministic review findings' })).toContainText('BLOCK');
  await page.locator('.build-flow-surface .composer-card').first().scrollIntoViewIfNeeded();
  // IntersectionObserver rounds a fully visible transformed card to 0.99999994.
  // Check its actual CSS bounds instead of comparing that floating-point ratio to 1.
  const bounds = await page.locator('.build-flow-surface .composer-card').first().boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect(page.getByRole('button', { name: 'Simulate fees' })).toBeEnabled();
  await readyForVisualCapture(page);
  await expect(page).toHaveScreenshot('review-blocked.png', { fullPage: true, maxDiffPixels: 0, mask: [page.locator('[data-workflow-ir]')] });
});

test('Base authoring and review fit mobile, tablet and desktop widths', async ({ page }) => {
  await page.goto('/');
  await createCanvas(page, 'USDC_TO_WETH', '2', '50');
  await selectSwap(page);
  await readWorkflowIr(page);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('region', { name: 'Deterministic review findings' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
  }
});
