// SPDX-License-Identifier: AGPL-3.0-only
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { authorSwap, forkPanel, preparedRecord, simulateOnFork, test, expect } from './mode-a-fixtures';
import { assertSimulationReviewBlocked } from './release-safety-fixtures';

if (process.env.GRYLOO_MODE_A_E2E !== 'synthetic') throw new Error('Release fork provenance requires the MOCKED synthetic profile');

for (const direction of ['WETH_TO_USDC', 'USDC_TO_WETH'] as const) {
  test(`${direction}: exact synthetic fork simulation cannot authorize a production wallet request`, async ({ page, fork, testWallet }) => {
    await page.goto('/__engineering');
    await authorSwap(page, direction, direction === 'WETH_TO_USDC' ? '1' : '2500', '100');
    await simulateOnFork(page);
    await expect(forkPanel(page)).toContainText('MOCKED');
    await expect(forkPanel(page).locator('[data-browser-verification="EXACT"]')).toBeVisible();
    await assertSimulationReviewBlocked(page, async () => testWallet.sent.length);
    expect(fork.preparedFiles()).toHaveLength(1);
    const prepared = preparedRecord(fork);
    expect(prepared.payloads).toHaveLength(2);
    expect(readdirSync(join(fork.fixture.journal, prepared.executionId))).toEqual(['prepared.json']);
    expect(await fork.pendingCount()).toBe(0);
  });
}
