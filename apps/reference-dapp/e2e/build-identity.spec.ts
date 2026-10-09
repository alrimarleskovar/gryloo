// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';

test('workflow naming confirms inline, cancels without clearing selection and survives navigation', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/app');
  const canvas = page.getByRole('region', { name: 'Workflow canvas', exact: true });
  const rename = canvas.getByRole('button', { name: 'Rename workflow', exact: true });
  await expect(canvas.getByRole('heading', { name: 'Your Workflow', exact: true })).toBeVisible();
  await rename.click();
  const input = canvas.getByRole('textbox', { name: 'Workflow name', exact: true });
  await expect(input).toBeFocused();
  await input.fill('  ETH Carry Strategy  ');
  await input.press('Enter');
  await expect(canvas.getByRole('heading', { name: 'ETH Carry Strategy', exact: true })).toBeVisible();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await page.getByRole('button', { name: 'Add supply', exact: true }).click();
  await expect(canvas.locator('.flow-card.active')).toHaveCount(1);
  await rename.click();
  await input.fill('Cancelled name');
  await input.press('Escape');
  await expect(canvas.getByRole('heading', { name: 'ETH Carry Strategy', exact: true })).toBeVisible();
  await expect(canvas.locator('.flow-card.active')).toHaveCount(1);
  await expect(page.getByRole('form', { name: 'Edit Supply' })).toBeVisible();
  await rename.click();
  await input.fill('   ');
  await input.press('Enter');
  await expect(canvas.getByRole('heading', { name: 'ETH Carry Strategy', exact: true })).toBeVisible();
  await rename.click();
  await input.fill('ETH Income Strategy');
  await page.getByRole('heading', { name: 'Copilot', exact: true }).click();
  await expect(canvas.getByRole('heading', { name: 'ETH Income Strategy', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Workflow stages' });
  await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await nav.getByRole('button', { name: 'Build', exact: true }).click();
  await expect(canvas.getByRole('heading', { name: 'ETH Income Strategy', exact: true })).toBeVisible();
  await expect(canvas.locator('.flow-card.active')).toHaveCount(1);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await page.setViewportSize({ width: 390, height: 844 });
  await rename.click();
  await input.fill('A'.repeat(80));
  await input.press('Enter');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('Privacy is a disabled affordance in both toolbar positions and never authors an action', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/app');
  const toolbar = page.getByRole('toolbar', { name: 'Canvas tools', exact: true });
  for (const floating of [false, true]) {
    if (floating) await page.getByRole('button', { name: 'Undock toolbar', exact: true }).click();
    const privacy = toolbar.getByRole('button', { name: 'Privacy', exact: true });
    await expect(privacy).toBeDisabled();
    await expect(privacy).toHaveAttribute('title', 'Privacy · not available yet');
    expect(await privacy.evaluate(button => button.previousElementSibling?.getAttribute('aria-label'))).toBe('Add withdraw');
    await privacy.dispatchEvent('click');
    await expect(page.locator('.flow-card')).toHaveCount(0);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  }
});

test('Copilot keeps existing commands and proposal review while removing internal presentation', async ({ page }) => {
  await installSupplyWallet(page);
  await page.goto('/app');
  const assistant = page.getByRole('complementary', { name: 'Workflow assistant' });
  const prompt = assistant.getByLabel('Describe your flow', { exact: true });
  const send = assistant.getByRole('button', { name: 'Send', exact: true });
  await expect(assistant.getByRole('heading', { name: 'Copilot', exact: true })).toBeVisible();
  await expect(assistant).toContainText('ASSISTANT');
  expect(await assistant.innerText()).not.toMatch(/GRYLOO|mock|demo|local command|no model|ticks/i);
  await prompt.fill('explain');
  await send.click();
  await expect(assistant).toContainText('Your flow has no actions yet.');
  await prompt.fill('unsupported request');
  await send.click();
  await expect(assistant).toContainText('This request could not be understood.');
  expect(await assistant.innerText()).not.toMatch(/GRYLOO|mock|local command|no model|ticks/i);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await prompt.fill('swap 2 USDC to WETH on Base slippage 50 bps');
  await send.click();
  await expect(page.getByRole('button', { name: 'Apply proposal', exact: true })).toBeVisible();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  await expect(page.locator('.flow-card')).toHaveCount(1);
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
  await prompt.fill('explain');
  await send.click();
  await expect(assistant.locator('.message.system').last()).toContainText('2 USDC');
  expect(await assistant.locator('.message.system').last().innerText()).not.toMatch(/mock|sample units/i);
});
