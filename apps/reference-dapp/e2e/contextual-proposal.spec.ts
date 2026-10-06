// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { installSupplyWallet, SUPPLY_OWNER } from './supply-fixtures';
import { configureCanvasAction } from './composer-authoring-fixtures';

const artifact = (page: Page) => page.getByRole('button', { name: /^Review proposed change:/ });
const popover = (page: Page) => page.getByRole('dialog', { name: 'Proposed change' });
async function propose(page: Page, supply = '0.1', borrow = '0.01') {
  await page.locator('#mock-prompt').fill(`compose supply ${supply} USDC to Aave then borrow ${borrow} USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps owner ${SUPPLY_OWNER}`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(artifact(page)).toBeVisible();
}
async function geometry(page: Page) {
  return page.evaluate(() => Object.fromEntries(['.top-bar', '.canvas', '.canvas-head', '.flow-surface', '.canvas-foot', '.canvas-primary-action', '.canvas-navigator', '.copilot', '.inspector'].map(selector => {
    const element = document.querySelector(selector)!;
    const { x, y, width, height } = element.getBoundingClientRect();
    return [selector, { x, y, width, height }];
  })));
}
async function fitReview(page: Page) {
  return popover(page).evaluate(review => {
    const r = review.getBoundingClientRect(), canvas = document.querySelector('.build-flow-surface')!.getBoundingClientRect();
    const collisions = ['.canvas-navigator', '.canvas-primary-action', '.floating-toolbox'].some(selector => {
      const element = document.querySelector(selector); if (!element) return false;
      const b = element.getBoundingClientRect();
      return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
    });
    return r.left >= Math.max(0, canvas.left) && r.right <= Math.min(innerWidth, canvas.right) &&
      r.top >= Math.max(0, canvas.top) && r.bottom <= Math.min(innerHeight, canvas.bottom) && !collisions;
  });
}
async function boot(page: Page, theme: string) {
  await page.addInitScript(value => localStorage.setItem('flofi.theme', value), theme);
  await installSupplyWallet(page); await page.goto('/');
  await expect(page.locator('.build009-wallet-info')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
function errors(page: Page) {
  const messages: string[] = [];
  page.on('pageerror', error => messages.push(error.message));
  page.on('console', message => { if (message.type() === 'error') messages.push(message.text()); });
  return messages;
}
async function noAuthorization(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { supplyWalletRequests: { method: string }[] }).supplyWalletRequests.filter(request => /send|sign|switch|addEthereumChain/.test(request.method)))).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  test(`${theme}: only explicit approval/dismissal changes the pending workflow proposal`, async ({ page }) => {
    const consoleErrors = errors(page);
    await boot(page, theme);
    const before = await geometry(page), height = await page.evaluate(() => document.documentElement.scrollHeight);
    await propose(page);
    await expect(page.getByText('Review proposed edit', { exact: true })).toHaveCount(0);
    await expect(page.locator('.workflow-edit-review')).toHaveCount(0);
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await expect(popover(page)).toHaveCount(0);
    expect(await geometry(page)).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    await artifact(page).click();
    await expect(popover(page)).toBeVisible();
    await expect(popover(page)).toContainText('Supply → Borrow → Swap');
    await expect(popover(page)).toContainText('Supply 0.1 USDC · Borrow 0.01 USDC');
    await expect(popover(page).getByRole('button')).toHaveCount(2);
    expect(await popover(page).getByRole('button').allTextContents()).toEqual(['', '']);
    await expect(page.getByRole('button', { name: 'Apply proposal', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Dismiss proposal', exact: true })).toHaveCount(1);
    expect(await fitReview(page)).toBe(true);
    expect(await geometry(page)).toEqual(before);
    await page.locator('.canvas-foot').click();
    await expect(popover(page)).toHaveCount(0);
    await expect(artifact(page)).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await artifact(page).focus(); await page.keyboard.press('Space');
    await expect(popover(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await expect(artifact(page)).toBeFocused();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(popover(page).getByRole('button', { name: 'Dismiss proposal' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(popover(page)).toHaveCount(0); await expect(artifact(page)).toHaveCount(0);
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    expect(await geometry(page)).toEqual(before);

    await propose(page); await artifact(page).click();
    // Two events before a render still submit the canonical command exactly once.
    await popover(page).getByRole('button', { name: 'Apply proposal' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(popover(page)).toHaveCount(0); await expect(artifact(page)).toHaveCount(0);
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    expect(await page.locator('.react-flow__node').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-id')))).toEqual(['lending-supply', 'lending-borrow', 'lending-swap']);
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    await expect(page.locator('.error-banner')).toHaveCount(0);
    // The full three-step proposal remains one history boundary.
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await noAuthorization(page);
    expect(consoleErrors).toEqual([]);
  });

  test(`${theme}: replacement proposals share one popover and dismissal preserves applied actions`, async ({ page }) => {
    const consoleErrors = errors(page);
    await boot(page, theme); await propose(page); await artifact(page).click();
    await popover(page).getByRole('button', { name: 'Apply proposal' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    const applied = await page.locator('.composer-card').allTextContents();
    await propose(page, '0.2', '0.02'); await artifact(page).click();
    await expect(popover(page)).toHaveCount(1); await expect(popover(page)).toContainText('Supply 0.2 USDC');
    await propose(page, '0.3', '0.03');
    await expect(popover(page)).toHaveCount(0); await artifact(page).click();
    await expect(popover(page)).toHaveCount(1); await expect(popover(page)).toContainText('Supply 0.3 USDC');
    await popover(page).getByRole('button', { name: 'Dismiss proposal' }).click();
    expect(await page.locator('.composer-card').allTextContents()).toEqual(applied);
    await propose(page, '0.4', '0.04'); await artifact(page).click();
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate', exact: true }).click();
    await expect(popover(page)).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Build', exact: true }).click();
    await expect(artifact(page)).toBeVisible(); await artifact(page).click();
    await expect(popover(page)).toContainText('Supply 0.4 USDC');
    await page.keyboard.press('Escape');
    const zoom = page.getByRole('slider', { name: 'Canvas zoom' });
    await zoom.focus(); await zoom.press('ArrowRight');
    await expect(artifact(page)).toBeVisible();
    await page.getByRole('button', { name: 'Fit workflow' }).click();
    await expect(artifact(page)).toBeVisible();
    const pane = page.locator('.build-flow-surface .react-flow__pane');
    const bounds = (await pane.boundingBox())!;
    const zoomBefore = Number(await zoom.inputValue());
    await page.mouse.move(bounds.x + 30, bounds.y + 150); await page.mouse.wheel(0, -100);
    await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(zoomBefore);
    const viewport = page.locator('.build-flow-surface .react-flow__viewport');
    const transform = await viewport.getAttribute('style');
    await page.mouse.down({ button: 'middle' }); await page.mouse.move(bounds.x + 60, bounds.y + 170, { steps: 4 }); await page.mouse.up({ button: 'middle' });
    await expect(viewport).not.toHaveAttribute('style', transform!);
    await page.getByRole('button', { name: 'Fit workflow' }).click();
    const title = page.locator('.react-flow__node[data-id="lending-supply"] .composer-action-title');
    const cardBefore = (await title.boundingBox())!;
    await page.mouse.move(cardBefore.x + 30, cardBefore.y + 10); await page.mouse.down();
    await page.mouse.move(cardBefore.x + 60, cardBefore.y + 30, { steps: 4 }); await page.mouse.up();
    expect((await title.boundingBox())!.x).not.toBe(cardBefore.x);
    await expect(artifact(page)).toBeVisible();
    await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '1');
    await noAuthorization(page); expect(consoleErrors).toEqual([]);
  });

  test(`${theme}: responsive review preserves canvas/Copilot geometry and avoids navigation controls`, async ({ page }, testInfo) => {
    const consoleErrors = errors(page);
    await boot(page, theme);
    await page.getByRole('button', { name: 'Add supply', exact: true }).click();
    await configureCanvasAction(page, '1');
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => scrollTo(0, 0));
      const paneWidth = await page.locator('.build-flow-surface').evaluate(element => element.clientWidth);
      await expect(page.locator('.canvas-navigator')).toHaveAttribute('data-compact', String(paneWidth < 800));
      await expect(page.locator('.canvas-navigator')).toHaveAttribute('data-narrow', String(paneWidth < 400));
      const before = await geometry(page);
      await page.getByRole('button', { name: 'Add Supply → Borrow → Swap', exact: true }).click();
      expect(await geometry(page)).toEqual(before);
      await artifact(page).click();
      await expect(popover(page)).toBeVisible();
      await expect.poll(() => fitReview(page)).toBe(true);
      expect(await popover(page).evaluate(element => getComputedStyle(element).backgroundColor)).toBe(theme === 'dark' ? 'rgb(28, 32, 41)' : 'rgb(255, 255, 255)');
      expect(await popover(page).evaluate(element => getComputedStyle(element).fontFamily)).toContain('Outfit');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const pane = page.locator('.build-flow-surface .react-flow__pane');
      expect(await pane.evaluate(element => getComputedStyle(element).cursor)).toContain(`flofi-mascot-cursor${theme === 'dark' ? '-dark' : ''}.png`);
      expect(await page.locator('.dark-spotlight').evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
      if (width === 320 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`proposal-${theme}-${width}.png`) });
      await popover(page).getByRole('button', { name: 'Dismiss proposal' }).click();
      await page.evaluate(() => scrollTo(0, 0));
      expect(await geometry(page)).toEqual(before);
      await expect(page.locator('.react-flow__node')).toHaveCount(1);
    }
    await noAuthorization(page); expect(consoleErrors).toEqual([]);
  });

  test(`${theme}: Copilot edits to an existing amount card use the same contextual review`, async ({ page }) => {
    const consoleErrors = errors(page);
    await boot(page, theme);
    await page.getByRole('button', { name: 'Add supply', exact: true }).click();
    await configureCanvasAction(page, '1');
    const card = page.locator('.composer-card');
    const edit = async () => {
      await page.locator('#mock-prompt').fill('set node-002 amount 2');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(artifact(page)).toBeVisible();
      await expect(card.getByRole('button', { name: 'Apply proposal' })).toHaveCount(0);
      await artifact(page).click();
      await expect(popover(page)).toContainText('Supply 2 USDC');
      await expect(popover(page).getByRole('button', { name: 'Apply proposal' })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Apply proposal' })).toHaveCount(1);
      await expect(card.getByRole('textbox', { name: 'Source amount (USDC)' })).toHaveValue('1');
    };
    await edit(); await page.keyboard.press('Escape'); await expect(artifact(page)).toBeVisible();
    await artifact(page).click(); await popover(page).getByRole('button', { name: 'Dismiss proposal' }).click();
    await expect(card.getByRole('textbox', { name: 'Source amount (USDC)' })).toHaveValue('1');
    await edit(); await popover(page).getByRole('button', { name: 'Apply proposal' }).focus(); await page.keyboard.press('Enter');
    await expect(card.getByRole('textbox', { name: 'Source amount (USDC)' })).toHaveValue('2');
    await expect(page.locator('.react-flow__node')).toHaveCount(1);
    await expect(artifact(page)).toHaveCount(0); await expect(popover(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(card.getByRole('textbox', { name: 'Source amount (USDC)' })).toHaveValue('1');
    await noAuthorization(page); expect(consoleErrors).toEqual([]);
  });
}

test('Copilot liquidity edits retain the card acceptance gate and one contextual interface', async ({ page }) => {
  const consoleErrors = errors(page);
  await boot(page, 'light');
  const submit = async (prefix: string, usdc: string) => {
    await page.locator('#mock-prompt').fill(`${prefix} 0.0001 WETH and ${usdc} USDC minimum 0 WETH and 0 USDC ticks -120 to 120 recipient ${SUPPLY_OWNER}`);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(artifact(page)).toBeVisible(); await artifact(page).click();
  };
  await submit('add liquidity', '1');
  await popover(page).getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await submit('set node-002 liquidity', '2');
  await expect(popover(page)).toContainText('2 USDC');
  await expect(popover(page).getByRole('button', { name: 'Apply proposal' })).toBeEnabled();
  await expect(page.locator('.composer-card').getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apply proposal' })).toHaveCount(1);
  await popover(page).getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.summary-bar')).toHaveAttribute('data-workflow-revision', '2');
  await expect(artifact(page)).toHaveCount(0); await expect(popover(page)).toHaveCount(0);
  await noAuthorization(page); expect(consoleErrors).toEqual([]);
});

test('a changed base revision cannot be accepted through contextual review', async ({ page }) => {
  const consoleErrors = errors(page);
  await boot(page, 'light'); await propose(page); await artifact(page).click();
  await popover(page).getByRole('button', { name: 'Apply proposal' }).click();
  await propose(page, '0.2', '0.02');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await artifact(page).click();
  await expect(popover(page).getByRole('button', { name: 'Apply proposal' })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(artifact(page)).toBeVisible();
  await artifact(page).click(); await popover(page).getByRole('button', { name: 'Dismiss proposal' }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await noAuthorization(page); expect(consoleErrors).toEqual([]);
});
