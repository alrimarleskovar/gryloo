// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from '@playwright/test';

/** Explicitly configure fixtures that exercise already-authored workflows. Toolbar creation itself stays unconfigured. */
export async function configureCanvasAction(page: Page, amount: string) {
  const card = page.locator('.build-flow-surface .composer-card').last();
  await card.getByRole('textbox', { name: 'Source amount (USDC)', exact: true }).fill(amount);
  await card.getByRole('button', { name: 'Review amount', exact: true }).click();
  await page.getByRole('button', { name: 'Apply amount', exact: true }).click();
}
