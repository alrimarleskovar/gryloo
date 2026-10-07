// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { installSupplyWallet } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} workflow save utility is truthful and preserves title, cards and session identity`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installSupplyWallet(page); await page.goto('/');
    const canvas = page.getByRole('region', { name: 'Workflow canvas', exact: true });
    const rename = canvas.getByRole('button', { name: 'Rename workflow', exact: true });
    const save = canvas.getByRole('button', { name: 'Save workflow', exact: true });
    await expect(save).toBeVisible(); await expect(save).toBeEnabled();
    expect(await save.evaluate(element => element.previousElementSibling?.getAttribute('aria-label'))).toBe('Rename workflow');
    for (const control of [rename, save]) {
      await expect(control).toHaveCSS('width', '28px'); await expect(control).toHaveCSS('height', '28px');
      await expect(control.locator('svg')).toHaveAttribute('width', '14');
      await expect(control.locator('svg')).toHaveAttribute('stroke-width', '1.8');
      await expect(control).toHaveCSS('box-shadow', 'none');
    }
    const pencilBox = (await rename.boundingBox())!, saveBox = (await save.boundingBox())!;
    expect(saveBox.y).toBe(pencilBox.y); expect(saveBox.x - pencilBox.x - pencilBox.width).toBe(4);
    await save.hover(); await expect(save).toHaveCSS('background-color', theme === 'dark' ? 'rgb(28, 32, 41)' : 'rgb(244, 247, 251)');
    await page.mouse.down();
    await expect(save).toHaveCSS('background-color', theme === 'dark' ? 'rgb(26, 35, 80)' : 'rgb(234, 242, 255)');
    await page.mouse.up();
    await rename.focus(); await page.keyboard.press('Tab'); await expect(save).toBeFocused();
    await expect(save).toHaveCSS('outline-style', 'solid');
    await save.press('Space');
    await expect(canvas.getByRole('status')).toHaveText('Workflow saving is not available yet. Your workflow stays in this session; Dashboard shows execution history.');
    await rename.click();
    const name = canvas.getByRole('textbox', { name: 'Workflow name', exact: true });
    await name.fill('Team workflow'); await save.click();
    await expect(canvas.getByRole('heading', { name: 'Team workflow', exact: true })).toBeVisible();
    await rename.click(); await name.fill('Discarded title'); await name.press('Escape');
    await expect(canvas.getByRole('heading', { name: 'Team workflow', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add swap', exact: true }).click();
    await configureCanvasAction(page, '2');
    const selected = canvas.locator('.composer-card.active');
    await expect(selected).toHaveCount(1);
    const cardBefore = await selected.innerText();
    const storageBefore = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    await save.click();
    await expect(selected).toHaveText(cardBefore, { useInnerText: true });
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))).toEqual(storageBefore);
    const nav = page.getByRole('navigation', { name: 'Workflow stages' });
    await nav.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save workflow', exact: true })).toHaveCount(0);
    await nav.getByRole('button', { name: 'Build', exact: true }).click();
    await expect(canvas.getByRole('heading', { name: 'Team workflow', exact: true })).toBeVisible();
    await expect(selected).toHaveText(cardBefore, { useInnerText: true });
    for (const stage of ['Simulate', 'Execute']) {
      await nav.getByRole('button', { name: stage, exact: true }).click();
      await expect(page.getByRole('button', { name: 'Save workflow', exact: true })).toHaveCount(0);
      await expect(page.locator('.canvas-head h2')).toHaveText('Team workflow');
    }
    expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /sign|send|switch/i.test(request.method)))).toEqual([]);
  });

  test(`${theme} environment menu supports keyboard selection, escape, outside click and focus exit`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installSupplyWallet(page); await page.goto('/');
    const trigger = page.getByRole('combobox', { name: 'Environment', exact: true });
    const menu = page.getByRole('listbox', { name: 'Environment options', exact: true });
    await expect(trigger).toHaveText('Testnet');
    await trigger.focus(); await trigger.press('ArrowDown');
    await expect(menu).toBeVisible(); await expect(trigger).toBeFocused();
    await expect(menu.getByRole('option', { name: 'Testnet', exact: true })).toHaveAttribute('aria-selected', 'true');
    await trigger.press('End');
    await expect(menu.getByRole('option', { name: 'Mainnet', exact: true })).toHaveAttribute('data-active', '');
    await expect(trigger).toHaveText('Testnet');
    await trigger.press('Enter');
    await expect(menu).toHaveCount(0); await expect(trigger).toHaveText('Mainnet');
    await expect(trigger.locator('.header-mainnet-dot')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(74, 222, 128)' : 'rgb(34, 197, 94)');
    await trigger.press('Space'); await trigger.press('ArrowUp'); await trigger.press('Space');
    await expect(trigger).toHaveText('Testnet');
    await trigger.press('m'); await expect(menu).toBeVisible();
    await expect(menu.getByRole('option', { name: 'Mainnet', exact: true })).toHaveAttribute('data-active', '');
    await trigger.press('Home');
    await expect(menu.getByRole('option', { name: 'Testnet', exact: true })).toHaveAttribute('data-active', '');
    await trigger.press('Escape'); await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused();
    await trigger.click(); await page.getByRole('heading', { name: 'Your Workflow', exact: true }).click();
    await expect(menu).toHaveCount(0);
    await trigger.click(); await trigger.press('Tab'); await expect(menu).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '0');
    expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /sign|send/i.test(request.method)))).toEqual([]);
  });

  test(`${theme} rounded environment panel and workflow utilities fit responsive headers`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
    await installSupplyWallet(page); await page.goto('/');
    const header = page.getByRole('banner');
    const trigger = header.getByRole('combobox', { name: 'Environment', exact: true });
    const menu = header.getByRole('listbox', { name: 'Environment options', exact: true });
    for (const width of [1440, 1024, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 900 }); await header.scrollIntoViewIfNeeded();
      await expect(trigger).toHaveText('Testnet');
      const before = await header.boundingBox();
      await trigger.click(); await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS('border-radius', '12px'); await expect(menu).toHaveCSS('padding', '6px');
      await expect(menu).toHaveCSS('background-color', theme === 'dark' ? 'rgb(21, 24, 31)' : 'rgb(255, 255, 255)');
      const selected = menu.getByRole('option', { name: 'Testnet', exact: true });
      await expect(selected).toHaveAttribute('aria-selected', 'true'); await expect(selected.locator('svg')).toBeVisible();
      await expect(selected).toHaveCSS('background-color', theme === 'dark' ? 'rgb(26, 35, 80)' : 'rgb(234, 242, 255)');
      await expect(selected).toHaveCSS('min-height', '40px');
      const other = menu.getByRole('option', { name: 'Mainnet', exact: true });
      await other.hover();
      await expect(other).toHaveCSS('background-color', theme === 'dark' ? 'rgb(28, 32, 41)' : 'rgb(244, 247, 251)');
      await expect(other).toHaveAttribute('aria-selected', 'false');
      const panel = (await menu.boundingBox())!;
      expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(width);
      expect(await header.boundingBox()).toEqual(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      if (width === 1440 || width === 320) await page.screenshot({ path: `.tmp/ux007-save-environment-${theme}-${width}.png` });
      await trigger.press('Escape');
      await expect(page.getByRole('button', { name: 'Save workflow', exact: true })).toBeInViewport();
    }
    await page.getByRole('button', { name: 'Rename workflow', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Workflow name', exact: true });
    await name.fill('A'.repeat(80)); await name.press('Enter');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await expect(page.getByRole('button', { name: 'Save workflow', exact: true })).toBeVisible();
  });
}
