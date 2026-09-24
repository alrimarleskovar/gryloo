// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import { hashArtifactBytes, parseArtifactBytes } from '@defi-workflow-engine/workflow-contracts';
import { digestRawResponse } from '@defi-workflow-engine/reference-linter';

const observation = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Base read-only observation' });

test('replay fails closed for an unrecorded swap and preserves the authority boundary', async ({ page, networkGuard }) => {
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("connect-src 'self'");
  await page.getByLabel('Describe a mock edit').fill('swap 3 USDC to WETH on Base slippage 50 bps');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate' }).click();
  const mocked = page.getByRole('region', { name: 'Mocked artifact chain' });
  await mocked.getByRole('button', { name: 'Generate mocked artifacts for revision 1' }).click();
  await expect(mocked).toContainText('ARTIFACTS: CURRENT');
  const region = observation(page);
  await expect(region).toContainText('Live reads use the single Alchemy Free provider');
  await expect(region).toContainText('Not an authorization input');
  await region.getByRole('button', { name: 'Read Base quote' }).click();
  await expect(region).toContainText('REPLAY_MISMATCH');
  await expect(region.locator('[data-observed-value]')).toHaveCount(0);
  await expect(region).not.toContainText('synthetic rate 1 WETH');
  await expect(mocked).toContainText('ARTIFACTS: CURRENT');
  expect(await mocked.locator('[data-mocked-value]').count()).toBeGreaterThan(0);
  await expect(region.locator('[data-observation-json]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manifest review unavailable' })).toBeDisabled();
  await expect(page.getByText('Revision 1', { exact: true })).toBeVisible();
  networkGuard.assertClean();
});

test('observation controls are keyboard reachable and fit mobile, tablet and desktop widths', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Describe a mock edit').fill('swap 1 WETH to USDC on Base slippage 50 bps');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate' }).click();
  const read = observation(page).getByRole('button', { name: 'Read Base quote' });
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(read).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
  }
  await read.focus();
  await expect(read).toBeFocused();
});

// Saved Base transcripts are historical replay data; these fixed browser times
// fall inside each recorded block's 30-second observation window.
for (const [from, to, amount, at] of [
  ['WETH', 'USDC', '1', '2026-09-24T14:51:42.000Z'],
  ['USDC', 'WETH', '2500', '2026-09-24T14:51:47.000Z'],
] as const) {
  test(`${from} to ${to}: recorded quote is verified, visible and never authorizes action`, async ({ page, networkGuard }) => {
    await page.clock.install({ time: new Date(Date.parse(at) - 1000) });
    await page.goto('/');
    await page.clock.pauseAt(new Date(at));
    await page.getByLabel('Describe a mock edit').fill(`swap ${amount} ${from} to ${to} on Base slippage 50 bps`);
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('button', { name: 'Apply proposal' }).click();
    await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate' }).click();
    const region = observation(page);
    await region.getByRole('button', { name: 'Read Base quote' }).click();
    await expect(region).toContainText('OBSERVATION: CURRENT');
    await expect(region).toContainText('RECORDED REPLAY · NOT LIVE');
    await expect(region.getByRole('table', { name: 'Fee tiers for node-002' }).getByRole('row')).toHaveCount(5);
    await expect(region.locator('[data-observed-value]')).toHaveCount(4);
    await expect(region).toContainText('requireCanonical');
    await expect(region).toContainText('Not an authorization input');
    await expect(region).toContainText('Alchemy Free');
    await expect(region).not.toContainText('synthetic rate 1 WETH');
    await region.getByRole('button', { name: 'Show JSON · Base observation node-002' }).click();
    const artifactText = await region.locator('[data-observation-json="artifact:node-002"]').textContent();
    const artifact = JSON.parse(artifactText!) as { sourceId: string; proposedSpenders: unknown[]; proposedRecipients: unknown[]; outputBounds: unknown[]; uncertainty: { code: string }[] };
    expect(parseArtifactBytes(new TextEncoder().encode(JSON.stringify(artifact)), 'quote-state-artifact')).toEqual(artifact);
    const artifactHash = hashArtifactBytes('quote-state-artifact', new TextEncoder().encode(JSON.stringify(artifact)));
    expect(await region.locator('[data-observation-hash="artifact:node-002"]').textContent()).toBe(artifactHash);
    expect(artifact.sourceId).toBe('base.json-rpc');
    expect(artifact.proposedSpenders).toEqual([]);
    expect(artifact.proposedRecipients).toEqual([]);
    expect(artifact.outputBounds).toEqual([]);
    expect(artifact.uncertainty.map(item => item.code)).toContain('NOT_EVIDENCE');
    await region.getByRole('button', { name: 'Hide JSON · Base observation node-002' }).click();
    await region.getByRole('button', { name: 'Show transcript · node-002' }).click();
    const transcriptText = await region.locator('[data-observation-json="transcript:node-002"]').textContent();
    expect(await region.locator('[data-observation-hash="transcript:node-002"]').textContent())
      .toBe(await digestRawResponse(new TextEncoder().encode(transcriptText!)));
    await region.getByRole('button', { name: 'Hide transcript · node-002' }).click();
    await expect(page.getByRole('button', { name: 'Manifest review unavailable' })).toBeDisabled();
    await expect(page.getByText('Revision 1', { exact: true })).toBeVisible();
    if (from === 'WETH') {
      await expect(page).toHaveScreenshot('observation-recorded.png', { fullPage: true });
      await page.clock.setSystemTime(new Date('2026-09-24T14:52:05.000Z'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(region).toContainText('OBSERVATION: EXPIRED');
      await expect(region.locator('[data-observed-value]')).toHaveCount(0);
      await expect(region.locator('[data-observation-json]')).toHaveCount(0);
      await expect(page).toHaveScreenshot('observation-expired.png', { fullPage: true });
    }
    networkGuard.assertClean();
  });
}

test('a semantic edit retires a recorded quote without touching the mocked chain', async ({ page, networkGuard }) => {
  const at = new Date('2026-09-24T14:51:42.000Z');
  await page.clock.install({ time: new Date(at.getTime() - 1000) });
  await page.goto('/');
  await page.clock.pauseAt(at);
  await page.getByLabel('Describe a mock edit').fill('swap 1 WETH to USDC on Base slippage 50 bps');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate' }).click();
  const mocked = page.getByRole('region', { name: 'Mocked artifact chain' });
  await mocked.getByRole('button', { name: 'Generate mocked artifacts for revision 1' }).click();
  await expect(mocked).toContainText('ARTIFACTS: CURRENT');
  const region = observation(page);
  await region.getByRole('button', { name: 'Read Base quote' }).click();
  await expect(region).toContainText('OBSERVATION: CURRENT');
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Build' }).click();
  await page.getByLabel('Describe a mock edit').fill('set node-002 amount 2');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: 'Simulate' }).click();
  await expect(region).toContainText('OBSERVATION: INVALIDATED');
  await expect(region.locator('[data-observed-value]')).toHaveCount(0);
  await expect(region.locator('[data-observation-json]')).toHaveCount(0);
  await expect(mocked).toContainText('ARTIFACTS: INVALIDATED');
  networkGuard.assertClean();
});
