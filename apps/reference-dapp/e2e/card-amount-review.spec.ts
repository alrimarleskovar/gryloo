// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction, openCanvasSettings } from './composer-authoring-fixtures';

for (const action of ['swap', 'bridge'] as const) test(`${action} reviews and applies in its card with validated acceptance and a stable hover glow`, async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  const source = card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  const review = card.getByRole('button', { name: 'Review amount', exact: true });
  const apply = card.getByRole('button', { name: 'Apply amount', exact: true });
  const revision = page.locator('.summary-bar');
  const settings = page.getByRole('region', { name: 'Action inspector' }).getByRole('button', { name: 'Advanced Settings', exact: true });
  const stages = page.getByRole('navigation', { name: 'Workflow stages' });
  await expect(review).toBeVisible(); await expect(apply).toBeVisible(); await expect(apply).toBeDisabled();
  await review.click(); await expect(apply).toBeDisabled();
  await expect(card.getByRole('alert')).toContainText('greater than 0');
  await expect(revision).toHaveAttribute('data-workflow-revision', '0');
  await source.fill('2.5'); await expect(apply).toBeDisabled();
  await review.click(); await expect(apply).toBeEnabled();
  await expect(revision).toHaveAttribute('data-workflow-revision', '0');
  await expect(stages.getByRole('button', { name: 'Simulate', exact: true })).toBeDisabled();
  await expect(stages.getByRole('button', { name: 'Execute', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Workflow edit review', exact: true })).toHaveCount(0);
  await openCanvasSettings(page);
  await expect(page.getByRole('button', { name: 'Review amount', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Apply amount', exact: true })).toHaveCount(1);
  await settings.click();
  await source.fill('3'); await expect(apply).toBeDisabled();
  await expect(revision).toHaveAttribute('data-workflow-revision', '0');
  await review.click(); await expect(apply).toBeEnabled();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const reviewBox = (await review.boundingBox())!, applyBox = (await apply.boundingBox())!, cardBox = (await card.boundingBox())!;
    expect(Math.abs(reviewBox.y - applyBox.y)).toBeLessThan(1);
    expect(applyBox.x).toBeGreaterThanOrEqual(reviewBox.x + reviewBox.width);
    expect(applyBox.x + applyBox.width).toBeLessThan(cardBox.x + cardBox.width);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const button of [review, apply]) {
    await page.mouse.move(0, 0); await source.focus();
    const before = (await button.boundingBox())!;
    expect(await button.evaluate(element => getComputedStyle(element).boxShadow)).toBe('none');
    await button.hover();
    expect(await button.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');
    expect(await button.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    const after = (await button.boundingBox())!;
    expect(after).toEqual(before);
    await page.mouse.move(0, 0); await button.focus();
    expect(await button.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThan(0);
    // The test fixture requests reduced motion; hover/focus remain visible without transitions.
    expect(await button.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  }
  await apply.focus(); await page.keyboard.press('Enter');
  await expect(source).toHaveValue('3');
  await expect(revision).toHaveAttribute('data-workflow-revision', '1');
  await expect(review).toHaveCount(0); await expect(apply).toHaveCount(0);
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Simulate fees', exact: true })).toBeEnabled();
  await openCanvasSettings(page);
  await expect(page.getByRole('region', { name: 'Action inspector' }).getByLabel(action === 'swap' ? 'Input amount (USDC)' : 'Cross-chain amount (USDC)', { exact: true })).toHaveValue('3');
  await settings.click();
  await page.getByRole('button', { name: 'Simulate fees', exact: true }).click();
  await expect(page.locator('.simulate-flow-surface .composer-amount')).toHaveText('3 USDC');
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /sign|send/i.test(request.method)))).toEqual([]);
});

test('amount acceptance is scoped to the reviewed card and stale reviews cannot accept another card', async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/app');
  const cards = page.locator('.build-flow-surface .composer-card');
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '2');
  await page.getByRole('button', { name: 'Add swap', exact: true }).click();
  await configureCanvasAction(page, '3'); await expect(cards).toHaveCount(2);
  const first = cards.nth(0), second = cards.nth(1);
  const amount = (card: typeof first) => card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  const review = (card: typeof first) => card.getByRole('button', { name: 'Review amount', exact: true });
  const apply = (card: typeof first) => card.getByRole('button', { name: 'Apply amount', exact: true });
  await amount(first).fill('4'); await review(first).click(); await expect(apply(first)).toBeEnabled();
  await amount(second).fill('5'); await expect(apply(second)).toBeDisabled();
  await review(second).click(); await expect(apply(second)).toBeEnabled(); await expect(apply(first)).toBeDisabled();
  await apply(second).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '3');
  await expect(amount(second)).toHaveValue('5'); await expect(apply(second)).toHaveCount(0);
  await expect(apply(first)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Simulate fees', exact: true })).toBeDisabled();
  await review(first).click(); await apply(first).click();
  await expect(amount(first)).toHaveValue('4'); await expect(amount(second)).toHaveValue('5');
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '4');
  await expect(page.getByRole('button', { name: 'Simulate fees', exact: true })).toBeEnabled();
});
