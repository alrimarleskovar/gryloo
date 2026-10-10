// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from '@playwright/test';
import { expect } from './fixtures';

/** Visible production boundaries only. This never supplies or changes provenance. */
export async function assertSimulationReviewBlocked(page: Page, requests: () => Promise<number>) {
  await expect(page.locator('.canvas-primary-action').getByRole('button', { name: 'Approve & Continue', exact: true })).toBeDisabled();
  await expect(page.locator('.review-authorization-details')).toContainText('A simulation that can authorize this workflow is required before approval.');
  await expect(page.getByRole('region', { name: 'Authorization technical details', exact: true }).first()).toContainText('Strategy Manifest');
  await expect(page.getByRole('button', { name: 'Review approved', exact: true })).toHaveCount(0);
  expect(await requests()).toBe(0);
  await assertExecutionBlocked(page, requests);
  await page.reload();
  await assertExecutionBlocked(page, requests);
}

export async function assertExecutionBlocked(page: Page, requests: () => Promise<number>) {
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(page.locator('.canvas-primary-action')).toBeVisible();
  await expect(page.locator('.canvas-primary-action button[data-lifecycle-action="execute"]:not(:disabled), .canvas-primary-action button[data-lifecycle-action="continue"]:not(:disabled)')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Download.*Evidence Bundle/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Result Summary', exact: true })).toHaveCount(0);
  expect(await requests()).toBe(0);
}
