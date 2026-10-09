// SPDX-License-Identifier: AGPL-3.0-only
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test, expect } from './fixtures';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

// Visual component fixtures exercise the real projection and CSS without RPC, signing, or execution.
// The live Build -> Simulate integration is covered by simulate-product-workspace.spec.ts.
for (const theme of ['light', 'dark']) test(`ready embedded Review component fixture wraps long authorization values in ${theme}`, async ({ page }) => {
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  const styles = await page.locator('head link[rel="stylesheet"]').evaluateAll(links => links.map(link => link.outerHTML).join(''));
  const fontClasses = await page.locator('html').getAttribute('class');
  // Vite renders the actual React components; Playwright's own JSX transform is for its component descriptors.
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const renderer = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
  const currentClock = Date.now;
  let markup: string;
  try {
    const { ReviewWorkspace, ReviewTechnicalDetails } = await renderer.ssrLoadModule('/apps/reference-dapp/src/components/review-workspace.tsx');
    const { SimulationSummary } = await renderer.ssrLoadModule('/apps/reference-dapp/src/components/simulation-summary.tsx');
    const { reviewFixture, reviewNow, reviewSpender } = await renderer.ssrLoadModule('/apps/reference-dapp/src/test-utils/review-fixture.ts');
    const fixture = reviewFixture() as ReturnType<typeof import('../src/test-utils/review-fixture').reviewFixture>;
    const token = fixture.context.assets.USDC.asset;
    if (!('address' in token)) throw new Error('fixture');
    fixture.authorization.approvals.push({ token: token.address, chain: token.chainId, spender: reviewSpender,
      spenderName: 'Provider with a deliberately long authorization-relevant contract name', amount: '123456789123456789123456789123456789', kind: 'exact' });
    fixture.authorization.limits.push({ label: 'Recipient constraint', value: '0x' + 'abcdef'.repeat(30) });
    Date.now = () => reviewNow;
    markup = renderToStaticMarkup(createElement('section', { className: 'simulate-workspace', 'aria-label': 'Workflow simulation workspace' },
      createElement('aside', { className: 'simulation-summary panel', 'aria-label': 'Simulation Summary' }, createElement(SimulationSummary, { workflow: fixture.workflow, context: fixture.context, source: fixture.source })),
      createElement(ReviewWorkspace, { ...fixture, workflowName: 'Long multi-network strategy', backToBuild() {}, showTechnicalDetails: false }),
      createElement('details', { className: 'shell-details technical-workspace' }, createElement('summary', {}, 'View technical details'), createElement(ReviewTechnicalDetails, { authorization: fixture.authorization }))));
  } finally { Date.now = currentClock; await renderer.close(); }
  await page.setContent(`<!doctype html><html class="${fontClasses ?? ''}" data-theme="${theme}"><head>${styles}</head><body><main class="main" aria-label="Simulation workspace">${markup!}</main></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)).toMatch(/^Outfit/);
  expect(await page.locator('.review-wallet-address').evaluate(element => getComputedStyle(element).fontFamily)).toContain('IBM Plex Mono');
  const review = page.getByRole('region', { name: 'Review & Authorization', exact: true });
  await expect(review.getByRole('button', { name: 'Approve & Continue', exact: true })).toBeEnabled();
  await expect(review).toContainText('Ready to approve');
  await expect(review).toContainText('Exactly 123456789123456789123456789123.456789 USDC');
  await expect(page.getByText('View technical details', { exact: true })).toHaveCount(1);
  expect(await page.getByRole('main').innerText()).not.toMatch(/mock|synthetic|artifact|canonical|schemaVersion|manifestHash|undefined|null/);
  expect(await review.locator('img.brand-icon').evaluateAll(images => images.every(image => getComputedStyle(image).filter === 'none'))).toBe(true);
  for (const width of [1440, 1280, 1024, 820, 768, 390, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const panel of [review, review.getByRole('complementary', { name: 'Final confirmation', exact: true }), review.locator('.review-strategy')])
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  const disclosure = page.locator('details.technical-workspace');
  const disclosureControl = disclosure.locator('summary');
  await disclosureControl.focus();
  await disclosureControl.press('Enter');
  await expect(disclosure).toHaveAttribute('open', '');
  expect(await disclosureControl.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: `.tmp/ux007-review-technical-${theme}-320.png`, fullPage: true });
  await disclosureControl.press('Enter');
  await expect(disclosure).not.toHaveAttribute('open');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `.tmp/ux004e-review-${theme}.png`, fullPage: true });
});
