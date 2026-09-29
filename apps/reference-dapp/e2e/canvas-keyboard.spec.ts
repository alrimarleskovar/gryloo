// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
test('canvas Delete, Backspace, Escape and text-entry guards use semantic IR', async ({ page }) => {
  await page.goto('/');
  const prompt = page.locator('#mock-prompt');
  await prompt.fill('add transform'); await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  const cards = page.locator('.flow-card');
  await expect(cards).toHaveCount(2);
  await cards.nth(1).click();
  await expect(cards.nth(1)).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(cards.nth(1)).not.toHaveClass(/active/);
  await cards.nth(1).click();
  await prompt.focus(); await page.keyboard.press('Backspace');
  await expect(cards).toHaveCount(2);
  await page.evaluate(() => { const editor = document.createElement('div'); editor.contentEditable = 'true';
    editor.id = 'inline-editor'; editor.textContent = 'text'; document.body.append(editor); editor.focus(); });
  await page.keyboard.press('Delete');
  await expect(cards).toHaveCount(2);
  await cards.nth(1).click(); await page.keyboard.press('Delete');
  await expect(cards).toHaveCount(1);
  await cards.first().click(); await page.keyboard.press('Backspace');
  await expect(cards).toHaveCount(1);
  await prompt.fill('add transform'); await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await cards.nth(1).click(); await page.keyboard.press('Backspace');
  await expect(cards).toHaveCount(1);
});
