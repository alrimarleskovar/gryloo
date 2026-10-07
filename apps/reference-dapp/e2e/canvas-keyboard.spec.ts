// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, applyPendingProposal } from './fixtures';

test('canvas Delete, Backspace, Escape and text-entry guards use semantic IR', async ({ page }) => {
  await page.goto('/');
  const prompt = page.getByLabel('Describe your flow');
  const addSwap = async () => {
    await prompt.fill('swap 2 USDC to WETH on Base slippage 50 bps');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await applyPendingProposal(page);
  };
  await addSwap();
  const cards = page.locator('.build-flow-surface .composer-card');
  await expect(cards).toHaveCount(1);
  await cards.first().click();
  await expect(cards.first()).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(cards.first()).not.toHaveClass(/active/);
  await cards.first().click();
  await prompt.focus(); await page.keyboard.press('Backspace');
  await expect(cards).toHaveCount(1);
  await page.evaluate(() => {
    const editor = document.createElement('div'); editor.contentEditable = 'true';
    editor.id = 'inline-editor'; editor.textContent = 'text'; document.body.append(editor); editor.focus();
  });
  await page.keyboard.press('Delete');
  await expect(cards).toHaveCount(1);
  await cards.first().click(); await page.keyboard.press('Delete');
  await expect(cards).toHaveCount(0);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '2');
  await addSwap();
  await cards.first().click(); await page.keyboard.press('Backspace');
  await expect(cards).toHaveCount(0);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '4');
});
