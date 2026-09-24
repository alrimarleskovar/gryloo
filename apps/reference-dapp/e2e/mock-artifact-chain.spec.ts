// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { hashArtifactBytes, parseArtifactBytes } from '@defi-workflow-engine/workflow-contracts';

const T0 = new Date('2026-09-24T12:00:00.000Z');
const T1 = new Date('2026-09-24T12:00:10.000Z');
const at = (seconds: number) => new Date(T1.getTime() + seconds * 1000);
const RATE = 'synthetic rate 1 WETH = 1,000 USDC';
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const panel = (page: Page) => page.getByRole('region', { name: 'Mocked artifact chain' });
const chip = (page: Page, status: string) => panel(page).getByText(`ARTIFACTS: ${status}`, { exact: true });
const tab = (page: Page, name: 'Build' | 'Simulate' | 'Execute') => page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name, exact: true }).click();

async function open(page: Page) {
  await page.clock.install({ time: T0 });
  await page.goto('/');
  await page.clock.pauseAt(T1);
}
async function apply(page: Page, text: string) {
  await page.getByLabel('Describe a mock edit').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Review proposed edit')).toBeVisible();
  await page.getByRole('button', { name: 'Apply proposal' }).click();
}
async function generate(page: Page) {
  await tab(page, 'Simulate');
  await panel(page).getByRole('button', { name: /^Generate mocked artifacts for revision \d+$/ }).click();
  await expect(chip(page, 'CURRENT')).toBeVisible();
}
async function readIr(page: Page) {
  await tab(page, 'Build');
  await page.locator('.flow-card').nth(1).click();
  const raw = await page.locator('.inspector pre').textContent();
  await tab(page, 'Simulate');
  return JSON.parse(raw!) as { revision: number };
}
async function readJson(page: Page, key: string, label: string) {
  await panel(page).getByRole('button', { name: `Show JSON · ${label}` }).click();
  const text = await panel(page).locator(`pre[data-artifact-json="${key}"]`).textContent();
  await panel(page).getByRole('button', { name: `Hide JSON · ${label}` }).click();
  return { text: text!, value: JSON.parse(text!) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const hash = (page: Page, key: string) => panel(page).locator(`code[data-hash="${key}"]`).textContent();

for (const [from, to, amount] of [['USDC', 'WETH', '2.25'], ['WETH', 'USDC', '0.125']] as const) {
  test(`${from} to ${to}: rendered mocked chain verifies against the frozen contracts (R-5, R-6)`, async ({ page }) => {
    await open(page);
    await apply(page, `swap ${amount} ${from} to ${to} on Base slippage 50 bps`);
    await generate(page);
    const ir = await readIr(page);
    await expect(chip(page, 'CURRENT')).toBeVisible();
    const quote = await readJson(page, 'quote:node-002', 'mocked quote · node-002');
    const set = await readJson(page, 'artifact-set', 'Artifact Set');
    const simulation = await readJson(page, 'simulation-bundle', 'mocked simulation');
    expect(parseArtifactBytes(bytes(quote.value), 'quote-state-artifact')).toEqual(quote.value);
    expect(parseArtifactBytes(bytes(set.value), 'artifact-set')).toEqual(set.value);
    expect(parseArtifactBytes(bytes(simulation.value), 'simulation-bundle')).toEqual(simulation.value);
    const irHash = hashArtifactBytes('semantic-workflow', bytes(ir));
    const quoteHash = hashArtifactBytes('quote-state-artifact', bytes(quote.value));
    const setHash = hashArtifactBytes('artifact-set', bytes(set.value));
    expect(await hash(page, 'semantic-workflow')).toBe(irHash);
    expect(await hash(page, 'quote:node-002')).toBe(quoteHash);
    expect(await hash(page, 'artifact-set')).toBe(setHash);
    expect(await hash(page, 'simulation-bundle')).toBe(hashArtifactBytes('simulation-bundle', bytes(simulation.value)));
    for (const artifact of [quote.value, set.value, simulation.value]) expect(artifact.semanticWorkflowHash).toBe(irHash);
    expect(set.value.artifacts).toEqual([{ artifactId: 'MOCKED.quote.node-002.r1.g1', nodeId: 'node-002', artifactHash: quoteHash }]);
    expect(simulation.value.artifactSetHash).toBe(setHash);
    expect(simulation.value.semanticWorkflowRevision).toBe(ir.revision);
    for (const { text } of [quote, set, simulation]) expect(text).toMatch(/"MOCKED\./);
    expect(quote.value.normalizedValues[0]).toEqual({ name: 'evidence-environment', kind: 'IDENTIFIER', value: 'MOCKED' });
    expect(quote.value.sourceId).toBe('mock.synthetic-fixture');
    expect(quote.value.proposedSpenders).toEqual([]);
    expect(simulation.value.uncertainty[0].code).toBe('MOCKED_SYNTHETIC_DATA');
  });
}

test('chat-created and canvas-created swaps yield identical mocked artifacts', async ({ page }) => {
  const artifacts = [];
  for (const surface of ['chat', 'canvas'] as const) {
    await page.clock.setFixedTime(T1);
    await page.goto('/');
    if (surface === 'chat') await apply(page, 'swap 2.25 USDC to WETH on Base slippage 50 bps');
    else {
      await page.getByLabel('Direction').selectOption('USDC_TO_WETH');
      await page.getByLabel('Input amount (required)').fill('2.25');
      await page.getByLabel('Slippage in bps (required)').fill('50');
      await page.getByRole('button', { name: 'Review swap proposal' }).click();
      await page.getByRole('button', { name: 'Apply proposal' }).click();
    }
    await generate(page);
    artifacts.push([
      (await readJson(page, 'quote:node-002', 'mocked quote · node-002')).text,
      (await readJson(page, 'artifact-set', 'Artifact Set')).text,
      (await readJson(page, 'simulation-bundle', 'mocked simulation')).text,
      await hash(page, 'simulation-bundle'),
    ]);
  }
  expect(artifacts[1]).toEqual(artifacts[0]);
});

test('semantic edits invalidate; presentation, dismissal, no-op and stale proposals do not', async ({ page }) => {
  await open(page);
  await apply(page, 'swap 2.25 USDC to WETH on Base slippage 50 bps');
  await generate(page);
  await expect(page).toHaveScreenshot('simulate-current.png', { fullPage: true });
  await readIr(page);
  await tab(page, 'Execute');
  await tab(page, 'Simulate');
  await expect(chip(page, 'CURRENT')).toBeVisible();
  await tab(page, 'Build');
  await page.getByLabel('Describe a mock edit').fill('set node-002 amount 3');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await apply(page, 'set node-002 amount 2.25');
  await expect(page.getByText('Revision 1', { exact: true })).toBeVisible();
  await page.getByLabel('Describe a mock edit').fill('set node-002 amount 4');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.locator('.flow-card').nth(1).click();
  await page.getByRole('button', { name: 'Lock amount' }).click();
  await expect(page.getByText('Revision 2', { exact: true })).toBeVisible();
  await generate(page);
  await tab(page, 'Build');
  await page.getByRole('button', { name: 'Apply proposal' }).click();
  await expect(page.locator('.error-banner')).toContainText('BASE_REVISION_CONFLICT');
  await tab(page, 'Simulate');
  await expect(chip(page, 'CURRENT')).toBeVisible();
  await tab(page, 'Build');
  await page.getByRole('button', { name: 'Unlock amount' }).click();
  await apply(page, 'set node-002 amount 3');
  await tab(page, 'Simulate');
  await expect(chip(page, 'INVALIDATED')).toBeVisible();
  await expect(panel(page)).toContainText('INVALIDATED · semantic edit (revision 2 → 4)');
  await expect(panel(page).locator('[data-mocked-value]')).toHaveCount(0);
  await expect(panel(page).locator('pre[data-artifact-json]')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /Show JSON/ })).toHaveCount(0);
  await expect(page.getByText('MOCKED ARTIFACTS: INVALIDATED', { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('simulate-invalidated.png', { fullPage: true });
});

test('refresh keeps the IR hash and replaces every downstream hash', async ({ page }) => {
  await open(page);
  await apply(page, 'swap 0.125 WETH to USDC on Base slippage 50 bps');
  await generate(page);
  const before = await Promise.all(['semantic-workflow', 'quote:node-002', 'artifact-set', 'simulation-bundle'].map(key => hash(page, key)));
  await page.clock.pauseAt(at(5));
  await panel(page).getByRole('button', { name: 'Refresh mocked quote' }).click();
  await expect(panel(page)).toContainText('Generated locally at 2026-09-24T12:00:15.000Z');
  const after = await Promise.all(['semantic-workflow', 'quote:node-002', 'artifact-set', 'simulation-bundle'].map(key => hash(page, key)));
  expect(after[0]).toBe(before[0]);
  for (const index of [1, 2, 3]) expect(after[index]).not.toBe(before[index]);
  expect((await readJson(page, 'artifact-set', 'Artifact Set')).value.artifactSetId).toBe('MOCKED.artifact-set.r1.g2');
});

test('expiry is detected on tab resume and on access without any timer firing (R-7)', async ({ page }) => {
  await open(page);
  await apply(page, 'swap 2.25 USDC to WETH on Base slippage 50 bps');
  await generate(page);
  await page.clock.setSystemTime(at(61));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(chip(page, 'EXPIRED')).toBeVisible();
  await expect(panel(page)).toContainText('EXPIRED · the 60-second mock validity window ended');
  await expect(panel(page).locator('[data-mocked-value]')).toHaveCount(0);
  await expect(page).toHaveScreenshot('simulate-expired.png', { fullPage: true });

  await panel(page).getByRole('button', { name: 'Generate mocked artifacts for revision 1' }).click();
  await expect(chip(page, 'CURRENT')).toBeVisible();
  await page.clock.setSystemTime(at(200));
  await panel(page).getByRole('button', { name: 'Show JSON · Artifact Set' }).click();
  await expect(chip(page, 'EXPIRED')).toBeVisible();
  await expect(panel(page).locator('pre[data-artifact-json]')).toHaveCount(0);

  await panel(page).getByRole('button', { name: 'Generate mocked artifacts for revision 1' }).click();
  await expect(chip(page, 'CURRENT')).toBeVisible();
  await page.clock.setSystemTime(at(150));
  await panel(page).getByRole('button', { name: 'Refresh mocked quote' }).click();
  await expect(chip(page, 'EXPIRED')).toBeVisible();

  await panel(page).getByRole('button', { name: 'Generate mocked artifacts for revision 1' }).click();
  await expect(chip(page, 'CURRENT')).toBeVisible();
  await page.clock.setSystemTime(at(400));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(chip(page, 'EXPIRED')).toBeVisible();
});

test('a failed hashing self-check prevents generation and shows an explicit error (R-3)', async ({ page }) => {
  await page.addInitScript(() => { SubtleCrypto.prototype.digest = async () => new ArrayBuffer(32); });
  await page.goto('/');
  await apply(page, 'swap 2.25 USDC to WETH on Base slippage 50 bps');
  await tab(page, 'Simulate');
  await panel(page).getByRole('button', { name: 'Generate mocked artifacts for revision 1' }).click();
  await expect(panel(page).getByRole('alert')).toHaveText('Artifact hashing self-check failed (DIGEST_UNAVAILABLE). No mocked artifacts were generated.');
  await expect(chip(page, 'REJECTED')).toBeVisible();
  await expect(panel(page).locator('[data-mocked-value], pre, code[data-hash]')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /Show JSON/ })).toHaveCount(0);
});

test('ineligible workflows cannot generate; zero outputs carry a blocking finding', async ({ page }) => {
  await open(page);
  await tab(page, 'Simulate');
  await expect(panel(page).getByRole('button', { name: 'Generate mocked artifacts for revision 0' })).toBeDisabled();
  await expect(panel(page)).toContainText('Add a Base swap in Build before generating mocked artifacts.');
  await tab(page, 'Build');
  await apply(page, 'swap 2 USDC to WETH on Base slippage 301 bps');
  await tab(page, 'Simulate');
  await expect(panel(page).getByRole('button', { name: 'Generate mocked artifacts for revision 1' })).toBeDisabled();
  await expect(panel(page)).toContainText('SLIPPAGE_ABOVE_REVIEW_LIMIT on node-002 blocks generation.');
  await tab(page, 'Build');
  await page.locator('.flow-card').nth(1).click();
  await page.getByRole('button', { name: 'Remove node' }).click();
  await apply(page, 'swap 0.000000000999999999 WETH to USDC on Base slippage 0 bps');
  await generate(page);
  await expect(panel(page)).toContainText('BLOCK · MOCKED_OUTPUT_ZERO');
});

test('mocked numbers stay labelled and execution stays unavailable after generation (R-1, R-8)', async ({ page }) => {
  await open(page);
  await apply(page, 'swap 2.25 USDC to WETH on Base slippage 50 bps');
  await generate(page);
  const values = panel(page).locator('[data-mocked-value]');
  expect(await values.count()).toBe(6);
  for (const text of await values.allTextContents()) {
    expect(text).toContain('MOCKED');
    expect(text).toContain(RATE);
  }
  const body = (await panel(page).innerText());
  expect(body).toContain('USD values: not modeled');
  expect(body).not.toMatch(/\$/);
  expect(body).not.toMatch(/\bUSD\s*\d|\d[\d,.]*\s*USD\b/);
  expect(body.replace(/not a live quote/gi, '')).not.toMatch(/\blive\b/i);
  await expect(page.getByText('Mocked artifact chain: synthetic fixture data, not a live quote or a financial simulation.')).toBeVisible();
  for (const name of await page.locator('main button:enabled, footer button:enabled').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') ?? button.textContent ?? ''))) {
    expect(name).not.toMatch(/sign|approv|authori[sz]|submit|execut|wallet|connect/i);
  }
  await expect(page.getByRole('button', { name: 'Manifest review unavailable in Build 003B' })).toBeDisabled();
  await tab(page, 'Execute');
  await expect(page.getByRole('region', { name: 'Execute unavailable' })).toContainText('Mocked quote and simulation artifacts cannot authorize execution.');
  await expect(page.getByRole('button', { name: 'Execution unavailable in Build 003B' })).toBeDisabled();
  await expect(page.getByText('MOCKED ARTIFACTS: CURRENT', { exact: true })).toBeVisible();
});

test('keyboard generation and responsive layout of the mocked chain', async ({ page }) => {
  await open(page);
  await apply(page, 'swap 2.25 USDC to WETH on Base slippage 50 bps');
  await tab(page, 'Simulate');
  await panel(page).getByRole('button', { name: 'Generate mocked artifacts for revision 1' }).focus();
  await page.keyboard.press('Enter');
  await expect(chip(page, 'CURRENT')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Show JSON · Artifact Set' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('pre[data-artifact-json="artifact-set"]')).toBeVisible();
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(chip(page, 'CURRENT')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `horizontal overflow at ${width}px`).toBe(false);
  }
});
