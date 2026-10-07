// SPDX-License-Identifier: AGPL-3.0-only
import { expect, type Page } from '@playwright/test';

/** Settings must be open. Choose a theme through the product's two-state switch. */
export async function selectSettingsTheme(page: Page, theme: string) {
  const value = theme.toLowerCase();
  expect(['light', 'dark']).toContain(value);
  const control = page.getByRole('switch', { name: 'Theme', exact: true });
  if ((await control.getAttribute('aria-checked') === 'true') !== (value === 'dark')) await control.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition');
}
