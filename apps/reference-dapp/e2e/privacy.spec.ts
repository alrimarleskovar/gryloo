// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('required Cloak workflow discloses public proceeds and never requests a signature or public execution', async ({ page }) => {
  const external: string[] = [];
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  await page.goto('/');
  await page.getByLabel(/Describe a mock edit/).fill('swap 0.02 SOL to USDC privately');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Privacy: REQUIRED / Cloak. USDC proceeds are public. Remaining SOL change stays private.')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Cloak privacy workflow' });
  await expect(panel.getByText('PRIVACY: REQUIRED / CLOAK')).toBeVisible();
  await page.getByRole('button', { name: 'Simulate', exact: true }).first().click();
  await panel.getByRole('button', { name: 'Check privacy feasibility' }).click();
  await expect(panel.getByText(/Financial simulation not performed/)).toBeVisible();
  const downloading = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export non-executed feasibility report' }).click();
  const download = await downloading;
  await download.saveAs('.turbo/privacy001-feasibility.json');
  const evidenceText = await readFile('.turbo/privacy001-feasibility.json', 'utf8');
  expect(JSON.parse(evidenceText)).toMatchObject({ format: 'flofi.cloak-feasibility.v1', execution: 'NOT_EXECUTED',
    financialSimulation: 'NOT_PERFORMED', acceptance: 'BLOCKED', privacy: { mode: 'required', provider: 'cloak', output: 'public-with-private-change' } });
  expect(evidenceText).not.toMatch(/inputNotes|outputNotes|privateKey|viewingKeyNk|noteSalt|blinding|passphrase/);
  await page.getByRole('button', { name: 'Execute', exact: true }).first().click();
  await expect(panel.getByRole('button', { name: 'Review and authorize Cloak execution' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Execute swap', exact: true })).toHaveCount(0);
  expect(external).toEqual([]);
});

test('unsupported original request cannot become a public Jupiter swap', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/Describe a mock edit/).fill('Swap 5 USDC to SOL privately');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('USDC → private SOL is unavailable');
  await expect(page.getByRole('button', { name: 'Apply proposal', exact: true })).toHaveCount(0);
});
