// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from '@playwright/test';

/** Explicitly configure fixtures that exercise already-authored workflows. Toolbar creation itself stays unconfigured. */
export async function configureCanvasAction(page: Page, amount: string) {
  const card = page.locator('.build-flow-surface .composer-card').last();
  await card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true }).fill(amount);
  const title = await card.locator('.composer-action-title').innerText();
  const single = ['Supply', 'Borrow', 'Repay', 'Withdraw'].find(action => title.includes(action));
  await card.getByRole('button', { name: single ? `Review ${single} change` : 'Review amount', exact: true }).click();
  await card.getByRole('button', { name: single ? 'Apply proposal' : 'Apply amount', exact: true }).click();
}

/** Opening settings is an explicit user action, independent of node selection. */
export async function openCanvasSettings(page: Page) {
  await page.locator('.build-flow-surface .composer-card.active').getByRole('button', { name: 'Advanced Settings', exact: true }).click();
}

/** Configure a neutral Pool through the existing card Review/Apply controls. */
export async function configureCanvasPool(page: Page, usdc = '1', weth = '0.0001') {
  const card = page.locator('.build-flow-surface .composer-card').last();
  await card.getByRole('textbox', { name: 'First liquidity amount (USDC)', exact: true }).fill(usdc);
  await card.getByRole('textbox', { name: 'Second liquidity amount (WETH)', exact: true }).fill(weth);
  await card.getByRole('button', { name: 'Review', exact: true }).click();
  await card.getByRole('button', { name: 'Apply', exact: true }).click();
}
