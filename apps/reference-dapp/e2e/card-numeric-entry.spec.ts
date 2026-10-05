// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { openCanvasSettings } from './composer-authoring-fixtures';

for (const action of ['swap', 'bridge', 'supply', 'borrow', 'repay', 'withdraw'] as const) test(`${action} uses consistent zero replacement, decimal entry and empty-on-blur behavior`, async ({ page }) => {
  await installSupplyWallet(page); await page.goto('/');
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
  await page.getByRole('button', { name: `Add ${action}`, exact: true }).click();
  const card = page.locator('.build-flow-surface .composer-card');
  const source = card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true });
  const panel = page.getByRole('region', { name: 'Action inspector' });
  const revision = page.locator('.summary-bar');
  const single = ['supply', 'borrow', 'repay', 'withdraw'].includes(action);
  const actionName = action[0]!.toUpperCase() + action.slice(1);
  const review = card.getByRole('button', { name: single ? `Review ${actionName} change` : 'Review amount', exact: true });
  const apply = card.getByRole('button', { name: single ? 'Apply proposal' : 'Apply amount', exact: true });
  await expect(source).toHaveValue('0'); await expect(source).toHaveAttribute('placeholder', '0');
  await expect(revision).toHaveAttribute('data-workflow-revision', '0');
  await expect(page.getByRole('button', { name: 'Simular Fees', exact: true })).toBeDisabled();
  const stages = page.getByRole('navigation', { name: 'Workflow stages' });
  for (const stage of ['Simulate', 'Execute']) {
    const button = stages.getByRole('button', { name: stage, exact: true });
    await expect(button).toBeDisabled(); await button.dispatchEvent('click');
  }
  await expect(stages.getByRole('button', { name: 'Build', exact: true })).toHaveAttribute('aria-current', 'page');

  // Clicking the zero and even moving the caret before it must replace it, not produce 50500.
  await source.click(); await source.press('ArrowLeft'); await source.pressSequentially('005050');
  await expect(source).toHaveValue('5050');
  await source.fill('0'); await source.click(); await source.pressSequentially('.05');
  await expect(source).toHaveValue('0.05');
  for (const [entered, expected] of [['005050', '5050'], ['0007', '7'], ['000.0500', '0.0500'], ['0.5', '0.5'], ['0.05', '0.05'], ['123456789012345678901234567890', '123456789012345678901234567890']]) {
    await source.fill(entered!); await expect(source).toHaveValue(expected!);
    await expect(revision).toHaveAttribute('data-workflow-revision', '0');
  }
  await source.fill(''); await expect(source).toHaveValue(''); await expect(source).toBeFocused();
  await card.locator('.composer-action-title').click(); await expect(source).toHaveValue('0');
  await expect(panel.locator('.inspector-toggle')).toHaveAttribute('aria-expanded', 'false');

  await source.fill('1e2'); await expect(source).toHaveValue('1e2');
  await review.click();
  if (single) await expect(apply).toHaveCount(0); else await expect(apply).toBeDisabled();
  await expect(revision).toHaveAttribute('data-workflow-revision', '0');

  await openCanvasSettings(page);
  const settingsAmount = panel.getByLabel('Source amount (USDC)', { exact: true });
  await settingsAmount.fill('0007'); await expect(source).toHaveValue('7'); await expect(settingsAmount).toHaveValue('7');
  await settingsAmount.fill(''); await expect(source).toHaveValue('');
  await settingsAmount.press('Tab'); await expect(source).toHaveValue('0');
  await expect(settingsAmount).toHaveValue('0');
  await panel.getByRole('button', { name: 'Advanced Settings', exact: true }).click();

  if (action === 'swap' || action === 'bridge') {
    await card.locator('.composer-amount').getByRole('button', { name: 'Show fiat amount first (estimate unavailable)', exact: true }).click();
    await source.fill('000.05'); await expect(source).toHaveValue('0.05');
    await expect(card.locator('.composer-amount .composer-primary-fiat')).toHaveText('US$ 0,00');
    await card.locator('.composer-amount .composer-primary-fiat').click();
  }
  await source.fill(''); await source.press('Tab'); await expect(source).toHaveValue('0');
  await review.click();
  if (single) await expect(apply).toHaveCount(0); else await expect(apply).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Simular Fees', exact: true })).toBeDisabled();

  // The Router's existing minimum is unchanged: decimal entry must not bypass it.
  if (action === 'bridge') {
    await source.fill('000.05'); await expect(source).toHaveValue('0.05');
    await review.click(); await expect(apply).toBeDisabled();
    await expect(revision).toHaveAttribute('data-workflow-revision', '0');
  }
  const firstAccepted = action === 'bridge' ? '2.5' : '0.05';
  await source.fill(`000${firstAccepted}`); await expect(source).toHaveValue(firstAccepted);
  await review.click(); await expect(apply).toBeEnabled();
  await expect(revision).toHaveAttribute('data-workflow-revision', '0');
  await apply.click(); await expect(source).toHaveValue(firstAccepted);
  await expect(revision).toHaveAttribute('data-workflow-revision', '1');

  // The accepted value remains editable with identical normalization and explicit acceptance.
  await source.fill(''); await expect(source).toHaveValue(''); await source.press('Tab');
  await expect(source).toHaveValue('0');
  await expect(revision).toHaveAttribute('data-workflow-revision', '1');
  await expect(page.getByRole('button', { name: 'Simular Fees', exact: true })).toBeDisabled();
  const replacement = action === 'bridge' ? '3.05' : '0.5';
  await source.click(); await source.pressSequentially(replacement); await expect(source).toHaveValue(replacement);
  await review.click(); await expect(apply).toBeEnabled();
  await expect(revision).toHaveAttribute('data-workflow-revision', '1');
  await apply.click(); await expect(source).toHaveValue(replacement);
  await expect(revision).toHaveAttribute('data-workflow-revision', '2');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(page.locator('.simulate-flow-surface .composer-amount')).toHaveText(`${replacement} USDC`);
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => request.method === 'eth_sendTransaction' || request.method.startsWith('eth_sign') || request.method.startsWith('personal_sign')))).toEqual([]);
});
